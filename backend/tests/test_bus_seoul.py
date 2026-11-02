"""서울 버스 API 연동과 TAGO 통합 테스트. 응답 모양은 실제 서울 응답(2026-11)을 따른다:
msgHeader.headerCd "0" 정상 / "4" 결과 없음(itemList null), 좌표·번호는 문자열, 왕복이 한 목록, direction 은 그 정류장에서 버스가 향하는 종점 이름,
getBusRouteList 는 번호가 포함된 노선을 모두 돌려준다(부분 일치).
"""
import asyncio

import httpx

from app.navigation import bus_seoul as bs
from app.navigation import bus_tago as bt
from app.navigation.schemas import TransitStep, TransitStop, TransitVehicle
from tests.test_bus_tago import LAT_BACK, LAT_GO, LNG, NAMES, PATH, client_for, route, run, stop

NO_RESULT = {"msgHeader": {"headerMsg": "결과가 없습니다.", "headerCd": "4", "itemCount": 0}, "msgBody": {"itemList": None}}


def s_ok(items):
    return {"msgHeader": {"headerMsg": "정상적으로 처리되었습니다.", "headerCd": "0", "itemCount": 0}, "msgBody": {"itemList": items}}


def s_route(rid, name, route_type):
    return {"busRouteId": rid, "busRouteNm": name, "routeType": route_type, "stStationNm": "가", "edStationNm": "라"}


def s_stop(seq, station, name, lat, lng, direction):
    return {"seq": str(seq), "station": station, "stationNm": name, "gpsY": str(lat), "gpsX": str(lng), "direction": direction, "stationNo": "0", "routeType": "3"}


def _id(prefix, kind, i):
    """접두어가 숫자면 실제 서울 ID 모양(1로 시작하는 9자리: 7자리 접두어 + 방향 1자리 + 순번 1자리), 아니면 읽기 쉬운 글자 ID."""
    return f"{prefix}{1 if kind == 'G' else 2}{i}" if prefix.isdigit() else f"{prefix}{kind}{i}"


SEOUL_LIKE = "1000000"  # 서울 정류장 ID 모양 접두어(100000010 ...)
OTHER_SYSTEM = "1100000"  # SEOUL_LIKE 와 겹치지 않는 다른 ID 체계


def seoul_round_trip(prefix="S", names=("가", "나", "다", "라"), go_lat=LAT_GO, back_lat=LAT_BACK, mix_direction=False, shift_m=0.0, shift_idx=(1,)):
    """가는 길(go_lat)은 종점 '라' 방향, 오는 길(back_lat)은 종점 '가' 방향. 같은 이름 정류장의 station ID 는 서로 다르다."""
    n = len(names)
    go = [s_stop(i + 1, _id(prefix, "G", i), nm, go_lat + (shift_m / 111_320.0 if i in shift_idx else 0), LNG(i), "라" if not (mix_direction and i == 1) else "가") for i, nm in enumerate(names)]
    back = [s_stop(n + i + 1, _id(prefix, "B", i), nm, back_lat, LNG(n - 1 - i), "가") for i, nm in enumerate(reversed(names))]
    return go + back


def seoul_transport(routes_by_number, stops_by_route, calls=None, fail=None):
    def handler(request: httpx.Request) -> httpx.Response:
        op = request.url.path.rsplit("/", 1)[-1]
        if calls is not None:
            calls.append(op)
        if fail:
            return fail(request)
        q = request.url.params
        if op == "getBusRouteList":
            # 실제처럼 번호가 포함된 노선을 모두 돌려준다
            hits = [r for number, rs in routes_by_number.items() if q["strSrch"] in number for r in rs]
            return httpx.Response(200, json=s_ok(hits) if hits else NO_RESULT)
        if op == "getStaionByRoute":
            return httpx.Response(200, json=s_ok(stops_by_route.get(q["busRouteId"], [])) if stops_by_route.get(q["busRouteId"]) else NO_RESULT)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def seoul_for(routes_by_number, stops_by_route, **kw):
    return bs.SeoulBusClient("seoul-test-key", transport=seoul_transport(routes_by_number, stops_by_route, **kw))


