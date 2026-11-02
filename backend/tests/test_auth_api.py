import re

import httpx
from sqlmodel import Session, select

from app.auth import mailer
from app.auth.models import User, normalize_email
from app.auth.security import create_access_token, create_email_verify_token, create_signup_verified_token, hash_password
from app.errors import api_error
from tests.conftest import make_settings


def _patch_resend_http(monkeypatch, sent, status=200):
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(status, json={"id": "email-id"})

    monkeypatch.setattr(mailer.httpx, "Client", lambda *a, **kw: real_client(*a, transport=httpx.MockTransport(handler), **kw))


def _extract_code(request: httpx.Request) -> str:
    body = request.read().decode("utf-8")
    match = re.search(r"letter-spacing:4px\\?\">(\d{6})<", body)
    assert match, body
    return match.group(1)


def _create_user(client, settings, email="a@example.com", password="password123", email_verified=False):
    """가입 전 인증코드 플로우를 거치지 않고 계정을 바로 만든다 - 그 플로우 자체를 테스트하지 않는 케이스용."""
    with Session(client.app.state.db_engine) as session:
        user = User(email=normalize_email(email), password_hash=hash_password(password), email_verified=email_verified)
        session.add(user)
        session.commit()
        session.refresh(user)
    return user, create_access_token(user.id, settings)


def _signup(client, settings, email="a@example.com", password="password123"):
    """가입 전 인증코드 발송·확인을 이미 통과했다고 치고(토큰을 직접 발급해서) /signup 만 호출한다."""
    verify_token = create_signup_verified_token(normalize_email(email), settings)
    return client.post("/api/auth/signup", json={"email": email, "password": password, "verify_token": verify_token})


