"""내비게이션(app/navigation) 테스트. poc/hybrid_navigation_backend/tests 의 서비스 테스트를 옮기고, 통합 서버의 경로·CORS 를 점검한다.

외부 호출(Tmap, Kakao, Naver)은 가짜 provider 로 바꿔서 네트워크와 실제 키를 쓰지 않는다.
backend 에 pytest-asyncio 가 없어서 async 함수는 asyncio.run 으로 실행한다.
"""
import asyncio
from typing import Optional, Set

import httpx
import pytest

from app.navigation import routers as nav_routers
from app.navigation.config import Settings as NavSettings
from app.navigation.schemas import LatLng, RouteGuide, RouteOption, TransitRouteOption
from app.navigation.service import (
    LONG_DISTANCE_KM_THRESHOLD,
    ROUTE_STYLE_SEARCH_OPTIONS,
    choose_provider_order,
    get_best_route,
    get_mode_route,
    get_route_styles,
)
from tests.conftest import make_settings

SEOUL = LatLng(lat=37.5665, lng=126.9780)
BUSAN = LatLng(lat=35.1796, lng=129.0756)  # ~325km, 장거리
NEARBY = LatLng(lat=37.5700, lng=126.9825)  # ~5km, 단거리
VERCEL = "https://tikkeul-data.vercel.app"
BODY = {"origin": {"lat": 37.5665, "lng": 126.978}, "destination": {"lat": 37.4979, "lng": 127.0276}}


# --- 서비스 로직 (PoC tests/test_service.py 이식) ----------------------------------
class FakeProvider:
    def __init__(self, name: str, *, fails: bool = False):
        self.name = name
        self.fails = fails
        self.called = False

    async def get_route(self, origin: LatLng, destination: LatLng) -> RouteOption:
        self.called = True
        if self.fails:
            raise RuntimeError("%s 호출 실패" % self.name)
        return RouteOption(provider="tmap" if self.name == "tmap" else "naver", distance_km=1, duration_min=1, path=[])


def test_long_distance_prefers_tmap():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    assert choose_provider_order(LONG_DISTANCE_KM_THRESHOLD + 1, tmap, naver) == [tmap, naver]


def test_short_distance_prefers_naver():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    assert choose_provider_order(LONG_DISTANCE_KM_THRESHOLD - 1, tmap, naver) == [naver, tmap]


def test_long_distance_route_uses_tmap_first():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    result = asyncio.run(get_best_route(SEOUL, BUSAN, tmap, naver))
    assert result.provider == "tmap" and naver.called is False


def test_short_distance_route_uses_naver_first():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    result = asyncio.run(get_best_route(SEOUL, NEARBY, tmap, naver))
    assert result.provider == "naver" and tmap.called is False


def test_falls_back_when_primary_provider_fails():
    tmap, naver = FakeProvider("tmap", fails=True), FakeProvider("naver")
    result = asyncio.run(get_best_route(SEOUL, BUSAN, tmap, naver))
    assert result.provider == "naver" and tmap.called is True


def test_raises_when_both_providers_fail():
    tmap, naver = FakeProvider("tmap", fails=True), FakeProvider("naver", fails=True)
    with pytest.raises(RuntimeError):
        asyncio.run(get_best_route(SEOUL, BUSAN, tmap, naver))


class FakeStyledTmapProvider:
    """get_route_styled 가 호출된 searchOption 을 거리 값으로 돌려주는 가짜 provider."""

    def __init__(self, *, fail_options: Optional[Set[str]] = None):
        self.fail_options = fail_options or set()
        self.seen_options = []

    async def get_route_styled(self, origin, destination, search_option="0"):
        self.seen_options.append(search_option)
        if search_option in self.fail_options:
            raise RuntimeError("tmap 호출 실패")
        route = RouteOption(provider="tmap", distance_km=float(search_option), duration_min=1, path=[])
        return route, ["option %s 안내" % search_option]


def test_get_route_styles_calls_all_five_search_options():
    tmap = FakeStyledTmapProvider()
    routes = asyncio.run(get_route_styles(SEOUL, BUSAN, tmap))
    assert {r.style for r in routes} == set(ROUTE_STYLE_SEARCH_OPTIONS)
    assert sorted(tmap.seen_options) == sorted(ROUTE_STYLE_SEARCH_OPTIONS.values())


