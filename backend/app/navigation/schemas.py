from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    # 켜면 응답에 회전 안내 지점(guides)을 함께 준다. 기본(꺼짐)은 기존 응답과 똑같다. 길안내 화면만 켠다.
    include_guides: bool = False


# 회전·안내 지점 하나. Tmap 경로 응답의 Point 피처에서 가져온다(좌표·turnType·도로명을 그대로 보존하고 만들어내지 않는다).
# 모든 필드는 Tmap 이 준 값이다. 모르는 숫자 값은 null 이 아니라 응답에서 키가 빠지고(route-styles·route-by-mode 는 exclude_none),
# 모르는 문자열은 빈 문자열이다. 화면은 없는 값을 추측하지 않는다.
class RouteGuide(BaseModel):
    index: int = Field(description="Tmap properties.index(경로 순번). 없으면 응답 안에서 등장한 순서(0부터)")
    lat: float
    lng: float
    path_index: int = Field(description="같은 응답의 path 배열에서 이 지점 좌표의 위치. path 를 따라 진행 거리를 잴 때 쓴다")
    turn_type: Optional[int] = Field(default=None, description="Tmap turnType 코드(11 직진, 12 좌회전, 13 우회전, 14 U턴 등). 모르면 생략")
    point_type: str = Field(default="", description="Tmap pointType: S 출발, E 도착, B1~B3 경유, N 일반 안내점")
    description: str = ""
    name: str = ""
    next_road_name: str = Field(default="", description="이 지점 다음 구간의 도로 이름(Tmap nextRoadName)")
    leg_distance_m: Optional[int] = Field(default=None, description="이 지점부터 다음 안내 지점까지 거리(m). 구간 값이 하나라도 없으면 생략")
    leg_time_sec: Optional[int] = Field(default=None, description="이 지점부터 다음 안내 지점까지 시간(초). Tmap 이 구간 time 을 안 주면 생략")


class RouteOption(BaseModel):
    provider: Literal["tmap", "naver", "kakao"]
    distance_km: float
    duration_min: float
    path: list[LatLng]
    # provider 안에서 service 로 넘기는 내부 값이다. /navigation/route 응답에는 싣지 않는다(exclude).
    guides: list[RouteGuide] = Field(default_factory=list, exclude=True)


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
    # include_guides 요청일 때만 채워진다(응답에서 키 자체가 빠진다). 자전거·대중교통은 지원하지 않아 항상 빠진다.
    guides: Optional[list[RouteGuide]] = None


class RouteStylesResponse(BaseModel):
    routes: list[StyledRoute]


class ModeRouteRequest(RouteRequest):
    mode: TravelMode


# 자동차 스타일 5가지(Tmap searchOption). route-styles 가 한 번에 5번 호출하므로, 재탐색처럼 하나만 필요하면 styles 로 좁힌다.
DrivingStyle = Literal["recommended", "toll_free", "major_road", "shortest", "avoid_school_zone"]


class RouteStylesRequest(RouteRequest):
    styles: Optional[list[DrivingStyle]] = Field(
        default=None, description="받을 스타일. 생략하면 5가지 전부(기존 동작). 빈 목록은 허용하지 않는다"
    )

    @field_validator("styles")
    @classmethod
    def _non_empty_unique(cls, value):
        if value is None:
            return None
        if not value:
            raise ValueError("styles 는 비어 있을 수 없다")
        return list(dict.fromkeys(value))  # 중복 제거, 순서 유지


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
