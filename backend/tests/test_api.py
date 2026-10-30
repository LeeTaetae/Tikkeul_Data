import logging

import httpx
import pytest

from app.cache import TtlCache
from tests.conftest import make_settings
from tests.fixtures import (
    CAUTION_ITEMS,
    EVENT_ITEMS,
    FLOW_ITEMS,
    KEYS,
    PREDICTION_ITEMS,
    its_error,
    its_ok,
    zone_header,
    zone_item,
    zone_ok,
)

BBOX = {"min_lon": 126.905, "max_lon": 127.10, "min_lat": 37.455, "max_lat": 37.60}


class Recorder:
    """호출 횟수와 요청을 기록하며 정해진 응답을 돌려주는 핸들러."""

    def __init__(self, respond):
        self.respond = respond
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)


def ok_json(payload):
    return lambda request: httpx.Response(200, json=payload)


# --- 정상 응답 -------------------------------------------------------------
def test_health_reports_configuration_without_secrets(make_client):
    client = make_client(Recorder(ok_json({})), make_settings(its_event_api_key=None))
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["configured"]["its_event_api_key"] is False
    assert body["configured"]["its_traffic_api_key"] is True
    assert not any(secret in client.get("/api/health").text for secret in KEYS.values())


def test_incidents_normalized_filtered_and_snapped(make_client):
    rec = Recorder(ok_json(its_ok(EVENT_ITEMS)))
    client = make_client(rec)
    # 요청 영역 안쪽: 위도 37.455~37.60, 경도 126.905~127.10 → 격자에 맞추면 126.90~127.10 / 37.45~37.60
    response = client.get("/api/traffic/incidents", params={**BBOX, "max_lat": 37.50})
    assert response.status_code == 200
    data = response.json()
    assert data["meta"]["data_kind"] == "realtime" and data["meta"]["stale"] is False and data["meta"]["fetched_at"]
    kinds = sorted(i["kind"] for i in data["items"])
    assert kinds == ["accident", "congestion"]  # 공사(위도 37.59)는 요청 영역 밖이라 제외, 좌표 없는 항목도 제외
    sent = rec.requests[0].url.params
    assert (sent["minX"], sent["maxX"], sent["minY"], sent["maxY"]) == ("126.900000", "127.100000", "37.450000", "37.500000")
    assert sent["getType"] == "json" and sent["type"] == "all" and sent["eventType"] == "all"
    assert sent["apiKey"] == KEYS["its_event_api_key"]


