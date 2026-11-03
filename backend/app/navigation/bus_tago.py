"""버스 노선·정류장 공식 데이터(국토교통부 TAGO) 매칭. 카카오 대중교통 경로의 버스 구간에 운영 지역·노선 유형·정류장 좌표를 붙인다.

공식 문서: 버스노선정보(data.go.kr 15098529, BusRouteInfoInqireService) - 도시코드 목록 · 노선번호목록 · 노선별경유정류소목록.
실제 응답으로 확인한 사실(2026-11):
 - 서울(11)은 TAGO 도시코드 목록에 없다. 서울 버스는 서울 API(bus_seoul.py)로 맞춘다. 두 기관이 모두 주장하는 노선은 아래 "통합 규칙"으로만 합친다.
 - 경기는 시·군별 도시코드(수원 31010, 부천 31050, 시흥 31150 ...)이고, 노선은 기점이 있는 도시에 등록된다(예: 부천까지 가는 31·31-3 은 시흥 31150).
 - 경유정류소 목록은 왕복이 한 목록(nodeord 1..N)이고 같은 정류장 이름이 양방향으로 반복된다. updowncd 는 인천만 채워지고 경기는 비어 있다.
   그래서 방향은 updowncd 가 아니라 "카카오 정류장 이름 순서가 목록에서 순서대로 이어지는지 + 정류장 좌표가 카카오 경로 위인지"로 가린다.
 - 좌표는 숫자와 문자열이 섞여 온다. routeno 도 숫자(31)와 문자열("31-3")이 섞여 온다.

규칙(어느 하나라도 어긋나면 값을 주지 않는다. 추측하지 않는다):
 1. 노선번호가 정확히 같은 후보만 본다. 번호 앞뒤를 고치거나 번호로 유형을 추정하지 않는다.
 2. 카카오 정류장 이름이 후보 노선 목록에서 순서대로(작은 건너뜀만 허용) 이어지고 각 정류장이 경로에서 가까워야 한다.
 3. 그렇게 맞는 노선·방향이 정확히 하나일 때만 확정한다. 후보가 여럿 맞으면(다른 도시의 같은 번호 등) 모호하므로 null.
키는 TAGO_SERVICE_KEY 환경변수(backend/.env)로만 받는다. 키가 없으면 아무 호출도 하지 않고 모든 필드를 비운다.

통합 규칙(TAGO + 서울, 잘못된 합치기보다 미매칭을 택한다):
 - TAGO 후보가 둘 이상 맞으면 모호(기존과 같음).
 - TAGO 가 하나 맞고 서울이 아무 후보도 못 맞추면 TAGO 값을 쓴다. 서울 API 가 실패해도 TAGO 값을 쓴다(기존 동작 유지).
 - TAGO 가 하나 맞고 서울 후보도 맞으면, 서울이 경기·인천(7·8) 노선이고 route_agreement 로 같은 노선임이 입증될 때만 TAGO 값을 쓴다. 아니면 모호.
   같은 노선으로 입증됐지만 좌표가 크게 어긋난 정류장이 있으면 그 정류장의 좌표만 비운다(노선 정보와 나머지 정류장은 그대로).
 - 서울 조회는 필요할 때만 한다: TAGO 가 맞은 노선은 서울 안 서울형 ID 정류장이 있을 때만(may_be_listed_in_seoul), TAGO 가 못 맞췄으면 서울 구간일 때만.
 - TAGO 가 못 맞췄고 서울 후보가 정확히 하나 맞으면: 서울 노선(2~6)은 방향이 분명할 때 서울 값을, 경기·인천(7·8)은 TAGO 조회가 정상이었고
   검증된 정류장이 충분하고 방향이 분명할 때만 운영 지역만 채운다(세부 유형은 서울이 주지 않으므로 null).
"""
import asyncio
import logging
import math
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import unquote

import httpx

from .bus_seoul import (
    DATA_SOURCE as SEOUL_DATA_SOURCE,
    MIN_ALIGNED_FOR_FILL,
    OTHER_REGION,
    SEOUL_CLASS,
    SeoulBusClient,
    SeoulError,
    SeoulRoute,
    direction_of,
    get_seoul_client,
    may_be_listed_in_seoul,
    route_agreement,
    touches_seoul,
)

logger = logging.getLogger(__name__)

