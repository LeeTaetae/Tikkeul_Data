"""배포 환경에서 발견된 문제(Render 의 502/504)의 재발 방지 테스트."""
import logging

import httpx

from tests.conftest import make_settings
from tests.fixtures import KEYS
from tests.test_api import BBOX

SEOUL = {"lat": 37.5665, "lon": 126.978}
KAKAO_REGION_OK = {"documents": [{"region_type": "B", "code": "1114000000", "region_1depth_name": "서울특별시", "region_2depth_name": "중구", "region_3depth_name": "태평로1가"}]}


def test_kakao_region_sends_ka_header(make_client):
    # Kakao 게이트웨이는 KA 헤더가 없으면 유효한 키도 401 로 거절한다(Render 의 /api/geo/region 502 원인).
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=KAKAO_REGION_OK)

    assert make_client(handler).get("/api/geo/region", params=SEOUL).status_code == 200
    assert seen[0].headers["KA"].startswith("os/")
    assert seen[0].headers["Authorization"] == "KakaoAK " + KEYS["kakao_rest_api_key"]


def test_connect_timeout_is_logged_with_host_and_class_only(make_client, caplog):
    # 504 원인이 연결 시간 초과인지 읽기 시간 초과인지 운영 로그로 구분할 수 있어야 한다. 키·좌표는 남기지 않는다.
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("connect timeout for %s" % request.url, request=request)

    client = make_client(handler)
    with caplog.at_level(logging.WARNING):
        responses = [client.get("/api/traffic/incidents", params=BBOX), client.get("/api/geo/region", params=SEOUL)]
    assert [r.status_code for r in responses] == [504, 504]  # 오류를 200 으로 숨기지 않는다
    assert "host=openapi.its.go.kr" in caplog.text and "host=dapi.kakao.com" in caplog.text
    assert caplog.text.count("error=ConnectTimeout") == 2
    for secret in KEYS.values():
        assert secret not in caplog.text
    assert "37.5665" not in caplog.text and "126.978" not in caplog.text


def test_read_timeout_is_distinguishable_from_connect_timeout(make_client, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with caplog.at_level(logging.WARNING):
        assert make_client(handler).get("/api/traffic/caution-zones", params=BBOX).status_code == 504
    assert "error=ReadTimeout" in caplog.text


def test_kakao_auth_rejection_is_logged_and_still_502(make_client, caplog):
    client = make_client(lambda request: httpx.Response(401, json={"errorType": "AccessDeniedError"}))
    with caplog.at_level(logging.WARNING):
        response = client.get("/api/geo/region", params=SEOUL)
    assert response.status_code == 502 and response.json()["error"]["code"] == "UPSTREAM_AUTH"
    assert "Kakao 인증 거절 status=401" in caplog.text
