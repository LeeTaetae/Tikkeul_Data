import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException

from .config import get_settings
from .providers import (
    KakaoRoutingProvider,
    NaverProvider,
    TmapProvider,
    translate_address_to_language,
    translate_chinese_query_to_korean,
    translate_places_to_language,
)
from .schemas import (
    LatLng,
    ModeRouteRequest,
    NavigationResponse,
    NearbyPlacesResponse,
    PlaceAtPointResponse,
    PlaceSearchResponse,
    ReverseGeocodeResponse,
    RouteRequest,
    RouteStylesRequest,
    RouteStylesResponse,
    TransitRoutesResponse,
)
from .service import get_best_route, get_mode_route, get_route_styles, get_transit_routes

router = APIRouter(prefix="/navigation", tags=["navigation"])
geocode_router = APIRouter(prefix="/geocode", tags=["geocode"])
places_router = APIRouter(prefix="/places", tags=["places"])

# 카카오 로컬 카테고리 그룹 코드(developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-category).
# "hair"(헤어샵)는 전용 그룹 코드가 없어 키워드 검색("미용실")으로 대신한다.
_CATEGORY_GROUP_CODES: dict[str, str] = {
    "restaurant": "FD6",
    "cafe": "CE7",
    "convenience": "CS2",
    "gas": "OL7",
    "parking": "PK6",
    "pharmacy": "PM9",
    "mart": "MT1",
}
_CATEGORY_KEYWORDS: dict[str, str] = {
    "hair": "미용실",
}


@router.post("/route", response_model=NavigationResponse)
async def post_route(req: RouteRequest) -> NavigationResponse:
    settings = get_settings()
    tmap = TmapProvider(settings.tmap_app_key)
    naver = NaverProvider(settings.naver_client_id, settings.naver_client_secret)
    try:
        best = await get_best_route(req.origin, req.destination, tmap, naver)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return NavigationResponse(routes=[best])


# exclude_none: include_guides 를 켜지 않은 요청은 guides 키가 없는 기존 응답 모양 그대로 받는다.
@router.post("/route-styles", response_model=RouteStylesResponse, response_model_exclude_none=True)
async def post_route_styles(req: RouteStylesRequest) -> RouteStylesResponse:
    settings = get_settings()
    tmap = TmapProvider(settings.tmap_app_key)
    routes = await get_route_styles(
        req.origin, req.destination, tmap, styles=req.styles, include_guides=req.include_guides
    )
    if not routes:
        raise HTTPException(status_code=503, detail="경로를 찾을 수 없습니다")
    return RouteStylesResponse(routes=routes)


@router.post("/route-by-mode", response_model=RouteStylesResponse, response_model_exclude_none=True)
async def post_route_by_mode(req: ModeRouteRequest) -> RouteStylesResponse:
    settings = get_settings()
    tmap = TmapProvider(settings.tmap_app_key)
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    try:
        route = await get_mode_route(req.origin, req.destination, req.mode, tmap, kakao, include_guides=req.include_guides)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"{req.mode} 경로를 찾을 수 없습니다") from exc
    return RouteStylesResponse(routes=[route])


@router.post("/transit-routes", response_model=TransitRoutesResponse)
async def post_transit_routes(req: RouteRequest) -> TransitRoutesResponse:
    settings = get_settings()
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    try:
        options, counts = await get_transit_routes(req.origin, req.destination, kakao)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="대중교통 경로를 찾을 수 없습니다") from exc
    return TransitRoutesResponse(routes=options, **counts)


@places_router.get("/nearby", response_model=NearbyPlacesResponse)
async def get_nearby_places(category: str, lat: float, lng: float, radius_m: int = 1000) -> NearbyPlacesResponse:
    group_code = _CATEGORY_GROUP_CODES.get(category)
    keyword = _CATEGORY_KEYWORDS.get(category)
    if not group_code and not keyword:
        raise HTTPException(status_code=400, detail=f"알 수 없는 장소 카테고리: {category}")
    settings = get_settings()
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    try:
        places = await kakao.search_nearby(
            LatLng(lat=lat, lng=lng), radius_m, category_group_code=group_code, keyword=keyword
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="주변 장소를 찾을 수 없습니다") from exc
    return NearbyPlacesResponse(places=places)


@places_router.get("/search", response_model=PlaceSearchResponse)
async def get_place_search(
    query: str, lat: Optional[float] = None, lng: Optional[float] = None, lang: Optional[str] = None
) -> PlaceSearchResponse:
    if not query.strip():
        return PlaceSearchResponse(places=[])
    settings = get_settings()
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    point = LatLng(lat=lat, lng=lng) if lat is not None and lng is not None else None
    search_query = await translate_chinese_query_to_korean(query, settings.papago_client_id, settings.papago_client_secret)
    try:
        places = await kakao.search_keyword(search_query, point)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="장소를 검색할 수 없습니다") from exc
    places = await translate_places_to_language(places, lang, settings.papago_client_id, settings.papago_client_secret)
    return PlaceSearchResponse(places=places)


@places_router.get("/at", response_model=PlaceAtPointResponse)
async def get_place_at_point(lat: float, lng: float, radius_m: int = 60) -> PlaceAtPointResponse:
    """지도에서 탭한 좌표의 장소 상세 패널용. 주소는 항상 시도하고, 장소명·카테고리는 반경 안에 걸리는 게 있을 때만 채운다."""
    settings = get_settings()
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    point = LatLng(lat=lat, lng=lng)

    async def safe_address() -> Optional[str]:
        try:
            return await kakao.reverse_geocode(point)
        except Exception:
            return None

    async def safe_place():
        try:
            return await kakao.find_place_at(point, radius_m)
        except Exception:
            return None

    address, place = await asyncio.gather(safe_address(), safe_place())
    return PlaceAtPointResponse(
        name=place.name if place else None,
        category=place.category if place else None,
        address=address,
        distance_m=place.distance_m if place else None,
    )


@geocode_router.get("/reverse", response_model=ReverseGeocodeResponse)
async def get_reverse_geocode(lat: float, lng: float, lang: Optional[str] = None) -> ReverseGeocodeResponse:
    settings = get_settings()
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    try:
        address = await kakao.reverse_geocode(LatLng(lat=lat, lng=lng))
    except Exception:
        address = None
    address = await translate_address_to_language(address, lang, settings.papago_client_id, settings.papago_client_secret)
    return ReverseGeocodeResponse(address=address)
