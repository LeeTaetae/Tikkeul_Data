def _signup_and_token(client, email="a@example.com"):
    from app.auth.models import normalize_email
    from app.auth.security import create_signup_verified_token

    settings = client.app.state.settings
    verify_token = create_signup_verified_token(normalize_email(email), settings)
    res = client.post("/api/auth/signup", json={"email": email, "password": "password123", "verify_token": verify_token})
    return res.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_list_and_get_favorite(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    res = client.post(
        "/api/favorites",
        json={"kind": "home", "label": "집", "lat": 37.5, "lon": 127.0, "address_text": "서울시 어딘가"},
        headers=_auth(token),
    )
    assert res.status_code == 201
    body = res.json()
    assert body["kind"] == "home" and body["label"] == "집" and "id" in body

    listed = client.get("/api/favorites", headers=_auth(token)).json()
    assert len(listed) == 1 and listed[0]["id"] == body["id"]


def test_second_home_is_409_but_second_custom_is_fine(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/favorites", json={"kind": "home", "label": "집", "lat": 37.5, "lon": 127.0}, headers=_auth(token))
    dup = client.post("/api/favorites", json={"kind": "home", "label": "집2", "lat": 37.6, "lon": 127.1}, headers=_auth(token))
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "FAVORITE_KIND_TAKEN"

    c1 = client.post("/api/favorites", json={"kind": "custom", "label": "카페", "lat": 37.5, "lon": 127.0}, headers=_auth(token))
    c2 = client.post("/api/favorites", json={"kind": "custom", "label": "헬스장", "lat": 37.5, "lon": 127.0}, headers=_auth(token))
    assert c1.status_code == c2.status_code == 201


def test_patch_updates_fields_and_delete_removes_it(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    created = client.post("/api/favorites", json={"kind": "custom", "label": "원래이름", "lat": 37.5, "lon": 127.0}, headers=_auth(token)).json()

    patched = client.patch(f"/api/favorites/{created['id']}", json={"label": "바뀐이름"}, headers=_auth(token))
    assert patched.status_code == 200 and patched.json()["label"] == "바뀐이름"

    deleted = client.delete(f"/api/favorites/{created['id']}", headers=_auth(token))
    assert deleted.status_code == 204
    assert client.get("/api/favorites", headers=_auth(token)).json() == []


def test_patching_custom_to_home_checks_duplicate_too(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    client.post("/api/favorites", json={"kind": "home", "label": "집", "lat": 37.5, "lon": 127.0}, headers=_auth(token))
    custom = client.post("/api/favorites", json={"kind": "custom", "label": "어딘가", "lat": 37.5, "lon": 127.0}, headers=_auth(token)).json()

    res = client.patch(f"/api/favorites/{custom['id']}", json={"kind": "home"}, headers=_auth(token))
    assert res.status_code == 409 and res.json()["error"]["code"] == "FAVORITE_KIND_TAKEN"


def test_cannot_see_or_modify_another_users_favorite(make_client):
    client = make_client(lambda r: None)
    token_a = _signup_and_token(client, "a@example.com")
    token_b = _signup_and_token(client, "b@example.com")
    mine = client.post("/api/favorites", json={"kind": "custom", "label": "A의 장소", "lat": 37.5, "lon": 127.0}, headers=_auth(token_a)).json()

    get_as_b = client.get("/api/favorites", headers=_auth(token_b)).json()
    assert get_as_b == []

    patch_as_b = client.patch(f"/api/favorites/{mine['id']}", json={"label": "뺏음"}, headers=_auth(token_b))
    assert patch_as_b.status_code == 404

    delete_as_b = client.delete(f"/api/favorites/{mine['id']}", headers=_auth(token_b))
    assert delete_as_b.status_code == 404


def test_patch_with_explicit_null_keeps_existing_value(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    created = client.post("/api/favorites", json={"kind": "custom", "label": "이름", "lat": 37.5, "lon": 127.0}, headers=_auth(token)).json()

    res = client.patch(f"/api/favorites/{created['id']}", json={"lat": None}, headers=_auth(token))
    assert res.status_code == 200
    assert res.json()["lat"] == 37.5


def test_patch_with_empty_body_changes_nothing(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    created = client.post("/api/favorites", json={"kind": "custom", "label": "이름", "lat": 37.5, "lon": 127.0}, headers=_auth(token)).json()

    res = client.patch(f"/api/favorites/{created['id']}", json={}, headers=_auth(token))
    assert res.status_code == 200 and res.json() == created


def test_custom_favorite_keeps_category(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    res = client.post(
        "/api/favorites",
        json={"kind": "custom", "label": "카페", "lat": 37.5, "lon": 127.0, "category": "카페"},
        headers=_auth(token),
    )
    assert res.status_code == 201 and res.json()["category"] == "카페"


def test_home_favorite_ignores_category(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    res = client.post(
        "/api/favorites",
        json={"kind": "home", "label": "집", "lat": 37.5, "lon": 127.0, "category": "뭔가"},
        headers=_auth(token),
    )
    assert res.status_code == 201 and res.json()["category"] is None


def test_patching_custom_to_home_clears_category(make_client):
    client = make_client(lambda r: None)
    token = _signup_and_token(client)
    custom = client.post(
        "/api/favorites",
        json={"kind": "custom", "label": "어딘가", "lat": 37.5, "lon": 127.0, "category": "카페"},
        headers=_auth(token),
    ).json()

    res = client.patch(f"/api/favorites/{custom['id']}", json={"kind": "home"}, headers=_auth(token))
    assert res.status_code == 200 and res.json()["category"] is None


def test_all_endpoints_require_a_token(make_client):
    client = make_client(lambda r: None)
    assert client.get("/api/favorites").status_code == 401
    assert client.post("/api/favorites", json={"kind": "custom", "label": "x", "lat": 0, "lon": 0}).status_code == 401
    assert client.patch("/api/favorites/1", json={"label": "x"}).status_code == 401
    assert client.delete("/api/favorites/1").status_code == 401