ROUTE_BASE = "https://apis.data.go.kr/1613000/BusRouteInfoInqireService"
DATA_SOURCE = "tago_bus_route"
CACHE_TTL_S = 24 * 3600
REQUEST_TIMEOUT_S = 6.0
MAX_CONCURRENT = 6
# 카카오 정류장 하나가 목록의 다음 정류장에서 이만큼(칸)까지 건너뛰어도 같은 노선으로 본다(이름이 다른 정류장이 사이에 끼는 경우)
MAX_SKIP = 3
# 정류장 좌표가 카카오 경로에서 이만큼(m) 안에 있어야 같은 정류장이다(길 양쪽 정류장은 대개 35m 안팎이라 이름 순서와 함께 쓴다)
MAX_OFF_PATH_M = 50.0
MAX_CANDIDATE_ROUTES = 8
# 직행·광역처럼 카카오가 정차하지 않는 정류장을 빼고 보여 주는 노선은 건너뜀이 MAX_SKIP 을 넘을 수 있다(예: 3200 은 한 번에 11칸). MAX_SKIP 은 전역으로 늘리지 않고,
# 기존 정렬(MAX_SKIP)이 실패한 직행·광역·급행 노선에 한해 EXPRESS_MAX_SKIP 까지 허용하되 경로 연속성(path_continuity_ok)을 통과해야 확정한다.
EXPRESS_MAX_SKIP = 20
EXPRESS_WORDS = ("직행", "광역", "급행")

# 도시코드 -> 시·도 이름표(operator_region). 코드 앞 두 자리 기준이며, 11(서울)은 TAGO 에 없다.
_PROVINCE = {
    "11": "seoul", "12": "sejong", "21": "busan", "22": "daegu", "23": "incheon", "24": "gwangju", "25": "daejeon", "26": "ulsan",
    "31": "gyeonggi", "32": "gangwon", "33": "chungbuk", "34": "chungnam", "35": "jeonbuk", "36": "jeonnam", "37": "gyeongbuk", "38": "gyeongnam", "39": "jeju",
}

# 카카오 경로가 어느 도시들의 노선을 찾아볼지 정하는 대략적인 사각형(남서-북동). 정밀한 행정구역이 아니다.
# 사각형이 틀리면 후보를 놓칠 뿐이고(null), 잘못된 값이 붙지는 않는다: 확정은 항상 이름 순서와 좌표 검증을 거친다.
# 도시코드 앞자리가 prefix 인 모든 도시를 찾는다(경기는 시·군별 코드라 "31"로 모두 포함하고, 노선은 기점 도시에 등록되므로 인접 도시까지 본다).
_CLUSTERS: list[tuple[tuple[float, float, float, float], tuple[str, ...]]] = [
    ((36.85, 38.30, 126.30, 127.95), ("23", "31")),  # 인천 + 경기
    ((34.95, 35.45, 128.70, 129.40), ("21",)),  # 부산
    ((35.70, 36.05, 128.35, 128.90), ("22",)),  # 대구
    ((35.05, 35.30, 126.70, 127.00), ("24",)),  # 광주
    ((36.20, 36.50, 127.25, 127.55), ("25",)),  # 대전
    ((35.40, 35.70, 129.10, 129.45), ("26",)),  # 울산
]


def province_of(city_code: str) -> Optional[str]:
    return _PROVINCE.get(str(city_code)[:2])


@dataclass(frozen=True)
class TagoRoute:
    route_id: str
    route_no: str
    route_type: Optional[str]
    city_code: str


@dataclass(frozen=True)
class TagoStop:
    order: int
    node_id: str
    name: str
    lat: float
    lng: float


@dataclass(frozen=True)
class VehicleMatch:
    route_id: str
    operator_region: Optional[str]
    route_class: Optional[str]
    data_source: str = DATA_SOURCE


@dataclass(frozen=True)
class StopMatch:
    stop_id: str
    lat: float
    lng: float
    data_source: str = DATA_SOURCE


class TagoError(Exception):
    """TAGO 가 오류를 돌려줬다(키 미승인·한도 초과·서비스 오류). 메시지에 요청 URL(키 포함)을 넣지 않는다."""


