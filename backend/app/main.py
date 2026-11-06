import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from google import genai
from google.genai import types as genai_types
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.auth.rate_limit import AttemptLimiter, ResendCooldown
from app.auth.router import router as auth_router
from app.auth.store import open_user_database
from app.cache import TtlCache
from app.chat.router import router as chat_router
from app.chat.service import ChatService
from app.config import Settings, get_settings
from app.db import create_db_and_tables, make_engine
from app.errors import ApiError
from app.favorites.router import router as favorites_router
from app.navigation.routers import geocode_router, places_router, router as navigation_router
from app.navigation.bus_seoul import seoul_matching_enabled
from app.navigation.bus_tago import bus_matching_enabled, warm_up_bus_routes
from app.navigation.stations import station_status
from app.routers import geo, traffic
from app.service import TrafficService
from app.trips.router import router as trips_router
from app.upstream import Upstream

_KEY_NAMES = [
    "its_traffic_api_key",
    "its_event_api_key",
    "its_prediction_api_key",
    "its_caution_api_key",
    "protection_zone_service_key",
    "kakao_rest_api_key",
    "jwt_secret",
    "resend_api_key",
    "gemini_api_key",
]


def create_app(
    settings: Optional[Settings] = None,
    http_client: Optional[httpx.AsyncClient] = None,
    cache: Optional[TtlCache] = None,
) -> FastAPI:
    settings = settings or get_settings()

    # httpx 는 INFO 레벨에서 요청 URL 전체를 기록한다. ITS 는 인증키가 URL 쿼리에 있어 키가 로그에 남으므로 끈다.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = http_client or httpx.AsyncClient(timeout=httpx.Timeout(settings.http_timeout_s, connect=5.0))
        app.state.service = TrafficService(Upstream(client, settings), settings, cache or TtlCache())
        gemini_key = settings.secret("gemini_api_key")
        chat_client = genai.Client(api_key=gemini_key, http_options=genai_types.HttpOptions(timeout=15000)) if gemini_key else None
        app.state.chat_service = ChatService(chat_client, app.state.service) if chat_client else None
        app.state.settings = settings
        app.state.db_engine = make_engine(settings)
        create_db_and_tables(app.state.db_engine)
        engine = app.state.db_engine
        app.state.resend_cooldown = ResendCooldown(engine, "resend_cooldown")
        app.state.signup_code_cooldown = ResendCooldown(engine, "signup_code_cooldown", cooldown_s=30.0)
        app.state.signup_code_attempts = AttemptLimiter(engine, "signup_code_attempts", max_attempts=5, window_s=settings.signup_code_expires_minutes * 60.0)
        app.state.reset_code_cooldown = ResendCooldown(engine, "reset_code_cooldown", cooldown_s=30.0)
        app.state.reset_code_attempts = AttemptLimiter(engine, "reset_code_attempts", max_attempts=5, window_s=settings.signup_code_expires_minutes * 60.0)
        # 로그인 비밀번호 무차별 대입 방어. 이메일당 5번 틀리면 5분간 막는다(성공하면 바로 풀림).
        app.state.login_attempts = AttemptLimiter(engine, "login", max_attempts=5, window_s=300.0)
        # /api/chat 은 인증 없는 공개 엔드포인트라 IP당 호출 빈도를 막아 Gemini 비용 남용을 막는다.
        app.state.chat_rate_limiter = AttemptLimiter(engine, "chat", max_attempts=10, window_s=60.0)
        # Fail closed when MongoDB is configured: never silently switch account stores.
        mongo_client, app.state.user_database = await asyncio.to_thread(open_user_database, settings)
        warm_task = asyncio.ensure_future(warm_up_bus_routes())  # 키가 없으면 바로 끝난다
        try:
            yield
        finally:
            warm_task.cancel()
            if mongo_client is not None:
                mongo_client.close()
            app.state.db_engine.dispose()
            if http_client is None:
                await client.aclose()

    app = FastAPI(title="티끌모아Data API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins(), allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"]
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})

    @app.get("/api/health", tags=["health"])
    async def health():
        # 키 값이 아니라 설정 여부(true/false)만 알려준다.
        # stations: 지하철 정거장 좌표 데이터의 건수와 로딩 실패 여부(배포 후 파일이 올라갔는지 확인용). 값이 0 이어도 status 는 ok 다.
        return {"status": "ok", "configured": {name: settings.secret(name) is not None for name in _KEY_NAMES}, "stations": {**station_status(), "bus_matching_enabled": bus_matching_enabled(), "seoul_bus_matching_enabled": seoul_matching_enabled()}}

    # 내비게이션 PoC 와 같은 경로(/health). Render 상태 확인과 기존 PoC 호출자용.
    @app.get("/health", tags=["health"])
    async def health_simple():
        return {"status": "ok"}

    app.include_router(traffic.router)
    app.include_router(geo.router)
    app.include_router(navigation_router)
    app.include_router(geocode_router)
    app.include_router(places_router)
    app.include_router(auth_router)

    app.include_router(trips_router)

    app.include_router(favorites_router)

    app.include_router(chat_router)

    return app


app = create_app()
