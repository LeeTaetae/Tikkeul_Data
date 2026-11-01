def _signup_and_token(client, email="a@example.com"):
    from app.auth.models import normalize_email
    from app.auth.security import create_signup_verified_token

    settings = client.app.state.settings
    verify_token = create_signup_verified_token(normalize_email(email), settings)
    res = client.post("/api/auth/signup", json={"email": email, "password": "password123", "verify_token": verify_token})
    return res.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _trip_body(dest_label="스타벅스 강남점", dest_lat=37.5, dest_lon=127.0, origin_lat=37.4, origin_lon=126.9):
    return {
        "origin": {"lat": origin_lat, "lon": origin_lon},
        "destination": {"lat": dest_lat, "lon": dest_lon, "label": dest_label, "address_text": "서울시 강남구"},
    }


def test_post_trip_records_it(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    res = client.post("/api/trips", json=_trip_body(), headers=_auth(token))
    assert res.status_code == 201 and "id" in res.json()


def test_recent_returns_most_recent_first(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/trips", json=_trip_body("첫번째", dest_lat=37.1, dest_lon=127.1), headers=_auth(token))
    client.post("/api/trips", json=_trip_body("두번째", dest_lat=37.2, dest_lon=127.2), headers=_auth(token))
    recent = client.get("/api/trips/recent", headers=_auth(token)).json()
    assert [r["label"] for r in recent] == ["두번째", "첫번째"]


def test_recent_dedupes_same_destination_cell_keeping_latest(make_client):
    # id 를 2차 정렬키로 쓰는지까지 확인하려고, 두 Trip을 같은 요청 흐름에서 연달아 넣는다
    # (테스트 환경은 벽시계 해상도가 낮을 수 있어 started_at 이 같은 값으로 찍힐 수 있다).
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/trips", json=_trip_body("스타벅스(옛이름)", dest_lat=37.5, dest_lon=127.0), headers=_auth(token))
    client.post("/api/trips", json=_trip_body("스타벅스(새이름)", dest_lat=37.5001, dest_lon=127.0001), headers=_auth(token))
    recent = client.get("/api/trips/recent", headers=_auth(token)).json()
    assert len(recent) == 1 and recent[0]["label"] == "스타벅스(새이름)"


def test_recent_respects_limit(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    for i in range(5):
        client.post("/api/trips", json=_trip_body(f"목적지{i}", dest_lat=37.0 + i, dest_lon=127.0 + i), headers=_auth(token))
    recent = client.get("/api/trips/recent?limit=2", headers=_auth(token)).json()
    assert len(recent) == 2


def test_recent_default_limit_is_ten(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    for i in range(12):
        client.post("/api/trips", json=_trip_body(f"목적지{i}", dest_lat=37.0 + i, dest_lon=127.0 + i), headers=_auth(token))
    recent = client.get("/api/trips/recent", headers=_auth(token)).json()
    assert len(recent) == 10


def test_recent_limit_over_cap_is_422(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    res = client.get("/api/trips/recent?limit=999", headers=_auth(token))
    assert res.status_code == 422


def test_recent_destinations_are_scoped_to_the_user(make_client):
    client = make_client(lambda r: None)
    token_a = _signup_and_token(client, "a@example.com")
    token_b = _signup_and_token(client, "b@example.com")
    client.post("/api/trips", json=_trip_body(), headers=_auth(token_a))
    assert client.get("/api/trips/recent", headers=_auth(token_b)).json() == []


def test_trip_rejects_out_of_range_coordinates(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    bad_destination = client.post("/api/trips", json=_trip_body(dest_lat=999, dest_lon=127.0), headers=_auth(token))
    assert bad_destination.status_code == 422
    bad_origin = client.post("/api/trips", json=_trip_body(origin_lat=999, origin_lon=127.0), headers=_auth(token))
    assert bad_origin.status_code == 422


def test_trip_rejects_blank_destination_label(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    res = client.post("/api/trips", json=_trip_body("   "), headers=_auth(token))
    assert res.status_code == 422


def test_trips_endpoints_require_a_token(make_client):
    client = make_client(lambda r: None)
    assert client.post("/api/trips", json=_trip_body()).status_code == 401
    assert client.get("/api/trips/recent").status_code == 401


def test_trips_endpoints_reject_a_garbage_token(make_client):
    client = make_client(lambda r: None)
    headers = _auth("not-a-real-token")
    assert client.post("/api/trips", json=_trip_body(), headers=headers).status_code == 401
    assert client.get("/api/trips/recent", headers=headers).status_code == 401


def _backdate_last_trip(client, days):
    from datetime import datetime, timedelta, timezone

    from sqlmodel import Session, select

    from app.trips.models import Trip

    with Session(client.app.state.db_engine) as session:
        trip = session.exec(select(Trip).order_by(Trip.id.desc())).first()
        trip.started_at = datetime.now(timezone.utc) - timedelta(days=days)
        session.add(trip)
        session.commit()


def test_frequent_ranks_by_visit_count_then_recency(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    for _ in range(3):
        client.post("/api/trips", json=_trip_body("자주가는곳", dest_lat=37.5, dest_lon=127.0), headers=_auth(token))
    client.post("/api/trips", json=_trip_body("한번간곳", dest_lat=37.6, dest_lon=127.1), headers=_auth(token))
    frequent = client.get("/api/trips/frequent", headers=_auth(token)).json()
    assert [f["label"] for f in frequent] == ["자주가는곳", "한번간곳"]
    assert frequent[0]["visit_count"] == 3
    assert frequent[1]["visit_count"] == 1


def test_frequent_respects_limit(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    for i in range(5):
        client.post("/api/trips", json=_trip_body(f"목적지{i}", dest_lat=37.0 + i, dest_lon=127.0 + i), headers=_auth(token))
    frequent = client.get("/api/trips/frequent?limit=3", headers=_auth(token)).json()
    assert len(frequent) == 3


def test_recent_excludes_trips_outside_the_days_window(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/trips", json=_trip_body("오래된곳"), headers=_auth(token))
    _backdate_last_trip(client, days=40)
    recent = client.get("/api/trips/recent?days=30", headers=_auth(token)).json()
    assert recent == []


def test_frequent_excludes_trips_outside_the_days_window(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/trips", json=_trip_body("오래된곳"), headers=_auth(token))
    _backdate_last_trip(client, days=40)
    frequent = client.get("/api/trips/frequent?days=30", headers=_auth(token)).json()
    assert frequent == []


def test_popular_requires_no_login_and_aggregates_across_users(make_client):
    client = make_client(lambda r: None)
    token_a = _signup_and_token(client, "a@example.com")
    token_b = _signup_and_token(client, "b@example.com")
    # 같은 장소(스타벅스) 근처로 두 유저가 각각 가고, 다른 유저가 또 한 번 더 간다
    client.post("/api/trips", json=_trip_body("스타벅스", dest_lat=37.50, dest_lon=127.00), headers=_auth(token_a))
    client.post("/api/trips", json=_trip_body("스타벅스", dest_lat=37.50, dest_lon=127.00), headers=_auth(token_b))
    client.post("/api/trips", json=_trip_body("한적한카페", dest_lat=37.501, dest_lon=127.001), headers=_auth(token_b))
    res = client.get("/api/trips/popular", params={"lat": 37.50, "lng": 127.00})
    assert res.status_code == 200  # 토큰 없이도 됨
    places = res.json()
    assert places[0]["label"] == "스타벅스" and places[0]["visit_count"] == 2


def test_popular_excludes_places_outside_the_radius(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/trips", json=_trip_body("아주 먼 곳", dest_lat=38.5, dest_lon=128.5), headers=_auth(token))
    res = client.get("/api/trips/popular", params={"lat": 37.50, "lng": 127.00, "radius_km": 3})
    assert res.json() == []


def test_popular_requires_lat_and_lng(make_client):
    client = make_client(lambda r: None)
    assert client.get("/api/trips/popular").status_code == 422
