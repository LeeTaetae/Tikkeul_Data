from fastapi import APIRouter, HTTPException

from .config import get_settings
from .providers import KakaoRoutingProvider, NaverProvider, TmapProvider
from .schemas import (
    LatLng,
    ModeRouteRequest,
    NavigationResponse,
    ReverseGeocodeResponse,
    RouteRequest,
    RouteStylesRequest,
    RouteStylesResponse,
    TransitRoutesResponse,
)
from .service import get_best_route, get_mode_route, get_route_styles, get_transit_routes

router = APIRouter(prefix="/navigation", tags=["navigation"])
geocode_router = APIRouter(prefix="/geocode", tags=["geocode"])


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


@geocode_router.get("/reverse", response_model=ReverseGeocodeResponse)
async def get_reverse_geocode(lat: float, lng: float) -> ReverseGeocodeResponse:
    settings = get_settings()
    kakao = KakaoRoutingProvider(settings.kakao_rest_api_key)
    try:
        address = await kakao.reverse_geocode(LatLng(lat=lat, lng=lng))
    except Exception:
        address = None
    return ReverseGeocodeResponse(address=address)