def match(seoul, tago=None, numbers=("402",), names=NAMES, path=PATH):
    return run(bt.match_bus_step(tago, list(numbers), names, path, seoul))


# ───────────────────────── 서울 노선만 있는 경우 ─────────────────────────

def test_seoul_trunk_route_is_confirmed_with_class_region_and_stop_ids():
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip()})
    m = match(seoul)
    assert m.vehicles["402"] == bt.VehicleMatch("R402", "seoul", "간선", "seoul_bus_route")
    # 가는 길 정류장이 선택된다. 같은 이름의 반대 방향(SB*)이 아니다
    assert [s.stop_id for s in m.stops] == ["SG0", "SG1", "SG2", "SG3"]
    assert all(s.data_source == "seoul_bus_route" and abs(s.lat - LAT_GO) < 1e-9 for s in m.stops)


def test_every_supported_seoul_route_type_maps_to_its_official_class():
    for code, label in {"2": "마을", "3": "간선", "4": "지선", "5": "순환", "6": "광역"}.items():
        seoul = seoul_for({"9": [s_route("R", "9", code)]}, {"R": seoul_round_trip()})
        assert match(seoul, numbers=("9",)).vehicles["9"].route_class == label


def test_unsupported_route_types_are_not_confirmed():
    # 1 공항, 0 공용, 9 폐지: 유형을 알 수 없으므로 채우지 않는다
    for code in ("1", "0", "9"):
        seoul = seoul_for({"9": [s_route("R", "9", code)]}, {"R": seoul_round_trip()})
        assert match(seoul, numbers=("9",)).vehicles == {}


def test_opposite_direction_only_is_not_confirmed():
    # 경로는 가는 길인데 서울 목록에는 오는 길(33m 북쪽 차로, 라→가 순서)만 있다
    only_back = [s_stop(i + 1, f"X{i}", nm, LAT_BACK, LNG(3 - i), "가") for i, nm in enumerate(["라", "다", "나", "가"])]
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": only_back})
    m = match(seoul)
    assert m.vehicles == {} and m.stops == [None] * 4


def test_stop_names_that_do_not_match_are_not_guessed():
    renamed = seoul_round_trip(names=("가", "나", "다", "다른이름"))
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": renamed})
    m = match(seoul)
    assert m.vehicles == {} and m.stops == [None] * 4


def test_two_seoul_routes_with_the_same_number_that_both_align_are_ambiguous():
    seoul = seoul_for({"402": [s_route("A", "402", "3"), s_route("B", "402", "4")]}, {"A": seoul_round_trip("A"), "B": seoul_round_trip("B")})
    assert match(seoul).vehicles == {}


def test_same_number_but_other_route_that_does_not_align_is_ignored():
    elsewhere = seoul_round_trip("E", names=("마", "바", "사", "아"))
    seoul = seoul_for({"402": [s_route("A", "402", "3"), s_route("E", "402", "4")]}, {"A": seoul_round_trip("A"), "E": elsewhere})
    assert match(seoul).vehicles["402"].route_id == "A"


def test_mixed_direction_among_aligned_stops_is_ambiguous():
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip(mix_direction=True)})
    assert match(seoul).vehicles == {}


def test_partial_number_hits_are_not_candidates():
    # strSrch=402 는 4402안성, P9402광주 같은 노선도 돌려준다. 노선명이 정확히 같거나 "번호+지역명"(경기·인천)만 후보다.
    seoul = seoul_for(
        {"402": [s_route("R402", "402", "3"), s_route("X", "4402안성", "8"), s_route("Y", "P9402(출근)광주", "8")]},
        {"R402": seoul_round_trip("A"), "X": seoul_round_trip("X"), "Y": seoul_round_trip("Y")},
    )
    candidates = run(seoul.candidates("402"))
    assert [c.route_id for c in candidates] == ["R402"]


