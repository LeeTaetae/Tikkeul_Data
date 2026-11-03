"""지하철 정거장 좌표 매칭(app/navigation/stations.py) 테스트.

규칙 테스트는 임시 CSV(실제 파일과 같은 컬럼·cp949)로 하고, 실제 공식 파일(backend/data/stations, git 제외)이 있으면 그 파일로도 확인한다.
"""
import asyncio

import httpx
import pytest

from app.navigation import providers as nav_providers
from app.navigation import stations as st
from app.navigation.schemas import LatLng
from tests.conftest import make_settings

HEADER = "역사_ID,역사명,호선,위도,경도\n"


def write_master(tmp_path, rows):
    path = tmp_path / "master.csv"
    path.write_bytes((HEADER + "\n".join(rows) + "\n").encode("cp949"))
    return st.load_seoul_master(path)


# 경도 0.001 ≈ 88m (위도 37.5). 동쪽으로 달리는 직선 경로 위에 역 A,B,C 가 있다.
def lng(i):
    return 127.0 + i * 0.01


PATH = [(37.5, lng(0) + k * 0.001) for k in range(0, 41)]  # lng 127.000 ~ 127.040


def row(i, name, line, x):
    return f"{i},{name},{line},37.5,{lng(x)}"


def test_exact_name_and_line_matches_with_high_confidence(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0), row(2, "나", "2호선", 2), row(3, "다", "2호선", 4)])
    res = idx.match_stops("2호선", ["가", "나", "다"], PATH)
    assert [m.confidence for m in res] == ["high"] * 3
    assert (res[1].lat, res[1].lng, res[1].station_id, res[1].data_source) == (37.5, lng(2), "2", "seoul_station_master")


def test_same_name_on_another_line_is_never_matched(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "3호선", 0), row(2, "나", "3호선", 2)])
    assert idx.match_stops("2호선", ["가", "나"], PATH) == [None, None]


def test_unknown_kakao_line_gets_no_coordinates(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0), row(2, "나", "2호선", 2)])
    assert idx.match_stops("모르는선", ["가", "나"], PATH) == [None, None]


def test_parenthesis_name_difference_matches_with_medium_confidence(tmp_path):
    idx = write_master(tmp_path, [row(1, "가(구청)", "2호선", 0), row(2, "나", "2호선", 2)])
    res = idx.match_stops("2호선", ["가", "나"], PATH)  # 카카오는 부역명을 뺀 이름을 주기도 한다
    assert [m.confidence for m in res] == ["medium", "high"]


def test_duplicate_rows_of_one_station_count_as_one_but_with_lower_confidence(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "1호선", 0), row(2, "가", "경부선", 0), row(3, "나", "1호선", 2)])
    res = idx.match_stops("1호선", ["가", "나"], PATH)
    assert res[0].confidence == "medium" and res[1].confidence == "high"


def test_same_name_in_different_places_is_ambiguous_and_not_matched(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "1호선", 0), row(2, "가", "경부선", 3), row(3, "나", "1호선", 2)])
    assert idx.match_stops("1호선", ["가", "나"], PATH)[0] is None


def test_coordinate_far_from_the_path_is_rejected(tmp_path):
    far = "2,나,2호선,37.51,%s" % lng(2)  # 위도 0.01 ≈ 1.1km 떨어짐
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0), far])
    res = idx.match_stops("2호선", ["가", "나"], PATH)
    assert res[0] is not None and res[1] is None


def test_stop_order_going_backwards_along_the_path_is_rejected(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0), row(2, "나", "2호선", 3), row(3, "다", "2호선", 1)])
    res = idx.match_stops("2호선", ["가", "나", "다"], PATH)  # 다 가 나 보다 앞쪽에 있어 순서가 어긋난다
    assert res[0] is not None and res[1] is not None and res[2] is None


def test_no_path_means_no_coordinates(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0)])
    assert idx.match_stops("2호선", ["가"], []) == [None]


