from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from app.models import Meta


class RoadWeather(BaseModel):
    """기상청 초단기실황 **관측값**. 노면 결빙 정보가 아니다 - 앱은 이 값으로 "미끄러울 수 있음"까지만 말한다."""

    observed_at: str = Field(description="기상청 발표 기준 시각(ISO 8601, +09:00)")
    temp_c: Optional[float] = Field(None, description="기온 T1H(℃). 결측이면 null")
    rain_mm_1h: Optional[float] = Field(None, description="1시간 강수량 RN1(mm). 결측이면 null")
    pty: str = Field(description="강수형태: none|rain|rain_snow|snow|shower|drizzle|drizzle_snow|snow_flurry|unknown")
    humidity_pct: Optional[float] = Field(None, description="습도 REH(%). 결측이면 null")
    missing: List[str] = Field(default_factory=list, description="결측으로 확인된 항목(T1H, RN1, PTY, REH)")
    grid: Dict[str, int] = Field(description="조회에 쓴 기상청 격자 nx, ny. 좌표 대신 이 값만 업스트림에 간다")
    meta: Meta
