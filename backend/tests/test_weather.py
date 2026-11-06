"""기상청 초단기실황 중계. 실제 기상청 응답 원문이 아니라, 공식 가이드의 구조·항목명을 따라 직접 만든 데이터를 쓴다."""
import asyncio
import logging
from datetime import datetime

import httpx
import pytest

from app.cache import TtlCache
from app.errors import ApiError
from app.timeutil import KST
from app.weather.kma import base_time_candidates, parse_nowcast, to_grid
from app.weather.service import WeatherService
from tests.conftest import FakeClock, make_settings

KMA_KEY = "SECRET-KMA-KEY"
SEOUL = {"lat": 37.5665, "lon": 126.978}


def item(category, value, base_date="20261105", base_time="1200"):
    return {"baseDate": base_date, "baseTime": base_time, "category": category, "nx": 60, "ny": 127, "obsrValue": str(value)}


def ok(*items):
    return {"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"}, "body": {"dataType": "JSON", "items": {"item": list(items)}}}}


def coded(code, msg="x"):
    return {"response": {"header": {"resultCode": code, "resultMsg": msg}}}


SNOW = ok(item("T1H", -1.5), item("RN1", 0.5), item("REH", 85), item("PTY", 3), item("WSD", 2.1))


class Recorder:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        payload = self.responses[min(len(self.requests), len(self.responses)) - 1]
        return payload(request) if callable(payload) else httpx.Response(200, json=payload)


def client_with(make_client, rec, key=KMA_KEY):
    return make_client(rec, make_settings(kma_service_key=key) if key else make_settings())


# ───────────── 격자·시각 ─────────────

def test_grid_matches_official_cells():
    assert to_grid(37.5665, 126.978) == (60, 127)  # 서울시청
    assert to_grid(33.4996, 126.5312) == (53, 38)  # 제주시청(공식 격자표와 일치)


def test_base_time_candidates_use_10_minute_slots_with_10_minute_lag():
    now = datetime(2026, 11, 5, 12, 7, 30, tzinfo=KST)
    assert base_time_candidates(now, 3) == [("20261105", "1150"), ("20261105", "1140"), ("20261105", "1130")]
    assert base_time_candidates(datetime(2026, 11, 5, 12, 10, tzinfo=KST), 1) == [("20261105", "1200")]
    assert base_time_candidates(datetime(2026, 11, 5, 0, 3, tzinfo=KST), 2) == [("20261104", "2350"), ("20261104", "2340")]


# ───────────── 파서 ─────────────

def test_parse_snow():
    p = parse_nowcast(SNOW)
    assert p == {"observed_at": "2026-11-05T12:00:00+09:00", "temp_c": -1.5, "rain_mm_1h": 0.5, "pty": "snow", "humidity_pct": 85.0, "missing": []}


@pytest.mark.parametrize("code,name", [(0, "none"), (1, "rain"), (2, "rain_snow"), (3, "snow"), (4, "shower"), (5, "drizzle"), (6, "drizzle_snow"), (7, "snow_flurry")])
def test_pty_codes(code, name):
    assert parse_nowcast(ok(item("T1H", 5), item("RN1", 0), item("REH", 50), item("PTY", code)))["pty"] == name


def test_missing_values_are_null_and_listed():
    p = parse_nowcast(ok(item("T1H", -999), item("RN1", 900), item("REH", 50), item("PTY", 0)))
    assert p["temp_c"] is None and p["rain_mm_1h"] is None and p["pty"] == "none"
    assert sorted(p["missing"]) == ["RN1", "T1H"]


def test_unknown_pty_code_is_not_guessed():
    p = parse_nowcast(ok(item("T1H", 5), item("RN1", 0), item("REH", 50), item("PTY", 9)))
    assert p["pty"] == "unknown" and "PTY" in p["missing"]


def test_pty_absent_is_reported_as_missing_not_as_clear_weather():
    p = parse_nowcast(ok(item("T1H", 5), item("RN1", 0), item("REH", 50)))
    assert p["pty"] == "unknown" and "PTY" in p["missing"]


def test_rn1_text_forms():
    assert parse_nowcast(ok(item("RN1", "강수없음"), item("PTY", 0)))["rain_mm_1h"] == 0.0
    assert parse_nowcast(ok(item("RN1", "1mm 미만"), item("PTY", 1)))["rain_mm_1h"] == 0.5


def test_no_data_is_none_and_error_codes_map():
    assert parse_nowcast(coded("03", "NODATA_ERROR")) is None
    assert parse_nowcast({"response": {"header": {"resultCode": "00"}, "body": {"items": {"item": []}}}}) is None
    with pytest.raises(ApiError) as e:
        parse_nowcast(coded("30", "SERVICE_KEY_IS_NOT_REGISTERED_ERROR"))
    assert e.value.code == "UPSTREAM_AUTH"
    with pytest.raises(ApiError) as e:
        parse_nowcast(coded("22"))
    assert e.value.code == "UPSTREAM_RATE_LIMIT"
    with pytest.raises(ApiError) as e:
        parse_nowcast(coded("99"))
    assert e.value.code == "UPSTREAM_ERROR"
    with pytest.raises(ApiError) as e:
        parse_nowcast({"unexpected": 1})
    assert e.value.code == "UPSTREAM_BAD_RESPONSE"


# ───────────── 엔드포인트 ─────────────

