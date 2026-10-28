import pytest

from app.schemas import LatLng, RouteOption
from app.service import (
    LONG_DISTANCE_KM_THRESHOLD,
    ROUTE_STYLE_SEARCH_OPTIONS,
    choose_provider_order,
    get_best_route,
    get_mode_route,
    get_route_styles,
)

SEOUL = LatLng(lat=37.5665, lng=126.9780)
BUSAN = LatLng(lat=35.1796, lng=129.0756)  # ~325km, 장거리
NEARBY = LatLng(lat=37.5700, lng=126.9825)  # ~5km, 단거리


class FakeProvider:
    def __init__(self, name: str, *, fails: bool = False):
        self.name = name
        self.fails = fails
        self.called = False

    async def get_route(self, origin: LatLng, destination: LatLng) -> RouteOption:
        self.called = True
        if self.fails:
            raise RuntimeError(f"{self.name} 호출 실패")
        return RouteOption(provider="tmap" if self.name == "tmap" else "naver", distance_km=1, duration_min=1, path=[])


def test_long_distance_prefers_tmap():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    order = choose_provider_order(LONG_DISTANCE_KM_THRESHOLD + 1, tmap, naver)
    assert order == [tmap, naver]


def test_short_distance_prefers_naver():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    order = choose_provider_order(LONG_DISTANCE_KM_THRESHOLD - 1, tmap, naver)
    assert order == [naver, tmap]


@pytest.mark.asyncio
async def test_long_distance_route_uses_tmap_first():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    result = await get_best_route(SEOUL, BUSAN, tmap, naver)
    assert result.provider == "tmap"
    assert naver.called is False


@pytest.mark.asyncio
async def test_short_distance_route_uses_naver_first():
    tmap, naver = FakeProvider("tmap"), FakeProvider("naver")
    result = await get_best_route(SEOUL, NEARBY, tmap, naver)
    assert result.provider == "naver"
    assert tmap.called is False


@pytest.mark.asyncio
async def test_falls_back_when_primary_provider_fails():
    tmap, naver = FakeProvider("tmap", fails=True), FakeProvider("naver")
    result = await get_best_route(SEOUL, BUSAN, tmap, naver)
    assert result.provider == "naver"
    assert tmap.called is True


@pytest.mark.asyncio
async def test_raises_when_both_providers_fail():
    tmap, naver = FakeProvider("tmap", fails=True), FakeProvider("naver", fails=True)
    with pytest.raises(RuntimeError):
        await get_best_route(SEOUL, BUSAN, tmap, naver)


class FakeStyledTmapProvider:
    """get_route_styled가 호출된 searchOption을 그대로 style 라벨처럼 돌려주는 가짜 provider."""

    def __init__(self, *, fail_options: set[str] | None = None):
        self.fail_options = fail_options or set()
        self.seen_options: list[str] = []

    async def get_route_styled(self, origin, destination, search_option="0"):
        self.seen_options.append(search_option)
        if search_option in self.fail_options:
            raise RuntimeError("tmap 호출 실패")
        route = RouteOption(provider="tmap", distance_km=float(search_option), duration_min=1, path=[])
        return route, [f"option {search_option} 안내"]


@pytest.mark.asyncio
async def test_get_route_styles_calls_all_five_search_options():
    tmap = FakeStyledTmapProvider()
    routes = await get_route_styles(SEOUL, BUSAN, tmap)
    assert {r.style for r in routes} == set(ROUTE_STYLE_SEARCH_OPTIONS)
    assert sorted(tmap.seen_options) == sorted(ROUTE_STYLE_SEARCH_OPTIONS.values())


@pytest.mark.asyncio
async def test_get_route_styles_drops_failed_styles():
    tmap = FakeStyledTmapProvider(fail_options={"19"})  # 어린이보호구역 회피만 실패
    routes = await get_route_styles(SEOUL, BUSAN, tmap)
    assert "avoid_school_zone" not in {r.style for r in routes}
    assert len(routes) == len(ROUTE_STYLE_SEARCH_OPTIONS) - 1


class FakePedestrianTmapProvider:
    async def get_pedestrian_route(self, origin, destination):
        return RouteOption(provider="tmap", distance_km=1.2, duration_min=15, path=[]), ["보행자도로를 따라 이동"]


class FakeKakaoRoutingProvider:
    def __init__(self):
        self.called_with: list[str] = []

    async def get_bicycle_route(self, origin, destination):
        self.called_with.append("cycling")
        return RouteOption(provider="kakao", distance_km=3.4, duration_min=20, path=[]), ["자전거도로를 따라 이동"]

    async def get_transit_route(self, origin, destination):
        self.called_with.append("transit")
        return RouteOption(provider="kakao", distance_km=5.6, duration_min=30, path=[]), ["2호선 탑승"]


@pytest.mark.asyncio
async def test_get_mode_route_walking_uses_tmap_pedestrian():
    tmap, kakao = FakePedestrianTmapProvider(), FakeKakaoRoutingProvider()
    route = await get_mode_route(SEOUL, NEARBY, "walking", tmap, kakao)
    assert route.style == "walking"
    assert route.distance_km == 1.2
    assert kakao.called_with == []


@pytest.mark.asyncio
async def test_get_mode_route_cycling_and_transit_use_kakao():
    tmap, kakao = FakePedestrianTmapProvider(), FakeKakaoRoutingProvider()
    cycling = await get_mode_route(SEOUL, NEARBY, "cycling", tmap, kakao)
    transit = await get_mode_route(SEOUL, NEARBY, "transit", tmap, kakao)
    assert cycling.style == "cycling"
    assert transit.style == "transit"
    assert kakao.called_with == ["cycling", "transit"]