def test_get_route_styles_drops_failed_styles():
    tmap = FakeStyledTmapProvider(fail_options={"19"})  # 어린이보호구역 회피만 실패
    routes = asyncio.run(get_route_styles(SEOUL, BUSAN, tmap))
    assert "avoid_school_zone" not in {r.style for r in routes}
    assert len(routes) == len(ROUTE_STYLE_SEARCH_OPTIONS) - 1


class FakePedestrianTmapProvider:
    async def get_pedestrian_route(self, origin, destination):
        return RouteOption(provider="tmap", distance_km=1.2, duration_min=15, path=[]), ["보행자도로를 따라 이동"]


class FakeKakaoRoutingProvider:
    def __init__(self):
        self.called_with = []

    async def get_bicycle_route(self, origin, destination):
        self.called_with.append("cycling")
        return RouteOption(provider="kakao", distance_km=3.4, duration_min=20, path=[]), ["자전거도로를 따라 이동"]

    async def get_transit_route(self, origin, destination):
        self.called_with.append("transit")
        return RouteOption(provider="kakao", distance_km=5.6, duration_min=30, path=[]), ["2호선 탑승"]


def test_get_mode_route_walking_uses_tmap_pedestrian():
    tmap, kakao = FakePedestrianTmapProvider(), FakeKakaoRoutingProvider()
    route = asyncio.run(get_mode_route(SEOUL, NEARBY, "walking", tmap, kakao))
    assert route.style == "walking" and route.distance_km == 1.2 and kakao.called_with == []


def test_get_mode_route_cycling_and_transit_use_kakao():
    tmap, kakao = FakePedestrianTmapProvider(), FakeKakaoRoutingProvider()
    cycling = asyncio.run(get_mode_route(SEOUL, NEARBY, "cycling", tmap, kakao))
    transit = asyncio.run(get_mode_route(SEOUL, NEARBY, "transit", tmap, kakao))
    assert (cycling.style, transit.style) == ("cycling", "transit")
    assert kakao.called_with == ["cycling", "transit"]


# --- HTTP 엔드포인트 (통합 서버에서 PoC 경로·응답 형식이 유지되는지) -----------------------
class StubTmap:
    def __init__(self, app_key):
        self.app_key = app_key

    async def get_route(self, origin, destination):
        return RouteOption(provider="tmap", distance_km=1.0, duration_min=2.0, path=[origin, destination])

    async def get_route_styled(self, origin, destination, search_option="0"):
        route = RouteOption(provider="tmap", distance_km=float(search_option), duration_min=2.0, path=[origin, destination])
        return route, ["직진"]

    async def get_pedestrian_route(self, origin, destination):
        return RouteOption(provider="tmap", distance_km=1.2, duration_min=15, path=[origin, destination]), ["도보 안내"]


class StubNaver:
    def __init__(self, client_id, client_secret):
        pass

    async def get_route(self, origin, destination):
        return RouteOption(provider="naver", distance_km=3.0, duration_min=5.0, path=[origin, destination])


class StubKakao:
    fail_geocode = False

    def __init__(self, rest_api_key):
        pass

    async def get_bicycle_route(self, origin, destination):
        return RouteOption(provider="kakao", distance_km=3.4, duration_min=20, path=[origin, destination]), ["자전거 안내"]

    async def get_transit_route(self, origin, destination):
        return RouteOption(provider="kakao", distance_km=5.6, duration_min=30, path=[origin, destination]), ["2호선 탑승"]

    async def get_transit_routes(self, origin, destination):
        option = TransitRouteOption(
            type="SUBWAY", distance_km=5.6, duration_min=30, transfers=0, fare=1400, path=[origin, destination]
        )
        return [option], {"total": 1, "bus": 0, "subway": 1, "bus_and_subway": 0}

    async def reverse_geocode(self, point):
        if StubKakao.fail_geocode:
            raise RuntimeError("kakao 실패")
        return "서울특별시 중구 세종대로 110"


@pytest.fixture
def nav_client(make_client, monkeypatch):
    monkeypatch.setattr(nav_routers, "get_settings", lambda: NavSettings(_env_file=None))
    monkeypatch.setattr(nav_routers, "TmapProvider", StubTmap)
    monkeypatch.setattr(nav_routers, "NaverProvider", StubNaver)
    monkeypatch.setattr(nav_routers, "KakaoRoutingProvider", StubKakao)
    monkeypatch.setattr(StubKakao, "fail_geocode", False)
    return make_client(lambda request: httpx.Response(200, json={}), make_settings(cors_allow_origins=VERCEL))


