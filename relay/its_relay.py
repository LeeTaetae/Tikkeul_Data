"""ITS 중계 서버 (한국 PC 에서 실행). Render 는 ITS(openapi.its.go.kr:9443)에 연결되지 않아서, 한국 IP 에서 대신 호출해 준다.

Render -> Cloudflare Tunnel -> 이 서버(127.0.0.1) -> ITS. 본문과 상태 코드는 그대로 돌려주고, 파싱·캐시는 Render 가 한다.

- GET 과 허용된 ITS 경로 4개만 처리한다. 인증은 X-Relay-Token 헤더이고, 실패하면 이유를 알려주지 않고 404 를 낸다.
- ITS 인증키는 이 PC 의 relay/.env(또는 환경변수)에만 있다. 호출자가 apiKey 를 보내도 버리고 PC 의 키로 바꿔 보낸다.
- 127.0.0.1 에만 바인딩한다(아래 HOST). 토큰·키·쿼리(좌표)는 로그에 남기지 않는다.

실행(저장소 루트에서): backend/.venv/Scripts/python relay/its_relay.py
"""
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

HOST = "127.0.0.1"  # 바꾸지 않는다. 외부에는 cloudflared 터널로만 연다.
PORT = 8787
RELAY_DIR = Path(__file__).resolve().parent

# ITS 경로 -> 그 경로에 쓰는 인증키 설정 이름. 여기에 없는 경로는 처리하지 않는다.
ROUTES: Dict[str, str] = {
    "eventInfo": "its_event_api_key",
    "posIncidentInfo": "its_caution_api_key",
    "trafficInfo": "its_traffic_api_key",
    "bypassFCastInfo": "its_prediction_api_key",
}
MIN_TOKEN_LEN = 24
MAX_CONCURRENT = 5
MAX_BODY_BYTES = 5 * 1024 * 1024

logger = logging.getLogger("its_relay")


class Settings(BaseSettings):
    # relay/.env 만 읽는다. 값은 로그와 응답에 내보내지 않는다(SecretStr).
    model_config = SettingsConfigDict(env_file=str(RELAY_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")

    relay_token: Optional[SecretStr] = None
    its_event_api_key: Optional[SecretStr] = None
    its_caution_api_key: Optional[SecretStr] = None
    its_traffic_api_key: Optional[SecretStr] = None
    its_prediction_api_key: Optional[SecretStr] = None
    its_base_url: str = "https://openapi.its.go.kr:9443"
    upstream_timeout_s: float = 8.0  # Render 의 읽기 제한(15초)보다 짧게 둔다

    def secret(self, name: str) -> Optional[str]:
        value = getattr(self, name)
        text = value.get_secret_value().strip() if value is not None else ""
        return text or None


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def _quiet_loggers() -> None:
    # httpx 는 INFO 레벨에서 요청 URL 전체(키·좌표 포함)를 기록한다.
    for name in ("httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(name).setLevel(logging.WARNING if name != "uvicorn.access" else logging.CRITICAL)


def create_app(settings: Optional[Settings] = None, http_client: Optional[httpx.AsyncClient] = None) -> FastAPI:
    settings = settings or get_settings()
    token = settings.secret("relay_token")
    if token is None or len(token) < MIN_TOKEN_LEN:
        raise RuntimeError("RELAY_TOKEN 이 없거나 %d자보다 짧다. relay/.env 를 확인한다." % MIN_TOKEN_LEN)
    _quiet_loggers()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = http_client or httpx.AsyncClient(timeout=httpx.Timeout(settings.upstream_timeout_s, connect=3.0))
        app.state.client = client
        app.state.slots = asyncio.Semaphore(MAX_CONCURRENT)
        yield
        if http_client is None:
            await client.aclose()

    # 자동 문서는 켜지 않는다(경로 목록을 드러내지 않는다).
    app = FastAPI(title="its-relay", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def authorized(request: Request) -> bool:
        given = request.headers.get("x-relay-token", "")
        return hmac.compare_digest(given.encode("utf-8"), token.encode("utf-8"))

    def not_found() -> Response:
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    @app.get("/_health")
    async def health(request: Request):
        if not authorized(request):
            return not_found()
        # 키 값이 아니라 설정 여부(true/false)만 알려준다.
        return {"status": "ok", "configured": {path: settings.secret(name) is not None for path, name in ROUTES.items()}}

    @app.get("/{path}")
    async def relay(path: str, request: Request):
        if not authorized(request) or path not in ROUTES:
            return not_found()
        key = settings.secret(ROUTES[path])
        if key is None:
            return JSONResponse({"error": "NOT_CONFIGURED"}, status_code=503)

        # 호출자가 보낸 apiKey 는 버리고(대소문자 무관) 이 PC 의 키를 쓴다.
        params: List[Tuple[str, str]] = [(k, v) for k, v in request.query_params.multi_items() if k.lower() != "apikey"]
        params.append(("apiKey", key))
        try:
            async with request.app.state.slots:
                response = await request.app.state.client.get(
                    settings.its_base_url.rstrip("/") + "/" + path, params=params, headers={"Accept": "application/json"}
                )
        except httpx.TimeoutException as exc:
            logger.warning("ITS 호출 실패 path=%s error=%s", path, type(exc).__name__)  # 예외 메시지에는 URL 과 키가 있다
            return JSONResponse({"error": "UPSTREAM_TIMEOUT"}, status_code=504)
        except httpx.HTTPError as exc:
            logger.warning("ITS 호출 실패 path=%s error=%s", path, type(exc).__name__)
            return JSONResponse({"error": "UPSTREAM_UNAVAILABLE"}, status_code=502)
        if len(response.content) > MAX_BODY_BYTES:
            return JSONResponse({"error": "UPSTREAM_TOO_LARGE"}, status_code=502)
        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type", "application/json").split(";")[0],
        )

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.WARNING)
    # access_log=False: 접속 로그에는 요청 URL(좌표)이 찍힌다.
    uvicorn.run(create_app(), host=HOST, port=PORT, access_log=False)


if __name__ == "__main__":
    main()
