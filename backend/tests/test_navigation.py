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
from app.navigation.schemas import LatLng, RouteInstruction, RouteOption, TransitRouteOption
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
        return route, [RouteInstruction(text="option %s 안내" % search_option)]


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
        return RouteOption(provider="tmap", distance_km=1.2, duration_min=15, path=[]), [RouteInstruction(text="보행자도로를 따라 이동")]


class FakeKakaoRoutingProvider:
    def __init__(self):
        self.called_with = []

    async def get_bicycle_route(self, origin, destination):
        self.called_with.append("cycling")
        return RouteOption(provider="kakao", distance_km=3.4, duration_min=20, path=[]), [RouteInstruction(text="자전거도로를 따라 이동")]

    async def get_transit_route(self, origin, destination):
        self.called_with.append("transit")
        return RouteOption(provider="kakao", distance_km=5.6, duration_min=30, path=[]), [RouteInstruction(text="2호선 탑승")]


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
        return route, [RouteInstruction(text="직진")]

    async def get_pedestrian_route(self, origin, destination):
        return RouteOption(provider="tmap", distance_km=1.2, duration_min=15, path=[origin, destination]), [RouteInstruction(text="도보 안내")]


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
        return RouteOption(provider="kakao", distance_km=3.4, duration_min=20, path=[origin, destination]), [RouteInstruction(text="자전거 안내")]

    async def get_transit_route(self, origin, destination):
        return RouteOption(provider="kakao", distance_km=5.6, duration_min=30, path=[origin, destination]), [RouteInstruction(text="2호선 탑승")]

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
