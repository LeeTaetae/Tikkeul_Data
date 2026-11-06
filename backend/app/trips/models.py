from datetime import datetime, timezone
from typing import Optional

from pydantic import field_validator
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Trip(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    origin_lat: float
    origin_lon: float
    origin_cell: str = Field(index=True)
    destination_lat: float
    destination_lon: float
    destination_cell: str = Field(index=True)
    destination_label: str = Field(max_length=200)
    destination_address_text: str = Field(default="", max_length=500)
    started_at: datetime = Field(default_factory=_utcnow, index=True)


class TripPoint(SQLModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class TripDestinationPoint(TripPoint):
    label: str = Field(max_length=200)
    address_text: str = Field(default="", max_length=500)

    @field_validator("label")
    @classmethod
    def _label_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("목적지 이름이 비어 있습니다.")
        return v


class TripCreate(SQLModel):
    origin: TripPoint
    destination: TripDestinationPoint


class TripCreated(SQLModel):
    id: int


class RecentDestination(SQLModel):
    label: str
    lat: float
    lon: float
    address_text: str
    last_used_at: datetime


class FrequentDestination(SQLModel):
    label: str
    lat: float
    lon: float
    address_text: str
    visit_count: int
    last_used_at: datetime