# ───────────────────────── 경기·인천(7·8) 노선 ─────────────────────────

def test_suffixed_gyeonggi_route_is_filled_only_when_tago_is_healthy_and_has_nothing():
    seoul = seoul_for({"83": [s_route("G83", "83부천", "8")]}, {"G83": seoul_round_trip("G")})
    tago = client_for({"31050": []}, {})  # TAGO 는 정상 응답하지만 이 노선이 없다
    m = match(seoul, tago, numbers=("83",))
    # 세부 유형은 서울이 주지 않으므로 route_class 는 null, 운영 지역만 채운다(서울 색 대상이 아니다)
    assert m.vehicles["83"] == bt.VehicleMatch("G83", "gyeonggi", None, "seoul_bus_route")
    assert [s.stop_id for s in m.stops] == ["GG0", "GG1", "GG2", "GG3"]


def test_incheon_route_type_7_maps_to_incheon_region_without_class():
    seoul = seoul_for({"83": [s_route("I83", "83인천", "7")]}, {"I83": seoul_round_trip("I")})
    m = match(seoul, client_for({"31050": []}, {}), numbers=("83",))
    assert m.vehicles["83"] == bt.VehicleMatch("I83", "incheon", None, "seoul_bus_route")


def test_gyeonggi_route_is_not_filled_when_tago_is_unavailable_or_failed():
    seoul = seoul_for({"83": [s_route("G83", "83부천", "8")]}, {"G83": seoul_round_trip("G")})
    assert match(seoul, None, numbers=("83",)).vehicles == {}  # TAGO 키 없음: TAGO 에 없다는 사실을 믿을 수 없다
    broken = client_for({}, {}, fail=lambda request: httpx.Response(500))
    assert match(seoul, broken, numbers=("83",)).vehicles == {}


def test_gyeonggi_fill_needs_enough_verified_stops():
    names = ["가", "나"]
    seoul = seoul_for({"83": [s_route("G83", "83부천", "8")]}, {"G83": seoul_round_trip("G", names=tuple(names))})
    assert match(seoul, client_for({"31050": []}, {}), numbers=("83",), names=names, path=PATH[:5]).vehicles == {}


def test_suffix_is_ignored_when_an_exact_name_exists_and_for_non_regional_types():
    # 정확한 이름이 있으면 번호+지역명 노선은 후보가 아니다. 서울 유형(3)인 번호+지역명 노선도 후보가 아니다.
    seoul = seoul_for({"83": [s_route("A", "83", "3"), s_route("B", "83부천", "8")], "9": [s_route("C", "9남양주", "3")]}, {})
    assert [c.route_id for c in run(seoul.candidates("83"))] == ["A"]
    assert run(seoul.candidates("9")) == []


# ───────────────────────── TAGO 와 서울이 모두 주장하는 노선 ─────────────────────────

def tago_round_trip(prefix=SEOUL_LIKE, names=("가", "나", "다", "라"), shift_m=0.0, shift_idx=(1,), tag="GGB"):
    """서울 seoul_round_trip 과 같은 정류장을 TAGO 형식(nodeid 에 영문 접두어)으로. shift_m: 한 정류장만 북쪽으로 옮긴 거리."""
    n = len(names)
    out = [stop(i + 1, tag + _id(prefix, "G", i), nm, LAT_GO + (shift_m / 111_320.0 if i in shift_idx else 0), LNG(i)) for i, nm in enumerate(names)]
    out += [stop(n + i + 1, tag + _id(prefix, "B", i), nm, LAT_BACK, LNG(n - 1 - i)) for i, nm in enumerate(reversed(names))]
    return out


def both(seoul_type="8", seoul_stops=None, tago_stops=None, seoul_id="SX", tago_id="GGBX", seoul_name="83부천"):
    seoul = seoul_for({"83": [s_route(seoul_id, seoul_name, seoul_type)]}, {seoul_id: seoul_stops or seoul_round_trip(SEOUL_LIKE)})
    tago = client_for({"31050": [route(tago_id, 83, "일반버스")]}, {("31050", tago_id): tago_stops or tago_round_trip()})
    return match(seoul, tago, numbers=("83",))


