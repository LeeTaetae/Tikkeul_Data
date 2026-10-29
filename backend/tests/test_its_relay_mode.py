"""ITS 중계 모드(한국 PC 의 relay/ 를 거쳐 ITS 를 호출)와 직접 호출 모드의 테스트. 실제 네트워크와 실제 키를 쓰지 않는다."""
import logging

import httpx
import pytest

from app.cache import TtlCache
from tests.conftest import make_settings
from tests.fixtures import CAUTION_ITEMS, EVENT_ITEMS, FLOW_ITEMS, KEYS, PREDICTION_ITEMS, its_error, its_ok
from tests.test_api import BBOX, Recorder

RELAY_URL = "https://relay-test.trycloudflare.com"
RELAY_TOKEN = "RELAY-TOKEN-" + "x" * 24
RELAY = {"its_relay_url": RELAY_URL, "its_relay_token": RELAY_TOKEN}
FLOW_BBOX = {"min_lon": 127.02, "max_lon": 127.06, "min_lat": 37.50, "max_lat": 37.54}

# 엔드포인트 -> (요청 경로, 요청 파라미터, ITS 경로, ITS 응답 항목)
ENDPOINTS = {
    "incidents": ("/api/traffic/incidents", BBOX, "eventInfo", EVENT_ITEMS),
    "caution": ("/api/traffic/caution-zones", BBOX, "posIncidentInfo", CAUTION_ITEMS),
    "flow": ("/api/traffic/flow", FLOW_BBOX, "trafficInfo", FLOW_ITEMS),
    "predictions": ("/api/traffic/predictions", {"section_id": "1", "route_no": "1"}, "bypassFCastInfo", PREDICTION_ITEMS),
}


def ok(items):
    return lambda request: httpx.Response(200, json=its_ok(items))


# --- 직접 호출 모드(중계 설정 없음): 기존 동작 그대로 -------------------------------------
@pytest.mark.parametrize("name", sorted(ENDPOINTS))
def test_direct_mode_calls_its_with_key_in_query_and_no_relay_header(make_client, name):
    url, params, its_path, items = ENDPOINTS[name]
    rec = Recorder(ok(items))
    assert make_client(rec).get(url, params=params).status_code == 200
    request = rec.requests[0]
    assert request.url.host == "openapi.its.go.kr" and request.url.port == 9443 and request.url.path == "/" + its_path
    assert request.url.params["apiKey"].startswith("SECRET-") and request.url.params["getType"] == "json"
    assert "x-relay-token" not in request.headers


def test_blank_relay_url_is_the_same_as_not_set(make_client):
    rec = Recorder(ok(EVENT_ITEMS))
    assert make_client(rec, make_settings(its_relay_url="   ")).get("/api/traffic/incidents", params=BBOX).status_code == 200
    assert rec.requests[0].url.host == "openapi.its.go.kr"


# --- 중계 모드 --------------------------------------------------------------------------
@pytest.mark.parametrize("name", sorted(ENDPOINTS))
def test_relay_mode_uses_relay_url_and_token_header_and_never_sends_its_key(make_client, name):
    url, params, its_path, items = ENDPOINTS[name]
    rec = Recorder(ok(items))
    response = make_client(rec, make_settings(**RELAY)).get(url, params=params)
    assert response.status_code == 200
    request = rec.requests[0]
    assert request.url.host == "relay-test.trycloudflare.com" and request.url.path == "/" + its_path
    assert request.headers["X-Relay-Token"] == RELAY_TOKEN  # 토큰은 헤더로만
    assert "apiKey" not in request.url.params and request.url.params["getType"] == "json"
    assert RELAY_TOKEN not in str(request.url)
    sent = str(request.url) + str(dict(request.headers))
    assert not any(key in sent for key in KEYS.values())  # Render 의 ITS 키는 중계로 가지 않는다


def test_relay_mode_trailing_slash_in_url_is_handled(make_client):
    rec = Recorder(ok(EVENT_ITEMS))
    make_client(rec, make_settings(**{**RELAY, "its_relay_url": RELAY_URL + "/"})).get("/api/traffic/incidents", params=BBOX)
    assert rec.requests[0].url.path == "/eventInfo"


