from datetime import datetime, timezone
from typing import Optional

from pydantic import field_validator
from sqlmodel import Field, SQLModel, UniqueConstraint


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("provider", "provider_id", name="uq_user_provider_provider_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    provider: str = Field(default="local")
    provider_id: Optional[str] = Field(default=None, index=True)
    email: Optional[str] = Field(default=None, index=True, unique=True)
    password_hash: Optional[str] = Field(default=None)
    email_verified: bool = Field(default=False)
    role: str = Field(default="user")
    status: str = Field(default="active")
    nickname: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)


def normalize_email(v: str) -> str:
    v = v.strip().lower()
    if "@" not in v or len(v) < 3:
        raise ValueError("올바른 이메일 형식이 아닙니다.")
    return v


# bcrypt 는 비밀번호를 72바이트까지만 본다(그 뒤는 조용히 잘린다) - 72바이트를 넘는 서로 다른 비밀번호가
# 앞부분만 같으면 같은 해시가 될 수 있어, 그 전에 막는다. 글자 수가 아니라 UTF-8 바이트 수로 잰다.
_PASSWORD_MAX_BYTES = 72


def _validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("비밀번호는 8자 이상이어야 합니다.")
    if len(v.encode("utf-8")) > _PASSWORD_MAX_BYTES:
        raise ValueError(f"비밀번호는 {_PASSWORD_MAX_BYTES}바이트를 넘을 수 없습니다.")
    return v


class SignupRequest(SQLModel):
    email: str
    password: str
    # /api/auth/signup/verify-code 에서 받은 토큰. 가입 직전에 이 이메일이 인증됐다는 증거다.
    verify_token: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return normalize_email(v)

    @field_validator("password")
    @classmethod
    def _check_password(cls, v: str) -> str:
        return _validate_password(v)


class LoginRequest(SQLModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return normalize_email(v)


class SocialLoginRequest(SQLModel):
    id_token: str


class KakaoLoginRequest(SQLModel):
    access_token: str


class UserPublic(SQLModel):
    id: int
    provider: str
    email: Optional[str]
    nickname: Optional[str] = None
    email_verified: bool
    role: str = "user"
    status: str = "active"
    created_at: datetime


class TokenResponse(SQLModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class EmailAvailability(SQLModel):
    available: bool


class SendVerificationResponse(SQLModel):
    sent: bool


class SignupCodeRequest(SQLModel):
    email: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return normalize_email(v)


class SignupCodeSentResponse(SQLModel):
    sent: bool
    # 다음 요청(verify-code)에 그대로 실어 보내는 서명된 챌린지. 코드 자체는 들어있지 않다(HMAC만).
    challenge: str


class SignupCodeVerifyRequest(SQLModel):
    email: str
    code: str
    challenge: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return normalize_email(v)


class SignupCodeVerifyResponse(SQLModel):
    verified: bool
    # 가입 요청(SignupRequest.verify_token)에 그대로 실어 보내는, "이 이메일은 확인됨" 토큰.
    token: str


# ── 비밀번호 재설정 ──────────────────────────────────────────────────────────


class PasswordResetSendCodeRequest(SQLModel):
    email: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return normalize_email(v)


class PasswordResetSendCodeResponse(SQLModel):
    sent: bool
    challenge: Optional[str] = None
    # 소셜 전용 계정(비밀번호 없음)이었는지 - 이 경우만 명시적으로 알려준다(계정 존재 여부는 숨기지만, 이건 제품 결정).
    social_only: bool = False


class PasswordResetVerifyRequest(SQLModel):
    email: str
    code: str
    challenge: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return normalize_email(v)


class PasswordResetVerifyResponse(SQLModel):
    verified: bool
    token: str


class PasswordResetRequest(SQLModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _check_new_password(cls, v: str) -> str:
        return _validate_password(v)
