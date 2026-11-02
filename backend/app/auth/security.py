import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import Settings
from app.errors import api_error


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _require_secret(settings: Settings) -> str:
    secret = settings.secret("jwt_secret")
    if secret is None:
        raise api_error("NOT_CONFIGURED")
    return secret


def create_access_token(user_id: int, settings: Settings) -> str:
    secret = _require_secret(settings)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expires_days)
    return jwt.encode({"sub": str(user_id), "purpose": "access", "exp": expires_at}, secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> int:
    # purpose 를 확인해서 이메일 인증 토큰(create_email_verify_token)이 로그인 토큰으로 재사용되는 걸 막는다.
    # 인증 메일은 노출 경로가 더 많다(메일함·클라이언트 기록 등) - 거기서 샌 토큰이 로그인에 쓰이면 안 된다.
    secret = _require_secret(settings)
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise api_error("UNAUTHORIZED")
    if payload.get("purpose") != "access":
        raise api_error("UNAUTHORIZED")
    return int(payload["sub"])


def create_email_verify_token(user_id: int, settings: Settings) -> str:
    secret = _require_secret(settings)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.email_verify_expires_hours)
    return jwt.encode({"sub": str(user_id), "purpose": "verify_email", "exp": expires_at}, secret, algorithm=settings.jwt_algorithm)


def decode_email_verify_token(token: str, settings: Settings) -> int:
    secret = _require_secret(settings)
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise api_error("UNAUTHORIZED")
    if payload.get("purpose") != "verify_email":
        raise api_error("UNAUTHORIZED")
    return int(payload["sub"])


# ── 가입 전 이메일 인증번호(6자리) ──────────────────────────────────────────
# 서버는 코드를 저장하지 않는다(워커·재시작에 무관하게 동작하도록). 대신 코드의 HMAC(비밀키로 서명)만
# JWT(challenge)에 담아 프런트엔드에 돌려주고, 프런트는 그걸 그대로 들고 있다가 코드 확인 때 같이 보낸다.
# HMAC(평문 해시가 아니라)을 쓰는 이유: 공격자가 challenge 를 가로채도 서버 비밀키 없이는 코드를 거꾸로 못 구한다.


def generate_signup_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _code_hmac(code: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def create_signup_code_token(email: str, code: str, settings: Settings) -> str:
    secret = _require_secret(settings)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.signup_code_expires_minutes)
    payload = {"email": email, "code_hash": _code_hmac(code, secret), "purpose": "signup_code", "exp": expires_at}
    return jwt.encode(payload, secret, algorithm=settings.jwt_algorithm)


def verify_signup_code(challenge: str, email: str, code: str, settings: Settings) -> None:
    """challenge·code 가 email 에 대해 유효하면 조용히 통과, 아니면 INVALID_CODE."""
    secret = _require_secret(settings)
    try:
        payload = jwt.decode(challenge, secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise api_error("INVALID_CODE")
    if payload.get("purpose") != "signup_code" or payload.get("email") != email:
        raise api_error("INVALID_CODE")
    if not hmac.compare_digest(_code_hmac(code, secret), payload.get("code_hash", "")):
        raise api_error("INVALID_CODE")


def create_signup_verified_token(email: str, settings: Settings) -> str:
    secret = _require_secret(settings)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.signup_verified_expires_minutes)
    payload = {"email": email, "purpose": "signup_verified", "exp": expires_at}
    return jwt.encode(payload, secret, algorithm=settings.jwt_algorithm)


def check_signup_verified(token: str, email: str, settings: Settings) -> None:
    """가입 요청에 실린 verify_token 이 이 email 에 대해 유효한 인증 완료 토큰인지 확인한다."""
    secret = _require_secret(settings)
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise api_error("EMAIL_NOT_VERIFIED")
    if payload.get("purpose") != "signup_verified" or payload.get("email") != email:
        raise api_error("EMAIL_NOT_VERIFIED")


# ── 비밀번호 재설정 이메일 인증번호(6자리) ────────────────────────────────────
# 가입 전 인증번호와 같은 구조(서버는 코드를 저장하지 않고 HMAC 만 JWT 에 담아 돌려준다). purpose 클레임만 달라서
# signup 쪽 토큰이 비밀번호 재설정에 재사용되는 걸 막는다.


def create_reset_code_token(email: str, code: str, settings: Settings) -> str:
    secret = _require_secret(settings)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.signup_code_expires_minutes)
    payload = {"email": email, "code_hash": _code_hmac(code, secret), "purpose": "reset_password_code", "exp": expires_at}
    return jwt.encode(payload, secret, algorithm=settings.jwt_algorithm)


def verify_reset_code(challenge: str, email: str, code: str, settings: Settings) -> None:
    """challenge·code 가 email 에 대해 유효하면 조용히 통과, 아니면 INVALID_CODE."""
    secret = _require_secret(settings)
    try:
        payload = jwt.decode(challenge, secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise api_error("INVALID_CODE")
    if payload.get("purpose") != "reset_password_code" or payload.get("email") != email:
        raise api_error("INVALID_CODE")
    if not hmac.compare_digest(_code_hmac(code, secret), payload.get("code_hash", "")):
        raise api_error("INVALID_CODE")


def create_reset_verified_token(email: str, settings: Settings) -> str:
    secret = _require_secret(settings)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.signup_verified_expires_minutes)
    payload = {"email": email, "purpose": "reset_password_verified", "exp": expires_at}
    return jwt.encode(payload, secret, algorithm=settings.jwt_algorithm)


def check_reset_verified(token: str, email: str, settings: Settings) -> None:
    """비밀번호 재설정 요청에 실린 토큰이 이 email 에 대해 유효한 인증 완료 토큰인지 확인한다."""
    secret = _require_secret(settings)
    try:
        payload = jwt.decode(token, secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        raise api_error("UNAUTHORIZED")
    if payload.get("purpose") != "reset_password_verified" or payload.get("email") != email:
        raise api_error("UNAUTHORIZED")