def test_relay_mode_does_not_need_the_its_key_on_this_server(make_client):
    # 키는 중계 PC 에 있다. 이 서버의 키가 없어도 중계 모드는 동작한다.
    settings = make_settings(**RELAY, its_event_api_key=None)
    assert make_client(Recorder(ok(EVENT_ITEMS)), settings).get("/api/traffic/incidents", params=BBOX).status_code == 200


def test_response_schema_is_identical_in_both_modes(make_client):
    direct = make_client(Recorder(ok(EVENT_ITEMS))).get("/api/traffic/incidents", params=BBOX).json()
    relayed = make_client(Recorder(ok(EVENT_ITEMS)), make_settings(**RELAY)).get("/api/traffic/incidents", params=BBOX).json()
    assert set(direct) == set(relayed) == {"meta", "items"}
    assert direct["items"] == relayed["items"]
    assert set(direct["meta"]) == set(relayed["meta"])


@pytest.mark.parametrize(
    "url",
    [
        "http://relay.example.com",
        "ftp://relay.example.com",
        "relay.example.com",
        "https://",
        "http://localhost.evil.example.com",  # 접두사만 같은 외부 주소
        "http://127.0.0.1.evil.example.com",
        "http://evil.example.com/http://127.0.0.1",
    ],
)
def test_relay_url_that_would_send_the_token_in_plain_http_is_refused(make_client, url):
    rec = Recorder(ok(EVENT_ITEMS))
    response = make_client(rec, make_settings(its_relay_url=url, its_relay_token=RELAY_TOKEN)).get("/api/traffic/incidents", params=BBOX)
    assert response.status_code == 503 and response.json()["error"]["code"] == "NOT_CONFIGURED"
    assert rec.requests == []  # 토큰을 어디로도 보내지 않는다


@pytest.mark.parametrize("url", ["http://127.0.0.1:8787", "http://localhost:8787"])
def test_local_plain_http_relay_is_allowed_for_development(make_client, url):
    rec = Recorder(ok(EVENT_ITEMS))
    assert make_client(rec, make_settings(its_relay_url=url, its_relay_token=RELAY_TOKEN)).get("/api/traffic/incidents", params=BBOX).status_code == 200


def test_relay_url_without_token_is_not_configured_and_sends_nothing(make_client):
    rec = Recorder(ok(EVENT_ITEMS))
    response = make_client(rec, make_settings(its_relay_url=RELAY_URL)).get("/api/traffic/incidents", params=BBOX)
    assert response.status_code == 503 and response.json()["error"]["code"] == "NOT_CONFIGURED"
    assert rec.requests == []  # 중계 주소가 있는데 토큰이 없으면 직접 호출로 몰래 바꾸지 않는다


# --- 중계/터널 장애 매핑(오류를 200 으로 숨기지 않는다) ------------------------------------------
@pytest.mark.parametrize(
    "response,status,code",
    [
        (httpx.Response(404, json={"detail": "Not Found"}), 502, "UPSTREAM_AUTH"),  # 토큰이 틀림
        (httpx.Response(504, json={"error": "UPSTREAM_TIMEOUT"}), 504, "UPSTREAM_TIMEOUT"),  # 중계가 ITS 에 못 닿음
        (httpx.Response(502, json={"error": "UPSTREAM_UNAVAILABLE"}), 503, "UPSTREAM_UNAVAILABLE"),
        (httpx.Response(530, text="<html>error code: 1033</html>"), 503, "UPSTREAM_UNAVAILABLE"),  # 터널이 끊김
        (httpx.Response(200, text="<html>not json</html>"), 502, "UPSTREAM_BAD_RESPONSE"),
        (httpx.Response(401, json=its_error(4005)), 502, "UPSTREAM_AUTH"),  # ITS 의 오류는 직접 호출과 똑같이 해석
        (httpx.Response(200, json=its_error(4001)), 503, "UPSTREAM_RATE_LIMIT"),
    ],
)
def test_relay_failures_map_to_existing_error_codes(make_client, response, status, code):
    result = make_client(lambda request: response, make_settings(**RELAY)).get("/api/traffic/incidents", params=BBOX)
    assert result.status_code == status and result.json()["error"]["code"] == code