def _as_float(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _items(payload: Any) -> list[dict]:
    """TAGO JSON 응답에서 item 목록을 꺼낸다. 결과가 없으면 items 가 빈 문자열이고, item 이 하나면 목록이 아니라 객체로 온다."""
    response = (payload or {}).get("response") or {}
    header = response.get("header") or {}
    code = str(header.get("resultCode", ""))
    if code and code != "00":
        raise TagoError(f"resultCode {code}")
    items = ((response.get("body") or {}).get("items")) or {}
    if not isinstance(items, dict):
        return []
    item = items.get("item") or []
    return item if isinstance(item, list) else [item]


class TagoClient:
    def __init__(self, service_key: str, *, transport: Optional[httpx.AsyncBaseTransport] = None, now: Callable[[], float] = time.monotonic) -> None:
        # data.go.kr 은 인코딩된 키와 디코딩된 키 두 가지를 준다. 인코딩된 키를 그대로 넣으면 이중 인코딩되므로 되돌려 쓴다.
        self._key = unquote(service_key) if "%" in service_key else service_key
        self._transport = transport
        self._now = now
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._cache: dict[tuple, tuple[float, Any]] = {}
        self._locks: dict[tuple, asyncio.Lock] = {}
        self.calls = 0  # 실제 HTTP 호출 수(테스트·점검용)

    async def _get(self, op: str, **params: Any) -> list[dict]:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(MAX_CONCURRENT)  # 실행 중인 이벤트 루프에서 만든다
        async with self._semaphore:
            for attempt in range(2):  # data.go.kr 은 가끔 연결 시간 초과가 난다: 시간 초과에 한해 한 번만 다시 시도한다
                self.calls += 1
                try:
                    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S, transport=self._transport) as client:
                        response = await client.get(f"{ROUTE_BASE}/{op}", params={"serviceKey": self._key, "_type": "json", "numOfRows": 2000, "pageNo": 1, **params})
                    response.raise_for_status()
                    return _items(response.json())
                except TagoError:
                    raise
                except httpx.TimeoutException as exc:
                    if attempt == 1:
                        raise TagoError(type(exc).__name__) from None
                except Exception as exc:  # httpx 예외 문자열에는 키가 든 URL 이 있을 수 있어 종류만 남긴다
                    raise TagoError(type(exc).__name__) from None
        raise TagoError("unreachable")

    async def _cached(self, key: tuple, load: Callable[[], Awaitable[Any]]) -> Any:
        hit = self._cache.get(key)
        if hit and self._now() - hit[0] < CACHE_TTL_S:
            return hit[1]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and self._now() - hit[0] < CACHE_TTL_S:
                return hit[1]
            value = await load()  # 실패(TagoError)는 캐시하지 않는다: 다음 요청이 다시 시도한다
            self._cache[key] = (self._now(), value)
            return value

    async def city_codes(self) -> list[str]:
        async def load() -> list[str]:
            return [str(x["citycode"]) for x in await self._get("getCtyCodeList") if x.get("citycode") is not None]

        return await self._cached(("cities",), load)

    async def routes_of_city(self, city_code: str) -> dict[str, list[TagoRoute]]:
        """도시의 모든 노선을 노선번호(문자열)별로 묶어 돌려준다. 도시당 한 번만 부르고 24시간 캐시한다."""

        async def load() -> dict[str, list[TagoRoute]]:
            by_no: dict[str, list[TagoRoute]] = {}
            for x in await self._get("getRouteNoList", cityCode=city_code):
                if x.get("routeid") is None or x.get("routeno") is None:
                    continue
                route = TagoRoute(str(x["routeid"]), str(x["routeno"]), x.get("routetp"), str(city_code))
                by_no.setdefault(route.route_no, []).append(route)
            return by_no

        return await self._cached(("routes", str(city_code)), load)

    async def stops_of_route(self, route: TagoRoute) -> list[TagoStop]:
        async def load() -> list[TagoStop]:
            stops: list[TagoStop] = []
            for x in await self._get("getRouteAcctoThrghSttnList", cityCode=route.city_code, routeId=route.route_id):
                lat, lng = _as_float(x.get("gpslati")), _as_float(x.get("gpslong"))
                if lat is None or lng is None or x.get("nodeid") is None or x.get("nodenm") is None:
                    continue
                try:
                    order = int(x["nodeord"])
                except (KeyError, TypeError, ValueError):
                    continue
                stops.append(TagoStop(order, str(x["nodeid"]), str(x["nodenm"]).strip(), lat, lng))
            stops.sort(key=lambda s: s.order)
            return stops

        return await self._cached(("stops", route.city_code, route.route_id), load)


# ───────────────────────── 기하 ─────────────────────────

