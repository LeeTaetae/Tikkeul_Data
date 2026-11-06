from fastapi import APIRouter, Query, Request

from app.weather.models import RoadWeather
from app.weather.service import WeatherService

router = APIRouter(prefix="/api/weather", tags=["weather"])


def get_weather_service(request: Request) -> WeatherService:
    return request.app.state.weather


@router.get(
    "/road",
    response_model=RoadWeather,
    summary="좌표 -> 기상청 초단기실황(비·눈·저온 판단용 관측값). 노면 결빙 정보 아님",
)
async def road_weather(
    request: Request,
    lat: float = Query(..., ge=32.5, le=39.5),
    lon: float = Query(..., ge=124.0, le=132.5),
):
    return await get_weather_service(request).road_weather(lat, lon)


@router.get("/safety", summary="주행 안전용 관측·예보. 장애/오래된 값은 별도 상태로 반환")
async def safety_weather(request: Request,
                         lat: float = Query(..., ge=32.5, le=39.5),
                         lon: float = Query(..., ge=124.0, le=132.5)):
    return await get_weather_service(request).safety_weather(lat, lon)
