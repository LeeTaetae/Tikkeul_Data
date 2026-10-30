import asyncio
from typing import Optional
from math import asin, cos, radians, sin, sqrt

from .providers import KakaoRoutingProvider, NavigationProvider, TmapProvider
from .schemas import LatLng, RouteOption, RouteStyle, StyledRoute, TransitRouteOption, TravelMode

LONG_DISTANCE_KM_THRESHOLD = 30.0

# Tmap searchOption 코드 매핑 (app/providers.py의 TmapProvider.get_route_styled 참고)
ROUTE_STYLE_SEARCH_OPTIONS: dict[RouteStyle, str] = {
    "recommended": "0",
    "toll_free": "1",
    "major_road": "4",
    "shortest": "10",
    "avoid_school_zone": "19",
}


def haversine_km(a: LatLng, b: LatLng) -> float:
    earth_radius_km = 6371.0
    dlat = radians(b.lat - a.lat)
    dlng = radians(b.lng - a.lng)
    h = sin(dlat / 2) ** 2 + cos(radians(a.lat)) * cos(radians(b.lat)) * sin(dlng / 2) ** 2
    return 2 * earth_radius_km * asin(sqrt(h))


def choose_provider_order(
    distance_km: float, tmap: NavigationProvider, naver: NavigationProvider
) -> list[NavigationProvider]:
    """장거리면 Tmap을 먼저, 아니면 Naver를 먼저 시도한다. 직선거리 기반 1차 근사치."""
    return [tmap, naver] if distance_km >= LONG_DISTANCE_KM_THRESHOLD else [naver, tmap]


async def get_best_route(
    origin: LatLng,
    destination: LatLng,
    tmap: NavigationProvider,
    naver: NavigationProvider,
) -> RouteOption:
    distance_km = haversine_km(origin, destination)
    last_error: Optional[Exception] = None
    for provider in choose_provider_order(distance_km, tmap, naver):
        try:
            return await provider.get_route(origin, destination)
        except Exception as exc:  # noqa: BLE001 - 다음 provider로 폴백하기 위한 의도적 포괄 처리
            last_error = exc
    raise RuntimeError("모든 경로 provider 호출에 실패했습니다") from last_error


async def get_route_styles(
    origin: LatLng,
    destination: LatLng,
    tmap: TmapProvider,
    styles: Optional[list[RouteStyle]] = None,
    include_guides: bool = False,
) -> list[StyledRoute]:
    """스타일을 Tmap에 동시 요청한다(기본은 5가지 전부). 실패한 스타일은 결과에서 빠진다.

    styles 로 일부만 요청할 수 있다(재탐색처럼 하나만 필요할 때 Tmap 호출 수를 줄인다). 순서는 ROUTE_STYLE_SEARCH_OPTIONS 를 따른다.
    include_guides 가 켜지면 회전 안내 지점(guides)을 함께 싣는다. 꺼져 있으면 응답에 guides 키가 없다.
    """

    async def fetch(style: RouteStyle, search_option: str) -> Optional[StyledRoute]:
        try:
            route, instructions = await tmap.get_route_styled(origin, destination, search_option)
        except Exception:
            return None
        return StyledRoute(
            style=style,
            distance_km=route.distance_km,
            duration_min=route.duration_min,
            path=route.path,
            instructions=instructions,
            guides=route.guides if include_guides else None,
        )

    wanted = ROUTE_STYLE_SEARCH_OPTIONS.items() if styles is None else [
        (style, option) for style, option in ROUTE_STYLE_SEARCH_OPTIONS.items() if style in styles
    ]
    results = await asyncio.gather(*(fetch(style, option) for style, option in wanted))
    return [r for r in results if r is not None]


async def get_mode_route(
    origin: LatLng,
    destination: LatLng,
    mode: TravelMode,
    tmap: TmapProvider,
    kakao: KakaoRoutingProvider,
    include_guides: bool = False,
) -> StyledRoute:
    """도보는 Tmap, 자전거·대중교통은 카카오맵 REST API로 가져온다 (Tmap에 그 둘이 없음).

    회전 안내 지점(guides)은 Tmap 이 주는 도보만 지원한다. 자전거·대중교통은 include_guides 여도 싣지 않는다.
    """
    if mode == "walking":
        route, instructions = await tmap.get_pedestrian_route(origin, destination)
        guides = route.guides if include_guides else None
    elif mode == "cycling":
        route, instructions = await kakao.get_bicycle_route(origin, destination)
        guides = None
    else:
        route, instructions = await kakao.get_transit_route(origin, destination)
        guides = None
    return StyledRoute(
        style=mode,
        distance_km=route.distance_km,
        duration_min=route.duration_min,
        path=route.path,
        instructions=instructions,
        guides=guides,
    )


async def get_transit_routes(
    origin: LatLng, destination: LatLng, kakao: KakaoRoutingProvider
) -> tuple[list[TransitRouteOption], dict[str, int]]:
    return await kakao.get_transit_routes(origin, destination)
