"""과속방지턱 조회. 공공 API 호출이 아니라 scripts/import_speed_bumps.py 가 만든 로컬 SQLite 를 읽는다."""
import sqlite3
from typing import List

from app.config import BACKEND_DIR
from app.geo import BBox
from app.models import GeoPoint, SpeedBump

DB_PATH = BACKEND_DIR / "data" / "speed_bumps.db"


def query_bbox(bbox: BBox) -> List[SpeedBump]:
    """DB 가 없으면(팀원이 import 스크립트를 아직 안 돌린 경우) 빈 목록을 돌려준다. 예외를 내지 않는다."""
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT id, lat, lng FROM speed_bumps WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
            (bbox.min_lat, bbox.max_lat, bbox.min_lon, bbox.max_lon),
        ).fetchall()
    finally:
        conn.close()
    return [SpeedBump(id=str(row_id), location=GeoPoint(lat=lat, lon=lng)) for row_id, lat, lng in rows]
