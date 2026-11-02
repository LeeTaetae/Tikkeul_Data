"""버스 노선·정류장 공식 데이터(TAGO) 매칭 테스트. 응답 모양은 실제 TAGO 응답(2026-11)을 따른다:
왕복이 한 목록, 경기는 updowncd 없음, 좌표/노선번호는 숫자·문자열 혼재, 결과가 없으면 items 가 빈 문자열.
"""
import asyncio

import httpx

from app.navigation import bus_tago as bt
from app.navigation.schemas import TransitStep, TransitStop, TransitVehicle

# 경도 0.002 ≈ 177m. 동쪽으로 가는 직선 도로(위도 37.5)와, 그 반대 방향 차로(위도 37.5003 ≈ 33m 북쪽).
LAT_GO, LAT_BACK = 37.5, 37.5003


def LNG(i):
    return 127.0 + i * 0.002


def ok(items):
    body = {"items": {"item": items} if items else "", "totalCount": len(items)}
    return {"response": {"header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."}, "body": body}}


def stop(order, node, name, lat, lng):
    # 실제 응답처럼 좌표는 숫자와 문자열이 섞여 온다
    return {"nodeord": order, "nodeid": node, "nodenm": name, "gpslati": str(lat) if order % 2 else lat, "gpslong": lng, "nodeno": 1000 + order}


# 왕복 한 목록: 가→나→다→라(가는 길, 위도 37.5), 라→다→나→가(오는 길, 위도 37.5003). 이름이 양방향으로 반복된다.
ROUND_TRIP = [stop(i + 1, f"G{i}", n, LAT_GO, LNG(i)) for i, n in enumerate(["가", "나", "다", "라"])] + [
    stop(i + 5, f"B{i}", n, LAT_BACK, LNG(3 - i)) for i, n in enumerate(["라", "다", "나", "가"])
]
OPPOSITE_ONLY = [stop(i + 1, f"X{i}", n, LAT_BACK, LNG(3 - i)) for i, n in enumerate(["라", "다", "나", "가"])]

# 카카오 경로: 가→라 (위도 37.5, 동쪽)
PATH = [(37.5, 127.0 + k * 0.0005) for k in range(0, 13)]
NAMES = ["가", "나", "다", "라"]


def make_transport(routes_by_city, stops_by_route, calls=None, fail=None, cities=None):
    cities = cities or ["23", "31010", "31050", "31150", "21"]

    def handler(request: httpx.Request) -> httpx.Response:
        op = request.url.path.rsplit("/", 1)[-1]
        if calls is not None:
            calls.append(op)
        if fail:
            return fail(request)
        q = request.url.params
        if op == "getCtyCodeList":
            return httpx.Response(200, json=ok([{"citycode": c, "cityname": c} for c in cities]))
        if op == "getRouteNoList":
            return httpx.Response(200, json=ok(routes_by_city.get(q["cityCode"], [])))
        if op == "getRouteAcctoThrghSttnList":
            return httpx.Response(200, json=ok(stops_by_route.get((q["cityCode"], q["routeId"]), [])))
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def client_for(routes_by_city, stops_by_route, **kw):
    return bt.TagoClient("test-key", transport=make_transport(routes_by_city, stops_by_route, **kw))


def run(coro):
    return asyncio.run(coro)


def route(rid, no, tp):
    return {"routeid": rid, "routeno": no, "routetp": tp, "startnodenm": "가", "endnodenm": "라"}  # routeno 는 숫자도 올 수 있다


def test_unique_route_and_direction_gives_class_region_and_stop_coordinates():
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): ROUND_TRIP})
    m = run(bt.match_bus_step(client, ["31"], NAMES, PATH))
    assert m.vehicles["31"] == bt.VehicleMatch("R1", "gyeonggi", "일반버스")
    # 가는 방향(G0..G3, 위도 37.5)의 정류장이 선택된다. 같은 이름의 반대 방향(B*)이 아니다
    assert [s.stop_id for s in m.stops] == ["G0", "G1", "G2", "G3"]
    assert all(abs(s.lat - 37.5) < 1e-9 for s in m.stops)


def test_route_number_given_as_integer_by_tago_is_matched_as_text():
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): ROUND_TRIP})
    assert "31" in run(bt.match_bus_step(client, ["31"], NAMES, PATH)).vehicles


def test_opposite_direction_only_is_not_matched():
    # 경로는 가는 길인데 노선 목록에는 오는 길(33m 북쪽 차로)만 있다. 순서가 라→다→나→가 라서 가→나→다→라 가 이어지지 않는다
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): OPPOSITE_ONLY})
    m = run(bt.match_bus_step(client, ["31"], NAMES, PATH))
    assert m.vehicles == {} and m.stops == [None] * 4


