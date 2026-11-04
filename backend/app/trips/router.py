from typing import List

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel import Session

from app.auth.deps import get_current_user
from app.auth.models import User
from app.trips.models import FrequentDestination, RecentDestination, Trip, TripCreate, TripCreated
from app.trips.service import cell_of, frequent_destinations, popular_destinations, recent_destinations

# 며칠치 기록을 볼지의 기본값·상한. 전체 이력을 다 끌어오면 느려지고 쓸모도 없어 최근 구간만 본다.
DEFAULT_HISTORY_DAYS = 30
MAX_HISTORY_DAYS = 365

router = APIRouter(prefix="/api/trips", tags=["trips"])


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


@router.get("/recent", response_model=List[RecentDestination])
def get_recent(
    request: Request,
    days: int = Query(default=DEFAULT_HISTORY_DAYS, ge=1, le=MAX_HISTORY_DAYS),
    limit: int = Query(default=10, ge=1, le=50),
    user: User = Depends(get_current_user),
) -> List[RecentDestination]:
    with Session(request.app.state.db_engine) as session:
        return recent_destinations(session, user.id, days, limit)


@router.get("/frequent", response_model=List[FrequentDestination])
def get_frequent(
    request: Request,
    days: int = Query(default=DEFAULT_HISTORY_DAYS, ge=1, le=MAX_HISTORY_DAYS),
    limit: int = Query(default=3, ge=1, le=10),
    user: User = Depends(get_current_user),
) -> List[FrequentDestination]:
    with Session(request.app.state.db_engine) as session:
        return frequent_destinations(session, user.id, days, limit)


@router.get("/popular", response_model=List[FrequentDestination])
def get_popular(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=3.0, gt=0, le=20.0),
    days: int = Query(default=DEFAULT_HISTORY_DAYS, ge=1, le=MAX_HISTORY_DAYS),
    limit: int = Query(default=10, ge=1, le=30),
) -> List[FrequentDestination]:
    """로그인 없이도 보는 홈 화면 기본 패널용 — 누가 갔는지는 안 밝히고 전체 유저 집계만 보여준다."""
    with Session(request.app.state.db_engine) as session:
        return popular_destinations(session, lat, lng, radius_km, days, limit)
