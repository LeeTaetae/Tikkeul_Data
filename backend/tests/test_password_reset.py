import httpx
from sqlmodel import Session

from app.auth.models import User, normalize_email
from app.auth.security import hash_password
from tests.conftest import make_settings
from tests.test_auth_api import _extract_code, _patch_resend_http


def _create_local_user(client, email="a@example.com", password="password123"):
    with Session(client.app.state.db_engine) as session:
        user = User(email=normalize_email(email), password_hash=hash_password(password), email_verified=True)
        session.add(user)
        session.commit()
        session.refresh(user)
    return user


def test_send_code_for_local_account_returns_challenge(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    _create_local_user(client, email="local@example.com")

    res = client.post("/api/auth/password-reset/send-code", json={"email": "local@example.com"})
    assert res.status_code == 200
    body = res.json()
    assert body["sent"] is True and body["challenge"] and body["social_only"] is False
    assert len(sent) == 1


def test_send_code_for_unknown_email_pretends_to_succeed(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)

    res = client.post("/api/auth/password-reset/send-code", json={"email": "nobody@example.com"})
    assert res.status_code == 200
    body = res.json()
    assert body == {"sent": True, "challenge": None, "social_only": False}
    assert len(sent) == 0  # 실제로는 아무것도 안 보냈다


def test_send_code_for_social_only_account_reveals_social_only(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        session.add(User(provider="google", provider_id="g-1", email="social@example.com", password_hash=None, email_verified=True))
        session.commit()

    res = client.post("/api/auth/password-reset/send-code", json={"email": "social@example.com"})
    assert res.status_code == 200
    assert res.json() == {"sent": False, "challenge": None, "social_only": True}
    assert len(sent) == 0


def test_full_reset_flow_send_code_verify_reset_then_login(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    _create_local_user(client, email="flow@example.com", password="oldpassword1")

    send_res = client.post("/api/auth/password-reset/send-code", json={"email": "flow@example.com"})
    challenge = send_res.json()["challenge"]
    code = _extract_code(sent[0])

    verify_res = client.post(
        "/api/auth/password-reset/verify-code", json={"email": "flow@example.com", "code": code, "challenge": challenge}
    )
    assert verify_res.status_code == 200
    body = verify_res.json()
    assert body["verified"] is True and body["token"]

    reset_res = client.post("/api/auth/password-reset", json={"token": body["token"], "new_password": "newpassword1"})
    assert reset_res.status_code == 200
    assert reset_res.json()["email"] == "flow@example.com"

    login_res = client.post("/api/auth/login", json={"email": "flow@example.com", "password": "newpassword1"})
    assert login_res.status_code == 200 and "access_token" in login_res.json()


def test_verify_code_too_many_wrong_attempts_is_429(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    _create_local_user(client, email="brute@example.com")

    send_res = client.post("/api/auth/password-reset/send-code", json={"email": "brute@example.com"})
    challenge = send_res.json()["challenge"]

    for _ in range(5):
        res = client.post(
            "/api/auth/password-reset/verify-code", json={"email": "brute@example.com", "code": "000000", "challenge": challenge}
        )
        assert res.status_code == 400

    blocked = client.post(
        "/api/auth/password-reset/verify-code", json={"email": "brute@example.com", "code": "000000", "challenge": challenge}
    )
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "TOO_MANY_REQUESTS"


def test_password_reset_with_expired_or_forged_token_is_401(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    res = client.post("/api/auth/password-reset", json={"token": "not-a-real-token", "new_password": "newpassword1"})
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHORIZED"
