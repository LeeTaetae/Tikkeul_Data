"""직행·광역·급행(정류장을 건너뛰는 노선) 보강 정렬 테스트. 3200 처럼 카카오가 정차하지 않는 정류장을 빼고 보여 주는 노선은 기존 정렬(MAX_SKIP=3)이 실패한다.
보강 정렬은 기존 정렬이 실패한 직행·광역·급행 노선에만 쓰고, 이름 순서·좌표·경로 연속성·후보 유일성을 모두 만족해야 확정한다.

지오메트리: 동쪽으로 가는 직선 도로(위도 37.5)에 정류장 12개(177m 간격), 길 맞은편(33m 북쪽) 차로가 오는 길이다. 카카오는 12개 중 5개만 보여 준다.
"""
import asyncio

import httpx

from app.navigation import bus_tago as bt
from app.navigation.schemas import TransitStep, TransitStop, TransitVehicle
from tests.test_bus_seoul import s_route, s_stop, seoul_for
from tests.test_bus_tago import LAT_BACK, LAT_GO, LNG, client_for, route, run, stop

N = [f"정류장{i}" for i in range(12)]
PATH_E = [(37.5, 127.0 + k * 0.0005) for k in range(0, 45)]  # LNG(0) .. LNG(11) 까지 동쪽
KAKAO = [N[0], N[1], N[7], N[8], N[11]]  # 12개 중 5개: 1→7 사이 5칸을 건너뛴다(기존 정렬 한도 3칸 초과)


def spec_list(spec, shift=None):
    """spec: [('F'|'B'|'X', 번호), ...]. F=가는 길, B=오는 길(33m 북쪽 차로), X=경로에서 400m 벗어난 정류장."""
    out = []
    for order, (kind, i) in enumerate(spec, start=1):
        lat, lng = (LAT_GO, LNG(i)) if kind == "F" else (LAT_BACK, LNG(i)) if kind == "B" else (LAT_GO + 0.0036, LNG(i))
        if shift and (kind, i) in shift:
            lat, lng = shift[(kind, i)]
        out.append(stop(order, f"{kind}{i}", N[i], lat, lng))
    return out


def as_stops(raw):
    """TAGO 응답 항목 -> bt.TagoStop (align_stops 를 직접 부를 때 쓴다)"""
    return [bt.TagoStop(int(x["nodeord"]), x["nodeid"], x["nodenm"], float(x["gpslati"]), float(x["gpslong"])) for x in raw]


ROUND_TRIP = [("F", i) for i in range(12)] + [("B", i) for i in range(11, -1, -1)]
EXPRESS = spec_list(ROUND_TRIP)


def match(client, numbers=("3200",), names=KAKAO, path=PATH_E, labels=("직행",), seoul=None):
    return run(bt.match_bus_step(client, list(numbers), names, path, seoul, list(labels) if labels is not None else None))


def tago(stops, cls="직행좌석버스", city="31150", cities=None, number="3200"):
    kw = {"cities": cities} if cities else {}
    return client_for({city: [route("R3200", number, cls)]}, {(city, "R3200"): stops}, **kw)


# ───────────────────────── 정상 매칭 ─────────────────────────

def test_the_global_skip_limit_is_unchanged_and_the_strict_alignment_still_fails_on_this_route():
    assert bt.MAX_SKIP == 3 and bt.EXPRESS_MAX_SKIP == 20
    assert bt.align_stops(KAKAO, as_stops(EXPRESS), PATH_E) is None  # 기존 정렬은 여전히 이 노선을 못 맞춘다
    assert bt.align_stops_express(KAKAO, as_stops(EXPRESS), PATH_E) is not None


def test_express_route_that_skips_stops_is_confirmed_with_official_id_class_and_stop_coordinates():
    m = match(tago(EXPRESS))
    assert m.vehicles["3200"] == bt.VehicleMatch("R3200", "gyeonggi", "직행좌석버스")
    assert [s.stop_id for s in m.stops] == ["F0", "F1", "F7", "F8", "F11"]  # 가는 길 정류장이다(오는 길 B* 가 아니다)
    assert all(abs(s.lat - LAT_GO) < 1e-9 for s in m.stops)