def test_route_styles_keeps_poc_response_shape(nav_client):
    response = nav_client.post("/navigation/route-styles", json=BODY)
    assert response.status_code == 200
    routes = response.json()["routes"]
    assert {r["style"] for r in routes} == set(ROUTE_STYLE_SEARCH_OPTIONS)
    assert set(routes[0]) == {"style", "distance_km", "duration_min", "path", "instructions"}
    assert routes[0]["path"][0] == {"lat": 37.5665, "lng": 126.978}


def test_route_returns_single_best_route(nav_client):
    response = nav_client.post("/navigation/route", json=BODY)
    assert response.status_code == 200
    routes = response.json()["routes"]
    assert len(routes) == 1 and routes[0]["provider"] in ("tmap", "naver")


@pytest.mark.parametrize("mode", ["walking", "cycling", "transit"])
def test_route_by_mode(nav_client, mode):
    response = nav_client.post("/navigation/route-by-mode", json={**BODY, "mode": mode})
    assert response.status_code == 200
    assert [r["style"] for r in response.json()["routes"]] == [mode]


def test_route_by_mode_rejects_driving(nav_client):
    assert nav_client.post("/navigation/route-by-mode", json={**BODY, "mode": "driving"}).status_code == 422


def test_transit_routes_response_shape(nav_client):
    data = nav_client.post("/navigation/transit-routes", json=BODY).json()
    assert (data["total"], data["bus"], data["subway"], data["bus_and_subway"]) == (1, 0, 1, 0)
    assert set(data["routes"][0]) >= {"type", "distance_km", "duration_min", "transfers", "fare", "path", "steps"}


def test_reverse_geocode_and_failure_returns_null_address(nav_client):
    ok = nav_client.get("/geocode/reverse", params={"lat": 37.5665, "lng": 126.978})
    assert ok.status_code == 200 and ok.json() == {"address": "서울특별시 중구 세종대로 110"}
    StubKakao.fail_geocode = True
    assert nav_client.get("/geocode/reverse", params={"lat": 37.5665, "lng": 126.978}).json() == {"address": None}


def test_route_styles_503_when_every_style_fails(nav_client, monkeypatch):
    async def always_fail(self, origin, destination, search_option="0"):
        raise RuntimeError("tmap 실패")

    monkeypatch.setattr(StubTmap, "get_route_styled", always_fail)
    assert nav_client.post("/navigation/route-styles", json=BODY).status_code == 503


def test_simple_health_matches_poc(nav_client):
    assert nav_client.get("/health").json() == {"status": "ok"}
    assert nav_client.get("/api/health").json()["status"] == "ok"  # 기존 헬스 체크는 그대로


# --- 라우터 충돌, CORS -------------------------------------------------------------
def test_no_duplicate_routes_and_all_existing_paths_present(nav_client):
    pairs = [(m, r.path) for r in nav_client.app.routes if hasattr(r, "methods") for m in r.methods if m != "HEAD"]
    assert len(pairs) == len(set(pairs)), "같은 메서드+경로가 두 번 등록됐다"
    expected = {
        ("GET", "/api/health"), ("GET", "/api/geo/region"), ("GET", "/api/traffic/incidents"),
        ("GET", "/api/traffic/caution-zones"), ("GET", "/api/traffic/protection-zones"),
        ("GET", "/api/traffic/flow"), ("GET", "/api/traffic/predictions"),
        ("GET", "/health"), ("POST", "/navigation/route"), ("POST", "/navigation/route-styles"),
        ("POST", "/navigation/route-by-mode"), ("POST", "/navigation/transit-routes"), ("GET", "/geocode/reverse"),
    }
    assert expected <= set(pairs)


