"""서울 버스 노선·정류장 공식 데이터(서울특별시_노선정보조회 서비스, data.go.kr 15000193) 조회와 교차 검증.

실제 응답으로 확인한 사실(2026-11, 필드 이름은 모두 실제 응답에서 확인한 것만 쓴다):
 - 호출 주소는 http://ws.bus.go.kr/api/rest/busRouteInfo (https 는 연결되지 않는다). 키가 URL 에 평문으로 실리므로 서버에서만 호출한다.
 - getBusRouteList(strSrch=번호)는 번호가 "포함된" 노선을 모두 돌려준다(부분 일치). 노선명이 번호와 정확히 같은 노선, 또는 경기·인천 노선이
   "번호+지역명"(예: 83부천, 9남양주)으로 등록된 노선만 후보로 쓴다. 결과가 없으면 headerCd "4" 이고 itemList 가 null 이다.
 - getStaionByRoute(busRouteId)는 왕복이 한 목록(seq 1..N)이고 정류장마다 station(정류소 ID), stationNm, gpsX(경도), gpsY(위도), direction(그 정류장에서
   버스가 향하는 종점 이름)이 있다. 왕복 같은 이름 정류장은 station 이 서로 다르다.
 - routeType: 2 마을 3 간선 4 지선 5 순환 6 광역 (서울 노선), 7 인천 8 경기 (그 지역 노선이 서울을 지나는 것), 그 외(1 공항 0 공용 9 폐지)는 쓰지 않는다.
 - stationNo(정류소 번호)는 경기 구간에서 0·"미정차"가 흔하고 TAGO 의 번호와 체계가 달라 매칭 근거로 쓰지 않는다. 서울 station·busRouteId 는
   TAGO nodeid·routeid 에서 영문 접두어(GGB 등)를 뺀 값과 같은 경우가 많다(같은 정류장 ID 체계). 이는 "같은 노선" 증거의 한 부분일 뿐 필수 조건이 아니다.
키는 SEOUL_BUS_SERVICE_KEY 환경변수(backend/.env)로만 받는다. 키가 없으면 아무 호출도 하지 않는다.
"""
import asyncio
import logging
import math
import re
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import unquote

import httpx

logger = logging.getLogger(__name__)

SEOUL_BASE = "http://ws.bus.go.kr/api/rest/busRouteInfo"
DATA_SOURCE = "seoul_bus_route"
CACHE_TTL_S = 24 * 3600
REQUEST_TIMEOUT_S = 5.0
MAX_CONCURRENT = 4  # 개발계정 한도가 하루 1,000건이라 동시 호출도 작게 둔다
MAX_CANDIDATE_ROUTES = 8
# 연속으로 이만큼 실패하면(한도 초과·서비스 장애 등) 이 시간 동안 서울 API 를 부르지 않는다(한도를 더 쓰지 않고, 요청을 지연시키지 않는다).
SUSPEND_AFTER_FAILURES = 3
SUSPEND_S = 300.0

# 서울 자체 노선 유형. 이 값이 확정(정류장 순서 검증 통과)돼야 공식 유형이 된다.
SEOUL_CLASS = {"2": "마을", "3": "간선", "4": "지선", "5": "순환", "6": "광역"}
# 경기·인천 노선이 서울을 지나는 것(운영 지역만 알 수 있고 세부 유형은 알 수 없다)
OTHER_REGION = {"7": "incheon", "8": "gyeonggi"}
# 서울을 지나는 구간에서만 서울 API 를 부른다(서울 밖 구간은 호출을 아낀다). 대략적인 사각형이라 가장자리는 놓칠 수 있고, 놓치면 null 이다.
SEOUL_BOX = (37.43, 37.70, 126.76, 127.19)
_REGION_SUFFIX = re.compile(r"[가-힣]+")

MAX_PAIR_DISTANCE_M = 50.0  # 두 기관이 같은 정류장이라고 주장할 때 허용하는 좌표 차이
MIN_ID_OVERLAP = 0.9  # 같은 ID 체계에서 노선 전체 정류장 ID 가 이만큼 겹쳐야 같은 노선으로 본다
MIN_ALIGNED_FOR_FILL = 3  # 서울 데이터만으로 경기·인천 노선을 채울 때 검증된 정류장의 최소 수


