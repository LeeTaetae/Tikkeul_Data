from typing import Optional

from fastapi import Depends, Header, Request
from app.auth.store import user_session

from app.auth.models import User
from app.auth.security import decode_access_token
from app.errors import api_error


def get_current_user(request: Request, authorization: Optional[str] = Header(default=None)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise api_error("UNAUTHORIZED")
    token = authorization.removeprefix("Bearer ").strip()
    user_id = decode_access_token(token, request.app.state.settings)
    with user_session(request) as session:
        user = session.get(User, user_id)
    if user is None:
        raise api_error("UNAUTHORIZED")
    if user.status != "active":
        raise api_error("ACCOUNT_DISABLED")
    return user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise api_error("FORBIDDEN")
    return user