def test_express_matching_picks_the_travel_direction():
    # 서쪽으로 가는 카카오 구간(이름·경로 모두 반대)은 오는 길(B*) 정류장에 맞는다. 가는 길(F*)로 정렬되지 않는다.
    m = match(tago(EXPRESS), names=list(reversed(KAKAO)), path=list(reversed(PATH_E)))
    assert [s.stop_id for s in m.stops] == ["B11", "B8", "B7", "B1", "B0"]


def test_strict_result_is_used_first_and_the_express_rule_never_adds_an_ambiguity():
    # 후보 A 는 기존 정렬로 맞고(이름이 이어짐), 후보 B 는 같은 이름 사이에 필러 정류장이 많아 보강 정렬로만 맞는다.
    # 기존 정렬이 맞은 A 를 그대로 쓰고 B 를 후보로 올려 모호하게 만들지 않는다.
    contiguous = [N[0], N[1], N[2], N[3]]
    a = spec_list([("F", i) for i in range(4)])
    b = []
    for i in range(4):
        b.append(stop(len(b) + 1, f"B{i}", N[i], LAT_GO, LNG(i)))
        if i < 3:
            for k in range(1, 7):  # 다음 정류장까지 이름이 다른 6개 정류장이 경로 위에 있다(건너뜀 6칸 > 3)
                b.append(stop(len(b) + 1, f"BF{i}{k}", f"필러{i}{k}", LAT_GO, LNG(i) + 0.002 * k / 7))
    path = PATH_E[:13]
    assert bt.align_stops(contiguous, as_stops(b), path) is None and bt.align_stops_express(contiguous, as_stops(b), path) is not None
    client = client_for(
        {"31010": [route("RA", "3200", "직행좌석버스")], "31150": [route("RB", "3200", "직행좌석버스")]},
        {("31010", "RA"): a, ("31150", "RB"): b},
    )
    m = match(client, names=contiguous, path=path)
    assert m.vehicles["3200"].route_id == "RA"
    assert [s.stop_id for s in m.stops] == ["F0", "F1", "F2", "F3"]


# ───────────────────────── 보강 정렬을 시도하지 않는 경우 ─────────────────────────

def test_express_alignment_is_only_tried_for_express_labels():
    for labels in (("일반",), ("마을",), (None,), None):
        assert match(tago(EXPRESS), labels=labels).vehicles == {}, labels
    for label in ("직행", "광역", "급행", "직행좌석"):
        assert "3200" in match(tago(EXPRESS), labels=(label,)).vehicles, label


def test_candidate_whose_official_class_is_not_express_is_not_rescued():
    # 카카오는 직행이라는데 공식 노선이 일반버스면 같은 노선이라고 볼 수 없다
    assert match(tago(EXPRESS, cls="일반버스")).vehicles == {}
    assert "3200" in match(tago(EXPRESS, cls="광역급행버스")).vehicles


# ───────────────────────── 잘못된 후보 거부 ─────────────────────────

def test_opposite_direction_only_is_rejected():
    only_back = spec_list([("B", i) for i in range(11, -1, -1)])  # 오는 길 차로만 있고 순서도 반대로 이어진다
    assert match(tago(only_back)).vehicles == {}


def test_wrong_stop_order_is_rejected():
    swapped = [N[0], N[7], N[1], N[8], N[11]]  # 1번과 7번의 순서가 노선 순서와 반대
    assert match(tago(EXPRESS), names=swapped).vehicles == {}


def test_a_stop_name_missing_from_the_route_is_rejected():
    renamed = [N[0], N[1], "없는정류장", N[8], N[11]]
    assert match(tago(EXPRESS), names=renamed).vehicles == {}


def test_skipped_stops_off_the_path_break_continuity_and_are_rejected():
    # 건너뛴 정류장(2~6번)이 경로에서 400m 벗어나 있다: 이름은 모두 맞아도 같은 길을 달리는 노선이 아니다
    detour = spec_list([("F", 0), ("F", 1)] + [("X", i) for i in range(2, 7)] + [("F", i) for i in range(7, 12)] + [("B", i) for i in range(11, -1, -1)])
    assert match(tago(detour)).vehicles == {}


def test_skipped_stops_that_go_backwards_along_the_path_are_rejected():
    # 건너뛴 정류장들이 경로 위에서 뒤로 물러난다(2~6번이 6~2번 위치에 있다): 같은 방향으로 이어지지 않는다
    backwards = {("F", i): (LAT_GO, LNG(8 - i)) for i in range(2, 7)}
    assert match(tago(spec_list(ROUND_TRIP, shift=backwards))).vehicles == {}


