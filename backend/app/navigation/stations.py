"""지하철 정거장 좌표 매칭. 카카오 대중교통 경로의 정거장 이름에는 좌표가 없어서, 공식 역 좌표 파일과 연결한다.

데이터: 서울시 역사마스터 정보(열린데이터광장 OA-21232, 공공누리 1유형, CSV cp949; 역사_ID·역사명·호선·위도·경도, WGS84).
파일은 data/ 에 함께 둔다(전국 버스정류장 CSV 처럼 큰 원본은 backend/data/ 에 두고 git 에 올리지 않는다). 파일이 없거나 읽지 못해도 좌표 없이 동작한다(모든 정거장이 좌표 null).

규칙(어느 하나라도 어긋나면 좌표를 주지 않는다. 좌표를 만들어내지 않는다):
1. 노선: 카카오 노선명에 허용된 마스터 호선 안에서만 찾는다(이름이 같아도 노선이 다르면 매칭하지 않는다).
2. 이름: 완전 일치(high) 우선, 없으면 괄호 안 부역명을 뺀 이름이 일치(medium). 후보가 둘 이상이면 매칭하지 않는다.
3. 경로 검증: 찾은 좌표가 카카오 구간 경로(path) 가까이에 있고 정거장 순서대로 경로를 따라 앞으로 가야 한다. 어긋나면 null.

지역 데이터 공급자를 늘릴 때는 같은 모양의 인덱스(노선·역명·좌표)를 하나 더 만들어 provider 에서 이어 붙이면 된다.
"""
import csv
import logging
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 공식 CSV 는 저장소에 함께 올리는 패키지 데이터다(서울시 역사마스터 정보, 공공누리 제1유형: 같은 폴더의 NOTICE.md).
STATION_DATA_DIR = Path(__file__).resolve().parent / "data"
SEOUL_MASTER_FILE = "seoul_station_master.csv"
SEOUL_MASTER_SOURCE = "seoul_station_master"

# 카카오 노선명 -> 마스터 호선. 마스터는 코레일 구간을 선 이름(경부선·경인선 등)으로 나눠 두어서 같은 "1호선"이 여러 호선에 걸친다.
# 실제 카카오 응답 208개 구간(2135개 정거장)에서 이름이 겹친 호선 분포와 노선 구성으로 정했다. 여기 없는 노선은 매칭하지 않는다.
LINE_ALIASES: dict[str, frozenset[str]] = {
    "1호선": frozenset({"1호선", "경부선", "경인선", "경원선", "장항선", "중앙선"}),
    "2호선": frozenset({"2호선"}),
    "3호선": frozenset({"3호선", "일산선"}),
    "4호선": frozenset({"4호선", "과천선", "안산선", "진접선"}),
    "5호선": frozenset({"5호선"}),
    "6호선": frozenset({"6호선"}),
    "7호선": frozenset({"7호선", "7호선(인천)"}),
    "8호선": frozenset({"8호선", "별내선"}),
    "9호선": frozenset({"9호선", "9호선(연장)"}),
    "경의중앙선": frozenset({"경의중앙선", "중앙선", "경부선", "경원선", "일산선"}),
    "경춘선": frozenset({"경춘선", "중앙선"}),
    "경강선": frozenset({"경강선"}),
    "공항철도": frozenset({"공항철도1호선"}),
    "서해선": frozenset({"서해선", "경인선"}),
    "수인분당선": frozenset({"수인선", "분당선", "안산선"}),
    "신분당선": frozenset({"신분당선", "신분당선(연장)", "신분당선(연장2)"}),
    "에버라인": frozenset({"에버라인선"}),
    "우이신설": frozenset({"우이신설선"}),
    "의정부 경전철": frozenset({"의정부선"}),
    "인천1호선": frozenset({"인천1호선"}),
    "인천2호선": frozenset({"인천2호선"}),
    "GTX-A": frozenset({"수도권 광역급행철도"}),
    "김포골드라인": frozenset({"김포골드라인"}),
}

# 마스터가 같은 역을 두 호선 행으로 중복 수록한 경우(7호선/7호선(인천), 서울역 등): 후보 좌표가 서로 이만큼(m) 안이면 같은 역으로 본다.
SAME_STATION_M = 150.0
# 경로와 이만큼(m) 넘게 떨어진 좌표는 같은 역이 아니라고 본다. 실제 응답에서 역 좌표는 경로 위(0m)에서 수십 m 안이었다.
MAX_OFF_PATH_M = 150.0
# 경로를 따라 앞 정거장보다 이만큼(m) 넘게 뒤로 가면 순서가 어긋난 것으로 본다(경로 점이 성긴 곳의 오차 허용).
ORDER_TOLERANCE_M = 80.0

_M_PER_DEG = 111_320.0
_PAREN = re.compile(r"\([^)]*\)")


@dataclass(frozen=True)
class StationRecord:
    station_id: str
    name: str
    line: str
    lat: float
    lng: float


@dataclass(frozen=True)
class StopMatch:
    station_id: str
    lat: float
    lng: float
    confidence: str  # 'high' 이름 완전 일치 · 'medium' 부역명 괄호를 뺀 이름 일치
    data_source: str


def _base(name: str) -> str:
    return _PAREN.sub("", name).replace(" ", "").strip()


