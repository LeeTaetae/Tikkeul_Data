import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth import social as social_module
from app.auth.models import User
from app.auth.security import hash_password
from app.auth.social import find_or_create_social_user
from tests.conftest import make_settings


def _patch_verify(monkeypatch, payload=None, error=None):
    def fake_verify(id_token, settings):
        if error is not None:
            raise error
        return payload

    monkeypatch.setattr(social_module, "verify_google_id_token", fake_verify)
    # router 가 함수를 직접 import 해서 쓰는 경우를 대비해 router 모듈도 같이 패치한다
    from app.auth import router as router_module

    monkeypatch.setattr(router_module, "verify_google_id_token", fake_verify)


def test_google_login_first_time_creates_user(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _patch_verify(monkeypatch, payload={"sub": "google-uid-1", "email": "new@example.com", "email_verified": True})

    res = client.post("/api/auth/social/google", json={"id_token": "fake-token"})
    assert res.status_code in (200, 201)
    body = res.json()
    assert "access_token" in body
    assert body["user"]["provider"] == "google"
    assert body["user"]["email"] == "new@example.com"

    with Session(client.app.state.db_engine) as session:
        user = session.exec(select(User).where(User.provider_id == "google-uid-1")).first()
        assert user is not None and user.provider == "google"


def test_google_login_same_provider_id_reuses_user(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _patch_verify(monkeypatch, payload={"sub": "google-uid-2", "email": "again@example.com", "email_verified": True})

    first = client.post("/api/auth/social/google", json={"id_token": "fake-token"})
    second = client.post("/api/auth/social/google", json={"id_token": "fake-token"})
    assert first.json()["user"]["id"] == second.json()["user"]["id"]

    with Session(client.app.state.db_engine) as session:
        users = session.exec(select(User).where(User.provider_id == "google-uid-2")).all()
        assert len(users) == 1


def test_google_login_email_already_used_by_local_account_is_409(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        session.add(User(email="taken@example.com", password_hash=hash_password("password123"), email_verified=True))
        session.commit()
    _patch_verify(monkeypatch, payload={"sub": "google-uid-3", "email": "taken@example.com", "email_verified": True})

    res = client.post("/api/auth/social/google", json={"id_token": "fake-token"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_TAKEN"


def test_google_login_unverified_email_is_not_trusted_even_if_it_collides(make_client, monkeypatch):
    # 구글이 email_verified=False 를 보고하면 그 이메일을 신뢰하지 않는다 - 기존 로컬 계정과 같은 이메일이어도
    # EMAIL_TAKEN 을 내서 그 계정을 막으면 안 되고, 새 구글 유저는 email=None 으로 만들어져야 한다.
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        session.add(User(email="owner@example.com", password_hash=hash_password("password123"), email_verified=True))
        session.commit()
    _patch_verify(monkeypatch, payload={"sub": "google-uid-unverified", "email": "owner@example.com", "email_verified": False})

    res = client.post("/api/auth/social/google", json={"id_token": "fake-token"})
    assert res.status_code in (200, 201)
    body = res.json()
    assert body["user"]["email"] is None

    with Session(client.app.state.db_engine) as session:
        user = session.exec(select(User).where(User.provider_id == "google-uid-unverified")).first()
        assert user is not None and user.email is None


def test_google_login_invalid_token_is_502_social_login_failed(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)

    # verify_google_id_token 자체는 실제 함수를 그대로 실행시키고, 그 함수가 감싸는
    # google 라이브러리 호출만 ValueError 를 던지게 해서 try/except 변환 로직을 실제로 통과시킨다.
    def fake_verify_oauth2_token(id_token, request, audience=None):
        raise ValueError("invalid token")

    monkeypatch.setattr(social_module, "verify_oauth2_token", fake_verify_oauth2_token)

    res = client.post("/api/auth/social/google", json={"id_token": "garbage"})
    assert res.status_code == 502 and res.json()["error"]["code"] == "SOCIAL_LOGIN_FAILED"


def test_google_login_email_case_variant_of_local_account_is_409(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        session.add(User(email="user@example.com", password_hash=hash_password("password123"), email_verified=True))
        session.commit()
    _patch_verify(monkeypatch, payload={"sub": "google-uid-4", "email": "User@Example.com", "email_verified": True})

    res = client.post("/api/auth/social/google", json={"id_token": "fake-token"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_TAKEN"


def _patch_kakao_verify(monkeypatch, payload=None, error=None):
    def fake_verify(access_token, settings):
        if error is not None:
            raise error
        return payload

    monkeypatch.setattr(social_module, "verify_kakao_access_token", fake_verify)
    from app.auth import router as router_module

    monkeypatch.setattr(router_module, "verify_kakao_access_token", fake_verify)


def test_kakao_login_first_time_creates_user(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _patch_kakao_verify(monkeypatch, payload={"id": 12345, "kakao_account": {"profile": {"nickname": "철수"}}})

    res = client.post("/api/auth/social/kakao", json={"access_token": "fake-token"})
    assert res.status_code in (200, 201)
    body = res.json()
    assert "access_token" in body
    assert body["user"]["provider"] == "kakao"
    assert body["user"]["email"] is None
    assert body["user"]["nickname"] == "철수"  # 카카오 닉네임이 응답에 그대로 실려야 한다

    with Session(client.app.state.db_engine) as session:
        user = session.exec(select(User).where(User.provider_id == "12345")).first()
        assert user is not None and user.provider == "kakao"


def test_kakao_login_same_provider_id_reuses_user(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _patch_kakao_verify(monkeypatch, payload={"id": 54321})

    first = client.post("/api/auth/social/kakao", json={"access_token": "fake-token"})
    second = client.post("/api/auth/social/kakao", json={"access_token": "fake-token"})
    assert first.json()["user"]["id"] == second.json()["user"]["id"]

    with Session(client.app.state.db_engine) as session:
        users = session.exec(select(User).where(User.provider_id == "54321")).all()
        assert len(users) == 1


def test_kakao_login_invalid_token_is_502_social_login_failed(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)

    # verify_kakao_access_token 자체는 실제 함수를 그대로 실행시키고, httpx.get 호출만 실패(401)하게
    # 해서 try/except·상태코드 검사 변환 로직을 실제로 통과시킨다.
    class FakeResp:
        status_code = 401

        def json(self):
            return {"msg": "this access token does not exist"}

    def fake_httpx_get(url, headers=None, timeout=None):
        return FakeResp()

    monkeypatch.setattr(social_module.httpx, "get", fake_httpx_get)

    res = client.post("/api/auth/social/kakao", json={"access_token": "garbage"})
    assert res.status_code == 502 and res.json()["error"]["code"] == "SOCIAL_LOGIN_FAILED"


def test_kakao_login_network_error_is_502_social_login_failed(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)

    def fake_httpx_get(url, headers=None, timeout=None):
        raise social_module.httpx.ConnectError("boom")

    monkeypatch.setattr(social_module.httpx, "get", fake_httpx_get)

    res = client.post("/api/auth/social/kakao", json={"access_token": "garbage"})
    assert res.status_code == 502 and res.json()["error"]["code"] == "SOCIAL_LOGIN_FAILED"


def test_db_rejects_duplicate_provider_and_provider_id(make_client):
    # provider+provider_id 조합에 DB UNIQUE 제약이 실제로 걸려 있는지 직접 증명한다(동시 가입 레이스 방어의 전제조건).
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        session.add(User(provider="kakao", provider_id="dup-1", email=None, email_verified=True))
        session.commit()
        session.add(User(provider="kakao", provider_id="dup-1", email=None, email_verified=True))
        with pytest.raises(IntegrityError):
            session.commit()


def _flush_that_fails_only_for_the_pending_insert(session, monkeypatch):
    """자동 flush(조회 때마다 일어나는)는 그대로 통과시키고, 실제로 새 User 를 넣으려는 explicit flush 만
    IntegrityError 로 실패하게 한다 - "확인 통과 후 삽입 시점" 레이스를 흉내낸다."""
    original_flush = session.flush

    def fake_flush(*args, **kwargs):
        if any(isinstance(obj, User) for obj in session.new):
            raise IntegrityError("UNIQUE constraint failed", None, None)
        return original_flush(*args, **kwargs)

    monkeypatch.setattr(session, "flush", fake_flush)


def test_find_or_create_social_user_converts_integrity_error_to_social_login_failed(make_client, monkeypatch):
    # "존재 확인" 통과 뒤 다른 트랜잭션이 먼저 커밋해버린 레이스를 흉내낸다 - session.flush 가 IntegrityError 를 던지게
    # 만들어서, 그게 raw 500 이 아니라 api_error 로 깨끗하게 변환되는지(email 없는 카카오 케이스) 직접 검증한다.
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        _flush_that_fails_only_for_the_pending_insert(session, monkeypatch)
        with pytest.raises(Exception) as exc_info:
            find_or_create_social_user(session, provider="kakao", provider_id="race-1", email=None, nickname=None)
        assert exc_info.value.code == "SOCIAL_LOGIN_FAILED"


def test_find_or_create_social_user_converts_integrity_error_to_email_taken(make_client, monkeypatch):
    # 같은 레이스지만 email 이 있는 경우(구글) - EMAIL_TAKEN 으로 변환돼야 한다.
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        _flush_that_fails_only_for_the_pending_insert(session, monkeypatch)
        with pytest.raises(Exception) as exc_info:
            find_or_create_social_user(session, provider="google", provider_id="race-2", email="race@example.com", nickname=None)
        assert exc_info.value.code == "EMAIL_TAKEN"


def test_kakao_login_missing_id_is_502_social_login_failed(make_client, monkeypatch):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)

    class FakeResp:
        status_code = 200

        def json(self):
            return {}

    def fake_httpx_get(url, headers=None, timeout=None):
        return FakeResp()

    monkeypatch.setattr(social_module.httpx, "get", fake_httpx_get)

    res = client.post("/api/auth/social/kakao", json={"access_token": "garbage"})
    assert res.status_code == 502 and res.json()["error"]["code"] == "SOCIAL_LOGIN_FAILED"