def test_coordinate_gap_between_aligned_stops_is_rejected():
    # 정렬된 정류장 하나가 경로에서 80m 떨어져 있다(50m 초과): 좌표가 경로와 이어지지 않는다
    far = {("F", 7): (LAT_GO + 0.0007, LNG(7))}
    assert match(tago(spec_list(ROUND_TRIP, shift=far))).vehicles == {}


def test_path_continuity_rejects_an_alignment_that_crosses_the_turnaround():
    # 가는 길의 첫 정류장에서 오는 길의 마지막 정류장까지 이어 붙이면 회차 지점을 넘으며 경로상 뒤로 간다
    stops = as_stops(EXPRESS)
    assert bt.path_continuity_ok(stops, [0, 5], PATH_E) is True
    assert bt.path_continuity_ok(stops, [0, len(stops) - 1], PATH_E) is False


# ───────────────────────── 같은 번호의 다른 노선·중복 후보 ─────────────────────────

def test_same_number_in_another_region_that_does_not_align_is_ignored():
    other = [stop(i + 1, f"Z{i}", f"다른{i}", 37.9, 127.5 + i * 0.002) for i in range(6)]
    client = client_for(
        {"31150": [route("R3200", "3200", "직행좌석버스")], "31270": [route("RZ", "3200", "직행좌석버스")]},
        {("31150", "R3200"): EXPRESS, ("31270", "RZ"): other},
        cities=["31150", "31270"],
    )
    assert match(client).vehicles["3200"].route_id == "R3200"


def test_two_candidates_that_both_pass_the_express_rule_are_ambiguous():
    client = client_for(
        {"31150": [route("RA", "3200", "직행좌석버스")], "31270": [route("RB", "3200", "직행좌석버스")]},
        {("31150", "RA"): EXPRESS, ("31270", "RB"): EXPRESS},
        cities=["31150", "31270"],
    )
    m = match(client)
    assert m.vehicles == {} and m.stops == [None] * 5


def test_a_candidate_that_cannot_be_loaded_makes_the_number_unconfirmed():
    class Boom:  # 후보 하나의 정류장 목록 조회가 실패하면 다른 후보와 모호한지 알 수 없다
        pass

    def fail_second(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500) if request.url.params.get("routeId") == "RB" else httpx.Response(404)

    good = client_for(
        {"31150": [route("RA", "3200", "직행좌석버스"), route("RB", "3200", "직행좌석버스")]},
        {("31150", "RA"): EXPRESS, ("31150", "RB"): []},
    )
    orig = good._get

    async def flaky(op, **params):
        if params.get("routeId") == "RB":
            raise bt.TagoError("HTTPStatusError")
        return await orig(op, **params)

    good._get = flaky
    assert match(good).vehicles == {}


def test_leading_zero_numbers_are_never_treated_as_the_same_route_even_with_the_express_rule():
    assert match(tago(EXPRESS, number="15"), numbers=("015",)).vehicles == {}
    assert match(tago(EXPRESS, number="015"), numbers=("15",)).vehicles == {}
    assert "015" in match(tago(EXPRESS, number="015"), numbers=("015",)).vehicles


# ───────────────────────── 서울 API 쪽 (정류장 데이터 구조가 다르다) ─────────────────────────

def seoul_list(spec, mix_direction=False):
    """서울 형식: seq 문자열, station, gpsY/gpsX 문자열, direction(그 정류장에서 버스가 향하는 종점)."""
    out = []
    for order, (kind, i) in enumerate(spec, start=1):
        lat, lng = (LAT_GO, LNG(i)) if kind == "F" else (LAT_BACK, LNG(i))
        direction = "종점" if kind == "F" else "기점"
        if mix_direction and (kind, i) == ("F", 8):
            direction = "기점"
        out.append(s_stop(order, f"{kind}{i}", N[i], lat, lng, direction))
    return out


def test_seoul_gyeonggi_route_with_skipped_stops_is_filled_only_when_tago_is_healthy_and_empty():
    seoul = seoul_for({"3200": [s_route("S3200", "3200시흥", "8")]}, {"S3200": seoul_list(ROUND_TRIP)})
    healthy_but_empty = client_for({"31150": []}, {})
    m = match(healthy_but_empty, seoul=seoul)
    assert m.vehicles["3200"] == bt.VehicleMatch("S3200", "gyeonggi", None, "seoul_bus_route")
    assert [s.stop_id for s in m.stops] == ["F0", "F1", "F7", "F8", "F11"]
    assert match(None, seoul=seoul).vehicles == {}  # TAGO 키가 없으면 TAGO 에 없다는 사실을 믿을 수 없다


