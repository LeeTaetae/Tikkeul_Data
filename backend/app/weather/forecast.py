"""KMA forecast issue/valid times and interval quantities. Forecasts are not observations.

Official service: https://www.data.go.kr/data/15084084/openapi.do
RN1/PCP: mm/hour; SNO: cm/hour of NEW snowfall, not observed road snow cover.
"""
import math
import re
from datetime import datetime, timedelta

from app.errors import api_error
from app.timeutil import KST
from app.weather.kma import PTY_NOWCAST


def quantity(value, unit):
    text = str(value).strip() if value is not None else ""
    out = {"raw": text, "unit": unit, "lower": None, "upper": None, "category": "missing"}
    if text in ("강수없음", "적설없음"):
        return {**out, "lower": 0.0, "upper": 0.0, "category": "none"}
    clean = text.replace("mm", "").replace("cm", "").strip()
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:~|～|-)\s*(\d+(?:\.\d+)?)", clean)
    if match:
        lo, hi = map(float, match.groups())
        return {**out, "lower": lo, "upper": hi, "category": "range"} if 0 <= lo <= hi < 900 else out
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(미만|이상)?", clean)
    if not match:
        return out
    v, bound = float(match[1]), match[2]
    if not math.isfinite(v) or v >= 900:
        return out
    return {**out, "lower": 0.0 if bound == "미만" else v,
            "upper": None if bound == "이상" else v,
            "category": "less_than" if bound == "미만" else "at_least" if bound else "exact"}


def issue_time(now, kind):
    now = now.astimezone(KST)
    if kind == "ultra":
        t = (now - timedelta(minutes=45)).replace(minute=30, second=0, microsecond=0)
    else:
        # Conservative publication delay; no forecast from an unissued cycle.
        limit = now - timedelta(minutes=15)
        t = limit.replace(hour=2 + ((limit.hour - 2) // 3) * 3, minute=0, second=0, microsecond=0) if limit.hour >= 2 else (limit-timedelta(days=1)).replace(hour=23, minute=0, second=0, microsecond=0)
    return t.strftime("%Y%m%d"), t.strftime("%H%M")


def parse_forecast(data, kind):
    response = data.get("response", {}) if isinstance(data, dict) else {}
    if not isinstance(response,dict):
        raise api_error("UPSTREAM_BAD_RESPONSE")
    header = response.get("header", {})
    if not isinstance(header,dict):
        raise api_error("UPSTREAM_BAD_RESPONSE")
    code = str(header.get("resultCode", ""))
    if code == "03":
        return []
    if code not in ("0", "00"):
        raise api_error("UPSTREAM_AUTH" if code in {"20","21","30","31","32","33"} else "UPSTREAM_RATE_LIMIT" if code == "22" else "UPSTREAM_BAD_RESPONSE")
    body = response.get("body", {})
    if not isinstance(body,dict):
        raise api_error("UPSTREAM_BAD_RESPONSE")
    raw = body.get("items", {})
    raw = raw.get("item", []) if isinstance(raw, dict) else raw
    raw = [raw] if isinstance(raw, dict) else raw
    if not isinstance(raw, list):
        raise api_error("UPSTREAM_BAD_RESPONSE")
    grouped = {}
    for row in raw:
        if not isinstance(row, dict) or row.get("category") not in {"PTY","RN1","PCP","SNO","T1H","TMP"}:
            continue
        try:
            valid = datetime.strptime(str(row["fcstDate"])+str(row["fcstTime"]), "%Y%m%d%H%M").replace(tzinfo=KST).isoformat()
            issued = datetime.strptime(str(row["baseDate"])+str(row["baseTime"]), "%Y%m%d%H%M").replace(tzinfo=KST).isoformat()
        except (ValueError, KeyError):
            raise api_error("UPSTREAM_BAD_RESPONSE") from None
        key = (issued, valid)
        point = grouped.setdefault(key, {"issued_at": issued, "valid_at": valid, "kind": "forecast", "pty": "unknown", "temp_c": None,
            "rain": quantity(None,"mm/h"), "snow": quantity(None,"cm/h"), "missing": []})
        cat, value = row["category"], row.get("fcstValue")
        if cat in {"RN1","PCP","SNO"}:
            point["snow" if cat=="SNO" else "rain"] = quantity(value,"cm/h" if cat=="SNO" else "mm/h")
        elif cat == "PTY":
            try:
                code = int(str(value))
                point["pty"] = PTY_NOWCAST.get(code,"unknown") if kind=="ultra" or code in {0,1,2,3,4} else "unknown"
            except (ValueError, TypeError):
                pass
        else:
            try:
                v = float(value)
                point["temp_c"] = v if math.isfinite(v) and -80 <= v <= 60 else None
            except (TypeError, ValueError):
                pass
    for point in grouped.values():
        point["missing"] = [k for k in ("pty","temp_c","rain","snow") if point[k] is None or point[k]=="unknown" or (isinstance(point[k],dict) and point[k]["category"]=="missing")]
    return sorted(grouped.values(), key=lambda p:p["valid_at"])