_M_PER_DEG = 111_320.0


def _distance_to_path_m(lat: float, lng: float, path: list[tuple[float, float]]) -> float:
    k = math.cos(math.radians(lat))
    px, py = lng * _M_PER_DEG * k, lat * _M_PER_DEG
    best = math.inf
    for i in range(len(path) - 1):
        ax, ay = path[i][1] * _M_PER_DEG * k, path[i][0] * _M_PER_DEG
        bx, by = path[i + 1][1] * _M_PER_DEG * k, path[i + 1][0] * _M_PER_DEG
        seg2 = (bx - ax) ** 2 + (by - ay) ** 2
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / seg2))
        best = min(best, math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))))
    return best


def _align_indexes(kakao_names: list[str], route_stops: list[TagoStop], path: list[tuple[float, float]], max_skip: int) -> Optional[list[int]]:
    """카카오 정류장 이름 목록과 순서대로 이어지는 노선 정류장 배열을 찾는다. 정확히 하나일 때만 돌려주고, 없거나 둘 이상이면 None.

    조건: 이름이 정확히 같고, 정류장 좌표가 카카오 경로 MAX_OFF_PATH_M 안이며, 목록 순서가 앞에서 뒤로 가고 한 번에 건너뛰는 칸이 MAX_SKIP 이하.
    왕복 한 목록에서는 길 맞은편(반대 방향) 정류장도 경로 근처에 있어 건너뛰기를 허용하면 회차 지점을 넘어 엉뚱하게 이어질 수 있다.
    그래서 건너뜀 총합이 가장 작은 정렬만 후보로 삼고, 그 정렬이 유일할 때만 확정한다.
    """
    n = len(kakao_names)
    if n < 2 or len(path) < 2:
        return None
    near: dict[int, bool] = {}

    def on_path(j: int) -> bool:
        if j not in near:
            s = route_stops[j]
            near[j] = _distance_to_path_m(s.lat, s.lng, path) <= MAX_OFF_PATH_M
        return near[j]

    # cells[i][j] = (최소 건너뜀 합, 그 최소를 만드는 정렬 수(2 에서 멈춤), 이전 정류장의 목록 위치)
    cells: list[dict[int, tuple[int, int, int]]] = []
    for i, name in enumerate(kakao_names):
        row: dict[int, tuple[int, int, int]] = {}
        for j, stop in enumerate(route_stops):
            if stop.name != name or not on_path(j):
                continue
            if i == 0:
                row[j] = (0, 1, -1)
                continue
            best: Optional[tuple[int, int, int]] = None
            for pj, (cost, count, _) in cells[i - 1].items():
                gap = j - pj
                if not 1 <= gap <= max_skip + 1:
                    continue
                candidate = cost + gap - 1
                if best is None or candidate < best[0]:
                    best = (candidate, count, pj)
                elif candidate == best[0]:
                    best = (candidate, min(2, best[1] + count), best[2])
            if best is not None:
                row[j] = best
        if not row:
            return None
        cells.append(row)
    lowest = min(c for c, _, _ in cells[-1].values())
    finals = [(j, v) for j, v in cells[-1].items() if v[0] == lowest]
    if sum(v[1] for _, v in finals) != 1:
        return None
    j = finals[0][0]
    chosen = [j]
    for i in range(n - 1, 0, -1):
        j = cells[i][j][2]
        chosen.append(j)
    chosen.reverse()
    return chosen


def align_stops(kakao_names: list[str], route_stops: list[TagoStop], path: list[tuple[float, float]]) -> Optional[list[TagoStop]]:
    """기존 정렬(MAX_SKIP). 동작은 _align_indexes 의 설명을 따른다."""
    chosen = _align_indexes(kakao_names, route_stops, path, MAX_SKIP)
    return None if chosen is None else [route_stops[j] for j in chosen]


def is_express_text(text: Optional[str]) -> bool:
    """직행·광역·급행이 들어간 글자인가(카카오 유형 라벨이든 공식 노선 유형 이름이든 같은 규칙)."""
    return text is not None and any(word in text for word in EXPRESS_WORDS)