def test_endpoint_returns_normalized_observation_and_sends_grid_not_coordinates(make_client):
    rec = Recorder(SNOW)
    r = client_with(make_client, rec).get("/api/weather/road", params=SEOUL)
    assert r.status_code == 200
    body = r.json()
    assert body["pty"] == "snow" and body["temp_c"] == -1.5 and body["grid"] == {"nx": 60, "ny": 127}
    assert body["observed_at"] == "2026-11-05T12:00:00+09:00"
    assert body["meta"]["source"] == "kma_ultra_srt_ncst" and body["meta"]["stale"] is False
    assert KMA_KEY not in r.text  # 응답에 키가 없다
    q = dict(rec.requests[0].url.params)
    assert q["nx"] == "60" and q["ny"] == "127" and q["dataType"] == "JSON" and q["serviceKey"] == KMA_KEY
    assert "lat" not in q and "lon" not in q and "37.5665" not in str(rec.requests[0].url)  # 좌표는 업스트림에 가지 않는다


def test_falls_back_to_previous_slots_on_no_data(make_client):
    rec = Recorder(coded("03"), coded("03"), SNOW)
    r = client_with(make_client, rec).get("/api/weather/road", params=SEOUL)
    assert r.status_code == 200 and len(rec.requests) == 3
    times = [dict(q.url.params)["base_time"] for q in rec.requests]
    assert times[0] > times[1] > times[2] or times[0] < times[1]  # 10분씩 거슬러 올라간다(자정 걸침은 문자열 비교가 뒤집힐 수 있다)
    assert len(set(times)) == 3


def test_all_no_data_is_503_unavailable_not_clear_weather(make_client):
    r = client_with(make_client, Recorder(coded("03"))).get("/api/weather/road", params=SEOUL)
    assert r.status_code == 503 and r.json()["error"]["code"] == "WEATHER_UNAVAILABLE"


def test_missing_key_is_503_not_configured_and_makes_no_upstream_call(make_client):
    rec = Recorder(SNOW)
    r = client_with(make_client, rec, key=None).get("/api/weather/road", params=SEOUL)
    assert r.status_code == 503 and r.json()["error"]["code"] == "NOT_CONFIGURED"
    assert rec.requests == []


@pytest.mark.parametrize(
    "respond,status,code",
    [
        (lambda req: httpx.Response(403, text="Forbidden"), 502, "UPSTREAM_AUTH"),
        (lambda req: httpx.Response(429, text="slow down"), 503, "UPSTREAM_RATE_LIMIT"),
        (lambda req: httpx.Response(500, text="boom"), 502, "UPSTREAM_ERROR"),
        (lambda req: httpx.Response(200, text="<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode></OpenAPI_ServiceResponse>"), 502, "UPSTREAM_BAD_RESPONSE"),
    ],
)
def test_upstream_failures_are_errors_never_clear_weather(make_client, respond, status, code):
    r = client_with(make_client, Recorder(respond)).get("/api/weather/road", params=SEOUL)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert KMA_KEY not in r.text


def test_timeout_is_504_and_log_does_not_contain_key_or_coordinates(make_client, caplog):
    def boom(request):
        raise httpx.ConnectTimeout("timed out", request=request)

    with caplog.at_level(logging.DEBUG):
        r = client_with(make_client, Recorder(boom)).get("/api/weather/road", params=SEOUL)
    assert r.status_code == 504 and r.json()["error"]["code"] == "UPSTREAM_TIMEOUT"
    assert KMA_KEY not in caplog.text and "37.5665" not in caplog.text


def test_same_grid_is_cached_and_other_grid_is_fetched(make_client):
    rec = Recorder(SNOW)
    c = client_with(make_client, rec)
    c.get("/api/weather/road", params=SEOUL)
    c.get("/api/weather/road", params={"lat": 37.5667, "lon": 126.9782})  # 같은 5km 격자
    assert len(rec.requests) == 1
    c.get("/api/weather/road", params={"lat": 35.1796, "lon": 129.0756})  # 부산
    assert len(rec.requests) == 2


def test_coordinates_outside_korea_are_rejected(make_client):
    rec = Recorder(SNOW)
    r = client_with(make_client, rec).get("/api/weather/road", params={"lat": 10, "lon": 20})
    assert r.status_code == 422 and rec.requests == []


# ───────────── 서비스: 실패 시 마지막 성공 결과(stale) ─────────────

class FakeUpstream:
    def __init__(self):
        self.calls = 0
        self.fail = False

    async def kma_nowcast(self, base_date, base_time, nx, ny):
        self.calls += 1
        if self.fail:
            from app.errors import api_error

            raise api_error("UPSTREAM_TIMEOUT")
        return SNOW


def test_service_serves_last_success_as_stale_then_gives_up():
    up, clock = FakeUpstream(), FakeClock()
    settings = make_settings(kma_service_key=KMA_KEY, ttl_weather_s=600, max_stale_s=1800)
    svc = WeatherService(up, settings, TtlCache(clock), clock=lambda: datetime(2026, 11, 5, 12, 12, tzinfo=KST))

    first = asyncio.run(svc.road_weather(**SEOUL))
    assert first.meta.stale is False and up.calls == 1

    up.fail = True
    clock.advance(601)  # TTL 만료, 아직 stale 허용 시간 안
    stale = asyncio.run(svc.road_weather(**SEOUL))
    assert stale.meta.stale is True and stale.pty == "snow" and up.calls == 2

    clock.advance(1800)  # stale 허용 시간 초과 -> 오류(앱은 unknown 으로 다룬다)
    with pytest.raises(ApiError) as e:
        asyncio.run(svc.road_weather(**SEOUL))
    assert e.value.code == "UPSTREAM_TIMEOUT"