def test_caution_zones_flow_predictions_zones_success(make_client):
    def respond(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("posIncidentInfo"):
            return httpx.Response(200, json=its_ok(CAUTION_ITEMS))
        if path.endswith("trafficInfo"):
            return httpx.Response(200, json=its_ok(FLOW_ITEMS))
        if path.endswith("bypassFCastInfo"):
            return httpx.Response(200, json=its_ok(PREDICTION_ITEMS))
        return httpx.Response(200, json=zone_ok([zone_item()]))

    rec = Recorder(respond)
    client = make_client(rec)

    caution = client.get("/api/traffic/caution-zones", params=BBOX).json()
    assert [z["kind"] for z in caution["items"]] == ["accident_prone", "congestion"]

    flow = client.get("/api/traffic/flow", params={"min_lon": 126.97, "max_lon": 126.99, "min_lat": 37.56, "max_lat": 37.58}).json()
    assert flow["geometry_available"] is False and len(flow["items"]) == 2
    assert flow["meta"]["updated_at"].startswith("2026-10-28T16:55:00")

    pred = client.get("/api/traffic/predictions", params={"section_id": "10", "route_no": "0010", "forecast_for": "2026-10-28T16:40:00+09:00"}).json()
    assert pred["meta"]["data_kind"] == "forecast"  # 예측은 실시간이 아니다
    assert pred["forecast_for"].startswith("2026-10-28T16:00:00")
    sent = [r for r in rec.requests if r.url.path.endswith("bypassFCastInfo")][0].url.params
    assert (sent["sectionId"], sent["routeNo"], sent["fCastDate"], sent["fCastHour"]) == ("10", "0010", "20261028", "16")

    zones = client.get("/api/traffic/protection-zones", params={"sgg_cd": "11110"}).json()
    assert zones["meta"]["data_kind"] == "registry"
    zone = zones["items"][0]
    assert zone["zone_type"] == "child" and zone["center"] and zone["geometry"] is None  # 기본은 형상 제외
    with_geometry = client.get("/api/traffic/protection-zones", params={"sgg_cd": "11110", "include_geometry": "true"}).json()
    assert with_geometry["items"][0]["geometry"]["type"] == "MultiPoint"
    assert len([r for r in rec.requests if "safetyzone" in str(r.url)]) == 1  # 형상 포함 여부와 상관없이 캐시 1회


def test_protection_zones_fetch_all_pages(make_client):
    def respond(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["pageNo"])
        return httpx.Response(200, json=zone_ok([zone_item(ptznMngNo=100 + page)], page=page, total_pages=2))

    rec = Recorder(respond)
    items = make_client(rec).get("/api/traffic/protection-zones", params={"sgg_cd": "11110"}).json()["items"]
    assert [i["id"] for i in items] == ["101", "102"] and len(rec.requests) == 2


# --- 빈 응답 ---------------------------------------------------------------
@pytest.mark.parametrize("path,params", [("incidents", BBOX), ("caution-zones", BBOX)])
def test_empty_its_response_is_ok_not_error(make_client, path, params):
    response = make_client(Recorder(ok_json(its_ok([])))).get("/api/traffic/" + path, params=params)
    assert response.status_code == 200 and response.json()["items"] == []


def test_zone_no_data_is_empty_not_error(make_client):
    response = make_client(Recorder(ok_json(zone_header("ERR_03", "조회된 데이터가 없습니다. : 0건")))).get(
        "/api/traffic/protection-zones", params={"sgg_cd": "99999"}
    )
    assert response.status_code == 200 and response.json()["items"] == []


# --- 오류 응답 -------------------------------------------------------------
@pytest.mark.parametrize(
    "http_status,code,expected_status,expected_code",
    [
        (401, 4005, 502, "UPSTREAM_AUTH"),
        (401, 4002, 502, "UPSTREAM_BAD_REQUEST"),
        (200, 4001, 503, "UPSTREAM_RATE_LIMIT"),
        (500, 4009, 502, "UPSTREAM_ERROR"),
    ],
)
def test_its_error_codes_are_mapped(make_client, http_status, code, expected_status, expected_code):
    client = make_client(Recorder(lambda r: httpx.Response(http_status, json=its_error(code))))
    response = client.get("/api/traffic/incidents", params=BBOX)
    assert response.status_code == expected_status
    assert response.json() == {"error": {"code": expected_code, "message": response.json()["error"]["message"]}}


def test_timeout_and_connection_errors(make_client):
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request):
        raise httpx.ConnectError("no route", request=request)

    assert make_client(Recorder(timeout)).get("/api/traffic/incidents", params=BBOX).status_code == 504
    response = make_client(Recorder(refused)).get("/api/traffic/incidents", params=BBOX)
    assert response.status_code == 503 and response.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_unparseable_responses(make_client):
    html = make_client(Recorder(lambda r: httpx.Response(200, text="<html>점검 중</html>")))
    assert html.get("/api/traffic/incidents", params=BBOX).json()["error"]["code"] == "UPSTREAM_BAD_RESPONSE"
    no_header = make_client(Recorder(ok_json({"body": {}})))
    assert no_header.get("/api/traffic/incidents", params=BBOX).json()["error"]["code"] == "UPSTREAM_BAD_RESPONSE"


def test_zone_errors(make_client):
    param_error = make_client(Recorder(ok_json(zone_header("ERR_01", "입력 파라미터 오류"))))
    assert param_error.get("/api/traffic/protection-zones", params={"sgg_cd": "11110"}).json()["error"]["code"] == "UPSTREAM_BAD_REQUEST"
    gateway = {"OpenAPI_ServiceResponse": {"cmmMsgHeader": {"errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnReasonCode": "30"}}}
    auth = make_client(Recorder(lambda r: httpx.Response(403, json=gateway)))
    assert auth.get("/api/traffic/protection-zones", params={"sgg_cd": "11110"}).json()["error"]["code"] == "UPSTREAM_AUTH"


def test_missing_key_does_not_call_upstream(make_client):
    rec = Recorder(ok_json(its_ok([])))
    client = make_client(rec, make_settings(its_event_api_key=None, protection_zone_service_key="  "))
    response = client.get("/api/traffic/incidents", params=BBOX)
    assert response.status_code == 503 and response.json()["error"]["code"] == "NOT_CONFIGURED"
    assert client.get("/api/traffic/protection-zones", params={"sgg_cd": "11110"}).status_code == 503
    assert rec.requests == []


