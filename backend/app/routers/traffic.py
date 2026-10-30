from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.geo import BBox
from app.models import (
    CautionZonesResponse,
    IncidentsResponse,
    PredictionsResponse,
    ProtectionZonesResponse,
    SpeedBumpsResponse,
    TrafficFlowResponse,
)
from app.service import TrafficService, default_forecast_time
from app.timeutil import KST

router = APIRouter(prefix="/api/traffic", tags=["traffic"])

# 한 번에 요청할 수 있는 영역의 한 변 최대 길이(도). 소통정보는 링크 수가 많아(2km 영역에 약 500개) 더 좁게 제한한다.
MAX_SPAN_DEG = 0.3
MAX_FLOW_SPAN_DEG = 0.05
# 과속방지턱은 외부 API 호출이 아니라 로컬 SQLite 조회라 비용 부담이 없다. 경로 전체(예: 서울-부산)를
# 한 번에 조회할 수 있도록 국내 범위(위 ge/le) 전체를 덮는 값으로 둔다.
MAX_SPEED_BUMP_SPAN_DEG = 10.0


def get_service(request: Request) -> TrafficService:
    return request.app.state.service


def _bbox(min_lon: float, max_lon: float, min_lat: float, max_lat: float, max_span: float) -> BBox:
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status_code=422, detail="min 값은 max 값보다 작아야 합니다.")
    if max_lon - min_lon > max_span or max_lat - min_lat > max_span:
        raise HTTPException(status_code=422, detail="영역이 너무 큽니다. 한 변은 %.2f도 이하여야 합니다." % max_span)
    return BBox(min_lon, max_lon, min_lat, max_lat)


def bbox_params(
    min_lon: float = Query(..., ge=123.5, le=132.5),
    max_lon: float = Query(..., ge=123.5, le=132.5),
    min_lat: float = Query(..., ge=32.5, le=39.0),
    max_lat: float = Query(..., ge=32.5, le=39.0),
) -> BBox:
    return _bbox(min_lon, max_lon, min_lat, max_lat, MAX_SPAN_DEG)


def flow_bbox_params(
    min_lon: float = Query(..., ge=123.5, le=132.5),
    max_lon: float = Query(..., ge=123.5, le=132.5),
    min_lat: float = Query(..., ge=32.5, le=39.0),
    max_lat: float = Query(..., ge=32.5, le=39.0),
) -> BBox:
    return _bbox(min_lon, max_lon, min_lat, max_lat, MAX_FLOW_SPAN_DEG)


def speed_bump_bbox_params(
    min_lon: float = Query(..., ge=123.5, le=132.5),
    max_lon: float = Query(..., ge=123.5, le=132.5),
    min_lat: float = Query(..., ge=32.5, le=39.0),
    max_lat: float = Query(..., ge=32.5, le=39.0),
) -> BBox:
    return _bbox(min_lon, max_lon, min_lat, max_lat, MAX_SPEED_BUMP_SPAN_DEG)


@router.get("/incidents", response_model=IncidentsResponse, summary="돌발상황(사고·공사·정체 등) - 실시간")
async def incidents(bbox: BBox = Depends(bbox_params), service: TrafficService = Depends(get_service)):
    items, meta = await service.incidents(bbox)
    return IncidentsResponse(meta=meta, items=items)


@router.get("/caution-zones", response_model=CautionZonesResponse, summary="주의운전구간(고속도로) - 실시간")
async def caution_zones(bbox: BBox = Depends(bbox_params), service: TrafficService = Depends(get_service)):
    items, meta = await service.caution_zones(bbox)
    return CautionZonesResponse(meta=meta, items=items)


@router.get("/protection-zones", response_model=ProtectionZonesResponse, summary="어린이·노인·장애인 보호구역 - 등록 현황")
async def protection_zones(
    sgg_cd: str = Query(..., pattern=r"^\d{5}$", description="시군구코드 5자리"),
    include_geometry: bool = Query(False, description="true 면 GeoJSON 형상을 포함한다(응답이 커진다)"),
    service: TrafficService = Depends(get_service),
):
    items, meta = await service.protection_zones(sgg_cd, include_geometry)
    return ProtectionZonesResponse(meta=meta, items=items)


@router.get("/speed-bumps", response_model=SpeedBumpsResponse, summary="과속방지턱 - 행정안전부 등록 현황(로컬 데이터)")
async def speed_bumps(bbox: BBox = Depends(speed_bump_bbox_params), service: TrafficService = Depends(get_service)):
    items, meta = await service.speed_bumps(bbox)
    return SpeedBumpsResponse(meta=meta, items=items)


@router.get("/flow", response_model=TrafficFlowResponse, summary="교통소통(링크별 속도) - 실시간")
async def traffic_flow(bbox: BBox = Depends(flow_bbox_params), service: TrafficService = Depends(get_service)):
    items, meta = await service.traffic_flow(bbox)
    return TrafficFlowResponse(meta=meta, geometry_available=False, items=items)


@router.get("/predictions", response_model=PredictionsResponse, summary="교통예측(우회도로 구간) - 예측 정보, 실시간 아님")
async def predictions(
    section_id: str = Query(..., pattern=r"^\d{1,6}$", description="본선 도로 구간 ID"),
    route_no: str = Query(..., pattern=r"^\d{1,4}$", description="노선 번호(예: 0010)"),
    forecast_for: Optional[datetime] = Query(None, description="예측 대상 시각(KST 기준 정시). 없으면 현재 시각"),
    service: TrafficService = Depends(get_service),
):
    target = default_forecast_time() if forecast_for is None else (
        forecast_for.astimezone(KST) if forecast_for.tzinfo else forecast_for.replace(tzinfo=KST)
    ).replace(minute=0, second=0, microsecond=0)
    items, meta = await service.predictions(section_id, route_no, target)
    return PredictionsResponse(meta=meta, forecast_for=target, items=items)
