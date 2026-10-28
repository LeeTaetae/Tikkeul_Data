import asyncio
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, Hashable, Tuple

from app.errors import ApiError
from app.timeutil import now_kst

MAX_ENTRIES = 500


@dataclass
class _Entry:
    value: Any
    at: float
    fetched_at: datetime


class TtlCache:
    """메모리 TTL 캐시. 같은 키의 동시 요청은 한 번만 업스트림을 호출하고,
    업스트림이 실패하면 max_stale_s 안의 마지막 성공 결과를 stale=True 로 대신 내준다."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._data: Dict[Hashable, _Entry] = {}
        self._locks: Dict[Hashable, asyncio.Lock] = {}

    async def get(
        self, key: Hashable, ttl_s: float, max_stale_s: float, fetch: Callable[[], Awaitable[Any]]
    ) -> Tuple[Any, datetime, bool]:
        entry = self._data.get(key)
        if entry and self._clock() - entry.at <= ttl_s:
            return entry.value, entry.fetched_at, False

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            entry = self._data.get(key)
            if entry and self._clock() - entry.at <= ttl_s:
                return entry.value, entry.fetched_at, False
            try:
                value = await fetch()
            except ApiError:
                if entry and self._clock() - entry.at <= max_stale_s:
                    return entry.value, entry.fetched_at, True
                raise
            self._data[key] = _Entry(value, self._clock(), now_kst())
            self._evict()
            return value, self._data[key].fetched_at, False

    def _evict(self) -> None:
        while len(self._data) > MAX_ENTRIES:
            oldest = min(self._data, key=lambda k: self._data[k].at)
            del self._data[oldest]
            self._locks.pop(oldest, None)
