"""배포 후 스모크 테스트: 대중교통 경로 응답에 정거장 좌표 필드가 실제로 오는지 확인한다.

사용: python scripts/smoke_transit_stops.py https://tikkeul-api.onrender.com

표준 라이브러리만 쓰고 키·토큰을 읽거나 보내지 않는다. 서버의 카카오 키로 카카오 길찾기를 1회 호출한다(무료 한도 안).
Render 무료 플랜은 잠들어 있으면 첫 요청이 오래 걸릴 수 있어 시간 제한을 넉넉히 둔다.
종료 코드: 0 모두 통과 · 1 하나라도 실패.
"""
import json
import sys
import urllib.request
from typing import Optional

TIMEOUT_S = 90
# 신도림 -> 강남: 2호선 한 구간으로 가는 경로가 나오는 쌍(서울 지하철 좌표 데이터가 있는 구간)
BODY = {"origin": {"lat": 37.5088, "lng": 126.8913}, "destination": {"lat": 37.4979, "lng": 127.0276}}
# 시흥 -> 부천: 31·31-3 같은 경기 노선이 TAGO 에 등록된 지역(버스 매칭 확인용). 서울 노선은 TAGO 에 없어 서울 경로로는 버스 확정을 확인할 수 없다.
BUS_BODY = {"origin": {"lat": 37.3486, "lng": 126.7556}, "destination": {"lat": 37.4859, "lng": 126.7768}}
failures: list[str] = []


def check(ok: bool, message: str) -> None:
    print(("PASS " if ok else "FAIL ") + message)
    if not ok:
        failures.append(message)


def call(url: str, body: Optional[dict] = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if body is not None else {})
    with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
        return json.loads(response.read().decode())


def main(base: str) -> int:
    base = base.rstrip("/")
    health = call(f"{base}/api/health")
    stations = health.get("stations")
    check(health.get("status") == "ok", "/api/health status ok")
    check(isinstance(stations, dict), "/api/health 에 stations 필드가 있다 (이 버전이 배포됨)")
    if isinstance(stations, dict):
        check(stations.get("file_present") is True, "정거장 데이터 파일이 서버에 있다")
        check(stations.get("load_error") is False, "정거장 데이터 로딩 오류가 없다")
        check(isinstance(stations.get("subway_records"), int) and stations["subway_records"] >= 700, f"정거장 레코드 수 >= 700 (현재 {stations.get('subway_records')})")

    data = call(f"{base}/navigation/transit-routes", BODY)
    subway_steps = [s for route in data.get("routes", []) for s in route.get("steps", []) if s.get("type") == "SUBWAY"]
    check(bool(subway_steps), "지하철 구간이 있는 경로가 반환된다")
    if subway_steps:
        check(all("path_start_index" in s for s in subway_steps), "구간에 path_start_index 필드가 있다")
        stops = [stop for s in subway_steps for stop in s.get("stops", [])]
        with_coords = [x for x in stops if x.get("lat") is not None and x.get("lng") is not None]
        check(all({"lat", "lng", "match_confidence", "station_id", "data_source"} <= set(x) for x in stops), "모든 정거장에 좌표 관련 필드 5개가 있다(없으면 null)")
        rate = len(with_coords) / len(stops) if stops else 0
        check(rate >= 0.8, f"정거장 좌표 채움 비율 >= 80% ({len(with_coords)}/{len(stops)} = {rate:.0%})")
        check(all(x.get("match_confidence") in ("high", "medium") for x in with_coords), "좌표가 있는 정거장은 match_confidence 가 high/medium 이다")
        check(all(x.get("lat") is None and x.get("match_confidence") is None for x in stops if x not in with_coords), "좌표가 없는 정거장은 신뢰도도 null 이다")
    bus_data = call(f"{base}/navigation/transit-routes", BUS_BODY)
    buses = [s for route in bus_data.get("routes", []) for s in route.get("steps", []) if s.get("type") == "BUS"]
    check(bool(buses), "버스 구간이 있는 경로가 반환된다(경기 시흥→부천)")
    bus_stops = [stop for s in buses for stop in s.get("stops", [])]
    # 좌표는 공식 데이터(TAGO)로 확정된 정류장에만 있고, 그 정류장은 stop_id·신뢰도·출처를 함께 가진다. 확정 못 한 정류장은 전부 null 이다.
    check(all((x.get("lat") is None) == (x.get("stop_id") is None) == (x.get("match_confidence") is None) for x in bus_stops), "버스 정류장은 좌표·stop_id·신뢰도가 함께 있거나 함께 null 이다(좌표를 만들어내지 않는다)")
    check(all(x.get("match_confidence") == "high" and x.get("data_source") == "tago_bus_route" for x in bus_stops if x.get("lat") is not None), "좌표가 있는 버스 정류장은 신뢰도 high · 출처 tago_bus_route 이다")
    vehicles = [v for s in buses for v in s.get("vehicles", [])]
    check(all("route_id" in v and "operator_region" in v and "route_class" in v for v in vehicles), "버스 노선에 route_id · operator_region · route_class 필드가 있다(없으면 null)")
    if isinstance(stations, dict) and stations.get("bus_matching_enabled") is True:
        confirmed = [v for v in vehicles if v.get("route_id")]
        print(f"INFO 버스 노선 확정 {len(confirmed)}/{len(vehicles)} (서울 노선은 TAGO 대상이 아니라 비어 있는 것이 정상)")
        check(len(confirmed) > 0, "TAGO 가 켜져 있으면 경기 경로의 버스 노선 중 최소 하나는 확정된다(31·31-3 등)")
    else:
        print("INFO 서버에 TAGO_SERVICE_KEY 가 설정돼 있지 않아 버스 매칭이 꺼져 있다(버스 필드는 모두 null)")
    print("\n실패 없음" if not failures else f"\n실패 {len(failures)}건")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