class SeoulError(Exception):
    """서울 API 가 오류를 돌려줬거나 호출에 실패했다. 메시지에 요청 URL(키 포함)을 넣지 않는다."""


@dataclass(frozen=True)
class SeoulRoute:
    route_id: str
    name: str
    route_type: str  # 문자열 코드("3" 등)


@dataclass(frozen=True)
class SeoulStop:
    # bus_tago.TagoStop 과 같은 이름의 필드를 가져서 align_stops 를 그대로 쓸 수 있다.
    order: int
    node_id: str
    name: str
    lat: float
    lng: float
    direction: str = ""


def touches_seoul(path: list[tuple[float, float]]) -> bool:
    min_lat, max_lat, min_lng, max_lng = SEOUL_BOX
    return any(min_lat <= lat <= max_lat and min_lng <= lng <= max_lng for lat, lng in path)


def _as_float(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _as_list(value: Any) -> list[dict]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


class SeoulBusClient:
    def __init__(self, service_key: str, *, transport: Optional[httpx.AsyncBaseTransport] = None, now: Callable[[], float] = time.monotonic) -> None:
        self._key = unquote(service_key) if "%" in service_key else service_key
        self._transport = transport
        self._now = now
        self._semaphore: Optional[asyncio.Semaphore] = None
        self._cache: dict[tuple, tuple[float, Any]] = {}
        self._locks: dict[tuple, asyncio.Lock] = {}
        self._failures = 0
        self._suspended_until = 0.0
        self.calls = 0  # 실제 HTTP 호출 수(한도 관리·점검용)

    @property
    def suspended(self) -> bool:
        return self._now() < self._suspended_until

    async def _get(self, op: str, **params: Any) -> list[dict]:
        if self.suspended:
            raise SeoulError("suspended")
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(MAX_CONCURRENT)  # 실행 중인 이벤트 루프에서 만든다
        try:
            items = await self._request(op, params)
        except SeoulError:
            self._failures += 1
            if self._failures >= SUSPEND_AFTER_FAILURES:
                self._suspended_until = self._now() + SUSPEND_S
                self._failures = 0
                logger.warning("서울 버스 API 연속 실패: %d초 동안 호출을 멈춘다", int(SUSPEND_S))
            raise
        self._failures = 0
        return items

    async def _request(self, op: str, params: dict[str, Any]) -> list[dict]:
        async with self._semaphore:  # type: ignore[union-attr]
            for attempt in range(2):  # 시간 초과에 한해 한 번만 다시 시도한다
                self.calls += 1
                try:
                    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S, transport=self._transport) as client:
                        response = await client.get(f"{SEOUL_BASE}/{op}", params={"serviceKey": self._key, "resultType": "json", **params})
                    response.raise_for_status()
                    payload = response.json()
                except httpx.TimeoutException as exc:
                    if attempt == 1:
                        raise SeoulError(type(exc).__name__) from None
                    continue
                except Exception as exc:  # httpx 예외 문자열에는 키가 든 URL 이 있을 수 있어 종류만 남긴다
                    raise SeoulError(type(exc).__name__) from None
                header = (payload or {}).get("msgHeader") or {}
                code = str(header.get("headerCd", ""))
                if code == "4":  # 결과가 없습니다
                    return []
                if code != "0":
                    raise SeoulError(f"headerCd {code}")
                return _as_list(((payload or {}).get("msgBody") or {}).get("itemList"))
        raise SeoulError("unreachable")

    async def _cached(self, key: tuple, load: Callable[[], Awaitable[Any]]) -> Any:
        hit = self._cache.get(key)
        if hit and self._now() - hit[0] < CACHE_TTL_S:
            return hit[1]
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._cache.get(key)
            if hit and self._now() - hit[0] < CACHE_TTL_S:
                return hit[1]
            value = await load()  # 실패(SeoulError)는 캐시하지 않는다
            self._cache[key] = (self._now(), value)
            return value

    async def candidates(self, number: str) -> list[SeoulRoute]:
        """노선번호의 후보 노선. 노선명이 번호와 같거나, 경기·인천 노선이 "번호+지역명"으로 등록된 것만."""

        async def load() -> list[SeoulRoute]:
            exact: list[SeoulRoute] = []
            suffixed: list[SeoulRoute] = []
            for x in await self._get("getBusRouteList", strSrch=number):
                route_id, name, route_type = x.get("busRouteId"), str(x.get("busRouteNm", "")).strip(), str(x.get("routeType", ""))
                if not route_id:
                    continue
                if name == number:
                    exact.append(SeoulRoute(str(route_id), name, route_type))
                elif name.startswith(number) and route_type in OTHER_REGION and _REGION_SUFFIX.fullmatch(name[len(number):] or "x"):
                    suffixed.append(SeoulRoute(str(route_id), name, route_type))
            # 정확히 같은 이름이 있으면 그것만 본다(번호+지역명 노선은 정확한 이름이 서울 DB 에 없을 때의 대안이다)
            return (exact or suffixed)[:MAX_CANDIDATE_ROUTES]

        return await self._cached(("candidates", number), load)

    async def stops_of_route(self, route: SeoulRoute) -> list[SeoulStop]:
        async def load() -> list[SeoulStop]:
            stops: list[SeoulStop] = []
            for x in await self._get("getStaionByRoute", busRouteId=route.route_id):
                lat, lng = _as_float(x.get("gpsY")), _as_float(x.get("gpsX"))
                if lat is None or lng is None or not x.get("station") or x.get("stationNm") is None:
                    continue
                try:
                    order = int(x["seq"])
                except (KeyError, TypeError, ValueError):
                    continue
                stops.append(SeoulStop(order, str(x["station"]), str(x["stationNm"]).strip(), lat, lng, str(x.get("direction") or "").strip()))
            stops.sort(key=lambda s: s.order)
            return stops

        return await self._cached(("stops", route.route_id), load)


