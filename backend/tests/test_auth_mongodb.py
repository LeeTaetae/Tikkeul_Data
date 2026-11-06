import mongomock
import pytest
from pymongo.errors import AutoReconnect

from app.auth import router as auth_router
from app.auth.models import User
from app.auth.security import create_access_token, create_reset_verified_token, create_signup_verified_token, hash_password
from app.auth.store import MongoUsers
from tests.conftest import make_settings


@pytest.fixture
def mongo_auth(make_client, monkeypatch):
    database = mongomock.MongoClient(tz_aware=True).accounts
    database.users.create_index("id", unique=True)
    database.users.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
    database.users.create_index([("provider", 1), ("provider_id", 1)], unique=True,
                                partialFilterExpression={"provider_id": {"$type": "string"}})
    settings = make_settings()
    client = make_client(lambda request: None, settings=settings)
    client.app.state.user_database = database
    return client, database, settings


def signup(client, settings, email="mongo@example.com", **extra):
    return client.post("/api/auth/signup", json={
        "email": email, "password": "password123", "verify_token": create_signup_verified_token(email, settings), **extra,
    })


def bearer(response):
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_mongo_signup_persists_hash_and_login_survives_new_session(mongo_auth):
    client, db, settings = mongo_auth
    response = signup(client, settings, role="admin", status="disabled")
    assert response.status_code == 201
    account = db.users.find_one({"email": "mongo@example.com"})
    assert account["role"] == "user" and account["status"] == "active"
    assert account["password_hash"] != "password123" and "password" not in account
    assert "password_hash" not in response.json()["user"]
    login = client.post("/api/auth/login", json={"email": " MONGO@EXAMPLE.COM ", "password": "password123"})
    assert login.status_code == 200
    assert client.get("/api/auth/me", headers=bearer(login)).json()["id"] == account["id"]
    assert signup(client, settings).status_code == 409
    assert client.post("/api/auth/login", json={"email": "mongo@example.com", "password": "wrong"}).status_code == 401


def test_admin_login_and_live_revocation(mongo_auth):
    client, db, settings = mongo_auth
    normal = signup(client, settings)
    credentials = {"email": "mongo@example.com", "password": "password123"}
    assert client.get("/api/auth/admin/me", headers=bearer(normal)).status_code == 403
    db.users.update_one({"email": credentials["email"]}, {"$set": {"role": "admin"}})
    admin = client.post("/api/auth/login", json=credentials)
    assert admin.status_code == 200 and admin.json()["user"]["role"] == "admin"
    assert client.get("/api/auth/admin/me", headers=bearer(admin)).status_code == 200
    db.users.update_one({"email": credentials["email"]}, {"$set": {"role": "user"}})
    assert client.get("/api/auth/admin/me", headers=bearer(admin)).status_code == 403
    db.users.update_one({"email": credentials["email"]}, {"$set": {"status": "disabled"}})
    assert client.get("/api/auth/me", headers=bearer(admin)).status_code == 403
    assert client.post("/api/auth/login", json=credentials).status_code == 403


def test_password_reset_updates_mongo_hash(mongo_auth):
    client, db, settings = mongo_auth
    signup(client, settings)
    response = client.post("/api/auth/password-reset", json={
        "token": create_reset_verified_token("mongo@example.com", settings), "new_password": "changed123",
    })
    assert response.status_code == 200
    for password, expected in (("password123", 401), ("changed123", 200)):
        assert client.post("/api/auth/login", json={"email": "mongo@example.com", "password": password}).status_code == expected


def test_social_accounts_reuse_identity_and_keep_nickname_without_email(mongo_auth, monkeypatch):
    client, db, settings = mongo_auth
    monkeypatch.setattr(auth_router, "verify_kakao_access_token", lambda *args: {"id": 42, "kakao_account": {"profile": {"nickname": "Tester"}}})
    first = client.post("/api/auth/social/kakao", json={"access_token": "verified-by-mock"})
    second = client.post("/api/auth/social/kakao", json={"access_token": "verified-by-mock"})
    assert first.status_code == second.status_code == 200
    assert first.json()["user"]["id"] == second.json()["user"]["id"]
    assert db.users.count_documents({}) == 1
    assert client.get("/api/auth/me", headers=bearer(first)).json()["nickname"] == "Tester"
    monkeypatch.setattr(auth_router, "verify_kakao_access_token", lambda *args: {"id": 43})
    assert client.post("/api/auth/social/kakao", json={"access_token": "second-user"}).status_code == 200
    assert db.users.count_documents({"email": None}) == 2


def test_google_collision_never_links_local_account(mongo_auth, monkeypatch):
    client, db, settings = mongo_auth
    signup(client, settings)
    monkeypatch.setattr(auth_router, "verify_google_id_token", lambda *args: {
        "sub": "google-1", "email": "mongo@example.com", "email_verified": True,
    })
    assert client.post("/api/auth/social/google", json={"id_token": "mock"}).status_code == 409
    assert db.users.count_documents({}) == 1


def test_mongo_failure_returns_safe_503_without_sqlite_fallback(mongo_auth, monkeypatch):
    client, db, settings = mongo_auth
    def unavailable(*args, **kwargs):
        raise AutoReconnect("sensitive connection details")
    monkeypatch.setattr(db.users, "find_one", unavailable)
    response = client.post("/api/auth/login", json={"email": "mongo@example.com", "password": "password123"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AUTH_DB_UNAVAILABLE"
    assert "sensitive" not in response.text


def test_mongo_password_update_does_not_overwrite_concurrent_role_change(mongo_auth):
    client, db, settings = mongo_auth
    signup(client, settings)
    store = MongoUsers(db)
    account = store.by_email("mongo@example.com")
    db.users.update_one({"id": account.id}, {"$set": {"role": "admin"}})
    account.password_hash = hash_password("newpassword")
    store.add(account)
    store.commit()
    assert db.users.find_one({"id": account.id})["role"] == "admin"


def test_signup_cannot_persist_account_when_jwt_not_configured(mongo_auth):
    client, db, settings = mongo_auth
    token = create_signup_verified_token("mongo@example.com", settings)
    settings.jwt_secret = None
    response = client.post("/api/auth/signup", json={"email": "mongo@example.com", "password": "password123", "verify_token": token})
    assert response.status_code == 503
    assert db.users.count_documents({}) == 0