def test_bad_rows_are_skipped_and_never_repaired(tmp_path):
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0), "2,나,2호선,127.0,37.5", "3,다,2호선,,", "4,라,2호선,abc,def"])
    assert len(idx) == 1  # 위·경도가 뒤바뀐 행은 고쳐 쓰지 않고 버린다


def test_missing_or_unexpected_file_gives_empty_index(tmp_path):
    bad = tmp_path / "x.csv"
    bad.write_bytes("a,b\n1,2\n".encode("utf-8"))
    assert len(st.load_seoul_master(bad)) == 0
    assert st.SubwayStationIndex([]).match_stops("2호선", ["가"], PATH) == [None]


def kakao_payload():
    steps = [
        {
            "properties": {"type": "SUBWAY", "guidance": "2호선", "distance": 100, "time": 60, "stops": [{"name": "가"}, {"name": "나"}, {"name": "없는역"}], "vehicles": [{"name": "2호선"}]},
            "path": {"points": [[lng(0) + k * 0.001, 37.5] for k in range(0, 41)]},
        },
        {
            "properties": {"type": "BUS", "guidance": "버스", "distance": 100, "time": 60, "stops": [{"name": "가"}, {"name": "나"}], "vehicles": [{"name": "402"}]},
            "path": {"points": [[127.0, 37.5], [127.04, 37.5]]},
        },
    ]
    return {"properties": {"total": 1}, "routes": [{"properties": {"type": "BUS_AND_SUBWAY", "totalDistance": 200, "totalTime": 120, "transfers": 1, "fare": {"value": 1500}}, "steps": steps}]}


def test_transit_routes_add_coordinates_only_for_matched_subway_stops(tmp_path, monkeypatch):
    idx = write_master(tmp_path, [row(1, "가", "2호선", 0), row(2, "나", "2호선", 2)])
    monkeypatch.setattr(nav_providers, "get_seoul_index", lambda: idx)
    real = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=kakao_payload()))
    monkeypatch.setattr(nav_providers.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    options, _ = asyncio.run(nav_providers.KakaoRoutingProvider("k").get_transit_routes(LatLng(lat=37.5, lng=127.0), LatLng(lat=37.5, lng=127.04)))
    subway, bus = options[0].steps
    assert [(s.name, s.lat is not None) for s in subway.stops] == [("가", True), ("나", True), ("없는역", False)]
    unmatched = subway.stops[2].model_dump()
    assert unmatched == {"name": "없는역", "lat": None, "lng": None, "match_confidence": None, "station_id": None, "stop_id": None, "data_source": None}
    assert all(s.lat is None and s.station_id is None for s in bus.stops)  # 버스는 좌표를 만들어내지 않는다
    assert set(subway.model_dump()) >= {"type", "distance_m", "time_sec", "stops", "vehicles", "path_start_index"}  # 기존 필드 유지


def _routes_with_data_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(st, "STATION_DATA_DIR", tmp_path)
    st.get_seoul_index.cache_clear()
    real = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=kakao_payload()))
    monkeypatch.setattr(nav_providers.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    return asyncio.run(nav_providers.KakaoRoutingProvider("k").get_transit_routes(LatLng(lat=37.5, lng=127.0), LatLng(lat=37.5, lng=127.04)))[0]


@pytest.mark.parametrize("kind", ["missing", "empty", "garbage", "folder"])
def test_transit_route_still_works_when_the_station_file_is_missing_or_unreadable(tmp_path, monkeypatch, kind):
    target = tmp_path / st.SEOUL_MASTER_FILE
    if kind == "empty":
        target.write_bytes(b"")
    elif kind == "garbage":
        target.write_bytes(bytes(range(256)) * 20)
    elif kind == "folder":
        target.mkdir()  # 읽으려 하면 PermissionError/IsADirectoryError
    options = _routes_with_data_dir(monkeypatch, tmp_path)
    st.get_seoul_index.cache_clear()
    assert len(options) == 1 and len(options[0].steps) == 2
    assert all(stop.lat is None and stop.station_id is None for step in options[0].steps for stop in step.stops)


def test_transit_route_still_works_when_matching_itself_raises(tmp_path, monkeypatch):
    class Broken:
        def match_stops(self, *args):
            raise RuntimeError("boom")

    monkeypatch.setattr(nav_providers, "get_seoul_index", lambda: Broken())
    real = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=kakao_payload()))
    monkeypatch.setattr(nav_providers.httpx, "AsyncClient", lambda **kw: real(transport=transport, **kw))
    options, _ = asyncio.run(nav_providers.KakaoRoutingProvider("k").get_transit_routes(LatLng(lat=37.5, lng=127.0), LatLng(lat=37.5, lng=127.04)))
    assert len(options) == 1 and all(stop.lat is None for step in options[0].steps for stop in step.stops)