_client: Optional[SeoulBusClient] = None
_client_key = ""


def get_seoul_client() -> Optional[SeoulBusClient]:
    """키가 설정돼 있을 때만 클라이언트를 돌려준다(캐시를 공유하려고 프로세스당 하나)."""
    global _client, _client_key
    from .config import get_settings  # 순환 import 를 피하려고 함수 안에서 읽는다

    key = get_settings().seoul_bus_service_key.strip()
    if not key:
        return None
    if _client is None or key != _client_key:
        _client, _client_key = SeoulBusClient(key), key
    return _client


def seoul_matching_enabled() -> bool:
    """/api/health 용: 서울 인증키가 설정돼 있는가(값은 노출하지 않는다)."""
    try:
        return get_seoul_client() is not None
    except Exception:
        return False


# ───────────────────────── 교차 검증 ─────────────────────────

def _dist_m(a: Any, b: Any) -> float:
    k = math.cos(math.radians((a.lat + b.lat) / 2))
    return math.hypot((b.lat - a.lat) * 111_320.0, (b.lng - a.lng) * 111_320.0 * k)


def strip_id_prefix(identifier: str) -> str:
    """TAGO 의 GGB212000232 와 서울의 212000232 처럼 영문 접두어만 다른 ID 를 비교하려고 접두어를 뗀다."""
    return re.sub(r"^[A-Za-z]+", "", str(identifier))