def _path_position(lat: float, lng: float, path: list[tuple[float, float]]) -> tuple[float, float]:
    """경로에서 가장 가까운 점: (거리 m, 경로상 위치 = 구간 번호 + 구간 안 비율). 위치가 클수록 경로 앞쪽이다."""
    k = math.cos(math.radians(lat))
    px, py = lng * _M_PER_DEG * k, lat * _M_PER_DEG
    best = (math.inf, 0.0)
    for i in range(len(path) - 1):
        ax, ay = path[i][1] * _M_PER_DEG * k, path[i][0] * _M_PER_DEG
        bx, by = path[i + 1][1] * _M_PER_DEG * k, path[i + 1][0] * _M_PER_DEG
        seg2 = (bx - ax) ** 2 + (by - ay) ** 2
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / seg2))
        distance = math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
        if distance < best[0]:
            best = (distance, i + t)
    return best


def path_continuity_ok(route_stops: list[TagoStop], indexes: list[int], path: list[tuple[float, float]]) -> bool:
    """정렬된 구간(첫 정류장~마지막 정류장) 안의 모든 노선 정류장이 카카오 경로를 따라 같은 방향으로 이어지는가.

    정렬된 정류장은 경로 위에서 순서대로 전진해야 하고, 그 사이에 건너뛴 정류장도 모두 경로 MAX_OFF_PATH_M 안에서 뒤로 가지 않고 이어져야 한다.
    회차 지점을 넘어 반대편 차로로 이어지거나, 경로를 벗어나 다른 길로 도는 노선은 여기서 걸러진다. 노선 목록의 앞/뒤 절반 같은 가정은 쓰지 않는다.
    """
    last_aligned = -math.inf
    for j in indexes:
        position = _path_position(route_stops[j].lat, route_stops[j].lng, path)[1]
        if position <= last_aligned:
            return False
        last_aligned = position
    last = -math.inf
    for j in range(indexes[0], indexes[-1] + 1):
        distance, position = _path_position(route_stops[j].lat, route_stops[j].lng, path)
        if distance > MAX_OFF_PATH_M or position < last - 1e-6:
            return False
        last = max(last, position)
    return True


def align_stops_express(kakao_names: list[str], route_stops: list[TagoStop], path: list[tuple[float, float]]) -> Optional[list[TagoStop]]:
    """보강 정렬(직행·광역·급행 전용, 기존 정렬이 실패한 뒤에만 부른다).

    확정 조건을 모두 만족해야 한다: 카카오 정류장 이름이 모두 노선에 있고, 이름 순서와 좌표(경로 MAX_OFF_PATH_M 이내)가 EXPRESS_MAX_SKIP 칸 건너뜀 안에서
    유일하게 이어지고(기존과 같은 최소 건너뜀 유일성), 건너뛴 정류장까지 경로 연속성(path_continuity_ok)이 확인된다. 하나라도 어긋나면 None.
    TAGO 와 서울의 정류장 모두 order·node_id·name·lat·lng 를 가져서 같은 규칙을 쓴다.
    """
    names = {s.name for s in route_stops}
    if any(n not in names for n in kakao_names):
        return None
    chosen = _align_indexes(kakao_names, route_stops, path, EXPRESS_MAX_SKIP)
    if chosen is None or not path_continuity_ok(route_stops, chosen, path):
        return None
    return [route_stops[j] for j in chosen]


def clusters_for(points: list[tuple[float, float]]) -> list[str]:
    """경로의 몇 점이 걸치는 지역의 도시코드 앞자리(prefix)들. 순서와 중복을 정리한다."""
    prefixes: list[str] = []
    for lat, lng in points:
        for (min_lat, max_lat, min_lng, max_lng), pre in _CLUSTERS:
            if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
                prefixes.extend(p for p in pre if p not in prefixes)
    return prefixes


@dataclass(frozen=True)
class BusStepMatch:
    vehicles: dict[str, VehicleMatch]  # 카카오 노선 번호 -> 확정된 노선
    stops: list[Optional[StopMatch]]  # 카카오 정류장 순서와 같은 길이. 확정 못 했거나 노선들이 서로 다르게 가리키면 None


@dataclass(frozen=True)
class _Pick:
    """한 번호에 대해 확정된 노선과, 카카오 정류장 순서에 맞춘 정류장 배열."""

    vehicle: VehicleMatch
    stops: list
    excluded: frozenset = frozenset()  # 두 기관의 좌표가 어긋나 좌표를 비울 정류장 위치(0부터)


