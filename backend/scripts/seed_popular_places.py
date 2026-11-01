"""데모용 더미 방문 기록을 채워 "주변 인기 장소" 패널(/api/trips/popular)이 비어 보이지 않게 한다.
실제 서비스 데이터가 아니다. 시드 유저(SEED_EMAIL)의 기존 Trip 을 지우고 다시 넣어서 멱등적이다 -
다시 실행해도 중복으로 쌓이지 않는다.

실행: cd backend && source .venv/bin/activate && python scripts/seed_popular_places.py
"""
import random
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.auth.models import User
from app.auth.security import hash_password
from app.config import get_settings
from app.db import create_db_and_tables, make_engine
from app.trips.models import Trip
from app.trips.service import cell_of

SEED_EMAIL = "seed-data@tikkeuldata.local"
ORIGIN = (37.5095, 126.7402)  # 실기기 테스트 위치(경기 부천) 근처를 기준으로 흩뿌린다

# (이름, 위도, 경도, 주소, 방문 횟수) - 공원·카페·음식점·쇼핑·문화시설을 고루 섞었다
PLACES = [
    ("부천시민문화동산", 37.5118, 126.7432, "경기 부천시 원미구 길주로 1", 23),
    ("상동호수공원", 37.5142, 126.7355, "경기 부천시 원미구 상일로 127", 19),
    ("롯데시네마 중동점", 37.5071, 126.7465, "경기 부천시 원미구 중동로 190", 16),
    ("현대백화점 중동점", 37.5074, 126.7447, "경기 부천시 원미구 중동로 170", 14),
    ("투썸플레이스 상동점", 37.5105, 126.7388, "경기 부천시 원미구 상동로 20", 11),
    ("부천체육관", 37.5036, 126.7398, "경기 부천시 원미구 길주로 210", 9),
    ("맘스터치 중동점", 37.5125, 126.7369, "경기 부천시 원미구 중동로 50", 7),
    ("부천아트벙커B39", 37.5162, 126.7501, "경기 부천시 오정구 삼작로 53", 5),
    ("스타벅스 부천중동DT점", 37.5088, 126.7421, "경기 부천시 원미구 길주로 75", 4),
    ("동네책방 오키로북스", 37.5099, 126.7378, "경기 부천시 원미구 상동로 45", 2),
    ("중동근린공원", 37.5055, 126.7382, "경기 부천시 원미구 중동 1140", 13),
    ("CGV 소풍점", 37.5048, 126.7472, "경기 부천시 소사구 경인로 335", 10),
    ("이마트 중동점", 37.5064, 126.7501, "경기 부천시 원미구 심곡로 150", 8),
    ("부천국제만화박물관", 37.5147, 126.7496, "경기 부천시 원미구 길주로 1", 6),
    ("김밥천국 상동점", 37.5112, 126.7347, "경기 부천시 원미구 상동로 88", 3),
    ("부천시립원미도서관", 37.5130, 126.7320, "경기 부천시 원미구 원미로 180", 2),
]


def main() -> None:
    settings = get_settings()
    engine = make_engine(settings)
    create_db_and_tables(engine)

    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == SEED_EMAIL)).first()
        if not user:
            user = User(email=SEED_EMAIL, password_hash=hash_password("seed-placeholder-2026"), email_verified=True)
            session.add(user)
            session.commit()
            session.refresh(user)
        else:
            # 다시 실행해도 중복으로 쌓이지 않게, 이 시드 유저의 기존 Trip 을 먼저 지운다.
            for trip in session.exec(select(Trip).where(Trip.user_id == user.id)).all():
                session.delete(trip)
            session.commit()

        now = datetime.now(timezone.utc)
        total = 0
        for name, lat, lng, address, visits in PLACES:
            for _ in range(visits):
                started_at = now - timedelta(days=random.uniform(0, 20), hours=random.uniform(0, 23))
                session.add(
                    Trip(
                        user_id=user.id,
                        origin_lat=ORIGIN[0],
                        origin_lon=ORIGIN[1],
                        origin_cell=cell_of(*ORIGIN),
                        destination_lat=lat,
                        destination_lon=lng,
                        destination_cell=cell_of(lat, lng),
                        destination_label=name,
                        destination_address_text=address,
                        started_at=started_at,
                    )
                )
                total += 1
        session.commit()

    print(f"시드 완료: 장소 {len(PLACES)}곳, 방문 기록 {total}건")


if __name__ == "__main__":
    main()
