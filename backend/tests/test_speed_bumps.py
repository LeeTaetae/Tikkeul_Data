"""과속방지턱 조회(app/speed_bumps.py, /api/traffic/speed-bumps) 테스트.

외부 API 가 아니라 로컬 SQLite 라 업스트림 모킹이 필요 없다 - DB_PATH 를 임시 DB 로 바꿔서 쓴다.
"""
import sqlite3

import httpx
import pytest

import app.speed_bumps as speed_bumps_module
from app.geo import BBox
from app.speed_bumps import query_bbox


@pytest.fixture
def speed_bump_db(tmp_path, monkeypatch):
    db_path = tmp_path / "speed_bumps.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE speed_bumps (id INTEGER PRIMARY KEY, sido TEXT, sigungu TEXT, lat REAL, lng REAL)")
    conn.executemany(
        "INSERT INTO speed_bumps (sido, sigungu, lat, lng) VALUES (?, ?, ?, ?)",
        [
            ("서울특별시", "중구", 37.56, 126.98),  # bbox 안
            ("서울특별시", "종로구", 37.90, 127.50),  # bbox 밖
        ],
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(speed_bumps_module, "DB_PATH", db_path)
    return db_path


def test_query_bbox_filters_to_box(speed_bump_db):
    bbox = BBox(min_lon=126.9, max_lon=127.1, min_lat=37.5, max_lat=37.6)
    items = query_bbox(bbox)
    assert [i.location.lat for i in items] == [37.56]


def test_query_bbox_missing_db_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(speed_bumps_module, "DB_PATH", tmp_path / "없음.db")
    assert query_bbox(BBox(min_lon=0, max_lon=180, min_lat=-90, max_lat=90)) == []


def test_speed_bumps_endpoint(make_client, speed_bump_db):
    client = make_client(lambda request: httpx.Response(200, json={}))
    response = client.get(
        "/api/traffic/speed-bumps",
        params={"min_lon": 126.9, "max_lon": 127.1, "min_lat": 37.5, "max_lat": 37.6},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["location"] == {"lat": 37.56, "lon": 126.98}
    assert body["meta"]["data_kind"] == "registry"
