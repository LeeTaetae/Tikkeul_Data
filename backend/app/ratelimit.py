"""공공 API 호출 보호. 업스트림별로 호출 속도·동시 호출 수를 제한하고, 실패나 한도 초과 뒤에는 쿨다운 동안 외부를 부르지 않는다."""
import asyncio
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator, Callable, Dict, List, Optional, Tuple

from app.errors import api_error


class UpstreamGuard:
    """업스트림 이름("its", "protection", "kakao")마다 독립된 토큰 버킷·동시 호출 슬롯·쿨다운을 가진다.

    호출 속도는 분당 한도(rate_per_min)를 한도만큼의 버스트까지 허용하는 토큰 버킷으로 지킨다.
    한도나 쿨다운에 걸리면 외부를 부르지 않고 ApiError 를 낸다. 캐시가 이 오류를 받으면 마지막 성공 결과(stale)로 대신 답한다.
    """

    def __init__(self, rate_per_min: Dict[str, int], max_concurrent: int, clock: Callable[[], float] = time.monotonic):
        self._rate = rate_per_min
        self._max_concurrent = max_concurrent
        self._clock = clock
        self._buckets: Dict[str, List[float]] = {}  # name -> [남은 토큰, 마지막 보충 시각]
        self._cooldowns: Dict[str, Tuple[float, str]] = {}  # name -> (쿨다운 끝 시각, 그동안 내줄 오류 코드)
        self._slots: Dict[str, asyncio.Semaphore] = {}

    def check(self, name: str) -> None:
        """외부 호출 직전에 부른다. 쿨다운 중이거나 토큰이 없으면 호출하지 말아야 하므로 ApiError 를 낸다. 통과하면 토큰 하나를 쓴다."""
        now = self._clock()
        cooldown = self._cooldowns.get(name)
        if cooldown:
            if now < cooldown[0]:
                raise api_error(cooldown[1])
            del self._cooldowns[name]

        capacity = float(self._rate[name])
        bucket = self._buckets.setdefault(name, [capacity, now])
        bucket[0] = min(capacity, bucket[0] + (now - bucket[1]) * capacity / 60.0)
        bucket[1] = now
        if bucket[0] < 1.0:
            raise api_error("UPSTREAM_RATE_LIMIT")
        bucket[0] -= 1.0

    def cool_down(self, name: str, seconds: float, code: str) -> None:
        """seconds 동안 name 업스트림을 부르지 않고 code 오류를 낸다. 이미 더 긴 쿨다운이 있으면 줄이지 않는다."""
        until = self._clock() + seconds
        current = self._cooldowns.get(name)
        if current is None or until > current[0]:
            self._cooldowns[name] = (until, code)

    @asynccontextmanager
    async def slot(self, name: str) -> AsyncIterator[None]:
        """동시에 진행 중인 외부 호출 수를 max_concurrent 로 제한한다."""
        semaphore = self._slots.get(name)
        if semaphore is None:
            semaphore = self._slots[name] = asyncio.Semaphore(self._max_concurrent)  # 실행 중인 이벤트 루프에서 만든다
        async with semaphore:
            yield


def retry_after_seconds(value: Optional[str]) -> Optional[float]:
    """Retry-After 헤더의 초 단위 값. 날짜 형식이나 잘못된 값은 None."""
    try:
        seconds = float((value or "").strip())
    except ValueError:
        return None
    return seconds if seconds >= 0 else None

