"""프런트엔드로 전달하는 정규화 모델. 공공 API 원본 필드명·형식은 여기까지 올라오지 않는다."""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DataKind(str, Enum):
    realtime = "realtime"  # 실시간 정보
    forecast = "forecast"  # 예측 정보(실시간 아님)
    registry = "registry"  # 등록·지정 현황(자주 바뀌지 않음)


class Meta(BaseModel):
    source: str
    data_kind: DataKind
    updated_at: Optional[datetime] = Field(None, description="공공 API 가 준 기준 시각. 없으면 null")
    fetched_at: datetime = Field(description="서버가 공공 API 에서 받아온 시각")
    stale: bool = Field(False, description="공공 API 호출이 실패해 마지막 성공 결과를 대신 내준 경우 true")


class GeoPoint(BaseModel):
    lat: float
    lon: float


# --- 돌발상황 -------------------------------------------------------------
class IncidentKind(str, Enum):
    accident = "accident"
    construction = "construction"
    congestion = "congestion"  # ITS 돌발정보의 '차량증가/정체' 분류. 속도로 우리가 판정한 것이 아니다.
    weather = "weather"
    disaster = "disaster"
    other = "other"


class ClosureKind(str, Enum):
    """ITS lanesBlockType 에서 읽은 통제 정도. 확인된 값만 부분/전면으로 나누고, 모르는 값은 unknown 으로 둔다."""

    none = "none"  # 통제 유형도 차단 차로 문구도 없음
    partial = "partial"  # 값에 '부분'이 들어 있음(관측 값: 차로부분통제)
    full = "full"  # 값에 '전면'이 들어 있음. ITS 명세로 확인하지 못한 문자열 패턴이다(관측 샘플에는 없음)
    unknown = "unknown"  # 유형 값이 있지만 위 둘이 아니거나, 차단 차로 문구만 있고 유형이 없음


class DirectionScope(str, Enum):
    """ITS roadDrcType 이 방향에 대해 알려 주는 범위. 어느 쪽인지(방위)는 알 수 없다."""

    both = "both"  # 양방향: 진행 방향과 무관하게 적용
    single = "single"  # 기점/종점: 한쪽 방향만. 우리 경로가 그쪽인지는 이 값만으로 판정할 수 없다
    unknown = "unknown"  # 비어 있거나 모르는 값


class Incident(BaseModel):
    id: str
    kind: IncidentKind
    road_type: str
    event_type: str = Field(description="ITS 원문 이벤트 유형")
    event_detail_type: str
    road_name: str
    road_no: str
    direction_text: str = Field(description="ITS 원문 도로 방향. 방위각이 아닌 자유 문자열이라 진행 방향 판정에 쓸 수 없다")
    lanes_blocked: str
    message: str
    link_id: str
    location: GeoPoint
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    # --- 아래는 추가 필드(기본값이 있어 기존 소비자·캐시에 영향이 없다) ---
    lanes_block_type: str = Field("", description="ITS lanesBlockType 원문(예: 차로부분통제)")
    closure: ClosureKind = Field(ClosureKind.none, description="lanes_block_type 에서 읽은 통제 정도")
    direction_scope: DirectionScope = Field(DirectionScope.unknown, description="direction_text 가 알려 주는 방향 범위")
    event_key: str = Field(
        "", description="같은 사건을 가리키는 안정 키(시작 시각·좌표·linkId·유형). message 가 바뀌어도 그대로다. id 와 달리 문구에 영향받지 않는다"
    )
    revision: str = Field("", description="사건 내용(문구·차단 차로·통제 유형·종료 시각)이 바뀌면 달라지는 값")


class IncidentsResponse(BaseModel):
    meta: Meta
    items: List[Incident]


# --- 주의운전구간 ---------------------------------------------------------
class CautionKind(str, Enum):
    accident_prone = "accident_prone"  # 사고잦은구간
    congestion = "congestion"  # 차량증가/정체
    lane_blocked = "lane_blocked"
    tunnel_glare = "tunnel_glare"
    work = "work"
    rest_area = "rest_area"
    other = "other"


class CautionPoint(BaseModel):
    location: GeoPoint
    link_id: str
    route_no: str
    route_name: str
    direction_text: str


class CautionZone(BaseModel):
    id: str
    kind: CautionKind
    outbrk_type: str = Field(description="ITS 원문 콘텐츠 유형")
    message: str
    priority: Optional[int] = None
    step_type: str
    start: CautionPoint = Field(description="이벤트 시작 위치")
    notice: Optional[CautionPoint] = Field(None, description="안내 문구를 받는 위치")


class CautionZonesResponse(BaseModel):
    meta: Meta
    items: List[CautionZone]


# --- 보호구역 -------------------------------------------------------------
class ZoneType(str, Enum):
    child = "child"
    senior = "senior"
    disabled = "disabled"
    unknown = "unknown"


class ProtectionZone(BaseModel):
    id: str
    name: str
    zone_type: ZoneType
    facility_detail_code: str
    parent_id: str
    in_use: bool
    sgg_code: str
    emdong_code: str
    std_code: str
    assignment: str = Field(description="priority(우선지정대상) / designated(지정대상) / unknown")
    road_address: str
    road_address_detail: str
    lot_address: str
    lot_address_detail: str
    registered_on: Optional[str] = None
    center: Optional[GeoPoint] = None
    geometry: Optional[Dict[str, Any]] = Field(None, description="GeoJSON(WGS84). include_geometry=true 일 때만 포함")


class ProtectionZonesResponse(BaseModel):
    meta: Meta
    items: List[ProtectionZone]


# --- 지역(좌표 -> 시군구) ---------------------------------------------------
class Region(BaseModel):
    sgg_cd: str = Field(description="현행 법정동코드 앞 5자리. 경찰청 보호구역 API 의 sggCd 로 쓴다")
    sido_name: str
    sgg_name: str = Field(description="시군구 이름. 일반구가 있는 시는 '수원시 장안구'처럼 구까지 포함")
    emd_name: str
    source: str


# --- 교통소통 -------------------------------------------------------------
class TrafficFlowItem(BaseModel):
    link_id: str
    road_name: str
    speed_kmh: Optional[float] = None
    travel_time_s: Optional[float] = None
    start_node_id: str
    end_node_id: str
    observed_at: Optional[datetime] = None


class TrafficFlowResponse(BaseModel):
    meta: Meta
    geometry_available: bool = Field(False, description="ITS 소통정보는 링크 좌표를 주지 않는다. 표준노드링크 자료가 있어야 지도에 그릴 수 있다")
    items: List[TrafficFlowItem]


# --- 교통예측 -------------------------------------------------------------
class PredictionItem(BaseModel):
    link_id: str
    section_id: str
    section_type: str = Field(description="main(본선) / detour(우회) / unknown")
    detour_id: str
    length: Optional[float] = Field(None, description="링크 길이. 공식 문서에 단위가 없다")
    speed_kmh: Optional[float] = Field(None, description="예측 속도")


class PredictionsResponse(BaseModel):
    meta: Meta
    forecast_for: datetime = Field(description="예측 대상 시각")
    items: List[PredictionItem]
