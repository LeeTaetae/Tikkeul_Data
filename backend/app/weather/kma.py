"""기상청 단기예보 조회서비스(VilageFcstInfoService_2.0) 초단기실황(getUltraSrtNcst) 격자 변환·파서.

근거: 기상청 공식 활용가이드(2026-10-19 판)와 ai/tunnel_detection/road_hazard_poc/{grid,kma_client}.py 의 실호출 검증.
- 항목: T1H 기온 ℃, RN1 1시간 강수량 mm, REH 습도 %, PTY 강수형태 코드, WSD 풍속 m/s (그 밖의 항목은 쓰지 않는다).
- PTY 초단기 코드: 없음0 비1 비/눈2 눈3 소나기4 빗방울5 빗방울눈날림6 눈날림7.
- 결측: |값| >= 900 이면 Missing.
- 발표: 매 정시 생성, 10분 이후 제공, 10분마다 갱신. 그래서 (지금 - 10분)을 10분 단위로 내린 시각부터 조회하고, 자료가 없으면(03) 10분씩 거슬러 올라간다.
이 모듈은 Python 3.9 에서 돌아야 해서 `X | None` 문법을 쓰지 않는다.
"""
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.errors import api_error
from app.timeutil import KST

PTY_NOWCAST = {0: "none", 1: "rain", 2: "rain_snow", 3: "snow", 4: "shower", 5: "drizzle", 6: "drizzle_snow", 7: "snow_flurry"}
MISSING_ABS = 900.0
AVAILABILITY_LAG_MIN = 10
NO_DATA_CODE = "03"
_NORMAL = {"00", "0"}
# 공식 가이드 오류 코드 중 인증·한도 관련(앱 오류 코드로 옮긴다)
_AUTH_CODES = {"20", "21", "30", "31", "32", "33"}
_RATE_CODES = {"22"}

# 격자 변환: 공식 활용가이드 C 예제와 같은 상수(Lambert Conformal Conic, 5km 격자).
_RE, _GRID, _SLAT1, _SLAT2, _OLON, _OLAT, _XO, _YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136


def to_grid(lat: float, lon: float) -> Tuple[int, int]:
    d2r = math.pi / 180
    re = _RE / _GRID
    slat1, slat2, olon, olat = _SLAT1 * d2r, _SLAT2 * d2r, _OLON * d2r, _OLAT * d2r
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5))
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5) ** sn * math.cos(slat1) / sn
    ro = re * sf / math.tan(math.pi * 0.25 + olat * 0.5) ** sn
    ra = re * sf / math.tan(math.pi * 0.25 + lat * d2r * 0.5) ** sn
    theta = lon * d2r - olon
    if theta > math.pi:
        theta -= 2 * math.pi
    if theta < -math.pi:
        theta += 2 * math.pi
    theta *= sn
    return math.floor(ra * math.sin(theta) + _XO + 0.5), math.floor(ro - ra * math.cos(theta) + _YO + 0.5)


def base_time_candidates(now: datetime, tries: int = 4, lag_min: int = AVAILABILITY_LAG_MIN) -> List[Tuple[str, str]]:
    """(base_date, base_time) 후보, 최신부터."""
    cur = now.astimezone(KST).replace(second=0, microsecond=0) - timedelta(minutes=lag_min)
    cur = cur.replace(minute=(cur.minute // 10) * 10)
    out = []
    for i in range(tries):
        t = cur - timedelta(minutes=10 * i)
        out.append((t.strftime("%Y%m%d"), t.strftime("%H%M")))
    return out


def _to_float(value: Any) -> Optional[float]:
    try:
        v = float(str(value).strip())
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _parse_rn1(value: Any) -> Tuple[Optional[float], bool]:
    """(값, 결측 여부). 공식 실황은 숫자 mm 지만 '강수없음'·'1mm 미만' 같은 예보식 표기도 받아 준다."""
    text = "" if value is None else str(value).strip()
    if text == "강수없음":
        return 0.0, False
    f = _to_float(text)
    if f is not None:
        return (None, True) if abs(f) >= MISSING_ABS else (f, False)
    if "미만" in text:
        return 0.5, False
    return None, True


def parse_nowcast(data: Any) -> Optional[Dict[str, Any]]:
    """초단기실황 JSON -> 정규화 dict. 자료 없음(03)이면 None, 오류 코드면 ApiError.

    반환 키: observed_at(ISO, +09:00), temp_c, rain_mm_1h, pty, humidity_pct, missing(list[str])
    """
    response = data.get("response") if isinstance(data, dict) else None
    header = response.get("header") if isinstance(response, dict) else None
    if not isinstance(header, dict):
        raise api_error("UPSTREAM_BAD_RESPONSE")
    code = str(header.get("resultCode", "")).strip()
    if code == NO_DATA_CODE:
        return None
    if code not in _NORMAL:
        if code in _AUTH_CODES:
            raise api_error("UPSTREAM_AUTH")
        if code in _RATE_CODES:
            raise api_error("UPSTREAM_RATE_LIMIT")
        raise api_error("UPSTREAM_ERROR")
    body = response.get("body")
    items = body.get("items") if isinstance(body, dict) else None
    raw = items.get("item") if isinstance(items, dict) else items
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list) or not raw:
        return None
    first = raw[0]
    try:
        observed = datetime.strptime(str(first.get("baseDate", "")) + str(first.get("baseTime", "")), "%Y%m%d%H%M").replace(tzinfo=KST)
    except (ValueError, AttributeError):
        raise api_error("UPSTREAM_BAD_RESPONSE") from None

    out: Dict[str, Any] = {"observed_at": observed.isoformat(), "temp_c": None, "rain_mm_1h": None, "pty": "unknown", "humidity_pct": None, "missing": []}
    seen_pty = False
    for item in raw:
        if not isinstance(item, dict):
            continue
        category, value = str(item.get("category", "")).strip(), item.get("obsrValue")
        if category == "RN1":
            out["rain_mm_1h"], missing = _parse_rn1(value)
            if missing:
                out["missing"].append("RN1")
            continue
        f = _to_float(value)
        missing = f is None or abs(f) >= MISSING_ABS
        if category == "T1H":
            out["temp_c"] = None if missing else f
        elif category == "REH":
            out["humidity_pct"] = None if missing else f
        elif category == "PTY":
            seen_pty = True
            if not missing and f == int(f) and int(f) in PTY_NOWCAST:
                out["pty"] = PTY_NOWCAST[int(f)]
            else:
                missing = True  # 모르는 코드는 추측하지 않는다
        else:
            continue
        if missing:
            out["missing"].append(category)
    if not seen_pty:
        out["missing"].append("PTY")  # 응답에 강수형태가 없으면 비·눈 여부를 모른다
    return out