@pytest.mark.parametrize(
    "path,params",
    [
        ("incidents", {**BBOX, "min_lon": 127.2}),  # min > max
        ("incidents", {**BBOX, "min_lon": 126.0, "max_lon": 127.5}),  # 영역이 너무 큼
        ("incidents", {**BBOX, "min_lat": 10.0}),  # 한국 범위 밖
        ("flow", {"min_lon": 126.9, "max_lon": 127.0, "min_lat": 37.5, "max_lat": 37.6}),  # 소통은 더 좁게 제한
        ("protection-zones", {"sgg_cd": "1111"}),
        ("predictions", {"section_id": "abc", "route_no": "0010"}),
    ],
)
def test_invalid_requests_are_rejected_before_calling_upstream(make_client, path, params):
    rec = Recorder(ok_json(its_ok([])))
    assert make_client(rec).get("/api/traffic/" + path, params=params).status_code == 422
    assert rec.requests == []


# --- 캐시 ------------------------------------------------------------------
def test_cache_hit_and_stale_fallback(make_client, clock):
    settings = make_settings(ttl_incidents_s=60, max_stale_s=600)
    state = {"fail": False}

    def respond(request):
        return httpx.Response(401, json=its_error(4005)) if state["fail"] else httpx.Response(200, json=its_ok(EVENT_ITEMS))

    rec = Recorder(respond)
    client = make_client(rec, settings, TtlCache(clock))

    first = client.get("/api/traffic/incidents", params=BBOX).json()
    clock.advance(30)
    client.get("/api/traffic/incidents", params=BBOX)
    assert len(rec.requests) == 1  # TTL 안에서는 업스트림을 다시 부르지 않는다

    clock.advance(60)  # TTL 지남 → 재호출하지만 업스트림이 실패
    state["fail"] = True
    stale = client.get("/api/traffic/incidents", params=BBOX)
    assert stale.status_code == 200 and stale.json()["meta"]["stale"] is True
    assert stale.json()["meta"]["fetched_at"] == first["meta"]["fetched_at"]  # 마지막 성공 시각을 그대로 보여준다
    assert stale.json()["items"] == first["items"]

    clock.advance(600)  # 허용 시간을 넘기면 오래된 데이터를 내주지 않고 오류를 낸다
    assert client.get("/api/traffic/incidents", params=BBOX).status_code == 502


def test_nearby_requests_share_one_upstream_call(make_client):
    rec = Recorder(ok_json(its_ok(EVENT_ITEMS)))
    client = make_client(rec)
    client.get("/api/traffic/incidents", params={**BBOX, "min_lon": 126.9051})
    client.get("/api/traffic/incidents", params={**BBOX, "min_lon": 126.9099})
    assert len(rec.requests) == 1  # 같은 0.01도 격자라서 캐시를 공유


# --- 보안 ------------------------------------------------------------------
def test_secrets_never_appear_in_logs_or_responses(make_client, caplog):
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("eventInfo"):
            raise httpx.ReadTimeout("timeout while reading %s" % request.url, request=request)  # 키가 든 URL 이 예외에 있다
        return httpx.Response(401, json=its_error(4005))

    client = make_client(Recorder(respond))
    with caplog.at_level(logging.DEBUG):
        responses = [
            client.get("/api/traffic/incidents", params=BBOX),
            client.get("/api/traffic/caution-zones", params=BBOX),
            client.get("/api/traffic/protection-zones", params={"sgg_cd": "11110"}),
            client.get("/api/health"),
        ]
    for secret in KEYS.values():
        assert secret not in caplog.text
        assert all(secret not in r.text for r in responses)


def test_incidents_response_adds_closure_direction_and_stable_key_without_dropping_fields(make_client):
    client = make_client(Recorder(ok_json(its_ok(EVENT_ITEMS))))
    items = client.get("/api/traffic/incidents", params=BBOX).json()["items"]
    accident = next(i for i in items if i["kind"] == "accident")
    # 추가된 필드
    assert (accident["closure"], accident["direction_scope"]) == ("partial", "single")
    assert accident["lanes_block_type"] == "차로부분통제" and accident["event_key"] and accident["revision"]
    assert accident["id"] != accident["event_key"]  # 기존 id 는 그대로 두고 안정 키를 따로 준다
    # 기존 필드는 모두 그대로
    legacy = {"id", "kind", "road_type", "event_type", "event_detail_type", "road_name", "road_no", "direction_text",
              "lanes_blocked", "message", "link_id", "location", "started_at", "ended_at"}
    assert legacy <= set(accident)