def test_same_number_in_two_cities_only_the_one_that_aligns_is_chosen():
    other = [stop(i + 1, f"Z{i}", f"다른{i}", 37.9, 127.5 + i * 0.002) for i in range(4)]
    client = client_for(
        {"31050": [route("R_BUCHEON", 31, "일반버스")], "31150": [route("R_SIHEUNG", 31, "일반버스")]},
        {("31050", "R_BUCHEON"): other, ("31150", "R_SIHEUNG"): ROUND_TRIP},
    )
    m = run(bt.match_bus_step(client, ["31"], NAMES, PATH))
    assert m.vehicles["31"].route_id == "R_SIHEUNG"


def test_same_number_that_aligns_in_two_places_is_ambiguous_and_left_empty():
    client = client_for(
        {"31050": [route("A", 31, "일반버스")], "31150": [route("B", 31, "일반버스")]},
        {("31050", "A"): ROUND_TRIP, ("31150", "B"): ROUND_TRIP},
    )
    m = run(bt.match_bus_step(client, ["31"], NAMES, PATH))
    assert m.vehicles == {} and m.stops == [None] * 4


def test_different_route_number_is_never_matched():
    client = client_for({"31150": [route("R1", "31-3", "일반버스")]}, {("31150", "R1"): ROUND_TRIP})
    assert run(bt.match_bus_step(client, ["31"], NAMES, PATH)).vehicles == {}  # '31' 은 '31-3' 이 아니다


def test_stop_names_that_do_not_follow_the_route_are_not_matched():
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): ROUND_TRIP})
    assert run(bt.match_bus_step(client, ["31"], ["가", "나", "없는정류장", "라"], PATH)).vehicles == {}


def test_stops_far_from_the_kakao_path_are_not_matched():
    far = [stop(i + 1, f"F{i}", n, 37.51, LNG(i)) for i, n in enumerate(NAMES)]  # 1.1km 떨어진 같은 이름 정류장들
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): far})
    assert run(bt.match_bus_step(client, ["31"], NAMES, PATH)).vehicles == {}


def test_small_gap_in_the_stop_list_is_allowed_but_big_gap_is_not():
    with_extra = [
        stop(1, "G0", "가", LAT_GO, LNG(0)),
        stop(2, "E", "끼어듦", LAT_GO, LNG(0) + 0.0004),
        stop(3, "G1", "나", LAT_GO, LNG(1)),
        stop(4, "G2", "다", LAT_GO, LNG(2)),
        stop(5, "G3", "라", LAT_GO, LNG(3)),
    ]
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): with_extra})
    assert "31" in run(bt.match_bus_step(client, ["31"], NAMES, PATH)).vehicles
    wide = (
        [stop(1, "G0", "가", LAT_GO, LNG(0))]
        + [stop(i + 2, f"E{i}", f"끼{i}", LAT_GO, LNG(0)) for i in range(6)]
        + [stop(8, "G1", "나", LAT_GO, LNG(1)), stop(9, "G2", "다", LAT_GO, LNG(2)), stop(10, "G3", "라", LAT_GO, LNG(3))]
    )
    client2 = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): wide})
    assert run(bt.match_bus_step(client2, ["31"], NAMES, PATH)).vehicles == {}


def test_seoul_is_not_covered_and_stays_empty():
    seoul_path = [(37.55, 126.98 + k * 0.0005) for k in range(0, 13)]
    client = client_for({}, {})
    m = run(bt.match_bus_step(client, ["402"], NAMES, seoul_path))
    assert m.vehicles == {}  # 서울 노선은 TAGO 에 없다: 후보가 없으면 아무것도 붙이지 않는다


def test_incheon_route_with_updowncd_gets_province_and_class():
    rows = [dict(s, updowncd=0) for s in ROUND_TRIP[:4]] + [dict(s, updowncd=1) for s in ROUND_TRIP[4:]]
    client = client_for({"23": [route("ICB1", 103, "간선버스")]}, {("23", "ICB1"): rows})
    m = run(bt.match_bus_step(client, ["103"], NAMES, PATH))
    assert m.vehicles["103"] == bt.VehicleMatch("ICB1", "incheon", "간선버스")