def test_same_route_registered_in_both_keeps_the_tago_result():
    m = both()
    assert m.vehicles["83"] == bt.VehicleMatch("GGBX", "gyeonggi", "일반버스")  # data_source 는 TAGO 기본값
    assert [s.stop_id for s in m.stops] == ["GGB100000010", "GGB100000011", "GGB100000012", "GGB100000013"]
    assert all(s.data_source == "tago_bus_route" for s in m.stops)


def test_route_ids_may_differ_between_agencies_when_everything_else_proves_the_same_route():
    # 노선 ID 가 달라도(서울 SX, TAGO GGBX) 정류장 ID·이름·좌표·방향·노선 전체가 같으면 같은 노선이다
    assert both(seoul_id="OTHER-ID").vehicles["83"].route_id == "GGBX"


def test_one_stop_with_conflicting_coordinates_keeps_the_route_but_drops_only_that_stop():
    # 둘 다 카카오 경로에서 45m(50m 안)라 각자 정렬은 통과하지만, 서로는 90m 떨어져 같은 정류장 좌표라고 볼 수 없다.
    # 정류장 ID·이름·방향·노선 전체가 같아 노선은 같다: 노선 정보와 나머지 정류장은 그대로, 어긋난 정류장(1번)만 좌표를 비운다.
    m = both(seoul_stops=seoul_round_trip(SEOUL_LIKE, shift_m=45.0), tago_stops=tago_round_trip(shift_m=-45.0))
    assert m.vehicles["83"] == bt.VehicleMatch("GGBX", "gyeonggi", "일반버스")
    assert [s.stop_id if s else None for s in m.stops] == ["GGB100000010", None, "GGB100000012", "GGB100000013"]


def test_when_half_or_more_stops_conflict_the_route_is_not_proven():
    m = both(seoul_stops=seoul_round_trip(SEOUL_LIKE, shift_m=45.0, shift_idx=(0, 1)), tago_stops=tago_round_trip(shift_m=-45.0, shift_idx=(0, 1)))
    assert m.vehicles == {}


def test_a_dropped_stop_is_dropped_for_every_vehicle_in_the_step():
    # 같은 구간의 두 노선이 모두 TAGO 로 확정돼 같은 정류장을 가리켜도, 한 노선이 그 정류장 좌표를 비우면 그 정류장은 비운다
    seoul = seoul_for({"83": [s_route("SX", "83부천", "8")]}, {"SX": seoul_round_trip(SEOUL_LIKE, shift_m=45.0)})
    tago = client_for(
        {"31050": [route("GGBX", 83, "일반버스"), route("GGBY", 84, "일반버스")]},
        {("31050", "GGBX"): tago_round_trip(shift_m=-45.0), ("31050", "GGBY"): tago_round_trip()},
    )
    m = match(seoul, tago, numbers=("83", "84"))
    assert set(m.vehicles) == {"83", "84"} and m.stops[1] is None and m.stops[0] is not None


def test_serving_seoul_type_route_that_also_aligns_with_a_tago_route_is_ambiguous():
    # 서울 자체 유형(간선)의 "83"이 TAGO 의 83과 같은 경로에 모두 맞는 것은 예상 밖이므로 합치지 않는다
    assert both(seoul_type="3", seoul_name="83").vehicles == {}


def test_two_seoul_candidates_with_a_tago_route_are_ambiguous():
    seoul = seoul_for(
        {"83": [s_route("A", "83부천", "8"), s_route("B", "83인천", "7")]}, {"A": seoul_round_trip(SEOUL_LIKE), "B": seoul_round_trip(SEOUL_LIKE)}
    )
    tago = client_for({"31050": [route("GGBX", 83, "일반버스")]}, {("31050", "GGBX"): tago_round_trip()})
    assert match(seoul, tago, numbers=("83",)).vehicles == {}