def route_agreement(a_aligned: list[Any], a_full: list[Any], b_aligned: list[Any], b_full: list[Any]) -> Optional[frozenset[int]]:
    """서로 다른 기관의 두 노선이 실제로 같은 노선임이 충분히 입증되는가. 입증되면 "좌표가 서로 어긋난 정렬 정류장의 위치(0부터)" 집합을 돌려주고
    (빈 집합이면 전부 일치), 입증되지 않으면 None(모호). 어긋난 정류장은 호출한 쪽이 좌표를 비운다.

    공통 조건: 정렬된 정류장 수가 같고, 이름이 모두 같다. 노선 ID 가 같은지는 보지 않는다(기관마다 달라도 같은 노선일 수 있다).
    진행 방향은 따로 목록 절반으로 가르지 않는다(직행처럼 정차를 건너뛰는 노선은 정렬이 목록 가운데를 지나기도 한다): 같은 정류장 ID 체계에서는 ID 가 같으면
    같은 방향의 같은 정류장이고(반대편 정류장은 ID 가 다르다), ID 체계가 다르면 아래처럼 목록 전체의 이름·좌표 순서와 정렬 위치가 같아야 한다.
    그 위에, 아래 둘 중 하나여야 한다.
     - 같은 정류장 ID 체계: 정렬된 정류장 ID 가 모두 같고(접두어 제외), 노선 전체의 정류장 ID 가 MIN_ID_OVERLAP 이상 겹친다.
       이때는 ID 가 같은 정류장이므로 좌표가 MAX_PAIR_DISTANCE_M 를 넘게 어긋난 정류장이 있어도 노선은 같다고 본다. 다만 어긋난 정류장이 정렬 정류장의
       절반 이상이거나 일치하는 정류장이 2개 미만이면 입증하지 않는다.
     - ID 체계가 다름(정렬된 정류장 ID 가 하나도 안 겹침): 노선 전체의 정류장 이름 순서가 같고 모든 정류장 쌍의 좌표가 MAX_PAIR_DISTANCE_M 이내다(좌표도 증거라 예외 없음).
    ID 가 일부만 겹치면 판단하지 않는다.
    """
    n = len(a_aligned)
    if n < 2 or n != len(b_aligned):
        return None
    if any(x.name != y.name for x, y in zip(a_aligned, b_aligned)):
        return None
    try:
        a_idx = [a_full.index(s) for s in a_aligned]
        b_idx = [b_full.index(s) for s in b_aligned]
    except ValueError:
        return None
    equal_ids = sum(strip_id_prefix(x.node_id) == strip_id_prefix(y.node_id) for x, y in zip(a_aligned, b_aligned))
    if equal_ids == n:
        a_ids = {strip_id_prefix(s.node_id) for s in a_full}
        b_ids = {strip_id_prefix(s.node_id) for s in b_full}
        if len(a_ids & b_ids) / max(1, len(a_ids | b_ids)) < MIN_ID_OVERLAP:
            return None
        conflicts = frozenset(i for i, (x, y) in enumerate(zip(a_aligned, b_aligned)) if _dist_m(x, y) > MAX_PAIR_DISTANCE_M)
        if len(conflicts) * 2 >= n or n - len(conflicts) < 2:
            return None
        return conflicts
    if equal_ids == 0:
        same = a_idx == b_idx and len(a_full) == len(b_full) and all(x.name == y.name and _dist_m(x, y) <= MAX_PAIR_DISTANCE_M for x, y in zip(a_full, b_full))
        return frozenset() if same else None
    return None


# 서울 DB 의 노선은 서울 안을 지난다. 서울 안 정류장의 ID 는 1 로 시작하는 9자리(예: 123000354)이고, TAGO 가 돌려주는 경기·인천 노선 목록에도 서울 구간
# 정류장이 같은 ID(GGB114000292 처럼 영문 접두어만 붙음)로 들어 있다. 실제 중복 55건이 모두 이 조건을 만족했다(놓침 0건).
_SEOUL_STOP_ID = re.compile(r"1\d{8}")


def may_be_listed_in_seoul(full_stops: list[Any]) -> bool:
    """TAGO 노선(전체 정류장)이 서울 DB 에도 있을 수 있는가. 서울 안에 서울형 ID 정류장이 하나도 없으면 서울 DB 의 노선일 수 없으니 서울 조회를 건너뛴다."""
    min_lat, max_lat, min_lng, max_lng = SEOUL_BOX
    return any(
        min_lat <= s.lat <= max_lat and min_lng <= s.lng <= max_lng and _SEOUL_STOP_ID.fullmatch(strip_id_prefix(s.node_id)) is not None for s in full_stops
    )


def direction_of(aligned: list[SeoulStop]) -> Optional[str]:
    """정렬된 서울 정류장들이 모두 같은 진행 방향(종점 이름)이면 그 값, 아니면(비어 있거나 섞이면) None. 방향이 모호하면 확정하지 않는다."""
    directions = {s.direction for s in aligned}
    return next(iter(directions)) if len(directions) == 1 and "" not in directions else None