def _decide(
    tago_passed: list[tuple[TagoRoute, list, list]],
    tago_unreliable: bool,
    seoul_passed: list[tuple[SeoulRoute, list, list]],
    seoul_failed: bool,
) -> Optional[_Pick]:
    """TAGO 와 서울의 검증 결과를 합쳐 노선 하나를 정한다. 입증되지 않으면 None(모호)."""
    if len(tago_passed) >= 2:
        return None
    if tago_passed:
        route, aligned, full = tago_passed[0]
        pick = _Pick(VehicleMatch(route.route_id, province_of(route.city_code), route.route_type), aligned)
        if not seoul_passed or seoul_failed:
            return pick  # 서울이 아무 후보도 못 맞췄거나 서울 API 가 안 되면 기존 TAGO 동작 그대로
        if len(seoul_passed) == 1:
            s_route, s_aligned, s_full = seoul_passed[0]
            conflicts = route_agreement(s_aligned, s_full, aligned, full) if s_route.route_type in OTHER_REGION else None
            if conflicts is not None:
                return _Pick(pick.vehicle, pick.stops, conflicts)
        return None  # 서울도 다른 노선(또는 입증 안 된 노선)을 주장한다
    if seoul_failed or len(seoul_passed) != 1:
        return None
    s_route, s_aligned, _ = seoul_passed[0]
    if direction_of(s_aligned) is None:
        return None  # 방향이 모호하면 정류장을 채우지 않는다
    if s_route.route_type in SEOUL_CLASS:
        return _Pick(VehicleMatch(s_route.route_id, "seoul", SEOUL_CLASS[s_route.route_type], SEOUL_DATA_SOURCE), s_aligned)
    if s_route.route_type in OTHER_REGION and not tago_unreliable and len(s_aligned) >= MIN_ALIGNED_FOR_FILL:
        return _Pick(VehicleMatch(s_route.route_id, OTHER_REGION[s_route.route_type], None, SEOUL_DATA_SOURCE), s_aligned)
    return None


# 서울 노선 유형 코드 중 직행·광역 성격을 가질 수 있는 것(6 광역, 7·8 경기·인천 노선). 서울 간선·지선·순환·마을이 직행 라벨과 맞을 수는 없다.
_SEOUL_EXPRESS_CODES = {"6"} | set(OTHER_REGION)


async def _seoul_passed(
    seoul: SeoulBusClient, number: str, stop_names: list[str], path: list[tuple[float, float]], express: bool = False
) -> list[tuple[SeoulRoute, list, list]]:
    routes = await seoul.candidates(number)
    loaded = await asyncio.gather(*(seoul.stops_of_route(r) for r in routes), return_exceptions=True)
    for item in loaded:
        if isinstance(item, Exception):
            raise item  # 후보 하나라도 못 받았으면 모호한지 알 수 없다
    passed = []
    for route, route_stops in zip(routes, loaded):
        aligned = align_stops(stop_names, route_stops, path)
        if aligned is not None:
            passed.append((route, aligned, route_stops))
    if not passed and express:  # 기존 정렬이 모두 실패한 직행·광역·급행 노선에만 보강 정렬
        for route, route_stops in zip(routes, loaded):
            if route.route_type not in _SEOUL_EXPRESS_CODES:
                continue  # 유형이 직행·광역 성격이 아닌 후보는 보강 대상이 아니다
            aligned = align_stops_express(stop_names, route_stops, path)
            if aligned is not None:
                passed.append((route, aligned, route_stops))
    return passed


