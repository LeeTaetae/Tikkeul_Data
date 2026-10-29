from fastapi import APIRouter, Depends, Query

from app.models import Region
from app.routers.traffic import get_service
from app.service import TrafficService

router = APIRouter(prefix="/api/geo", tags=["geo"])


@router.get("/region", response_model=Region, summary="좌표 -> 시군구(현행 법정동코드 앞 5자리)")
async def region(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    service: TrafficService = Depends(get_service),
):
    return await service.region(lat, lon)