def test_signup_then_me_returns_the_account(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    res = _signup(client, settings)
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "a@example.com"
    assert body["user"]["email_verified"] is True  # 가입 전 코드로 이미 확인됐다
    assert "password" not in body["user"] and "password_hash" not in body["user"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == "a@example.com"


def test_signup_duplicate_email_is_409(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _signup(client, settings)
    res = _signup(client, settings)
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_TAKEN"


def test_login_with_correct_password_succeeds(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _create_user(client, settings)
    res = client.post("/api/auth/login", json={"email": "a@example.com", "password": "password123"})
    assert res.status_code == 200 and "access_token" in res.json()


def test_login_wrong_password_and_unknown_email_both_401_invalid_credentials(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _create_user(client, settings)
    wrong = client.post("/api/auth/login", json={"email": "a@example.com", "password": "nope"})
    unknown = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "password123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["code"] == unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_with_google_only_account_is_401_not_500(make_client):
    # password_hash=None인 구글 전용 계정에 일반 로그인 폼으로 들어오면 500이 아니라 깨끗한 401이어야 한다.
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    with Session(client.app.state.db_engine) as session:
        session.add(User(provider="google", provider_id="g-1", email="google-only@example.com", password_hash=None, email_verified=True))
        session.commit()
    res = client.post("/api/auth/login", json={"email": "google-only@example.com", "password": "anything123"})
    assert res.status_code == 401 and res.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_me_without_token_is_401(make_client):
    client = make_client(lambda r: None)
    res = client.get("/api/auth/me")
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHORIZED"


def test_me_with_garbage_token_is_401(make_client):
    client = make_client(lambda r: None)
    res = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHORIZED"


def test_signup_without_jwt_secret_is_503_not_configured(make_client):
    client = make_client(lambda r: None, settings=make_settings(jwt_secret=None))
    res = client.post("/api/auth/signup", json={"email": "a@example.com", "password": "password123", "verify_token": "x"})
    assert res.status_code == 503 and res.json()["error"]["code"] == "NOT_CONFIGURED"


def test_signup_without_verifying_email_first_is_400(make_client):
    client = make_client(lambda r: None, settings=make_settings())
    res = client.post("/api/auth/signup", json={"email": "unverified@example.com", "password": "password123", "verify_token": "garbage"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_signup_rejects_verify_token_issued_for_a_different_email_is_400(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    verify_token = create_signup_verified_token("someone-else@example.com", settings)
    res = client.post("/api/auth/signup", json={"email": "victim@example.com", "password": "password123", "verify_token": verify_token})
    assert res.status_code == 400 and res.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


def test_signup_rejects_malformed_email_with_422(make_client):
    client = make_client(lambda r: None)
    res = client.post("/api/auth/signup", json={"email": "not-an-email", "password": "password123", "verify_token": "x"})
    assert res.status_code == 422


def test_signup_rejects_short_password_with_422(make_client):
    client = make_client(lambda r: None)
    res = client.post("/api/auth/signup", json={"email": "a@example.com", "password": "short", "verify_token": "x"})
    assert res.status_code == 422


def test_signup_normalizes_email_case_so_duplicate_is_still_caught(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _signup(client, settings, email="a@example.com")
    res = _signup(client, settings, email="  A@Example.com ")
    assert res.status_code == 409


def test_signup_failure_after_user_insert_does_not_leave_a_half_created_account(make_client, monkeypatch):
    # 삽입 뒤 토큰 발급이 실패하면, 그 전에 DB 에 넣은 유저도 커밋되지 않아야 한다.
    # 안 그러면 그 반쪽짜리 계정은 토큰을 받은 적이 없어 재가입(EMAIL_TAKEN)도 로그인도 못 한다.
    from app.auth import router as auth_router_module

    def boom(user_id, settings):
        raise api_error("NOT_CONFIGURED")

    monkeypatch.setattr(auth_router_module, "create_access_token", boom)

    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    failed = _signup(client, settings)
    assert failed.status_code == 503

    with Session(client.app.state.db_engine) as session:
        assert session.exec(select(User).where(User.email == "a@example.com")).first() is None


def test_check_email_available_for_unused_email(make_client):
    client = make_client(lambda r: None)
    res = client.get("/api/auth/check-email", params={"email": "fresh@example.com"})
    assert res.status_code == 200 and res.json() == {"available": True}


def test_check_email_unavailable_after_signup(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _create_user(client, settings, email="taken@example.com")
    res = client.get("/api/auth/check-email", params={"email": "taken@example.com"})
    assert res.status_code == 200 and res.json() == {"available": False}


def test_check_email_normalizes_case_and_whitespace(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _create_user(client, settings, email="mixedcase@example.com")
    res = client.get("/api/auth/check-email", params={"email": "  MixedCase@Example.com "})
    assert res.status_code == 200 and res.json() == {"available": False}


def test_check_email_rejects_malformed_email_with_422(make_client):
    client = make_client(lambda r: None)
    res = client.get("/api/auth/check-email", params={"email": "not-an-email"})
    assert res.status_code == 422


def test_check_email_does_not_require_a_token(make_client):
    client = make_client(lambda r: None)
    res = client.get("/api/auth/check-email", params={"email": "anyone@example.com"})
    assert res.status_code == 200


def test_verify_email_marks_account_verified_and_is_idempotent(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    user, _ = _create_user(client, settings)
    token = create_email_verify_token(user.id, settings)

    res = client.get("/api/auth/verify-email", params={"token": token})
    assert res.status_code == 200 and res.json()["email_verified"] is True

    res2 = client.get("/api/auth/verify-email", params={"token": token})
    assert res2.status_code == 200 and res2.json()["email_verified"] is True


def test_verify_email_rejects_access_token_reused_as_verify_token(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _, access_token = _create_user(client, settings)
    res = client.get("/api/auth/verify-email", params={"token": access_token})
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHORIZED"


def test_verify_email_unknown_user_is_401(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    token = create_email_verify_token(999999, settings)
    res = client.get("/api/auth/verify-email", params={"token": token})
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHORIZED"


def test_verify_email_rejects_garbage_token(make_client):
    client = make_client(lambda r: None)
    res = client.get("/api/auth/verify-email", params={"token": "not-a-real-token"})
    assert res.status_code == 401 and res.json()["error"]["code"] == "UNAUTHORIZED"


def test_send_verification_requires_login(make_client):
    client = make_client(lambda r: None)
    res = client.post("/api/auth/send-verification")
    assert res.status_code == 401


def test_send_verification_without_resend_key_is_503_not_configured(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _, access_token = _create_user(client, settings)
    res = client.post("/api/auth/send-verification", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 503 and res.json()["error"]["code"] == "NOT_CONFIGURED"


def test_send_verification_already_verified_is_409(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _, access_token = _create_user(client, settings, email_verified=True)
    res = client.post("/api/auth/send-verification", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_ALREADY_VERIFIED"


def test_send_verification_success_sends_email_when_resend_configured(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    _, access_token = _create_user(client, settings)

    res = client.post("/api/auth/send-verification", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 200 and res.json() == {"sent": True}
    assert len(sent) == 1


def test_send_verification_email_send_failure_is_502(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent, status=401)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    _, access_token = _create_user(client, settings)

    res = client.post("/api/auth/send-verification", headers={"Authorization": f"Bearer {access_token}"})
    assert res.status_code == 502 and res.json()["error"]["code"] == "EMAIL_SEND_FAILED"


def test_send_verification_second_call_within_cooldown_is_429(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    _, access_token = _create_user(client, settings)
    headers = {"Authorization": f"Bearer {access_token}"}

    first = client.post("/api/auth/send-verification", headers=headers)
    assert first.status_code == 200

    second = client.post("/api/auth/send-verification", headers=headers)
    assert second.status_code == 429 and second.json()["error"]["code"] == "TOO_MANY_REQUESTS"
    assert len(sent) == 1  # 두 번째 호출은 쿨다운에 막혀 실제로 Resend 를 호출하지 않았다


# ── 가입 전 이메일 인증번호(send-code / verify-code) ──────────────────────────


def test_send_signup_code_without_resend_key_is_503_not_configured(make_client):
    client = make_client(lambda r: None)
    res = client.post("/api/auth/signup/send-code", json={"email": "a@example.com"})
    assert res.status_code == 503 and res.json()["error"]["code"] == "NOT_CONFIGURED"


def test_send_signup_code_already_registered_email_is_409(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _create_user(client, settings, email="taken@example.com")
    res = client.post("/api/auth/signup/send-code", json={"email": "taken@example.com"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_TAKEN"


def test_send_signup_code_normalizes_email_for_duplicate_check(make_client):
    settings = make_settings()
    client = make_client(lambda r: None, settings=settings)
    _create_user(client, settings, email="a@example.com")
    res = client.post("/api/auth/signup/send-code", json={"email": "  A@Example.com "})
    assert res.status_code == 409 and res.json()["error"]["code"] == "EMAIL_TAKEN"


def test_send_signup_code_success_sends_email_and_returns_challenge(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)

    res = client.post("/api/auth/signup/send-code", json={"email": "new@example.com"})
    assert res.status_code == 200
    body = res.json()
    assert body["sent"] is True and body["challenge"]
    assert len(sent) == 1
    assert sent[0].headers["authorization"] == "Bearer SECRET-RESEND-KEY"
    assert b"new@example.com" in sent[0].read()


def test_send_signup_code_email_send_failure_is_502(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent, status=401)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)

    res = client.post("/api/auth/signup/send-code", json={"email": "new@example.com"})
    assert res.status_code == 502 and res.json()["error"]["code"] == "EMAIL_SEND_FAILED"


def test_send_signup_code_second_call_within_cooldown_is_429(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)

    first = client.post("/api/auth/signup/send-code", json={"email": "cooldown@example.com"})
    assert first.status_code == 200
    second = client.post("/api/auth/signup/send-code", json={"email": "cooldown@example.com"})
    assert second.status_code == 429 and second.json()["error"]["code"] == "TOO_MANY_REQUESTS"
    assert len(sent) == 1


def test_verify_signup_code_with_correct_code_returns_token(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    send_res = client.post("/api/auth/signup/send-code", json={"email": "code@example.com"})
    challenge = send_res.json()["challenge"]
    code = _extract_code(sent[0])

    res = client.post("/api/auth/signup/verify-code", json={"email": "code@example.com", "code": code, "challenge": challenge})
    assert res.status_code == 200
    body = res.json()
    assert body["verified"] is True and body["token"]


def test_verify_signup_code_wrong_code_is_400_invalid_code(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    send_res = client.post("/api/auth/signup/send-code", json={"email": "code@example.com"})
    challenge = send_res.json()["challenge"]

    wrong = client.post("/api/auth/signup/verify-code", json={"email": "code@example.com", "code": "000000", "challenge": challenge})
    assert wrong.status_code == 400 and wrong.json()["error"]["code"] == "INVALID_CODE"

    # 틀려도 실제 코드는 그대로다 - 맞는 코드는 여전히 통한다
    code = _extract_code(sent[0])
    ok = client.post("/api/auth/signup/verify-code", json={"email": "code@example.com", "code": code, "challenge": challenge})
    assert ok.status_code == 200


def test_verify_signup_code_challenge_email_mismatch_is_400(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    send_res = client.post("/api/auth/signup/send-code", json={"email": "owner@example.com"})
    challenge = send_res.json()["challenge"]
    code = _extract_code(sent[0])

    res = client.post("/api/auth/signup/verify-code", json={"email": "other@example.com", "code": code, "challenge": challenge})
    assert res.status_code == 400 and res.json()["error"]["code"] == "INVALID_CODE"


def test_verify_signup_code_too_many_wrong_attempts_is_429(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)
    send_res = client.post("/api/auth/signup/send-code", json={"email": "brute@example.com"})
    challenge = send_res.json()["challenge"]

    for _ in range(5):  # main.py 기본 AttemptLimiter(max_attempts=5)
        res = client.post("/api/auth/signup/verify-code", json={"email": "brute@example.com", "code": "000000", "challenge": challenge})
        assert res.status_code == 400

    blocked = client.post("/api/auth/signup/verify-code", json={"email": "brute@example.com", "code": "000000", "challenge": challenge})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "TOO_MANY_REQUESTS"


def test_full_signup_flow_send_code_verify_then_signup(make_client, monkeypatch):
    sent = []
    _patch_resend_http(monkeypatch, sent)
    settings = make_settings(resend_api_key="SECRET-RESEND-KEY")
    client = make_client(lambda r: None, settings=settings)

    send_res = client.post("/api/auth/signup/send-code", json={"email": "full@example.com"})
    challenge = send_res.json()["challenge"]
    code = _extract_code(sent[0])
    verify_res = client.post("/api/auth/signup/verify-code", json={"email": "full@example.com", "code": code, "challenge": challenge})
    verify_token = verify_res.json()["token"]

    res = client.post("/api/auth/signup", json={"email": "full@example.com", "password": "password123", "verify_token": verify_token})
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "full@example.com"
    assert body["user"]["email_verified"] is True
