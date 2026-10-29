"""ITS 중계 서버 단위 테스트. 실제 ITS 와 네트워크, 실제 키를 쓰지 않는다(httpx.MockTransport)."""
import logging
import re
from pathlib import Path
from typing import List, Optional

import httpx
import pytest
from fastapi.testclient import TestClient

import its_relay
from its_relay import ROUTES, Settings, create_app

TOKEN = "T" * 12 + "relay-test-token-0123456789"
KEYS = {
    "its_event_api_key": "SECRET-EVENT-KEY",
    "its_caution_api_key": "SECRET-CAUTION-KEY",
    "its_traffic_api_key": "SECRET-TRAFFIC-KEY",
    "its_prediction_api_key": "SECRET-PRED-KEY",
}
AUTH = {"X-Relay-Token": TOKEN}
ITS_OK = {"header": {"resultCode": 0, "resultMsg": "SUCCESS"}, "body": {"items": []}}
RELAY_DIR = Path(__file__).resolve().parents[1]


def make_settings(**over) -> Settings:
    return Settings(_env_file=None, relay_token=TOKEN, **{**KEYS, **over})  # 실제 relay/.env 를 읽지 않는다


class Recorder:
    def __init__(self, respond=None):
        self.requests: List[httpx.Request] = []
        self.respond = respond or (lambda request: httpx.Response(200, json=ITS_OK))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.respond(request)


@pytest.fixture
def make_client():
    opened: List[TestClient] = []

    def factory(handler, settings: Optional[Settings] = None) -> TestClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = TestClient(create_app(settings or make_settings(), http))
        client.__enter__()
        opened.append(client)
        return client

    yield factory
    for client in opened:
        client.__exit__(None, None, None)


# --- 정상 전달 ------------------------------------------------------------------
@pytest.mark.parametrize("path,key_name", sorted(ROUTES.items()))
def test_each_allowed_path_is_forwarded_with_the_pcs_own_key(make_client, path, key_name):
    rec = Recorder()
    client = make_client(rec)
    response = client.get("/" + path, params={"type": "all", "minX": "126.9", "getType": "json"}, headers=AUTH)
    assert response.status_code == 200 and response.json() == ITS_OK
    request = rec.requests[0]
    assert request.url.host == "openapi.its.go.kr" and request.url.port == 9443 and request.url.path == "/" + path
    assert request.url.params["apiKey"] == KEYS[key_name]  # 그 경로에 맞는 키
    assert request.url.params["type"] == "all" and request.url.params["minX"] == "126.9"  # 나머지 쿼리는 그대로


@pytest.mark.parametrize("name", ["apiKey", "apikey", "APIKEY"])
def test_callers_api_key_is_discarded_and_replaced(make_client, name):
    rec = Recorder()
    make_client(rec).get("/eventInfo", params={name: "CALLER-KEY", "type": "all"}, headers=AUTH)
    params = rec.requests[0].url.params
    assert params.get_list("apiKey") == [KEYS["its_event_api_key"]]  # 하나뿐이고 PC 의 키
    assert "CALLER-KEY" not in str(rec.requests[0].url)


def test_upstream_status_and_body_pass_through(make_client):
    client = make_client(Recorder(lambda r: httpx.Response(401, json={"header": {"resultCode": 4005}})))
    response = client.get("/eventInfo", headers=AUTH)
    assert response.status_code == 401 and response.json()["header"]["resultCode"] == 4005


# --- 인증, 허용 범위 -------------------------------------------------------------
@pytest.mark.parametrize("headers", [{}, {"X-Relay-Token": "wrong-token"}, {"X-Relay-Token": TOKEN[:-1]}, {"X-Relay-Token": TOKEN + "x"}])
def test_missing_or_wrong_token_is_404_and_never_reaches_its(make_client, headers):
    rec = Recorder()
    client = make_client(rec)
    for path in ("/eventInfo", "/_health"):
        assert client.get(path, headers=headers).status_code == 404
    assert rec.requests == []


def test_token_in_query_string_is_not_accepted(make_client):
    rec = Recorder()
    assert make_client(rec).get("/eventInfo", params={"token": TOKEN, "relay_token": TOKEN}).status_code == 404
    assert rec.requests == []


