"""좌표 -> 격자 -> 초단기실황. 격자(5km)와 10분 슬롯 단위로 캐시하고, 실패하면 마지막 성공 결과를 stale 로 내준다.

개인정보: 기상청에는 좌표가 아니라 격자 번호만 보내고, 캐시 키도 격자다. 좌표는 로그에 남기지 않는다.
"""
import asyncio
import time
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

import httpx

from app.cache import TtlCache
from app.config import Settings
from app.errors import api_error
from app.models import DataKind, Meta
from app.timeutil import now_kst
from app.upstream import Upstream
from app.weather.kma import base_time_candidates, parse_nowcast, to_grid
from app.weather.models import RoadWeather
from app.weather.forecast import issue_time, parse_forecast, quantity
from app.errors import ApiError

SOURCE = "kma_ultra_srt_ncst"


class WeatherService:
    def __init__(self, upstream: Upstream, settings: Settings, cache: Optional[TtlCache] = None, clock=now_kst):
        self._up = upstream
        self._settings = settings
        self._cache = cache or TtlCache()
        self._clock = clock
        self._call_lock = None  # Python 3.9: create the lock inside a running event loop.
        self._last_call = 0.0

    async def _pace(self):
        if self._call_lock is None:
            self._call_lock = asyncio.Lock()
        async with self._call_lock:
            await asyncio.sleep(max(0, self._settings.kma_min_interval_s - (time.monotonic()-self._last_call)))
            self._last_call = time.monotonic()

    async def safety_weather(self, lat: float, lon: float):
        nx, ny = to_grid(lat, lon)

        async def component(kind):
            async def fetch():
                try:
                    await self._pace()
                    now = self._clock()
                    if kind == "nowcast":
                        date, hour = base_time_candidates(now, tries=1)[0]
                        raw = await self._up.kma_nowcast(date, hour, nx, ny)
                        parsed = parse_nowcast(raw)
                        if parsed is None:
                            raise api_error("WEATHER_UNAVAILABLE")
                        rows = raw["response"].get("body",{}).get("items",{})
                        rows = rows.get("item",[]) if isinstance(rows,dict) else rows
                        rows = [rows] if isinstance(rows,dict) else rows
                        rain = next((r.get("obsrValue") for r in rows if isinstance(r,dict) and r.get("category")=="RN1"),None)
                        parsed["rain"] = quantity(rain,"mm/h")
                        # Keep interval-valued reports as intervals in the new endpoint.
                        parsed["rain_mm_1h"] = parsed["rain"]["lower"] if parsed["rain"]["category"] in {"none","exact"} else None
                    else:
                        date, hour = issue_time(now, kind)
                        parsed = parse_forecast(await self._up.kma_weather(kind, date, hour, nx, ny),kind)
                        if not parsed:
                            raise api_error("WEATHER_UNAVAILABLE")
                    return {"data": parsed, "error_code": None}
                except ApiError as exc:
                    # Negative cache prevents retries on every GPS update/API failure.
                    return {"data": None, "error_code": exc.code}

            # Cache successes AND failures; a client cannot hammer failed endpoints.
            value, fetched, _ = await self._cache.get(("weather_safety",kind,nx,ny),
                60 if kind=="nowcast" else 300,0,fetch)
            now = self._clock()
            data = value["data"]
            stamp = data.get("observed_at") if kind=="nowcast" and data else (data[0]["issued_at"] if data else None)
            age = (now-datetime.fromisoformat(stamp)).total_seconds() if stamp else None
            stale = age is not None and (age < -600 or age > (3600 if kind=="nowcast" else 10800 if kind=="ultra" else 21600))
            if kind != "nowcast" and data:
                data = [p for p in data if 0 <= (datetime.fromisoformat(p["valid_at"])-now).total_seconds() <= 6*3600]
                stale = stale or not data
            return {"status": "unavailable" if value["error_code"] else "stale" if stale else "available",
                    "data": data, "error_code":value["error_code"],"fetched_at":fetched.isoformat(),
                    "data_kind":"observation" if kind=="nowcast" else "forecast"}

        observation, ultra, village = await asyncio.gather(*(component(k) for k in ("nowcast","ultra","village")))
        return {"grid":{"nx":nx,"ny":ny},"observation":observation,"ultra_forecast":ultra,"village_forecast":village,
                "road_surface_observed":False}

    async def road_weather(self, lat: float, lon: float) -> RoadWeather:
        nx, ny = to_grid(lat, lon)

        async def fetch() -> Dict[str, Any]:
            now = self._clock()
            for base_date, base_time in base_time_candidates(now):
                await self._pace()
                data = await self._up.kma_nowcast(base_date, base_time, nx, ny)
                parsed = parse_nowcast(data)
                if parsed is not None:
                    return parsed
            raise api_error("WEATHER_UNAVAILABLE")  # 최근 40분 안에 자료가 없다

        value, fetched_at, stale = await self._cache.get(
            ("kma_ncst", nx, ny), self._settings.ttl_weather_s, self._settings.max_stale_s, fetch
        )
        observed_at: Optional[datetime] = datetime.fromisoformat(value["observed_at"])
        return RoadWeather(
            **value,
            grid={"nx": nx, "ny": ny},
            meta=Meta(source=SOURCE, data_kind=DataKind.realtime, updated_at=observed_at, fetched_at=fetched_at, stale=stale),
        )
