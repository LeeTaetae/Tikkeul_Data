from typing import Optional

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.id_token import verify_oauth2_token
from sqlmodel import Session, select

from app.auth.models import User
from app.config import Settings
from app.errors import api_error


def verify_google_id_token(id_token: str, settings: Settings) -> dict:
    """구글 ID 토큰을 검증하고 payload(sub, email 등)를 돌려준다. 서명/만료/audience 불일치는 SOCIAL_LOGIN_FAILED로 변환한다."""
    try:
        return verify_oauth2_token(id_token, GoogleAuthRequest(), audience=settings.google_web_client_id)
    except ValueError:
        raise api_error("SOCIAL_LOGIN_FAILED")


def find_or_create_social_user(session: Session, provider: str, provider_id: str, email: Optional[str], nickname: Optional[str]) -> User:
    """provider+provider_id로 기존 유저를 찾거나, 없으면 새로 만든다.

    nickname은 이번 스키마에 저장 컬럼이 없어 DB에는 쓰지 않는다(호출부에서 응답 조립 시에만 사용).
    """
    existing = session.exec(select(User).where(User.provider == provider, User.provider_id == provider_id)).first()
    if existing is not None:
        return existing
    if email is not None:
        email_collision = session.exec(select(User).where(User.email == email)).first()
        if email_collision is not None:
            raise api_error("EMAIL_TAKEN")
    # 소셜 로그인은 공급자가 이미 이메일을 확인했다고 간주한다.
    user = User(provider=provider, provider_id=provider_id, email=email, password_hash=None, email_verified=True)
    session.add(user)
    session.flush()
    return user
