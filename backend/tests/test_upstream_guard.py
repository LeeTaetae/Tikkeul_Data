"""공공 API 호출 보호(속도 제한·429 재시도·실패 쿨다운)와 캐시 조합 테스트. 외부 API 는 모두 MockTransport 이고 실제 호출은 없다."""
import asyncio

import httpx
import pytest

from app import upstream as upstream_module
from app.cache import TtlCache
from app.errors import ApiError
from app.ratelimit import UpstreamGuard, retry_after_seconds
from app.service import TrafficService
from app.upstream import Upstream
from app.geo import BBox
from tests.conftest import make_settings
from tests.fixtures import EVENT_ITEMS, its_error, its_ok
from tests.test_api import BBOX, Recorder, ok_json

SEOUL = {"lat": 37.5665, "lon": 126.978}
KAKAO_REGION_OK = {"documents": [{"region_type": "B", "code": "1114000000", "region_1depth_name": "서울특별시", "region_2depth_name": "중구", "region_3depth_name": "태평로1가"}]}


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    """재시도 대기를 기록만 하고 실제로 기다리지 않는다."""
    waits = []

    async def fake_sleep(seconds):
        waits.append(seconds)

    monkeypatch.setattr(upstream_module.asyncio, "sleep", fake_sleep)
    return waits


def guard_of(client) -> UpstreamGuard:
    return client.app.state.service._up.guard


# --- UpstreamGuard 단위 ----------------------------------------------------
def test_token_bucket_allows_burst_then_blocks_then_refills(clock):
    guard = UpstreamGuard({"its": 60}, 4, clock)
    for _ in range(60):
        guard.check("its")
    with pytest.raises(ApiError) as exc:
        guard.check("its")
    assert exc.value.code == "UPSTREAM_RATE_LIMIT"
    clock.advance(1)  # 분당 60 = 초당 1개 보충
    guard.check("its")
    with pytest.raises(ApiError):
        guard.check("its")


def test_upstreams_are_limited_independently(clock):
    guard = UpstreamGuard({"its": 1, "kakao": 1}, 4, clock)
    guard.check("its")
    with pytest.raises(ApiError):
        guard.check("its")
    guard.check("kakao")  # its 가 소진돼도 kakao 는 영향이 없다


def test_cooldown_blocks_until_it_ends_and_keeps_the_longer_one(clock):
    guard = UpstreamGuard({"its": 100}, 4, clock)
    guard.cool_down("its", 30, "UPSTREAM_TIMEOUT")
    guard.cool_down("its", 5, "UPSTREAM_UNAVAILABLE")  # 더 짧은 쿨다운은 기존 것을 줄이지 못한다
    clock.advance(29)
    with pytest.raises(ApiError) as exc:
        guard.check("its")
    assert exc.value.code == "UPSTREAM_TIMEOUT"
    clock.advance(2)
    guard.check("its")


@pytest.mark.parametrize("value,expected", [("5", 5.0), (" 0 ", 0.0), ("Wed, 21 Oct 2026 07:28:00 GMT", None), ("-1", None), ("", None), (None, None)])
def test_retry_after_parsing(value, expected):
    assert retry_after_seconds(value) == expected


# --- 사용자 1명이 연속 요청 / 캐시 만료 ------------------------------------
def test_repeated_requests_hit_upstream_once_until_ttl_expires(make_client, clock):
    rec = Recorder(ok_json(its_ok(EVENT_ITEMS)))
    client = make_client(rec, make_settings(ttl_incidents_s=60), TtlCache(clock))
    for _ in range(10):
        assert client.get("/api/traffic/incidents", params=BBOX).status_code == 200
    assert len(rec.requests) == 1
    clock.advance(61)  # 캐시 만료
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == 2


# --- 사용자 100명이 동시에 같은 데이터 요청 --------------------------------
def test_100_concurrent_users_share_one_upstream_call():
    calls = []

    async def run() -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            await asyncio.sleep(0)  # 다른 요청이 끼어들 수 있게 양보한다
            return httpx.Response(200, json=its_ok(EVENT_ITEMS))

        settings = make_settings()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            service = TrafficService(Upstream(http, settings), settings, TtlCache())
            bbox = BBox(126.905, 127.10, 37.455, 37.60)
            results = await asyncio.gather(*(service.incidents(bbox) for _ in range(100)))
        assert all(len(items) == len(results[0][0]) for items, _ in results)

    asyncio.run(run())
    assert len(calls) == 1


# --- GPS 가 빠르게 변하는 경우 ---------------------------------------------
def test_rapidly_moving_gps_stays_within_few_upstream_calls(make_client):
    rec = Recorder(ok_json(its_ok(EVENT_ITEMS)))
    client = make_client(rec)
    # 약 1km 안에서 흔들리는 위치 60번(같은 0.01도 격자 + 인접 격자 1개)
    for i in range(60):
        offset = i * 0.00002
        client.get("/api/traffic/incidents", params={**BBOX, "min_lon": 126.9051 + offset, "max_lon": 127.0999 - offset})
    assert len(rec.requests) == 1


# --- 429 -------------------------------------------------------------------
def test_429_with_short_retry_after_is_retried_then_succeeds(make_client, no_real_sleep):
    responses = [httpx.Response(429, headers={"Retry-After": "2"}), httpx.Response(200, json=its_ok(EVENT_ITEMS))]
    rec = Recorder(lambda request: responses.pop(0))
    assert make_client(rec).get("/api/traffic/incidents", params=BBOX).status_code == 200
    assert len(rec.requests) == 2 and no_real_sleep == [2.0]  # Retry-After 를 존중한다


