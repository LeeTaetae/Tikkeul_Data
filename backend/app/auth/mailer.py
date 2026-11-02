"""Resend로 이메일을 보낸다. 실패해도 예외를 올리지 않고 성공 여부만 돌려준다 - 호출부가 결정한다."""
import logging
from typing import Optional

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def _verify_link(token: str, settings: Settings) -> str:
    return f"{settings.api_base_url.rstrip('/')}/api/auth/verify-email?token={token}"


def _post(client: httpx.Client, to_email: str, subject: str, html: str, settings: Settings, api_key: str) -> bool:
    body = {"from": settings.resend_from_email, "to": [to_email], "subject": subject, "html": html}
    try:
        response = client.post(RESEND_URL, json=body, headers={"Authorization": f"Bearer {api_key}"})
    except httpx.HTTPError as exc:
        # 응답 본문·요청 본문(인증 링크·인증번호 포함)은 로그에 남기지 않는다 - upstream.py 의 _log_failure 와 같은 원칙.
        logger.warning("메일 발송 실패 error=%s", type(exc).__name__)
        return False
    if not 200 <= response.status_code < 300:
        logger.warning("메일 발송 실패 status=%d", response.status_code)
        return False
    return True


def _send(to_email: str, subject: str, html: str, settings: Settings, client: Optional[httpx.Client]) -> bool:
    api_key = settings.secret("resend_api_key")
    if api_key is None:
        return False
    if client is not None:
        return _post(client, to_email, subject, html, settings, api_key)
    with httpx.Client(timeout=settings.http_timeout_s) as owned:
        return _post(owned, to_email, subject, html, settings, api_key)


def send_verification_email(to_email: str, token: str, settings: Settings, client: Optional[httpx.Client] = None) -> bool:
    """성공하면 True. resend_api_key 가 없거나 발송이 실패하면 False."""
    html = f'<p>아래 링크를 눌러 이메일을 인증해 주세요.</p><p><a href="{_verify_link(token, settings)}">이메일 인증하기</a></p>'
    return _send(to_email, "이메일 인증 - 티끌모아Data", html, settings, client)


def send_signup_code_email(to_email: str, code: str, settings: Settings, client: Optional[httpx.Client] = None) -> bool:
    """가입 전 이메일 인증번호(6자리) 메일. 성공하면 True."""
    html = (
        f"<p>아래 인증번호를 입력해 주세요.</p>"
        f'<p style="font-size:28px;font-weight:700;letter-spacing:4px">{code}</p>'
        f"<p>{settings.signup_code_expires_minutes}분 안에 입력하지 않으면 만료돼요.</p>"
    )
    return _send(to_email, "회원가입 인증번호 - 티끌모아Data", html, settings, client)


def send_reset_code_email(to_email: str, code: str, settings: Settings, client: Optional[httpx.Client] = None) -> bool:
    """비밀번호 재설정 인증번호(6자리) 메일. 성공하면 True."""
    html = (
        f"<p>아래 인증번호를 입력해 주세요.</p>"
        f'<p style="font-size:28px;font-weight:700;letter-spacing:4px">{code}</p>'
        f"<p>{settings.signup_code_expires_minutes}분 안에 입력하지 않으면 만료돼요.</p>"
    )
    return _send(to_email, "비밀번호 재설정 인증번호 - 티끌모아Data", html, settings, client)
