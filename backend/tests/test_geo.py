import logging

import httpx
import pytest

from tests.conftest import make_settings
from tests.fixtures import KEYS


def kakao_doc(region_type, code, d1, d2, d3):
    return {"region_type": region_type, "address_name": " ".join([d1, d2, d3]).strip(), "region_1depth_name": d1,
            "region_2depth_name": d2, "region_3depth_name": d3, "region_4depth_name": "", "code": code, "x": 0, "y": 0}


def kakao_ok(*docs):
    return {"meta": {"total_count": len(docs)}, "documents": list(docs)}


class Recorder:
    def __init__(self, respond):
        self.respond = respond
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return self.respond(request)


def reply(payload, status=200):
    return lambda request: httpx.Response(status, json=payload)


SEOUL = {"lat": 37.5665, "lon": 126.978}


def test_region_picks_legal_dong_and_returns_first_five_digits(make_client):
    rec = Recorder(reply(kakao_ok(kakao_doc("H", "1114055000", "서울특별시", "중구", "명동"), kakao_doc("B", "1114010100", "서울특별시", "중구", "명동1가"))))
    body = make_client(rec).get("/api/geo/region", params=SEOUL).json()
    assert body["sgg_cd"] == "11140" and body["sido_name"] == "서울특별시" and body["sgg_name"] == "중구"
    request = rec.requests[0]
    assert request.headers["Authorization"] == "KakaoAK " + KEYS["kakao_rest_api_key"]  # 키는 헤더로만
    assert KEYS["kakao_rest_api_key"] not in str(request.url)
    assert request.url.params["x"] == "126.978000" and request.url.params["y"] == "37.566500"  # x=경도, y=위도


@pytest.mark.parametrize(
    "code,d1,d2,expected",
    [
        ("4111110100", "경기도", "수원시 장안구", "41111"),  # 일반구가 있는 시는 구 코드
        ("5111010100", "강원특별자치도", "춘천시", "51110"),  # 개편 후 현행 코드
        ("5211110100", "전북특별자치도", "전주시 완산구", "52111"),
        ("2772025000", "대구광역시", "군위군", "27720"),
        ("3611010100", "세종특별자치시", "", "36110"),
    ],
)
def test_region_code_examples(make_client, code, d1, d2, expected):
    client = make_client(Recorder(reply(kakao_ok(kakao_doc("B", code, d1, d2, "읍면동")))))
    assert client.get("/api/geo/region", params=SEOUL).json()["sgg_cd"] == expected


def test_only_administrative_dong_or_empty_means_region_not_found(make_client):
    only_h = make_client(Recorder(reply(kakao_ok(kakao_doc("H", "1114055000", "서울특별시", "중구", "명동")))))
    response = only_h.get("/api/geo/region", params=SEOUL)
    assert response.status_code == 404 and response.json()["error"]["code"] == "REGION_NOT_FOUND"
    empty = make_client(Recorder(reply(kakao_ok())))
    assert empty.get("/api/geo/region", params=SEOUL).status_code == 404


def test_coordinates_outside_korea_do_not_call_kakao(make_client):
    rec = Recorder(reply(kakao_ok()))
    client = make_client(rec)
    for params in ({"lat": 35.6762, "lon": 139.6503}, {"lat": 0.0, "lon": 0.0}, {"lat": 40.7, "lon": -74.0}):
        response = client.get("/api/geo/region", params=params)
        assert response.status_code == 404 and response.json()["error"]["code"] == "REGION_NOT_FOUND"
    assert rec.requests == []
    assert client.get("/api/geo/region", params={"lat": 95, "lon": 126}).status_code == 422


@pytest.mark.parametrize("code", ["11140", "ABCDEFGHIJ", "", "111401010012"])
def test_unexpected_code_format_is_not_guessed(make_client, code):
    client = make_client(Recorder(reply(kakao_ok(kakao_doc("B", code, "서울특별시", "중구", "명동")))))
    assert client.get("/api/geo/region", params=SEOUL).json()["error"]["code"] == "UPSTREAM_BAD_RESPONSE"


@pytest.mark.parametrize(
    "status,expected_status,expected_code",
    [(401, 502, "UPSTREAM_AUTH"), (403, 502, "UPSTREAM_AUTH"), (429, 503, "UPSTREAM_RATE_LIMIT"), (400, 502, "UPSTREAM_BAD_REQUEST"), (500, 502, "UPSTREAM_ERROR")],
)
def test_kakao_error_statuses(make_client, status, expected_status, expected_code):
    client = make_client(Recorder(reply({"errorType": "x", "message": "y"}, status)))
    response = client.get("/api/geo/region", params=SEOUL)
    assert response.status_code == expected_status and response.json()["error"]["code"] == expected_code


def test_timeout_connection_and_bad_body(make_client):
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request):
        raise httpx.ConnectError("no route", request=request)

    assert make_client(Recorder(timeout)).get("/api/geo/region", params=SEOUL).status_code == 504
    assert make_client(Recorder(refused)).get("/api/geo/region", params=SEOUL).json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert make_client(Recorder(lambda r: httpx.Response(200, text="<html>"))).get("/api/geo/region", params=SEOUL).json()["error"]["code"] == "UPSTREAM_BAD_RESPONSE"
    assert make_client(Recorder(reply({"documents": "nope"}))).get("/api/geo/region", params=SEOUL).json()["error"]["code"] == "UPSTREAM_BAD_RESPONSE"


def test_missing_key_does_not_call_kakao(make_client):
    rec = Recorder(reply(kakao_ok()))
    response = make_client(rec, make_settings(kakao_rest_api_key=None)).get("/api/geo/region", params=SEOUL)
    assert response.status_code == 503 and response.json()["error"]["code"] == "NOT_CONFIGURED"
    assert rec.requests == []


def test_key_and_coordinates_never_appear_in_logs_or_errors(make_client, caplog):
    def respond(request):
        raise httpx.ReadTimeout("timeout while reading %s" % request.url, request=request)  # URL(좌표)이 예외에 들어 있다

    client = make_client(Recorder(respond))
    with caplog.at_level(logging.DEBUG):
        response = client.get("/api/geo/region", params={"lat": 37.123456, "lon": 127.654321})
    for secret in (KEYS["kakao_rest_api_key"], "37.123", "127.654"):
        assert secret not in caplog.text and secret not in response.text
