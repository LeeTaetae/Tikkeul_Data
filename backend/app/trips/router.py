from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.navigation.config import get_settings as get_navigation_settings
from app.navigation.providers import translate_labeled_addresses_to_language
from app.trips.models import FrequentDestination, RecentDestination, Trip, TripCreate, TripCreated
from app.trips.service import cell_of, delete_all_trips, frequent_destinations, popular_destinations, recent_destinations

# 며칠치 기록을 볼지의 기본값·상한. 전체 이력을 다 끌어오면 느려지고 쓸모도 없어 최근 구간만 본다.
DEFAULT_HISTORY_DAYS = 30
MAX_HISTORY_DAYS = 365

router = APIRouter(prefix="/api/trips", tags=["trips"])


# 사용자가 한국어로 남긴 실제 목적지 이름이라, 화면 언어가 ko 가 아니면 번역해서 돌려준다
# (navigation 라우터의 장소 검색과 같은 방식, translate_places_to_language 참고). recent/frequent/popular 가 모두 같은 모양을 쓴다.
async def _translate_destinations(destinations: List, lang: Optional[str]) -> List:
    settings = get_navigation_settings()
    translated = await translate_labeled_addresses_to_language(
        [(d.label, d.address_text) for d in destinations], lang, settings.papago_client_id, settings.papago_client_secret
    )
    return [d.model_copy(update={"label": label, "address_text": address}) for d, (label, address) in zip(destinations, translated)]


@router.post("", response_model=TripCreated, status_code=201)
def create_trip(body: TripCreate, request: Request, user: User = Depends(get_current_user)) -> TripCreated:
    with Session(request.app.state.db_engine) as session:
        trip = Trip(
            user_id=user.id,
            origin_lat=body.origin.lat,
            origin_lon=body.origin.lon,
            origin_cell=cell_of(body.origin.lat, body.origin.lon),
            destination_lat=body.destination.lat,
            destination_lon=body.destination.lon,
            destination_cell=cell_of(body.destination.lat, body.destination.lon),
            destination_label=body.destination.label,
            destination_address_text=body.destination.address_text,
        )
        session.add(trip)
        session.commit()
        session.refresh(trip)
        return TripCreated(id=trip.id)


@router.delete("", status_code=204)
def delete_trips(request: Request, user: User = Depends(get_current_user)) -> None:
    """사용자가 자신의 이동 기록(최근/자주 간 곳 집계용 원본)을 전부 지운다 - 위치정보 최소화 원칙상
    삭제 방법이 있어야 한다(코드 리뷰 finding 3)."""
    with Session(request.app.state.db_engine) as session:
        delete_all_trips(session, user.id)


@router.get("/recent", response_model=List[RecentDestination])
async def get_recent(
    request: Request,
    days: int = Query(default=DEFAULT_HISTORY_DAYS, ge=1, le=MAX_HISTORY_DAYS),
    limit: int = Query(default=10, ge=1, le=50),
    lang: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
) -> List[RecentDestination]:
    with Session(request.app.state.db_engine) as session:
        destinations = recent_destinations(session, user.id, days, limit)
    return await _translate_destinations(destinations, lang)


@router.get("/frequent", response_model=List[FrequentDestination])
async def get_frequent(
    request: Request,
    days: int = Query(default=DEFAULT_HISTORY_DAYS, ge=1, le=MAX_HISTORY_DAYS),
    limit: int = Query(default=3, ge=1, le=10),
    lang: Optional[str] = Query(default=None),
    user: User = Depends(get_current_user),
) -> List[FrequentDestination]:
    with Session(request.app.state.db_engine) as session:
        destinations = frequent_destinations(session, user.id, days, limit)
    return await _translate_destinations(destinations, lang)


@router.get("/popular", response_model=List[FrequentDestination])
async def get_popular(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=3.0, gt=0, le=20.0),
    days: int = Query(default=DEFAULT_HISTORY_DAYS, ge=1, le=MAX_HISTORY_DAYS),
    limit: int = Query(default=10, ge=1, le=30),
    lang: Optional[str] = Query(default=None),
) -> List[FrequentDestination]:
    """로그인 없이도 보는 홈 화면 기본 패널용 — 누가 갔는지는 안 밝히고 전체 유저 집계만 보여준다.
    라벨·주소는 사용자가 한국어로 남긴 실제 목적지 이름이라, 화면 언어가 ko 가 아니면 번역해서 돌려준다
    (navigation 라우터의 장소 검색과 같은 방식, translate_places_to_language 참고)."""
    with Session(request.app.state.db_engine) as session:
        destinations = popular_destinations(session, lat, lng, radius_km, days, limit)
    return await _translate_destinations(destinations, lang)