def test_429_with_long_retry_after_does_not_wait_and_cools_down(make_client, no_real_sleep, clock):
    rec = Recorder(lambda request: httpx.Response(429, headers={"Retry-After": "120"}))
    client = make_client(rec, make_settings(ttl_incidents_s=1))
    guard_of(client)._clock = clock

    first = client.get("/api/traffic/incidents", params=BBOX)
    assert first.status_code == 503 and first.json()["error"]["code"] == "UPSTREAM_RATE_LIMIT"
    assert no_real_sleep == [] and len(rec.requests) == 1  # 사용자 요청을 붙잡고 기다리지 않는다

    for _ in range(5):  # 쿨다운 동안은 외부에 추가 요청을 하지 않는다
        assert client.get("/api/traffic/incidents", params=BBOX).status_code == 503
    assert len(rec.requests) == 1

    clock.advance(121)  # Retry-After 이후에는 다시 시도한다
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == 2


def test_persistent_429_without_retry_after_is_bounded_and_uses_backoff(make_client, no_real_sleep):
    rec = Recorder(lambda request: httpx.Response(429))
    assert make_client(rec).get("/api/traffic/incidents", params=BBOX).status_code == 503
    assert len(rec.requests) == upstream_module.MAX_RETRIES + 1  # 무한 재시도 없음
    assert len(no_real_sleep) == upstream_module.MAX_RETRIES and no_real_sleep[1] > no_real_sleep[0]  # 지수 백오프


def test_its_quota_error_code_starts_cooldown(make_client):
    rec = Recorder(lambda request: httpx.Response(200, json=its_error(4001)))
    client = make_client(rec)
    assert client.get("/api/traffic/incidents", params=BBOX).json()["error"]["code"] == "UPSTREAM_RATE_LIMIT"
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == 1


def test_kakao_429_is_retried_and_limited(make_client):
    rec = Recorder(lambda request: httpx.Response(429))
    response = make_client(rec).get("/api/geo/region", params=SEOUL)
    assert response.status_code == 503 and response.json()["error"]["code"] == "UPSTREAM_RATE_LIMIT"
    assert len(rec.requests) == upstream_module.MAX_RETRIES + 1


# --- 500 / 타임아웃 ---------------------------------------------------------
def test_timeout_starts_cooldown_and_stale_data_is_served(make_client, clock):
    settings = make_settings(ttl_incidents_s=60, max_stale_s=600, upstream_failure_cooldown_s=30)
    state = {"fail": False}

    def respond(request):
        if state["fail"]:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, json=its_ok(EVENT_ITEMS))

    rec = Recorder(respond)
    client = make_client(rec, settings, TtlCache(clock))
    guard_of(client)._clock = clock
    first = client.get("/api/traffic/incidents", params=BBOX).json()

    clock.advance(61)
    state["fail"] = True
    for _ in range(5):
        stale = client.get("/api/traffic/incidents", params=BBOX)
        assert stale.status_code == 200 and stale.json()["meta"]["stale"] is True
        assert stale.json()["items"] == first["items"]
    assert len(rec.requests) == 2  # 첫 성공 1번 + 실패 1번. 쿨다운 동안 나머지 4번은 외부를 부르지 않았다

    clock.advance(31)  # 쿨다운이 끝나면 다시 시도한다
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == 3


def test_500_is_retried_a_bounded_number_of_times_then_cools_down(make_client):
    rec = Recorder(lambda request: httpx.Response(503))
    client = make_client(rec)
    assert client.get("/api/traffic/incidents", params=BBOX).status_code >= 500
    assert len(rec.requests) == upstream_module.MAX_RETRIES + 1
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == upstream_module.MAX_RETRIES + 1  # 쿨다운 중이라 늘지 않는다


def test_failure_of_one_upstream_does_not_block_another(make_client):
    def respond(request):
        if request.url.host == "dapi.kakao.com":
            raise httpx.ConnectTimeout("down", request=request)
        return httpx.Response(200, json=its_ok(EVENT_ITEMS))

    client = make_client(Recorder(respond))
    assert client.get("/api/geo/region", params=SEOUL).status_code == 504
    assert client.get("/api/geo/region", params=SEOUL).status_code == 504  # kakao 는 쿨다운
    assert client.get("/api/traffic/incidents", params=BBOX).status_code == 200  # its 는 영향 없음


def test_server_side_rate_limit_stops_calls_without_hitting_upstream(make_client, clock):
    rec = Recorder(ok_json(its_ok(EVENT_ITEMS)))
    client = make_client(rec, make_settings(its_rate_per_min=2, ttl_incidents_s=1), TtlCache(clock))
    guard_of(client)._clock = clock
    stale_flags = []
    for _ in range(5):
        response = client.get("/api/traffic/incidents", params=BBOX)
        assert response.status_code == 200
        stale_flags.append(response.json()["meta"]["stale"])
        clock.advance(2)  # 캐시는 매번 만료되지만 토큰은 분당 2개(30초에 1개)만 보충된다
    assert stale_flags == [False, False, True, True, True]  # 한도를 넘으면 외부를 부르지 않고 마지막 성공 결과로 답한다
    assert len(rec.requests) == 2


# --- 데이터 갱신·삭제 --------------------------------------------------------
def test_incident_removal_is_reflected_after_ttl(make_client, clock):
    state = {"items": EVENT_ITEMS}
    rec = Recorder(lambda request: httpx.Response(200, json=its_ok(state["items"])))
    client = make_client(rec, make_settings(ttl_incidents_s=60), TtlCache(clock))
    assert client.get("/api/traffic/incidents", params=BBOX).json()["items"]
    state["items"] = []  # 사고가 해소돼 사라짐
    assert client.get("/api/traffic/incidents", params=BBOX).json()["items"]  # TTL 안에서는 이전 값
    clock.advance(61)
    assert client.get("/api/traffic/incidents", params=BBOX).json()["items"] == []