def test_seoul_route_type_that_cannot_be_express_is_not_rescued():
    for code in ("3", "4", "5", "2"):  # 간선·지선·순환·마을
        seoul = seoul_for({"3200": [s_route("S", "3200", code)]}, {"S": seoul_list(ROUND_TRIP)})
        assert match(None, seoul=seoul).vehicles == {}, code
    seoul = seoul_for({"3200": [s_route("S", "3200", "6")]}, {"S": seoul_list(ROUND_TRIP)})  # 서울 광역
    assert match(None, seoul=seoul).vehicles["3200"].route_class == "광역"


def test_seoul_mixed_direction_among_aligned_stops_is_rejected():
    seoul = seoul_for({"3200": [s_route("S3200", "3200시흥", "8")]}, {"S3200": seoul_list(ROUND_TRIP, mix_direction=True)})
    assert match(client_for({"31150": []}, {}), seoul=seoul).vehicles == {}


def test_seoul_express_alignment_needs_the_express_label():
    seoul = seoul_for({"3200": [s_route("S3200", "3200시흥", "8")]}, {"S3200": seoul_list(ROUND_TRIP)})
    assert match(client_for({"31150": []}, {}), seoul=seoul, labels=("일반",)).vehicles == {}


def test_tago_and_seoul_agree_on_an_express_route_even_when_the_alignment_spans_the_middle_of_the_list():
    # 가는 길 14개 + 오는 길 6개(목록 20개, 가운데 10). 정렬 4..12 는 가운데를 가로지른다. 두 기관의 정류장 ID 가 같으면 같은 노선이다.
    names = [f"정류장{i}" for i in range(14)]
    fwd = [("F", i) for i in range(14)] + [("B", i) for i in range(13, 7, -1)]
    path = [(37.5, 127.0 + k * 0.0005) for k in range(0, 53)]
    kakao = [names[4], names[5], names[11], names[12]]

    def tago_stops():
        return [stop(o, f"GGB1000{o:05d}"[:12], names[i], LAT_GO if k == "F" else LAT_BACK, LNG(i)) for o, (k, i) in enumerate(fwd, start=1)]

    def seoul_stops():
        return [s_stop(o, f"1000{o:05d}", names[i], LAT_GO if k == "F" else LAT_BACK, LNG(i), "종점" if k == "F" else "기점") for o, (k, i) in enumerate(fwd, start=1)]

    seoul = seoul_for({"3200": [s_route("S3200", "3200시흥", "8")]}, {"S3200": seoul_stops()})
    client = client_for({"31150": [route("R3200", "3200", "직행좌석버스")]}, {("31150", "R3200"): tago_stops()})
    m = run(bt.match_bus_step(client, ["3200"], kakao, path, seoul, ["직행"]))
    assert m.vehicles["3200"] == bt.VehicleMatch("R3200", "gyeonggi", "직행좌석버스")  # data_source 는 TAGO
    assert [s.stop_id for s in m.stops] == ["GGB100000005", "GGB100000006", "GGB100000012", "GGB100000013"]


# ───────────────────────── 응답에 붙이기 ─────────────────────────

def test_attach_passes_the_kakao_label_so_only_express_steps_use_the_express_rule():
    def step(label):
        return TransitStep(type="BUS", distance_m=1, time_sec=1, stops=[TransitStop(name=n) for n in KAKAO], vehicles=[TransitVehicle(name="3200", type=label)])

    express, regular = step("직행"), step("일반")
    run(bt.attach_bus_matches([(express, PATH_E)], tago(EXPRESS), None))
    run(bt.attach_bus_matches([(regular, PATH_E)], tago(EXPRESS), None))
    v = express.vehicles[0]
    assert (v.route_id, v.operator_region, v.route_class, v.match_confidence, v.data_source) == ("R3200", "gyeonggi", "직행좌석버스", "high", "tago_bus_route")
    assert [s.stop_id for s in express.stops] == ["F0", "F1", "F7", "F8", "F11"] and all(s.lat is not None for s in express.stops)
    assert regular.vehicles[0].route_id is None and all(s.lat is None for s in regular.stops)
