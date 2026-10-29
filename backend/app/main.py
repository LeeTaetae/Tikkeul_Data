import logging
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cache import TtlCache
from app.config import Settings, get_settings
from app.errors import ApiError
from app.navigation.routers import geocode_router, router as navigation_router
from app.routers import geo, traffic
from app.service import TrafficService
from app.upstream import Upstream

_KEY_NAMES = [
    "its_traffic_api_key",
    "its_event_api_key",
    "its_prediction_api_key",
    "its_caution_api_key",
    "protection_zone_service_key",
    "kakao_rest_api_key",
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
        yield
        if http_client is None:
            await client.aclose()

    app = FastAPI(title="티끌모아Data API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins(), allow_methods=["GET", "POST"], allow_headers=["*"]
    )

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})

    @app.get("/api/health", tags=["health"])
    async def health():
        # 키 값이 아니라 설정 여부(true/false)만 알려준다.
        return {"status": "ok", "configured": {name: settings.secret(name) is not None for name in _KEY_NAMES}}

    # 내비게이션 PoC 와 같은 경로(/health). Render 상태 확인과 기존 PoC 호출자용.
    @app.get("/health", tags=["health"])
    async def health_simple():
        return {"status": "ok"}

    app.include_router(traffic.router)
    app.include_router(geo.router)
    app.include_router(navigation_router)
    app.include_router(geocode_router)
    return app


app = create_app()