def test_relay_connection_failures_use_the_existing_timeout_and_unavailable_codes(make_client):
    def timeout(request):
        raise httpx.ConnectTimeout("t", request=request)

    def refused(request):
        raise httpx.ConnectError("c", request=request)

    assert make_client(timeout, make_settings(**RELAY)).get("/api/traffic/incidents", params=BBOX).status_code == 504
    assert make_client(refused, make_settings(**RELAY)).get("/api/traffic/incidents", params=BBOX).status_code == 503


# --- 캐시와 stale 은 그대로 ---------------------------------------------------------------------
def test_cache_and_stale_fallback_work_in_relay_mode(make_client, clock):
    settings = make_settings(ttl_incidents_s=60, max_stale_s=600, **RELAY)
    state = {"down": False}

    def respond(request):
        return httpx.Response(530, text="tunnel down") if state["down"] else httpx.Response(200, json=its_ok(EVENT_ITEMS))

    rec = Recorder(respond)
    client = make_client(rec, settings, TtlCache(clock))
    first = client.get("/api/traffic/incidents", params=BBOX).json()
    clock.advance(30)
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == 1  # TTL 안에서는 중계를 다시 부르지 않는다

    clock.advance(60)
    state["down"] = True  # PC 중계나 터널이 꺼졌다
    stale = client.get("/api/traffic/incidents", params=BBOX)
    assert stale.status_code == 200 and stale.json()["meta"]["stale"] is True and stale.json()["items"] == first["items"]

    clock.advance(600)  # 허용 시간을 넘기면 오류
    assert client.get("/api/traffic/incidents", params=BBOX).status_code == 503


# --- 영향 범위, 비밀 값 --------------------------------------------------------------------------
def test_other_upstreams_never_receive_the_relay_token(make_client):
    seen = []
    region = {"documents": [{"region_type": "B", "code": "1114000000", "region_1depth_name": "서울특별시",
                             "region_2depth_name": "중구", "region_3depth_name": "태평로1가"}]}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "kakao" in request.url.host:
            return httpx.Response(200, json=region)
        return httpx.Response(200, json={"response": {"header": {"resultCode": "ERR_03"}}})

    client = make_client(handler, make_settings(**RELAY))
    assert client.get("/api/geo/region", params={"lat": 37.5665, "lon": 126.978}).status_code == 200
    client.get("/api/traffic/protection-zones", params={"sgg_cd": "11140"})
    assert any(r.url.host == "dapi.kakao.com" for r in seen) and any(r.url.host == "apis.data.go.kr" for r in seen)
    assert all("x-relay-token" not in r.headers for r in seen)


def test_relay_token_never_appears_in_logs_or_responses(make_client, caplog):
    def fail(request):
        raise httpx.ReadTimeout("slow %s token=%s" % (request.url, request.headers.get("x-relay-token")), request=request)

    clients = [
        make_client(fail, make_settings(**RELAY)),
        make_client(Recorder(ok(EVENT_ITEMS)), make_settings(**RELAY)),
        make_client(lambda r: httpx.Response(404, json={"detail": "Not Found"}), make_settings(**RELAY)),
    ]
    with caplog.at_level(logging.DEBUG):
        responses = [c.get("/api/traffic/incidents", params=BBOX) for c in clients] + [clients[1].get("/api/health")]
    for secret in [RELAY_TOKEN, *KEYS.values()]:
        assert secret not in caplog.text, secret
        assert all(secret not in r.text for r in responses), secret
    assert "error=ReadTimeout" in caplog.text  # 원인 종류는 남는다


def test_health_response_is_unchanged_and_hides_relay_settings(make_client):
    body = make_client(Recorder(ok(EVENT_ITEMS)), make_settings(**RELAY)).get("/api/health").json()
    assert set(body) == {"status", "configured"} and set(body["configured"]) == set(KEYS)