async def match_bus_step(
    client: Optional[TagoClient],
    route_numbers: list[str],
    stop_names: list[str],
    path: list[tuple[float, float]],
    seoul: Optional[SeoulBusClient] = None,
    route_labels: Optional[list[Optional[str]]] = None,
) -> BusStepMatch:
    """버스 구간 하나를 공식 노선과 맞춘다. 어떤 오류도 밖으로 내지 않고, 못 맞춘 부분은 비워 둔다.

    route_labels: route_numbers 와 같은 순서의 카카오 유형 라벨. 직행·광역·급행인 노선에 한해, 기존 정렬이 실패했을 때 보강 정렬을 시도할지 정하는 데만 쓴다(없으면 시도하지 않는다).
    """
    empty = BusStepMatch({}, [None] * len(stop_names))
    if len(stop_names) < 2 or len(path) < 2:
        return empty
    use_seoul = seoul is not None and touches_seoul(path)
    city_routes: list = []
    tago_failed = False
    if client is not None:
        prefixes = clusters_for([path[0], path[len(path) // 2], path[-1]])
        if prefixes:
            try:
                all_codes = await client.city_codes()
                codes = [c for c in all_codes if any(c.startswith(p) for p in prefixes)]
                # 도시별 노선 목록은 번호와 상관없이 한 번만 받는다(동시에 받고 캐시한다).
                city_routes = list(await asyncio.gather(*(client.routes_of_city(c) for c in codes)))
            except TagoError as exc:
                logger.warning("TAGO 노선 조회 실패: %s", exc)
                tago_failed = True
    if not use_seoul and (client is None or tago_failed or not city_routes):
        return empty

    labels = dict(zip(route_numbers, route_labels or []))

    async def resolve(number: str) -> Optional[_Pick]:
        """노선번호 하나를 TAGO(후보를 동시에 받아 검증)와 서울로 확인해 하나로 정한다."""
        tago_passed: list[tuple[TagoRoute, list, list]] = []
        express = is_express_text(labels.get(number))
        unreliable = client is None or tago_failed  # TAGO 에 없다는 사실을 믿을 수 없는 상태
        candidates = [r for by_no in city_routes for r in by_no.get(number, [])][:MAX_CANDIDATE_ROUTES]
        loaded = await asyncio.gather(*(client.stops_of_route(r) for r in candidates), return_exceptions=True) if client is not None else []
        failures = [x for x in loaded if isinstance(x, Exception)]
        if failures:
            # 후보 하나라도 못 받았으면 다른 노선도 맞는지(모호한지) 알 수 없다. 추측하지 않고 TAGO 쪽은 비워 둔다.
            if not all(isinstance(x, TagoError) for x in failures):
                raise failures[0]
            logger.warning("TAGO 노선 조회 실패: %s", failures[0])
            unreliable = True
        else:
            for route, route_stops in zip(candidates, loaded):
                aligned = align_stops(stop_names, route_stops, path)
                if aligned is not None:
                    tago_passed.append((route, aligned, route_stops))
            if not tago_passed and express:  # 기존 정렬이 모두 실패한 직행·광역·급행 노선에만 보강 정렬
                for route, route_stops in zip(candidates, loaded):
                    if route.route_type is not None and not is_express_text(route.route_type):
                        continue  # 공식 유형이 직행·광역 성격이 아닌 후보(일반버스 등)는 보강 대상이 아니다
                    aligned = align_stops_express(stop_names, route_stops, path)
                    if aligned is not None:
                        tago_passed.append((route, aligned, route_stops))
        if len(tago_passed) >= 2:
            return None  # 같은 번호의 다른 노선이 모두 맞아 모호함
        seoul_passed: list[tuple[SeoulRoute, list, list]] = []
        seoul_failed = False
        # 서울 조회가 필요한 경우만: TAGO 가 맞은 노선이 서울 DB 에도 있을 수 있을 때, 또는 TAGO 가 못 맞췄을 때
        if use_seoul and (not tago_passed or may_be_listed_in_seoul(tago_passed[0][2])):
            try:
                seoul_passed = await _seoul_passed(seoul, number, stop_names, path, express)  # type: ignore[arg-type]
            except SeoulError as exc:
                logger.warning("서울 버스 노선 조회 실패: %s", exc)
                seoul_failed = True
        return _decide(tago_passed, unreliable, seoul_passed, seoul_failed)

    numbers = list(dict.fromkeys(route_numbers))
    vehicles: dict[str, VehicleMatch] = {}
    picks_by_vehicle: dict[str, _Pick] = {}
    for number, found in zip(numbers, await asyncio.gather(*(resolve(n) for n in numbers))):
        if found is None:
            continue
        vehicles[number] = found.vehicle
        picks_by_vehicle[number] = found

    stops: list[Optional[StopMatch]] = []
    for i in range(len(stop_names)):
        picks = {(p.vehicle.data_source, p.stops[i].node_id): (p.vehicle.data_source, p.stops[i]) for p in picks_by_vehicle.values()}
        # 확정된 노선들이 같은 정류장을 가리킬 때만 좌표를 준다(다르게 가리키면 어느 쪽인지 모른다)
        if len(picks) == 1 and not any(i in p.excluded for p in picks_by_vehicle.values()):
            source, stop = next(iter(picks.values()))
            stops.append(StopMatch(stop.node_id, stop.lat, stop.lng, source))
        else:
            stops.append(None)
    return BusStepMatch(vehicles, stops)


# ───────────────────────── 응답에 붙이기 ─────────────────────────

# 한 번의 경로 검색에서 버스 매칭에 쓸 수 있는 시간(초). 처음 호출은 도시 노선 목록을 채우느라 오래 걸릴 수 있어, 시간이 지나면 끝난 것만 붙이고
# 나머지는 비운다. 이미 받은 응답은 캐시에 남아서 같은 지역을 다시 검색하면 더 많이 채워진다.
MATCH_BUDGET_S = 10.0

_client: Optional[TagoClient] = None
_client_key = ""


def get_tago_client() -> Optional[TagoClient]:
    """키가 설정돼 있을 때만 클라이언트를 돌려준다(캐시를 공유하려고 프로세스당 하나)."""
    global _client, _client_key
    from .config import get_settings  # 순환 import 를 피하려고 함수 안에서 읽는다

    key = get_settings().tago_service_key.strip()
    if not key:
        return None
    if _client is None or key != _client_key:
        _client, _client_key = TagoClient(key), key
    return _client


async def attach_bus_matches(
    jobs: list[tuple[Any, list[tuple[float, float]]]], client: Optional[TagoClient] = None, seoul: Optional[SeoulBusClient] = None
) -> None:
    """jobs: (TransitStep, 그 구간 경로 (lat, lng) 목록). 확정된 값만 step.vehicles / step.stops 에 채운다."""
    client = client or get_tago_client()
    seoul = seoul or get_seoul_client()
    if (client is None and seoul is None) or not jobs:
        return
    tasks: dict[tuple, asyncio.Task] = {}
    for step, path in jobs:
        numbers = [v.name for v in step.vehicles if v.name]
        labels = [v.type for v in step.vehicles if v.name]
        names = [s.name for s in step.stops]
        key = (tuple(numbers), tuple(labels), tuple(names), tuple(round(c, 5) for c in path[0]) if path else ())
        if key not in tasks and numbers and len(names) >= 2:
            tasks[key] = asyncio.ensure_future(match_bus_step(client, numbers, names, path, seoul, labels))
    if not tasks:
        return
    done, pending = await asyncio.wait(tasks.values(), timeout=MATCH_BUDGET_S)
    for task in pending:
        task.cancel()
    for step, path in jobs:
        numbers = [v.name for v in step.vehicles if v.name]
        labels = [v.type for v in step.vehicles if v.name]
        names = [s.name for s in step.stops]
        key = (tuple(numbers), tuple(labels), tuple(names), tuple(round(c, 5) for c in path[0]) if path else ())
        task = tasks.get(key)
        if task is None or task not in done or task.cancelled() or task.exception() is not None:
            continue
        result: BusStepMatch = task.result()
        for vehicle in step.vehicles:
            matched = result.vehicles.get(vehicle.name)
            if matched is not None:
                vehicle.route_id = matched.route_id
                vehicle.operator_region = matched.operator_region
                vehicle.route_class = matched.route_class
                vehicle.match_confidence = "high"
                vehicle.data_source = matched.data_source
        for i, stop_match in enumerate(result.stops):
            if stop_match is not None and i < len(step.stops):
                stop = step.stops[i]
                stop.lat, stop.lng, stop.stop_id = stop_match.lat, stop_match.lng, stop_match.stop_id
                stop.match_confidence, stop.data_source = "high", stop_match.data_source


def bus_matching_enabled() -> bool:
    """/api/health 용: TAGO 인증키가 설정돼 있는가(값은 노출하지 않는다)."""
    try:
        return get_tago_client() is not None
    except Exception:
        return False


async def warm_up_bus_routes(client: Optional[TagoClient] = None) -> None:
    """서버가 뜬 직후 백그라운드에서 지원 지역의 도시별 노선 목록을 미리 받아 둔다(첫 경로 검색이 느려지는 것을 줄인다). 실패해도 조용히 넘어간다."""
    client = client or get_tago_client()
    if client is None:
        return
    try:
        prefixes = {p for _, pre in _CLUSTERS for p in pre}
        codes = [c for c in await client.city_codes() if any(c.startswith(p) for p in prefixes)]
        await asyncio.gather(*(client.routes_of_city(c) for c in codes), return_exceptions=True)
    except Exception as exc:  # 백그라운드 작업이라 서버를 막지 않는다
        logger.warning("TAGO 노선 목록 미리 받기 실패: %s", type(exc).__name__)
