"""인증메일 재전송 쿨다운·가입 인증번호 시도 제한. DB(SQLite)에 저장해 여러 워커·재시작 간에도 카운트를 공유한다."""
import time
from typing import Callable, Hashable, Optional

from sqlmodel import Field, Session, SQLModel, UniqueConstraint, select

DEFAULT_COOLDOWN_S = 60.0


class RateLimitState(SQLModel, table=True):
    __tablename__ = "rate_limit_state"
    __table_args__ = (UniqueConstraint("bucket", "key"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    bucket: str = Field(index=True)
    key: str = Field(index=True)
    count: int = 0
    first_at: float = 0.0
    last_at: float = 0.0


class ResendCooldown:
    def __init__(self, engine, bucket: str, cooldown_s: float = DEFAULT_COOLDOWN_S, clock: Callable[[], float] = time.monotonic):
        self._engine = engine
        self._bucket = bucket
        self._cooldown_s = cooldown_s
        self._clock = clock

    def try_mark(self, key: Hashable) -> bool:
        """쿨다운이 끝났으면 True 를 돌려주고 시각을 기록한다. 아직 쿨다운 중이면 False(시각은 안 바뀐다)."""
        key = str(key)
        now = self._clock()
        with Session(self._engine) as session:
            row = session.exec(select(RateLimitState).where(RateLimitState.bucket == self._bucket, RateLimitState.key == key)).first()
            if row is not None and now - row.last_at < self._cooldown_s:
                return False
            if row is None:
                row = RateLimitState(bucket=self._bucket, key=key)
            row.last_at = now
            session.add(row)
            session.commit()
            return True


class AttemptLimiter:
    """키(이메일 등)별로 일정 시간 안의 시도 횟수를 센다. 가입 인증번호를 무작정 틀려보는 걸 막는 용도."""

    def __init__(self, engine, bucket: str, max_attempts: int = 5, window_s: float = 600.0, clock: Callable[[], float] = time.monotonic):
        self._engine = engine
        self._bucket = bucket
        self._max_attempts = max_attempts
        self._window_s = window_s
        self._clock = clock

    def try_attempt(self, key: Hashable) -> bool:
        """이번 시도를 허용하면 True(카운트 올림). 한도를 넘었으면 False."""
        key = str(key)
        now = self._clock()
        with Session(self._engine) as session:
            row = session.exec(select(RateLimitState).where(RateLimitState.bucket == self._bucket, RateLimitState.key == key)).first()
            if row is None:
                row = RateLimitState(bucket=self._bucket, key=key, count=0, first_at=now)
            elif now - row.first_at > self._window_s:
                row.count, row.first_at = 0, now
            if row.count >= self._max_attempts:
                return False
            row.count += 1
            session.add(row)
            session.commit()
            return True

    def reset(self, key: Hashable) -> None:
        key = str(key)
        with Session(self._engine) as session:
            row = session.exec(select(RateLimitState).where(RateLimitState.bucket == self._bucket, RateLimitState.key == key)).first()
            if row is not None:
                session.delete(row)
                session.commit()