def test_different_stop_id_systems_are_proven_only_by_the_whole_route_names_and_coordinates():
    seoul_stops = seoul_round_trip(OTHER_SYSTEM)  # 서울 ID 와 TAGO ID 가 하나도 안 겹친다(정렬된 정류장 기준)
    tago_stops = tago_round_trip(prefix=SEOUL_LIKE)
    assert both(seoul_stops=seoul_stops, tago_stops=tago_stops).vehicles["83"].route_id == "GGBX"
    # 노선 전체의 정류장 이름이 다르면(서울 목록에 정류장이 하나 더 있다) 입증되지 않는다
    longer = seoul_stops + [s_stop(9, "110000099", "마", 37.6, 127.1, "가")]
    assert both(seoul_stops=longer, tago_stops=tago_stops).vehicles == {}


def test_partially_overlapping_ids_are_not_proven():
    seoul_stops = seoul_round_trip(SEOUL_LIKE)
    mixed = [dict(s, station="900000012") if s["station"] == "100000012" else s for s in seoul_stops]  # 한 정류장만 ID 가 다르다
    assert both(seoul_stops=mixed).vehicles == {}


# ───────────────────────── 불필요한 서울 호출 생략 ─────────────────────────

def calls_for(tago_stops, seoul_type="8"):
    calls: list[str] = []
    seoul = seoul_for({"83": [s_route("SX", "83부천", seoul_type)]}, {"SX": seoul_round_trip(SEOUL_LIKE)}, calls=calls)
    tago = client_for({"31050": [route("GGBX", 83, "일반버스")]}, {("31050", "GGBX"): tago_stops})
    m = match(seoul, tago, numbers=("83",))
    return m, calls


def test_seoul_is_skipped_for_a_tago_route_that_cannot_be_in_the_seoul_database():
    # 서울형 ID(1로 시작하는 9자리) 정류장이 없는 경기 노선: 서울 DB 에 있을 수 없으니 호출하지 않고 TAGO 결과를 쓴다
    m, calls = calls_for(tago_round_trip(prefix="2240000"))
    assert calls == [] and m.vehicles["83"].route_id == "GGBX"


def test_seoul_is_checked_for_a_tago_route_that_has_seoul_stops():
    m, calls = calls_for(tago_round_trip())
    assert calls == ["getBusRouteList", "getStaionByRoute"] and m.vehicles["83"].route_id == "GGBX"


def test_seoul_is_still_asked_when_tago_has_no_match():
    calls: list[str] = []
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip(SEOUL_LIKE)}, calls=calls)
    assert match(seoul, client_for({"31050": []}, {})).vehicles["402"].route_class == "간선" and len(calls) == 2


def test_may_be_listed_in_seoul_needs_a_seoul_shaped_id_inside_seoul():
    def st(node, lat=37.5, lng=127.0):
        return bs.SeoulStop(1, node, "x", lat, lng)

    assert bs.may_be_listed_in_seoul([st("GGB114000292")]) and bs.may_be_listed_in_seoul([st("114000292")])
    assert not bs.may_be_listed_in_seoul([st("GGB224000004")])  # 경기형 ID
    assert not bs.may_be_listed_in_seoul([st("GGB114000292", 37.9, 127.5)])  # 서울형 ID 라도 서울 밖 좌표
    assert not bs.may_be_listed_in_seoul([st("GGB11400029")])  # 자릿수가 다르다
    assert not bs.may_be_listed_in_seoul([])