def test_results_are_cached_so_the_second_search_makes_no_tago_calls():
    calls = []
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): ROUND_TRIP}, calls=calls)
    run(bt.match_bus_step(client, ["31"], NAMES, PATH))
    first = len(calls)
    run(bt.match_bus_step(client, ["31"], NAMES, PATH))
    assert first > 0 and len(calls) == first


def test_tago_errors_and_http_failures_leave_values_empty_without_raising():
    def err(request):
        return httpx.Response(200, json={"response": {"header": {"resultCode": "30", "resultMsg": "SERVICE KEY IS NOT REGISTERED ERROR."}}})

    def boom(request):
        return httpx.Response(500, text="oops")

    for fail in (err, boom):
        client = client_for({}, {}, fail=fail)
        m = run(bt.match_bus_step(client, ["31"], NAMES, PATH))
        assert m.vehicles == {} and m.stops == [None] * 4


def test_errors_are_not_cached_and_do_not_leak_the_key():
    state = {"fail": True}

    def handler(request):
        if state["fail"]:
            return httpx.Response(500, text="oops")
        return httpx.Response(200, json=ok([{"citycode": "23", "cityname": "인천"}]))

    client = bt.TagoClient("SECRET-KEY-VALUE", transport=httpx.MockTransport(handler))
    try:
        run(client.city_codes())
        raise AssertionError("TagoError 가 나야 한다")
    except bt.TagoError as exc:
        assert "SECRET-KEY-VALUE" not in str(exc) and "SECRET-KEY-VALUE" not in repr(exc)
    state["fail"] = False
    assert run(client.city_codes()) == ["23"]  # 실패는 캐시하지 않아서 다음에 다시 시도해 성공한다


def test_percent_encoded_key_is_decoded_once():
    seen = []

    def handler(request):
        seen.append(request.url.params.get("serviceKey"))
        return httpx.Response(200, json=ok([{"citycode": "23", "cityname": "인천"}]))

    run(bt.TagoClient("abc%2Bdef%3D%3D", transport=httpx.MockTransport(handler)).city_codes())
    assert seen == ["abc+def=="]


def _step(numbers, names, vehicle_type="일반"):
    return TransitStep(
        type="BUS", distance_m=100, time_sec=60,
        stops=[TransitStop(name=n) for n in names],
        vehicles=[TransitVehicle(name=n, type=vehicle_type) for n in numbers],
    )


def test_attach_fills_only_confirmed_fields_and_keeps_kakao_fields():
    client = client_for({"31150": [route("R1", 31, "일반버스")]}, {("31150", "R1"): ROUND_TRIP})
    matched, unmatched = _step(["31"], NAMES), _step(["99"], NAMES)
    run(bt.attach_bus_matches([(matched, PATH), (unmatched, PATH)], client))
    v = matched.vehicles[0]
    assert (v.route_id, v.operator_region, v.route_class, v.match_confidence, v.data_source) == ("R1", "gyeonggi", "일반버스", "high", "tago_bus_route")
    assert v.type == "일반"  # 카카오가 준 유형은 그대로
    assert [s.stop_id for s in matched.stops] == ["G0", "G1", "G2", "G3"] and all(s.match_confidence == "high" for s in matched.stops)
    assert unmatched.vehicles[0].route_id is None and all(s.lat is None and s.stop_id is None for s in unmatched.stops)


def test_attach_does_nothing_without_a_key():
    step = _step(["31"], NAMES)
    run(bt.attach_bus_matches([(step, PATH)], None))  # 테스트 기본 설정: get_tago_client() 가 None
    assert step.vehicles[0].route_id is None and step.stops[0].lat is None


def test_alternative_routes_in_one_step_agreeing_on_stops_fill_coordinates():
    client = client_for(
        {"31150": [route("R1", 31, "일반버스"), route("R2", "31-3", "일반버스")]},
        {("31150", "R1"): ROUND_TRIP, ("31150", "R2"): ROUND_TRIP},
    )
    step = _step(["31", "31-3"], NAMES)
    run(bt.attach_bus_matches([(step, PATH)], client))
    assert [v.route_id for v in step.vehicles] == ["R1", "R2"]
    assert [s.stop_id for s in step.stops] == ["G0", "G1", "G2", "G3"]  # 두 노선이 같은 정류장을 가리킨다


def test_alternative_routes_pointing_at_different_stops_leave_coordinates_empty():
    other = [dict(s, nodeid=s["nodeid"] + "x") for s in ROUND_TRIP]
    client = client_for(
        {"31150": [route("R1", 31, "일반버스"), route("R2", "31-3", "일반버스")]},
        {("31150", "R1"): ROUND_TRIP, ("31150", "R2"): other},
    )
    step = _step(["31", "31-3"], NAMES)
    run(bt.attach_bus_matches([(step, PATH)], client))
    assert all(v.route_id for v in step.vehicles)  # 노선은 각각 확정
    assert all(s.lat is None for s in step.stops)  # 어느 정류장인지 모르므로 좌표는 비운다