@pytest.mark.parametrize("path", ["/", "/secret", "/openapi.json", "/docs", "/eventInfo/extra", "/EVENTINFO", "/eventInfo%2F..%2Fx", "/trafficInfoAll"])
def test_unlisted_paths_are_404_even_with_a_valid_token(make_client, path):
    rec = Recorder()
    assert make_client(rec).get(path, headers=AUTH).status_code == 404
    assert rec.requests == []


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_only_get_is_handled(make_client, method):
    rec = Recorder()
    response = getattr(make_client(rec), method)("/eventInfo", headers=AUTH)
    assert response.status_code == 405
    assert rec.requests == []


def test_missing_key_for_a_path_is_503_without_calling_its(make_client):
    rec = Recorder()
    client = make_client(rec, make_settings(its_caution_api_key=None))
    assert client.get("/posIncidentInfo", headers=AUTH).status_code == 503
    assert client.get("/eventInfo", headers=AUTH).status_code == 200  # 다른 경로는 정상
    assert len(rec.requests) == 1


def test_health_reports_configuration_without_secrets(make_client):
    client = make_client(Recorder(), make_settings(its_traffic_api_key=None))
    body = client.get("/_health", headers=AUTH).json()
    assert body["status"] == "ok" and body["configured"]["trafficInfo"] is False and body["configured"]["eventInfo"] is True
    text = client.get("/_health", headers=AUTH).text
    assert not any(secret in text for secret in [TOKEN, *KEYS.values()])


def test_refuses_to_start_without_a_strong_token():
    for token in (None, "", "short"):
        with pytest.raises(RuntimeError):
            create_app(Settings(_env_file=None, relay_token=token, **KEYS), httpx.AsyncClient())


def test_binds_to_loopback_only():
    assert its_relay.HOST == "127.0.0.1"


# --- 장애 -----------------------------------------------------------------------
def test_its_timeout_is_504_and_connection_error_is_502(make_client):
    def timeout(request):
        raise httpx.ConnectTimeout("connect timeout for %s" % request.url, request=request)

    def refused(request):
        raise httpx.ConnectError("refused %s" % request.url, request=request)

    assert make_client(timeout).get("/eventInfo", headers=AUTH).status_code == 504
    assert make_client(refused).get("/eventInfo", headers=AUTH).status_code == 502


# --- 비밀 값 노출 방지 -------------------------------------------------------------
def test_token_keys_and_coordinates_never_appear_in_logs_or_responses(make_client, caplog):
    def fail(request):
        raise httpx.ReadTimeout("slow %s" % request.url, request=request)  # 예외 메시지에 키가 든 URL 이 있다

    ok_client = make_client(Recorder())
    bad_client = make_client(fail)
    with caplog.at_level(logging.DEBUG):
        responses = [
            ok_client.get("/eventInfo", params={"minX": "126.912345", "minY": "37.598765"}, headers=AUTH),
            bad_client.get("/eventInfo", params={"minX": "126.912345", "minY": "37.598765"}, headers=AUTH),
            ok_client.get("/eventInfo", headers={"X-Relay-Token": "attacker-guess"}),
            ok_client.get("/_health", headers=AUTH),
        ]
    secrets_ = [TOKEN, "attacker-guess", "126.912345", "37.598765", *KEYS.values()]
    for secret in secrets_:
        assert secret not in caplog.text, secret
        assert all(secret not in r.text for r in responses), secret
    assert "error=ReadTimeout" in caplog.text  # 원인 종류는 남는다


# --- 저장소 위생 ------------------------------------------------------------------
def test_env_example_has_names_only_and_every_secret_name():
    names = set()
    for line in (RELAY_DIR / ".env.example").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, sep, value = line.partition("=")
        assert sep == "=" and re.fullmatch(r"[A-Z][A-Z0-9_]*", name.strip()), line
        assert value.strip() == "", "%s 에 값이 들어 있다" % name
        names.add(name.strip())
    assert names == {"RELAY_TOKEN", "ITS_EVENT_API_KEY", "ITS_CAUTION_API_KEY", "ITS_TRAFFIC_API_KEY", "ITS_PREDICTION_API_KEY"}


def test_relay_source_contains_no_hardcoded_secrets():
    source = (RELAY_DIR / "its_relay.py").read_text(encoding="utf-8")
    assert not re.search(r"""(?i)(api_?key|token|secret)\s*=\s*["'][A-Za-z0-9_\-]{16,}["']""", source)