def test_route_agreement_returns_the_conflicting_positions_or_none():
    def st(i, node, lat):
        return bs.SeoulStop(i, node, f"n{i}", lat, 127.0 + i * 0.002)

    full_a = [st(i, f"10000000{i}", 37.5) for i in range(1, 5)] + [st(i, f"10000000{i}", 37.5003) for i in range(5, 9)]
    same = [bs.SeoulStop(s.order, "GGB" + s.node_id, s.name, s.lat, s.lng) for s in full_a]
    assert bs.route_agreement(full_a[:4], full_a, same[:4], same) == frozenset()
    moved = [bs.SeoulStop(s.order, s.node_id, s.name, s.lat + (0.001 if s.order == 2 else 0), s.lng) for s in same]  # 약 111m
    assert bs.route_agreement(full_a[:4], full_a, moved[:4], moved) == frozenset({1})
    renamed = [bs.SeoulStop(s.order, s.node_id, "다른" if s.order == 2 else s.name, s.lat, s.lng) for s in same]
    assert bs.route_agreement(full_a[:4], full_a, renamed[:4], renamed) is None
    assert bs.route_agreement(full_a[:1], full_a, same[:1], same) is None  # 정류장 1개로는 입증하지 않는다


# ───────────────────────── 서울 API 가 안 될 때 ─────────────────────────

def test_tago_result_is_kept_when_the_seoul_api_fails():
    tago = client_for({"31050": [route("GGBX", 83, "일반버스")]}, {("31050", "GGBX"): tago_round_trip()})
    seoul = seoul_for({}, {}, fail=lambda request: httpx.Response(500))
    m = match(seoul, tago, numbers=("83",))
    assert m.vehicles["83"] == bt.VehicleMatch("GGBX", "gyeonggi", "일반버스")


def test_seoul_route_is_not_guessed_when_the_seoul_api_fails():
    assert match(seoul_for({}, {}, fail=lambda request: httpx.Response(500))).vehicles == {}


def test_seoul_api_stops_being_called_after_repeated_failures_then_recovers():
    now = [1000.0]
    calls: list[str] = []
    seoul = bs.SeoulBusClient("k", transport=seoul_transport({}, {}, calls=calls, fail=lambda request: httpx.Response(500)), now=lambda: now[0])
    for number in ("1", "2", "3", "4", "5"):
        try:
            run(seoul.candidates(number))
        except bs.SeoulError:
            pass
    assert seoul.suspended and len(calls) == 3  # 3번 실패한 뒤에는 더 부르지 않는다
    now[0] += bs.SUSPEND_S + 1
    assert not seoul.suspended


def test_error_header_is_an_error_not_an_empty_result_and_failures_are_not_cached():
    calls: list[str] = []
    quota = {"msgHeader": {"headerMsg": "LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR", "headerCd": "7", "itemCount": 0}, "msgBody": {"itemList": None}}
    seoul = bs.SeoulBusClient("k", transport=seoul_transport({}, {}, calls=calls, fail=lambda request: httpx.Response(200, json=quota)))
    for _ in range(2):
        try:
            run(seoul.candidates("402"))
            raise AssertionError("오류 응답을 빈 결과로 취급했다")
        except bs.SeoulError as exc:
            assert "headerCd 7" in str(exc)
    assert len(calls) == 2  # 실패는 캐시되지 않는다


def test_no_result_header_is_an_empty_list_not_an_error():
    seoul = seoul_for({}, {})
    assert run(seoul.candidates("999")) == []


def test_error_text_never_contains_the_service_key():
    def boom(request):
        raise httpx.ConnectError(f"cannot connect {request.url}")  # 실제 httpx 예외는 키가 든 URL 을 문자열에 담을 수 있다

    seoul = bs.SeoulBusClient("SECRET-KEY-123", transport=httpx.MockTransport(boom))
    try:
        run(seoul.candidates("402"))
    except bs.SeoulError as exc:
        assert "SECRET-KEY-123" not in str(exc) and "SECRET-KEY-123" not in repr(exc)
    else:
        raise AssertionError("SeoulError 가 나야 한다")


def test_timeout_is_retried_once_and_other_errors_are_not():
    calls: list[str] = []

    def timeout(request):
        calls.append("t")
        raise httpx.ReadTimeout("slow")

    seoul = bs.SeoulBusClient("k", transport=httpx.MockTransport(timeout))
    try:
        run(seoul.candidates("402"))
    except bs.SeoulError:
        pass
    assert len(calls) == 2