def test_one_timeout_is_retried_but_a_second_timeout_gives_up():
    state = {"n": 0}

    def flaky(request):
        state["n"] += 1
        if state["n"] == 1:
            raise httpx.ConnectTimeout("t")
        return httpx.Response(200, json=ok([{"citycode": "23", "cityname": "인천"}]))

    assert run(bt.TagoClient("k", transport=httpx.MockTransport(flaky)).city_codes()) == ["23"]
    assert state["n"] == 2

    def dead(request):
        raise httpx.ConnectTimeout("t")

    try:
        run(bt.TagoClient("k", transport=httpx.MockTransport(dead)).city_codes())
        raise AssertionError("TagoError 가 나야 한다")
    except bt.TagoError:
        pass


def test_warm_up_prefetches_route_lists_of_supported_regions_only():
    calls = []
    client = client_for({}, {}, calls=calls, cities=["23", "31010", "31150", "21", "34010", "11"])  # 34010(충남)·11(서울)은 지원 묶음이 아니다
    run(bt.warm_up_bus_routes(client))
    assert calls.count("getCtyCodeList") == 1
    assert calls.count("getRouteNoList") == 4  # 23, 31010, 31150, 21


def test_warm_up_never_raises_even_when_tago_fails():
    client = client_for({}, {}, fail=lambda request: httpx.Response(500, text="oops"))
    run(bt.warm_up_bus_routes(client))  # 예외 없이 끝난다


# ── 후보 조회 병렬화: 속도만 달라지고 판정은 같아야 한다 ──

def slow_transport(routes_by_city, stops_by_route, delay=0.03, stats=None, fail_route=None):
    """응답이 느린 TAGO 모의 서버. 동시에 진행 중인 요청 수의 최댓값(stats['max'])을 기록한다."""
    cities = sorted(set(routes_by_city) | {k[0] for k in stops_by_route} | {"23"})

    async def handler(request: httpx.Request) -> httpx.Response:
        op = request.url.path.rsplit("/", 1)[-1]
        q = request.url.params
        if stats is not None:
            stats["now"] += 1
            stats["max"] = max(stats["max"], stats["now"])
            stats["total"] += 1
        try:
            await asyncio.sleep(delay)
            if op == "getCtyCodeList":
                return httpx.Response(200, json=ok([{"citycode": c, "cityname": c} for c in cities]))
            if op == "getRouteNoList":
                return httpx.Response(200, json=ok(routes_by_city.get(q["cityCode"], [])))
            if fail_route and q.get("routeId") == fail_route:
                return httpx.Response(500, text="oops")
            return httpx.Response(200, json=ok(stops_by_route.get((q["cityCode"], q["routeId"]), [])))
        finally:
            if stats is not None:
                stats["now"] -= 1

    return httpx.MockTransport(handler)


def many_candidates(n):
    """같은 번호 '1' 이 n 개 도시에 있고 그중 하나(마지막)만 카카오 경로와 맞는다."""
    cities = {f"3{1000 + i * 10}"[:5]: [route(f"R{i}", 1, "일반버스")] for i in range(n)}
    stops = {}
    for i, (city, _) in enumerate(cities.items()):
        stops[(city, f"R{i}")] = ROUND_TRIP if i == n - 1 else [stop(k + 1, f"Z{i}_{k}", f"다른{i}_{k}", 37.9, 127.5 + k * 0.002) for k in range(4)]
    return cities, stops


def test_parallel_matching_is_faster_than_one_by_one_but_stays_within_the_concurrency_limit(monkeypatch):
    cities, stops = many_candidates(6)
    stats = {"now": 0, "max": 0, "total": 0}
    client = bt.TagoClient("k", transport=slow_transport(cities, stops, delay=0.05, stats=stats))
    started = __import__("time").monotonic()
    m = run(bt.match_bus_step(client, ["1"], NAMES, PATH))
    elapsed = __import__("time").monotonic() - started
    assert m.vehicles["1"].route_id == "R5"
    assert stats["total"] == 1 + 7 + 6  # 도시코드 1 + 노선 목록 7(후보 6개 도시 + 인천 23) + 후보 노선 정류장 목록 6
    assert 1 < stats["max"] <= bt.MAX_CONCURRENT  # 실제로 동시에 실행되고, 동시 요청 수 상한을 넘지 않는다
    # 호출을 한 건씩 했다면 최소 14 x 0.05 = 0.7초. 병렬이면 (1 + 2 + 1)번의 대기 정도만 걸린다.
    assert elapsed < 0.45


