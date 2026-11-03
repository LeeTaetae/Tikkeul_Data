from typing import Callable, List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

from app.cache import TtlCache
from app.config import Settings
from app.main import create_app
from tests.fixtures import KEYS


@pytest.fixture(autouse=True)
def _tago_off_by_default(monkeypatch):
    """backend/.env 에 실제 TAGO 키가 있어도 테스트는 TAGO 를 부르지 않는다. 버스 매칭 테스트는 자기 클라이언트를 직접 넘긴다."""
    from app.navigation import bus_seoul, bus_tago

    monkeypatch.setattr(bus_tago, "get_tago_client", lambda: None)
    monkeypatch.setattr(bus_tago, "get_seoul_client", lambda: None)  # 서울 키도 같다
    monkeypatch.setattr(bus_seoul, "get_seoul_client", lambda: None)


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


# jwt_secret 은 다른 인증키와 같은 "/api/health 의 configured 목록" 이라 KEYS 에 있다. database_url 은
# 그 목록에 없는 별도 설정이라 여기 따로 둔다 - 테스트가 실제 backend/data/tikkeul.db 를 건드리지 않도록 기본은 메모리 DB다.
AUTH_TEST_DEFAULTS = {"database_url": "sqlite:///:memory:"}


def make_settings(**over) -> Settings:
    return Settings(_env_file=None, **{**KEYS, **AUTH_TEST_DEFAULTS, **over})  # 실제 .env 를 읽지 않는다


@pytest.fixture
def make_client():
    """MockTransport 핸들러를 공공 API 대신 연결한 앱 클라이언트를 만든다."""
    opened: List[TestClient] = []

    def factory(handler: Callable[[httpx.Request], httpx.Response], settings: Optional[Settings] = None, cache: Optional[TtlCache] = None) -> TestClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = TestClient(create_app(settings or make_settings(), http, cache))
        client.__enter__()
        opened.append(client)
        return client

    yield factory
    for client in opened:
        client.__exit__(None, None, None)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()
