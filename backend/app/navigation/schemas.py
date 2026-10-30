from typing import Literal, Optional

from pydantic import BaseModel, Field


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng


class RouteOption(BaseModel):
    provider: Literal["tmap", "naver", "kakao"]
    distance_km: float
    duration_min: float
    path: list[LatLng]


# 턴바이턴 안내 한 토막. point 가 있으면 그 지점 근처에서 TTS 로 읽을 수 있다(없으면 텍스트만 표시).
class RouteInstruction(BaseModel):
    text: str
    point: Optional[LatLng] = None


class NavigationResponse(BaseModel):
    routes: list[RouteOption]


# 앞의 5개는 자동차(Tmap searchOption) 스타일, 뒤의 3개는 이동수단(도보/자전거/대중교통) 자체를 나타낸다.
RouteStyle = Literal[
    "recommended",
    "toll_free",
    "major_road",
    "shortest",
    "avoid_school_zone",
    "walking",
    "cycling",
    "transit",
]

TravelMode = Literal["walking", "cycling", "transit"]


class StyledRoute(BaseModel):
    style: RouteStyle
    distance_km: float
    duration_min: float
    path: list[LatLng]
    instructions: list[RouteInstruction] = []


class RouteStylesResponse(BaseModel):
    routes: list[StyledRoute]


class ModeRouteRequest(RouteRequest):
    mode: TravelMode


class ReverseGeocodeResponse(BaseModel):
    address: Optional[str] = None


# 대중교통만 경로가 여러 개(버스/지하철/버스+지하철 조합) 온다. 카테고리별로 골라볼 수 있게 전부 내려준다.
TransitType = Literal["BUS", "SUBWAY", "BUS_AND_SUBWAY"]
TransitStepType = Literal["WALKING", "BUS", "SUBWAY"]


class TransitVehicle(BaseModel):
    name: str
    type: Optional[str] = None


class TransitStop(BaseModel):
    name: str


# 구간 하나(도보 한 토막, 또는 버스/지하철 한 번 타는 구간). 카카오맵·네이버지도처럼 몇 호선·몇 번 버스를
# 어디서 타서 어디서 내리는지 상세 표시하는 데 쓴다.
class TransitStep(BaseModel):
    type: TransitStepType
    distance_m: int
    time_sec: int
    stops: list[TransitStop] = []
    vehicles: list[TransitVehicle] = []


class TransitRouteOption(BaseModel):
    type: TransitType
    distance_km: float
    duration_min: float
    transfers: int
    fare: int
    path: list[LatLng]
    instructions: list[str] = []
    steps: list[TransitStep] = []


class TransitRoutesResponse(BaseModel):
    total: int
    bus: int
    subway: int
    bus_and_subway: int
    routes: list[TransitRouteOption]