@pytest.mark.parametrize(
    "method,path",
    [("POST", "/navigation/route-styles"), ("POST", "/navigation/transit-routes"), ("GET", "/api/traffic/incidents"),
     ("GET", "/geocode/reverse")],
)
def test_cors_preflight_allows_vercel_origin(nav_client, method, path):
    response = nav_client.options(
        path,
        headers={"Origin": VERCEL, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "content-type"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == VERCEL
    assert method in response.headers["access-control-allow-methods"]


def test_cors_blocks_unlisted_origin_and_adds_header_to_real_response(nav_client):
    denied = nav_client.options(
        "/navigation/route-styles",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert denied.status_code == 400 and "access-control-allow-origin" not in denied.headers
    real = nav_client.post("/navigation/route-styles", json=BODY, headers={"Origin": VERCEL})
    assert real.headers["access-control-allow-origin"] == VERCEL


# --- 회전 안내 지점(guides)·스타일 일부 요청 (추가 전용 변경) ---------------------------------
# Tmap 경로 응답 모양은 공식 문서 샘플(turnType·nextRoadName·Point/LineString)을 따른 것이다. 실제 호출 응답은 아니다.
def _tmap_feature(kind, coords, **props):
    geometry = {"type": kind, "coordinates": coords}
    return {"type": "Feature", "geometry": geometry, "properties": props}


TMAP_PAYLOAD = {
    "type": "FeatureCollection",
    "features": [
        _tmap_feature("Point", [126.978, 37.5665], index=0, pointIndex=0, name="출발지", description="출발",
                      totalDistance=1234, totalTime=300, pointType="S", turnType=200, nextRoadName="세종대로"),
        _tmap_feature("LineString", [[126.978, 37.5665], [126.981, 37.5662]], index=1, lineIndex=0, name="세종대로",
                      description="세종대로 을(를) 따라 300m 이동", distance=300, time=60, roadType=21, facilityType=1),
        _tmap_feature("Point", [126.981, 37.5662], index=2, pointIndex=1, name="세종대로사거리",
                      description="세종대로사거리에서 좌회전", nextRoadName="을지로", turnType=12, pointType="N"),
        _tmap_feature("LineString", [[126.981, 37.5662], [126.985, 37.565]], index=3, lineIndex=1, name="을지로",
                      description="을지로 을(를) 따라 500m 이동", distance=500, time=100),
        _tmap_feature("LineString", [[126.985, 37.565], [126.986, 37.5649]], index=4, lineIndex=2, name="을지로",
                      description="을지로 을(를) 따라 200m 이동", distance=200),  # time 없음
        _tmap_feature("Point", [126.986, 37.5649], index=5, pointIndex=2, name="도착지", description="도착",
                      turnType=201, pointType="E"),
    ],
}


def _legacy_parse(data):
    """리팩터링 전 TmapProvider 의 파싱을 그대로 옮긴 것. 새 파서가 path·instructions·총 거리/시간을 바꾸지 않았는지 비교한다."""
    from app.navigation.providers import _coerce_coordinates

    properties = data["features"][0]["properties"]
    path = [
        LatLng(lat=coord[1], lng=coord[0])
        for feature in data["features"]
        for coord in _coerce_coordinates(feature["geometry"])
    ]
    instructions = [f["properties"]["description"] for f in data["features"][1:] if f["properties"].get("description")]
    return path, instructions, properties.get("totalDistance", 0) / 1000, properties.get("totalTime", 0) / 60


def test_parse_tmap_route_keeps_legacy_path_instructions_and_totals():
    from app.navigation.providers import parse_tmap_route

    route, instructions = parse_tmap_route(TMAP_PAYLOAD)
    path, legacy_instructions, km, minutes = _legacy_parse(TMAP_PAYLOAD)
    assert route.path == path and instructions == legacy_instructions
    assert (route.distance_km, route.duration_min) == (km, minutes)
    assert route.provider == "tmap"


def test_parse_tmap_route_extracts_turn_guides_with_path_positions():
    from app.navigation.providers import parse_tmap_route

    route, _ = parse_tmap_route(TMAP_PAYLOAD)
    guides = route.guides
    assert [g.point_type for g in guides] == ["S", "N", "E"]
    assert [g.turn_type for g in guides] == [200, 12, 201]
    assert guides[1].description == "세종대로사거리에서 좌회전" and guides[1].next_road_name == "을지로"
    assert guides[1].name == "세종대로사거리"
    # path_index 는 path 배열에서 그 안내 지점 좌표의 위치다
    for guide in guides:
        assert (route.path[guide.path_index].lat, route.path[guide.path_index].lng) == (guide.lat, guide.lng)
    assert [g.path_index for g in guides] == [0, 3, 8]  # 좌표 수: 1 + 2 + 1 + 2 + 2 개 뒤에 도착점
    assert [g.index for g in guides] == [0, 2, 5]  # Tmap properties.index 그대로


def test_parse_tmap_route_leg_totals_are_none_when_a_segment_lacks_the_value():
    from app.navigation.providers import parse_tmap_route

    guides = parse_tmap_route(TMAP_PAYLOAD)[0].guides
    assert (guides[0].leg_distance_m, guides[0].leg_time_sec) == (300, 60)  # 세종대로 한 구간
    assert guides[1].leg_distance_m == 700  # 500 + 200
    assert guides[1].leg_time_sec is None  # 두 번째 구간에 time 이 없어 합을 모른다(만들어내지 않는다)
    assert (guides[2].leg_distance_m, guides[2].leg_time_sec) == (None, None)  # 도착점 뒤에는 구간이 없다


def test_parse_tmap_route_tolerates_missing_and_odd_fields():
    from app.navigation.providers import parse_tmap_route

    payload = {
        "features": [
            _tmap_feature("Point", [127.0, 37.5], totalDistance=10, totalTime=60),  # index·turnType 등 없음
            _tmap_feature("Point", [127.001, 37.5], index="7", turnType="13", description=None, nextRoadName=123),
            _tmap_feature("Point", [127.002, 37.5], turnType=True),  # 불리언은 숫자로 읽지 않는다
        ]
    }
    guides = parse_tmap_route(payload)[0].guides
    assert guides[0].index == 0 and guides[0].turn_type is None and guides[0].point_type == ""
    assert guides[1].index == 7 and guides[1].turn_type == 13  # 문자열 숫자는 읽는다
    assert guides[1].description == "" and guides[1].next_road_name == ""  # 문자열이 아닌 값은 비움
    assert guides[2].turn_type is None


def test_parse_tmap_route_without_points_gives_no_guides_but_same_path():
    from app.navigation.providers import parse_tmap_route

    payload = {"features": [_tmap_feature("LineString", [[127.0, 37.5], [127.1, 37.5]], totalDistance=5, totalTime=10)]}
    route, instructions = parse_tmap_route(payload)
    assert route.guides == [] and len(route.path) == 2 and instructions == []


def _patch_tmap_http(monkeypatch, payload, sent):
    from app.navigation import providers

    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append((str(request.url), request.read()))
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda *a, **kw: real_client(*a, transport=httpx.MockTransport(handler), **kw))


@pytest.mark.parametrize("method", ["driving", "pedestrian"])
def test_tmap_provider_returns_guides_without_changing_the_request(monkeypatch, method):
    import json

    from app.navigation.providers import TmapProvider

    sent = []
    _patch_tmap_http(monkeypatch, TMAP_PAYLOAD, sent)
    provider = TmapProvider("test-key")
    if method == "driving":
        route, instructions = asyncio.run(provider.get_route_styled(SEOUL, NEARBY, "19"))
        assert sent[0][0].endswith("/tmap/routes?version=1")
        assert json.loads(sent[0][1])["searchOption"] == "19"
    else:
        route, instructions = asyncio.run(provider.get_pedestrian_route(SEOUL, NEARBY))
        assert "/tmap/routes/pedestrian" in sent[0][0]
    assert len(route.guides) == 3 and instructions[0].startswith("세종대로")
    assert len(sent) == 1  # 안내 지점을 얻으려고 Tmap 을 더 부르지 않는다


class GuideStyledProvider(FakeStyledTmapProvider):
    async def get_route_styled(self, origin, destination, search_option="0"):
        route, instructions = await super().get_route_styled(origin, destination, search_option)
        route.guides = [RouteGuide(index=0, lat=1.0, lng=2.0, path_index=0, turn_type=12)]
        return route, instructions


def test_get_route_styles_can_request_a_subset_in_declared_order():
    tmap = FakeStyledTmapProvider()
    routes = asyncio.run(get_route_styles(SEOUL, BUSAN, tmap, styles=["shortest", "recommended"]))
    assert [r.style for r in routes] == ["recommended", "shortest"]  # 요청 순서가 아니라 ROUTE_STYLE_SEARCH_OPTIONS 순서
    assert sorted(tmap.seen_options) == ["0", "10"]  # 필요한 것만 Tmap 에 요청했다


def test_get_route_styles_guides_only_when_requested():
    tmap = GuideStyledProvider()
    without = asyncio.run(get_route_styles(SEOUL, BUSAN, tmap, styles=["recommended"]))
    with_guides = asyncio.run(get_route_styles(SEOUL, BUSAN, tmap, styles=["recommended"], include_guides=True))
    assert without[0].guides is None
    assert with_guides[0].guides[0].turn_type == 12


def test_get_mode_route_guides_only_for_walking():
    class WalkingGuides(FakePedestrianTmapProvider):
        async def get_pedestrian_route(self, origin, destination):
            route, instructions = await super().get_pedestrian_route(origin, destination)
            route.guides = [RouteGuide(index=0, lat=1.0, lng=2.0, path_index=0)]
            return route, instructions

    tmap, kakao = WalkingGuides(), FakeKakaoRoutingProvider()
    walking = asyncio.run(get_mode_route(SEOUL, NEARBY, "walking", tmap, kakao, include_guides=True))
    cycling = asyncio.run(get_mode_route(SEOUL, NEARBY, "cycling", tmap, kakao, include_guides=True))
    plain = asyncio.run(get_mode_route(SEOUL, NEARBY, "walking", tmap, kakao))
    assert len(walking.guides) == 1 and cycling.guides is None and plain.guides is None


LEGACY_STYLED_KEYS = {"style", "distance_km", "duration_min", "path", "instructions"}


def test_http_default_responses_keep_the_legacy_shape(nav_client):
    styles = nav_client.post("/navigation/route-styles", json=BODY).json()["routes"]
    walking = nav_client.post("/navigation/route-by-mode", json={**BODY, "mode": "walking"}).json()["routes"]
    assert all(set(r) == LEGACY_STYLED_KEYS for r in styles + walking)
    single = nav_client.post("/navigation/route", json=BODY).json()["routes"][0]
    assert set(single) == {"provider", "distance_km", "duration_min", "path"}  # guides 는 내부 값이라 싣지 않는다


def test_http_include_guides_adds_guides_to_driving_and_walking_only(nav_client, monkeypatch):
    async def styled(self, origin, destination, search_option="0"):
        route = RouteOption(provider="tmap", distance_km=1, duration_min=2, path=[origin, destination],
                            guides=[RouteGuide(index=0, lat=37.5665, lng=126.978, path_index=0, turn_type=12,
                                               description="좌회전", next_road_name="을지로", leg_distance_m=300)])
        return route, ["직진"]

    async def pedestrian(self, origin, destination):
        route = RouteOption(provider="tmap", distance_km=1, duration_min=2, path=[origin, destination],
                            guides=[RouteGuide(index=0, lat=37.5665, lng=126.978, path_index=0, turn_type=211)])
        return route, ["도보"]

    monkeypatch.setattr(StubTmap, "get_route_styled", styled)
    monkeypatch.setattr(StubTmap, "get_pedestrian_route", pedestrian)
    body = {**BODY, "include_guides": True}

    driving = nav_client.post("/navigation/route-styles", json=body).json()["routes"]
    assert all(set(r) == LEGACY_STYLED_KEYS | {"guides"} for r in driving)
    guide = driving[0]["guides"][0]
    assert guide["turn_type"] == 12 and guide["next_road_name"] == "을지로" and guide["leg_distance_m"] == 300
    assert "leg_time_sec" not in guide and "point_type" in guide  # 모르는 숫자 값은 null 이 아니라 키가 빠진다

    walking = nav_client.post("/navigation/route-by-mode", json={**body, "mode": "walking"}).json()["routes"][0]
    assert walking["guides"][0]["turn_type"] == 211
    for mode in ("cycling", "transit"):
        other = nav_client.post("/navigation/route-by-mode", json={**body, "mode": mode}).json()["routes"][0]
        assert "guides" not in other


def test_http_styles_limits_tmap_calls_for_reroute(nav_client, monkeypatch):
    calls = []

    async def recording(self, origin, destination, search_option="0"):
        calls.append(search_option)
        return RouteOption(provider="tmap", distance_km=1, duration_min=2, path=[origin, destination]), ["직진"]

    monkeypatch.setattr(StubTmap, "get_route_styled", recording)
    response = nav_client.post("/navigation/route-styles", json={**BODY, "styles": ["recommended"]})
    assert response.status_code == 200
    assert [r["style"] for r in response.json()["routes"]] == ["recommended"] and calls == ["0"]

    calls.clear()
    nav_client.post("/navigation/route-styles", json={**BODY, "styles": ["recommended", "recommended"]})
    assert calls == ["0"]  # 중복은 한 번만

    calls.clear()
    assert len(nav_client.post("/navigation/route-styles", json=BODY).json()["routes"]) == len(ROUTE_STYLE_SEARCH_OPTIONS)
    assert len(calls) == len(ROUTE_STYLE_SEARCH_OPTIONS)  # styles 를 생략하면 기존처럼 5번


@pytest.mark.parametrize("styles", [[], ["walking"], ["transit"], ["nope"], "recommended"])
def test_http_styles_rejects_empty_or_non_driving_values(nav_client, styles):
    assert nav_client.post("/navigation/route-styles", json={**BODY, "styles": styles}).status_code == 422
