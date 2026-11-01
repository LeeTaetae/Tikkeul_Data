from datetime import datetime, timedelta, timezone
from typing import List

from sqlmodel import Session, select

from app.navigation.schemas import LatLng
from app.navigation.service import haversine_km
from app.trips.models import FrequentDestination, RecentDestination, Trip

CELL_PRECISION = 3  # 소수 3자리 ~= 100m 격자


def cell_of(lat: float, lon: float) -> str:
    return f"{round(lat, CELL_PRECISION)},{round(lon, CELL_PRECISION)}"


def _since(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _trips_within(session: Session, user_id: int, days: int) -> List[Trip]:
    # started_at 만으로 정렬하면 벽시계 해상도 때문에 거의 동시에 들어온 두 Trip의 순서가 보장되지 않는다.
    # id 는 같은 SQLite 커넥션이 순서대로 매기는 값이라 안전한 2차 정렬 기준이 된다.
    return session.exec(
        select(Trip)
        .where(Trip.user_id == user_id, Trip.started_at >= _since(days))
        .order_by(Trip.started_at.desc(), Trip.id.desc())
    ).all()


def _all_trips_within(session: Session, days: int) -> List[Trip]:
    return session.exec(
        select(Trip).where(Trip.started_at >= _since(days)).order_by(Trip.started_at.desc(), Trip.id.desc())
    ).all()


def recent_destinations(session: Session, user_id: int, days: int, limit: int) -> List[RecentDestination]:
    trips = _trips_within(session, user_id, days)
    seen_cells = set()
    result: List[RecentDestination] = []
    for trip in trips:
        if trip.destination_cell in seen_cells:
            continue
        seen_cells.add(trip.destination_cell)
        result.append(
            RecentDestination(
                label=trip.destination_label,
                lat=trip.destination_lat,
                lon=trip.destination_lon,
                address_text=trip.destination_address_text,
                last_used_at=trip.started_at,
            )
        )
        if len(result) >= limit:
            break
    return result


def _rank_by_frequency(trips: List[Trip], limit: int) -> List[FrequentDestination]:
    # 최신순으로 훑으면서 칸(cell)마다 방문 횟수를 세고, 그 칸의 가장 최근 Trip을 대표로 삼는다.
    counts: dict[str, int] = {}
    latest: dict[str, Trip] = {}
    for trip in trips:
        counts[trip.destination_cell] = counts.get(trip.destination_cell, 0) + 1
        latest.setdefault(trip.destination_cell, trip)
    ranked = sorted(latest.values(), key=lambda t: (-counts[t.destination_cell], -t.started_at.timestamp()))
    return [
        FrequentDestination(
            label=trip.destination_label,
            lat=trip.destination_lat,
            lon=trip.destination_lon,
            address_text=trip.destination_address_text,
            visit_count=counts[trip.destination_cell],
            last_used_at=trip.started_at,
        )
        for trip in ranked[:limit]
    ]


def frequent_destinations(session: Session, user_id: int, days: int, limit: int) -> List[FrequentDestination]:
    return _rank_by_frequency(_trips_within(session, user_id, days), limit)


def popular_destinations(
    session: Session, lat: float, lng: float, radius_km: float, days: int, limit: int
) -> List[FrequentDestination]:
    """좌표 주변에서 전체 유저가 가장 많이 간 곳 TOP N. 누가 갔는지는 드러내지 않고 장소·횟수만 모은다(홈 화면 기본 패널용, 로그인 불필요)."""
    center = LatLng(lat=lat, lng=lng)
    nearby = [
        trip
        for trip in _all_trips_within(session, days)
        if haversine_km(center, LatLng(lat=trip.destination_lat, lng=trip.destination_lon)) <= radius_km
    ]
    return _rank_by_frequency(nearby, limit)