# ───────────────────────── 호출 수 ─────────────────────────

def test_results_are_cached_per_number_and_route():
    calls: list[str] = []
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip()}, calls=calls)
    match(seoul)
    first = len(calls)
    match(seoul)
    assert first == 2 and len(calls) == 2  # 노선 목록 1건 + 정류장 목록 1건. 두 번째 검색은 호출 0건


def test_seoul_is_not_called_for_steps_outside_seoul():
    calls: list[str] = []
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip()}, calls=calls)
    far_path = [(37.9, 127.5 + k * 0.0005) for k in range(13)]
    far_names = ["가", "나", "다", "라"]
    match(seoul, client_for({"31050": []}, {}), names=far_names, path=far_path)
    assert calls == []


def test_concurrent_seoul_calls_stay_within_the_limit():
    active = [0]
    peak = [0]

    async def handler(request: httpx.Request) -> httpx.Response:
        active[0] += 1
        peak[0] = max(peak[0], active[0])
        await asyncio.sleep(0.01)
        active[0] -= 1
        return httpx.Response(200, json=NO_RESULT)

    async def go():
        seoul = bs.SeoulBusClient("k", transport=httpx.MockTransport(handler))
        await asyncio.gather(*(seoul.candidates(str(i)) for i in range(20)))

    asyncio.run(go())
    assert 1 < peak[0] <= bs.MAX_CONCURRENT


# ───────────────────────── 응답에 붙이기 ─────────────────────────

def test_attach_sets_seoul_data_source_and_high_confidence():
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip()})
    step = TransitStep(
        type="BUS", distance_m=1, time_sec=1, stops=[TransitStop(name=n) for n in NAMES], vehicles=[TransitVehicle(name="402", type="간선")]
    )
    run(bt.attach_bus_matches([(step, PATH)], None, seoul))
    vehicle = step.vehicles[0]
    assert (vehicle.route_id, vehicle.operator_region, vehicle.route_class, vehicle.match_confidence, vehicle.data_source) == (
        "R402", "seoul", "간선", "high", "seoul_bus_route"
    )
    assert [s.stop_id for s in step.stops] == ["SG0", "SG1", "SG2", "SG3"]
    assert all(s.match_confidence == "high" and s.data_source == "seoul_bus_route" for s in step.stops)


def test_attach_with_no_clients_changes_nothing():
    step = TransitStep(type="BUS", distance_m=1, time_sec=1, stops=[TransitStop(name=n) for n in NAMES], vehicles=[TransitVehicle(name="402")])
    run(bt.attach_bus_matches([(step, PATH)]))  # 테스트는 두 키를 모두 끈다
    assert step.vehicles[0].route_id is None and all(s.lat is None for s in step.stops)


def test_vehicles_from_different_agencies_in_one_step_do_not_share_stop_coordinates():
    # 한 구간에 서울 노선(402)과 TAGO 노선(31)이 함께 있고 서로 다른 정류장 ID 를 가리키면 정류장 좌표는 채우지 않는다
    seoul = seoul_for({"402": [s_route("R402", "402", "3")]}, {"R402": seoul_round_trip()})
    tago = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): [stop(i + 1, f"G{i}", n, LAT_GO, LNG(i)) for i, n in enumerate(NAMES)]})
    m = match(seoul, tago, numbers=("402", "31"))
    assert set(m.vehicles) == {"402", "31"} and m.stops == [None] * 4


# ───────────────────────── 단위: 보조 함수 ─────────────────────────

def test_strip_id_prefix_only_removes_leading_letters():
    assert bs.strip_id_prefix("GGB212000232") == "212000232"
    assert bs.strip_id_prefix("212000232") == "212000232"
    assert bs.strip_id_prefix("ICB165000001") == "165000001"


def test_touches_seoul_uses_the_box_only():
    assert bs.touches_seoul([(37.5, 127.0)]) and not bs.touches_seoul([(37.9, 127.5), (35.1, 129.0)])