def test_parallel_result_equals_the_one_by_one_result_for_unique_ambiguous_and_missing_cases():
    # 유일: R_OK 만 맞음 / 모호: 두 도시 모두 맞음 / 없음
    cases = {
        "유일": ({"31050": [route("A", 7, "일반버스")], "31150": [route("B", 7, "일반버스")]}, {("31050", "A"): [stop(1, "z", "다른", 37.9, 127.5), stop(2, "y", "다른2", 37.9, 127.51)], ("31150", "B"): ROUND_TRIP}),
        "모호": ({"31050": [route("A", 7, "일반버스")], "31150": [route("B", 7, "일반버스")]}, {("31050", "A"): ROUND_TRIP, ("31150", "B"): ROUND_TRIP}),
        "없음": ({"31150": [route("B", 8, "일반버스")]}, {("31150", "B"): ROUND_TRIP}),
    }
    expected = {"유일": "B", "모호": None, "없음": None}
    for name, (routes, stops) in cases.items():
        fast = run(bt.match_bus_step(bt.TagoClient("k", transport=slow_transport(routes, stops, delay=0.001)), ["7"], NAMES, PATH))
        got = fast.vehicles.get("7")
        assert (got.route_id if got else None) == expected[name], name


def test_if_any_candidate_cannot_be_loaded_the_number_is_left_empty_even_when_another_candidate_aligns():
    # R_BAD 를 못 받으면, 맞는 R_OK 하나만 보고 확정하면 R_BAD 도 맞았을 가능성(모호)을 놓친다. 추측하지 않고 비운다.
    routes = {"31050": [route("R_BAD", 5, "일반버스")], "31150": [route("R_OK", 5, "일반버스")]}
    stops = {("31150", "R_OK"): ROUND_TRIP}
    client = bt.TagoClient("k", transport=slow_transport(routes, stops, delay=0.001, fail_route="R_BAD"))
    m = run(bt.match_bus_step(client, ["5"], NAMES, PATH))
    assert m.vehicles == {} and m.stops == [None] * 4


def test_other_numbers_in_the_same_step_still_match_when_one_number_fails():
    routes = {"31050": [route("R_BAD", 5, "일반버스")], "31150": [route("R_OK", 31, "일반버스")]}
    stops = {("31150", "R_OK"): ROUND_TRIP}
    client = bt.TagoClient("k", transport=slow_transport(routes, stops, delay=0.001, fail_route="R_BAD"))
    m = run(bt.match_bus_step(client, ["5", "31"], NAMES, PATH))
    assert "31" in m.vehicles and "5" not in m.vehicles


def test_concurrent_identical_requests_share_one_tago_call():
    routes = {"31150": [route("R1", 31, "일반버스")]}
    stats = {"now": 0, "max": 0, "total": 0}
    client = bt.TagoClient("k", transport=slow_transport(routes, {("31150", "R1"): ROUND_TRIP}, stats=stats))

    async def many():
        return await asyncio.gather(*(bt.match_bus_step(client, ["31"], NAMES, PATH) for _ in range(8)))

    results = run(many())
    assert all("31" in r.vehicles for r in results)
    # 도시코드 1 + 노선 목록 2(이 모의 서버의 도시: 23·31150) + 정류장 목록 1 = 4. 8번 동시에 불러도 늘지 않는다.
    assert stats["total"] == 1 + 2 + 1


def test_leading_zero_number_is_never_matched_to_the_number_without_it():
    # 카카오 "015"(부천 마을)와 다른 도시의 "15"는 다른 노선이다. 앞의 0을 떼거나 붙여 추정하지 않는다(번호는 문자열로 정확히 같아야 한다).
    client = client_for({"31150": [route("R15", 15, "일반버스")]}, {("31150", "R15"): ROUND_TRIP})
    assert run(bt.match_bus_step(client, ["015"], NAMES, PATH)).vehicles == {}
    client = client_for({"31150": [route("R015", "015", "일반버스")]}, {("31150", "R015"): ROUND_TRIP})
    assert run(bt.match_bus_step(client, ["15"], NAMES, PATH)).vehicles == {}
    assert "015" in run(bt.match_bus_step(client, ["015"], NAMES, PATH)).vehicles  # 정확히 같으면 매칭된다