REAL_FILE = st.STATION_DATA_DIR / st.SEOUL_MASTER_FILE


def test_bundled_official_file_is_in_the_repository_layout():
    # 배포되는 패키지 데이터다. 이 파일이 없으면 Render 에서 좌표가 전부 null 이 된다(경로 안내는 그대로 동작한다).
    assert REAL_FILE.exists() and REAL_FILE.parent.name == "data" and REAL_FILE.parent.parent.name == "navigation"
    assert (REAL_FILE.parent / "NOTICE.md").exists()


def test_official_file_loads_and_matches_line_two_stations():
    idx = st.load_seoul_master(REAL_FILE)
    assert len(idx) == 784  # 확인한 파일의 행 수. 파일을 갱신하면 이 수를 함께 고친다
    names = ["신도림", "대림(구로구청)", "구로디지털단지"]
    coords = [idx._lookup("2호선", n) for n in names]
    assert all(c is not None for c in coords)
    path = [(r.lat, r.lng) for r, _ in coords]
    res = idx.match_stops("2호선", names, path)
    assert [m.confidence for m in res] == ["high", "high", "high"]
    assert 37.4 < res[0].lat < 37.6 and 126.8 < res[0].lng < 127.0  # 서울 서남부(신도림)


def _client(make_client):
    return make_client(lambda request: httpx.Response(200, json={}), make_settings())


def test_health_reports_station_data_and_stays_backward_compatible(make_client):
    st.get_seoul_index.cache_clear()
    body = _client(make_client).get("/api/health").json()
    assert body["status"] == "ok" and "configured" in body  # 기존 필드 그대로
    assert body["stations"] == {"subway_records": 784, "file_present": True, "load_error": False, "bus_matching_enabled": False, "seoul_bus_matching_enabled": False}  # 테스트는 TAGO 를 끈다


def test_health_stays_ok_but_flags_a_failed_station_load(make_client, tmp_path, monkeypatch):
    (tmp_path / st.SEOUL_MASTER_FILE).mkdir()  # 읽을 수 없는 대상
    monkeypatch.setattr(st, "STATION_DATA_DIR", tmp_path)
    st.get_seoul_index.cache_clear()
    try:
        response = _client(make_client).get("/api/health")
        assert response.status_code == 200 and response.json()["status"] == "ok"
        assert response.json()["stations"] == {"subway_records": 0, "file_present": True, "load_error": True, "bus_matching_enabled": False, "seoul_bus_matching_enabled": False}
    finally:
        st.get_seoul_index.cache_clear()


def test_health_when_the_station_file_is_missing(make_client, tmp_path, monkeypatch):
    monkeypatch.setattr(st, "STATION_DATA_DIR", tmp_path)
    st.get_seoul_index.cache_clear()
    try:
        assert _client(make_client).get("/api/health").json()["stations"] == {"subway_records": 0, "file_present": False, "load_error": False, "bus_matching_enabled": False, "seoul_bus_matching_enabled": False}
    finally:
        st.get_seoul_index.cache_clear()
