from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlmodel import Field, Index, SQLModel, text


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FavoriteKind(str, Enum):
    home = "home"
    work = "work"
    custom = "custom"


class FavoritePlace(SQLModel, table=True):
    # custom 은 여러 개 허용, home/work 는 사용자당 하나뿐 - 사전 SELECT 검사의 레이스 컨디션을 막는 안전망.
    __table_args__ = (Index("ix_favorite_home_work_unique", "user_id", "kind", unique=True, sqlite_where=text("kind != 'custom'")),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    kind: FavoriteKind
    label: str = Field(max_length=200)
    lat: float
    lon: float
    address_text: str = Field(default="", max_length=500)
    category: Optional[str] = Field(default=None, max_length=100)
    created_at: datetime = Field(default_factory=_utcnow)


class FavoritePlaceCreate(SQLModel):
    kind: FavoriteKind
    label: str = Field(max_length=200)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    address_text: str = Field(default="", max_length=500)
    category: Optional[str] = Field(default=None, max_length=100)


class FavoritePlaceUpdate(SQLModel):
    kind: Optional[FavoriteKind] = None
    label: Optional[str] = Field(default=None, max_length=200)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)
    address_text: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default=None, max_length=100)


class FavoritePlacePublic(SQLModel):
    id: int
    kind: FavoriteKind
    label: str
    lat: float
    lon: float
    address_text: str
    category: Optional[str] = None