class SubwayStationIndex:
    def __init__(self, records: list[StationRecord], data_source: str = SEOUL_MASTER_SOURCE) -> None:
        self._data_source = data_source
        self._by_name: dict[str, list[StationRecord]] = defaultdict(list)
        self._by_base: dict[str, list[StationRecord]] = defaultdict(list)
        for record in records:
            self._by_name[record.name].append(record)
            self._by_base[_base(record.name)].append(record)

    def __len__(self) -> int:
        return sum(len(v) for v in self._by_name.values())

    def _lookup(self, line_name: str, stop_name: str) -> Optional[tuple[StationRecord, str]]:
        lines = LINE_ALIASES.get(line_name)
        if not lines:
            return None
        exact = [r for r in self._by_name.get(stop_name, []) if r.line in lines]
        if exact:
            return _unique(exact, "high")
        loose = [r for r in self._by_base.get(_base(stop_name), []) if r.line in lines]
        return _unique(loose, "medium") if loose else None

    def match_stops(self, line_name: str, stop_names: list[str], path: list[tuple[float, float]]) -> list[Optional[StopMatch]]:
        """정거장 이름 목록(승차 → 하차 순서)과 같은 길이의 결과. 매칭하지 못했거나 경로 검증에 실패한 정거장은 None.

        path 는 (lat, lng) 목록(카카오 구간 경로). 경로가 없으면 검증할 수 없으므로 모두 None 이다.
        """
        results: list[Optional[StopMatch]] = [None] * len(stop_names)
        if len(path) < 2:
            return results
        cumulative = _cumulative(path)
        last_offset = -1.0
        for i, name in enumerate(stop_names):
            found = self._lookup(line_name, name)
            if found is None:
                continue
            record, confidence = found
            off_path_m, offset_m = _project(path, cumulative, record.lat, record.lng)
            if off_path_m > MAX_OFF_PATH_M or offset_m < last_offset - ORDER_TOLERANCE_M:
                continue
            last_offset = max(last_offset, offset_m)
            results[i] = StopMatch(record.station_id, record.lat, record.lng, confidence, self._data_source)
        return results


def _unique(candidates: list[StationRecord], confidence: str) -> Optional[tuple[StationRecord, str]]:
    """후보 하나면 그대로. 여럿이어도 전부 같은 자리(SAME_STATION_M 안)면 중복 수록으로 보고 첫 행을 쓰되 신뢰도를 한 단계 낮춘다. 흩어져 있으면 모호하므로 None."""
    first = candidates[0]
    if len(candidates) == 1:
        return first, confidence
    if all(_dist((first.lat, first.lng), (r.lat, r.lng)) <= SAME_STATION_M for r in candidates[1:]):
        return first, "medium"
    return None


def _cumulative(path: list[tuple[float, float]]) -> list[float]:
    cum = [0.0]
    for i in range(1, len(path)):
        cum.append(cum[-1] + _dist(path[i - 1], path[i]))
    return cum


def _dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((b[0] - a[0]) * _M_PER_DEG, (b[1] - a[1]) * _M_PER_DEG * k)


def _project(path: list[tuple[float, float]], cum: list[float], lat: float, lng: float) -> tuple[float, float]:
    """(경로까지 수직거리 m, 경로 시작부터 투영점까지 거리 m)"""
    k = math.cos(math.radians(lat))
    px, py = lng * _M_PER_DEG * k, lat * _M_PER_DEG
    best = (math.inf, 0.0)
    for i in range(len(path) - 1):
        ax, ay = path[i][1] * _M_PER_DEG * k, path[i][0] * _M_PER_DEG
        bx, by = path[i + 1][1] * _M_PER_DEG * k, path[i + 1][0] * _M_PER_DEG
        seg = math.hypot(bx - ax, by - ay)
        if seg == 0:
            continue
        t = max(0.0, min(1.0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (seg * seg)))
        d = math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
        if d < best[0]:
            best = (d, cum[i] + t * (cum[i + 1] - cum[i]))
    return best


def _read_csv(path: Path) -> list[list[str]]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        return []
    return list(csv.reader(text.splitlines()))


def load_seoul_master(path: Path) -> SubwayStationIndex:
    """서울시 역사마스터 CSV 를 읽는다. 컬럼이 기대와 다르거나 좌표가 숫자가 아닌 행은 건너뛴다(좌표를 채우지 않는다)."""
    rows = _read_csv(path)
    records: list[StationRecord] = []
    if rows and rows[0][:5] == ["역사_ID", "역사명", "호선", "위도", "경도"]:
        for row in rows[1:]:
            try:
                lat, lng = float(row[3]), float(row[4])
            except (ValueError, IndexError):
                continue
            if not (33.0 <= lat <= 39.0 and 124.0 <= lng <= 132.0):  # 대한민국 밖 좌표(위·경도 뒤바뀜 등)는 버린다
                continue
            records.append(StationRecord(row[0], row[1], row[2], lat, lng))
    return SubwayStationIndex(records)


_load_error = False


@lru_cache()
def get_seoul_index() -> SubwayStationIndex:
    global _load_error
    _load_error = False
    path = STATION_DATA_DIR / SEOUL_MASTER_FILE
    try:
        return load_seoul_master(path) if path.exists() else SubwayStationIndex([])
    except Exception:
        _load_error = True  # 정거장 좌표는 부가 정보다. 파일을 못 읽어도(권한·폴더·깨진 파일) 대중교통 경로는 그대로 나가야 한다.
        logger.warning("정거장 좌표 파일을 읽지 못해 좌표 없이 동작합니다: %s", SEOUL_MASTER_FILE, exc_info=True)
        return SubwayStationIndex([])


def station_status() -> dict:
    """/api/health 용 상태. 키·경로 같은 민감 정보 없이 건수와 성공 여부만 알린다. 어떤 경우에도 예외를 내지 않는다."""
    try:
        records = len(get_seoul_index())
        return {"subway_records": records, "file_present": (STATION_DATA_DIR / SEOUL_MASTER_FILE).exists(), "load_error": _load_error}
    except Exception:
        return {"subway_records": 0, "file_present": False, "load_error": True}
