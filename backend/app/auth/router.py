from typing import List

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from app.auth.store import user_session

from app.auth.deps import get_current_user, get_admin_user
from app.auth.mailer import send_reset_code_email, send_signup_code_email, send_verification_email
from app.auth.models import (
    EmailAvailability,
    KakaoLoginRequest,
    LoginRequest,
    PasswordResetRequest,
    PasswordResetSendCodeRequest,
    PasswordResetSendCodeResponse,
    PasswordResetVerifyRequest,
    PasswordResetVerifyResponse,
    SendVerificationResponse,
    SignupCodeRequest,
    SignupCodeSentResponse,
    SignupCodeVerifyRequest,
    SignupCodeVerifyResponse,
    SignupRequest,
    SocialLoginRequest,
    TokenResponse,
    User,
    UserPublic,
    UserStatusUpdate,
    normalize_email,
)
from app.auth.social import find_or_create_social_user, verify_google_id_token, verify_kakao_access_token
from app.auth.security import (
    check_reset_verified,
    check_signup_verified,
    create_access_token,
    create_email_verify_token,
    create_reset_code_token,
    create_reset_verified_token,
    create_signup_code_token,
    create_signup_verified_token,
    decode_email_verify_token,
    generate_signup_code,
    hash_password,
    verify_password,
    verify_reset_code,
    verify_signup_code,
)
from app.errors import api_error

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 핸들러는 모두 def(async 아님)로 둔다: bcrypt 해싱은 수백ms 걸리는 블로킹 작업이라, async def 안에서
# 돌리면 그 시간만큼 이벤트 루프 전체(다른 요청의 ITS 조회 등)를 막는다. def 면 FastAPI가 스레드풀에서 돌린다.


@router.post("/signup/send-code", response_model=SignupCodeSentResponse)
def send_signup_code(body: SignupCodeRequest, request: Request) -> SignupCodeSentResponse:
    settings = request.app.state.settings
    with user_session(request) as session:
        existing = session.by_email(body.email)
        if existing is not None:
            raise api_error("EMAIL_TAKEN")
    if settings.secret("resend_api_key") is None:
        raise api_error("NOT_CONFIGURED")
    if not request.app.state.signup_code_cooldown.try_mark(body.email):
        raise api_error("TOO_MANY_REQUESTS")
    code = generate_signup_code()
    if not send_signup_code_email(body.email, code, settings):
        raise api_error("EMAIL_SEND_FAILED")
    request.app.state.signup_code_attempts.reset(body.email)  # 새 코드를 받았으니 이전 실패 횟수는 지운다
    return SignupCodeSentResponse(sent=True, challenge=create_signup_code_token(body.email, code, settings))


@router.post("/signup/verify-code", response_model=SignupCodeVerifyResponse)
def verify_signup_code_endpoint(body: SignupCodeVerifyRequest, request: Request) -> SignupCodeVerifyResponse:
    settings = request.app.state.settings
    if not request.app.state.signup_code_attempts.try_attempt(body.email):
        raise api_error("TOO_MANY_REQUESTS")
    verify_signup_code(body.challenge, body.email, body.code, settings)
    return SignupCodeVerifyResponse(verified=True, token=create_signup_verified_token(body.email, settings))


@router.post("/signup", response_model=TokenResponse, status_code=201)
def signup(body: SignupRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    check_signup_verified(body.verify_token, body.email, settings)
    with user_session(request) as session:
        existing = session.by_email(body.email)
        if existing is not None:
            raise api_error("EMAIL_TAKEN")
        # 가입 직전 인증번호로 이미 확인된 이메일이다 - 계정을 바로 인증됨으로 만든다.
        user = User(email=body.email, password_hash=hash_password(body.password), email_verified=True)
        session.add(user)
        session.flush()  # id 를 받되 커밋은 안 한다 - 아래 토큰 발급이 실패하면 세션이 닫힐 때 롤백된다
        if user.status != "active":
            raise api_error("ACCOUNT_DISABLED")
        token = create_access_token(user.id, settings)
        session.commit()
        session.refresh(user)
        return TokenResponse(
            access_token=token,
            user=UserPublic.model_validate(user),
        )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request) -> TokenResponse:
    return _password_login(body, request)


