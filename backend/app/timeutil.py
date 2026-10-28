from datetime import datetime, timedelta, timezone
from typing import Optional

# zoneinfo 는 Windows 에서 tzdata 가 따로 필요하므로 한국 표준시를 고정 오프셋으로 쓴다.
KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    return datetime.now(KST)


def parse_its_datetime(value: object) -> Optional[datetime]:
    """ITS 의 YYYYMMDDHH24MISS 문자열을 KST 시각으로 바꾼다. 형식이 다르면 None."""
    text = str(value or "").strip()
    if len(text) != 14 or not text.isdigit():
        return None
    try:
        return datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=KST)
    except ValueError:
        return None
