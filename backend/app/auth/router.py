from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select

from app.auth.deps import get_current_user
from app.auth.mailer import send_signup_code_email, send_verification_email
from app.auth.models import (
    EmailAvailability,
    LoginRequest,
    SendVerificationResponse,
    SignupCodeRequest,
    SignupCodeSentResponse,
    SignupCodeVerifyRequest,
    SignupCodeVerifyResponse,
    SignupRequest,
    TokenResponse,
    User,
    UserPublic,
    normalize_email,
)
from app.auth.security import (
    check_signup_verified,
    create_access_token,
    create_email_verify_token,
    create_signup_code_token,
    create_signup_verified_token,
    decode_email_verify_token,
    generate_signup_code,
    hash_password,
    verify_password,
    verify_signup_code,
)
from app.errors import api_error

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 핸들러는 모두 def(async 아님)로 둔다: bcrypt 해싱은 수백ms 걸리는 블로킹 작업이라, async def 안에서
# 돌리면 그 시간만큼 이벤트 루프 전체(다른 요청의 ITS 조회 등)를 막는다. def 면 FastAPI가 스레드풀에서 돌린다.


@router.post("/signup/send-code", response_model=SignupCodeSentResponse)
def send_signup_code(body: SignupCodeRequest, request: Request) -> SignupCodeSentResponse:
    settings = request.app.state.settings
    with Session(request.app.state.db_engine) as session:
        existing = session.exec(select(User).where(User.email == body.email)).first()
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
    with Session(request.app.state.db_engine) as session:
        existing = session.exec(select(User).where(User.email == body.email)).first()
        if existing is not None:
            raise api_error("EMAIL_TAKEN")
        # 가입 직전 인증번호로 이미 확인된 이메일이다 - 계정을 바로 인증됨으로 만든다.
        user = User(email=body.email, password_hash=hash_password(body.password), email_verified=True)
        session.add(user)
        session.flush()  # id 를 받되 커밋은 안 한다 - 아래 토큰 발급이 실패하면 세션이 닫힐 때 롤백된다
        token = create_access_token(user.id, settings)
        session.commit()
        session.refresh(user)
        return TokenResponse(
            access_token=token,
            user=UserPublic(id=user.id, provider=user.provider, email=user.email, email_verified=user.email_verified, created_at=user.created_at),
        )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request) -> TokenResponse:
    settings = request.app.state.settings
    with Session(request.app.state.db_engine) as session:
        user = session.exec(select(User).where(User.email == body.email)).first()
        if user is None or not verify_password(body.password, user.password_hash):
            raise api_error("INVALID_CREDENTIALS")
        token = create_access_token(user.id, settings)
        return TokenResponse(
            access_token=token,
            user=UserPublic(id=user.id, provider=user.provider, email=user.email, email_verified=user.email_verified, created_at=user.created_at),
        )


@router.get("/check-email", response_model=EmailAvailability)
def check_email(email: str, request: Request) -> EmailAvailability:
    # 로그인이 필요 없다 - 가입 전에 입력칸만 보고 확인하는 용도다.
    try:
        normalized = normalize_email(email)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    with Session(request.app.state.db_engine) as session:
        existing = session.exec(select(User).where(User.email == normalized)).first()
        return EmailAvailability(available=existing is None)


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic(id=user.id, provider=user.provider, email=user.email, email_verified=user.email_verified, created_at=user.created_at)


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
    with Session(request.app.state.db_engine) as session:
        user = session.get(User, user_id)
        if user is None:
            raise api_error("UNAUTHORIZED")  # 토큰 발급 후 계정이 삭제된 경우 - get_current_user 와 같은 처리
        user.email_verified = True
        session.add(user)
        session.commit()
        session.refresh(user)
        return UserPublic(id=user.id, provider=user.provider, email=user.email, email_verified=user.email_verified, created_at=user.created_at)