def _password_login(body: LoginRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    # 이메일당 시도 횟수를 제한해 비밀번호 무차별 대입을 막는다(가입 인증번호·비밀번호 재설정과 같은 패턴).
    if not request.app.state.login_attempts.try_attempt(body.email):
        raise api_error("TOO_MANY_REQUESTS")
    with user_session(request) as session:
        user = session.by_email(body.email)
        if user is None or user.password_hash is None or not verify_password(body.password, user.password_hash):
            raise api_error("INVALID_CREDENTIALS")
        if user.status != "active":
            raise api_error("ACCOUNT_DISABLED")
        request.app.state.login_attempts.reset(body.email)
        token = create_access_token(user.id, settings)
        return TokenResponse(
            access_token=token,
            user=UserPublic.model_validate(user),
        )


@router.post("/social/google", response_model=TokenResponse)
def login_with_google(body: SocialLoginRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    payload = verify_google_id_token(body.id_token, settings)
    with user_session(request) as session:
        nickname = payload.get("name")
        # 구글이 이메일을 아직 확인하지 않았다고 보고하면(email_verified=False, 드물지만 공식 문서에 명시된 가능성) 그
        # 이메일을 신뢰하지 않는다 - 안 그러면 남의 이메일을 주장해 EMAIL_TAKEN으로 그 이메일의 실제 소유자를 막을 수 있다.
        email = payload.get("email") if payload.get("email_verified") else None
        user = find_or_create_social_user(session, provider="google", provider_id=payload["sub"], email=email, nickname=nickname)
        if user.status != "active":
            raise api_error("ACCOUNT_DISABLED")
        token = create_access_token(user.id, settings)
        session.commit()
        session.refresh(user)
        return TokenResponse(
            access_token=token,
            user=UserPublic(
                id=user.id, provider=user.provider, email=user.email, nickname=nickname, email_verified=user.email_verified, role=user.role, status=user.status, created_at=user.created_at
            ),
        )


@router.post("/social/kakao", response_model=TokenResponse)
def login_with_kakao(body: KakaoLoginRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    payload = verify_kakao_access_token(body.access_token, settings)
    profile = (payload.get("kakao_account") or {}).get("profile") or {}
    nickname = profile.get("nickname")
    with user_session(request) as session:
        user = find_or_create_social_user(session, provider="kakao", provider_id=str(payload["id"]), email=None, nickname=nickname)
        if user.status != "active":
            raise api_error("ACCOUNT_DISABLED")
        token = create_access_token(user.id, settings)
        session.commit()
        session.refresh(user)
        return TokenResponse(
            access_token=token,
            user=UserPublic(
                id=user.id, provider=user.provider, email=user.email, nickname=nickname, email_verified=user.email_verified, role=user.role, status=user.status, created_at=user.created_at
            ),
        )


@router.get("/check-email", response_model=EmailAvailability)
def check_email(email: str, request: Request) -> EmailAvailability:
    # 로그인이 필요 없다 - 가입 전에 입력칸만 보고 확인하는 용도다.
    try:
        normalized = normalize_email(email)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    with user_session(request) as session:
        existing = session.by_email(normalized)
        return EmailAvailability(available=existing is None)


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(user)


@router.post("/send-verification", response_model=SendVerificationResponse)
def send_verification(request: Request, user: User = Depends(get_current_user)) -> SendVerificationResponse:
    settings = request.app.state.settings
    if user.email_verified:
        raise api_error("EMAIL_ALREADY_VERIFIED")
    if settings.secret("resend_api_key") is None:
        raise api_error("NOT_CONFIGURED")
    if not request.app.state.resend_cooldown.try_mark(user.id):
        raise api_error("TOO_MANY_REQUESTS")
    token = create_email_verify_token(user.id, settings)
    if not send_verification_email(user.email, token, settings):
        raise api_error("EMAIL_SEND_FAILED")
    return SendVerificationResponse(sent=True)


@router.get("/verify-email", response_model=UserPublic)
def verify_email(token: str, request: Request) -> UserPublic:
    # 로그인이 필요 없다 - 메일 클릭으로 들어오는 경로라 Bearer 토큰이 없다. decode_email_verify_token 이
    # purpose 클레임으로 로그인 토큰의 재사용을 막아준다. 두 번 눌러도(이미 인증됨) 에러 없이 그대로 성공 처리한다.
    settings = request.app.state.settings
    user_id = decode_email_verify_token(token, settings)
    with user_session(request) as session:
        user = session.get(User, user_id)
        if user is None:
            raise api_error("UNAUTHORIZED")  # 토큰 발급 후 계정이 삭제된 경우 - get_current_user 와 같은 처리
        user.email_verified = True
        session.add(user)
        session.commit()
        session.refresh(user)
        return UserPublic.model_validate(user)


# ── 비밀번호 재설정 ──────────────────────────────────────────────────────────


@router.post("/password-reset/send-code", response_model=PasswordResetSendCodeResponse)
def send_reset_code(body: PasswordResetSendCodeRequest, request: Request) -> PasswordResetSendCodeResponse:
    settings = request.app.state.settings
    with user_session(request) as session:
        user = session.by_email(body.email)
    if user is None:
        # 계정 존재 여부를 숨긴다 - 실제로는 메일을 안 보내지만, 응답 모양(challenge 포함)은
        # 실제 계정 분기와 동일하게 만든다. 가짜 challenge 는 verify-code 에서 INVALID_CODE 로
        # 자연스럽게 실패한다. (쿨다운/메일 설정 체크는 일부러 안 거친다 - 실제 계정에만 있는 분기)
        dummy_code = generate_signup_code()
        return PasswordResetSendCodeResponse(sent=True, challenge=create_reset_code_token(body.email, dummy_code, settings), social_only=False)
    if user.password_hash is None:
        return PasswordResetSendCodeResponse(sent=False, challenge=None, social_only=True)
    if settings.secret("resend_api_key") is None:
        raise api_error("NOT_CONFIGURED")
    if not request.app.state.reset_code_cooldown.try_mark(body.email):
        raise api_error("TOO_MANY_REQUESTS")
    code = generate_signup_code()
    if not send_reset_code_email(body.email, code, settings):
        raise api_error("EMAIL_SEND_FAILED")
    request.app.state.reset_code_attempts.reset(body.email)  # 새 코드를 받았으니 이전 실패 횟수는 지운다
    return PasswordResetSendCodeResponse(sent=True, challenge=create_reset_code_token(body.email, code, settings), social_only=False)


@router.post("/password-reset/verify-code", response_model=PasswordResetVerifyResponse)
def verify_reset_code_endpoint(body: PasswordResetVerifyRequest, request: Request) -> PasswordResetVerifyResponse:
    settings = request.app.state.settings
    if not request.app.state.reset_code_attempts.try_attempt(body.email):
        raise api_error("TOO_MANY_REQUESTS")
    verify_reset_code(body.challenge, body.email, body.code, settings)
    return PasswordResetVerifyResponse(verified=True, token=create_reset_verified_token(body.email, settings))


@router.post("/password-reset", response_model=UserPublic)
def reset_password(body: PasswordResetRequest, request: Request) -> UserPublic:
    settings = request.app.state.settings
    try:
        # 서명 검증 전에 email 클레임만 먼저 들여다본다 - 실제 검증(서명·만료·purpose·email 일치)은
        # 바로 뒤 check_reset_verified 가 한다.
        email = jwt.decode(body.token, options={"verify_signature": False}).get("email")
    except jwt.PyJWTError:
        raise api_error("UNAUTHORIZED")
    check_reset_verified(body.token, email, settings)
    with user_session(request) as session:
        user = session.by_email(email)
        if user is None:
            raise api_error("UNAUTHORIZED")
        user.password_hash = hash_password(body.new_password)
        session.add(user)
        session.commit()
        session.refresh(user)
        return UserPublic.model_validate(user)


@router.get("/admin/me", response_model=UserPublic)
def admin_me(user: User = Depends(get_admin_user)) -> UserPublic:
    return UserPublic.model_validate(user)


@router.get("/admin/users", response_model=List[UserPublic])
def admin_list_users(request: Request, _: User = Depends(get_admin_user)) -> List[UserPublic]:
    with user_session(request) as session:
        return [UserPublic.model_validate(u) for u in session.all_users()]


@router.patch("/admin/users/{user_id}/status", response_model=UserPublic)
def admin_set_user_status(user_id: int, body: UserStatusUpdate, request: Request, admin: User = Depends(get_admin_user)) -> UserPublic:
    # 자기 계정을 막으면 관리자 화면에서 바로 쫓겨나고 되돌릴 사람이 없을 수 있다.
    if user_id == admin.id and body.status == "disabled":
        raise api_error("CANNOT_DISABLE_SELF")
    with user_session(request) as session:
        user = session.get(User, user_id)
        if user is None:
            raise api_error("USER_NOT_FOUND")
        user.status = body.status
        session.add(user)
        session.commit()
        session.refresh(user)
        return UserPublic.model_validate(user)
