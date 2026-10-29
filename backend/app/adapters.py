"""공공 API 원본 항목을 정규화 모델로 바꾸는 API별 어댑터. 네트워크 호출은 하지 않는 순수 함수다."""
import hashlib
from typing import Any, Dict, List, Optional

from app.errors import api_error
from app.geo import WktError, geometry_center, wkt_to_geojson
from app.models import (
    CautionKind,
    CautionPoint,
    CautionZone,
    GeoPoint,
    Incident,
    IncidentKind,
    PredictionItem,
    ProtectionZone,
    Region,
    TrafficFlowItem,
    ZoneType,
)
from app.timeutil import parse_its_datetime

Raw = Dict[str, Any]


def _s(raw: Raw, key: str) -> str:
    return str(raw.get(key) if raw.get(key) is not None else "").strip()


def _float(value: Any) -> Optional[float]:
    text = str(value if value is not None else "").strip()
    try:
        return float(text) if text else None
    except ValueError:
        return None


def _point(lat: Any, lon: Any) -> Optional[GeoPoint]:
    la, lo = _float(lat), _float(lon)
    if la is None or lo is None or not (-90 <= la <= 90 and -180 <= lo <= 180):
        return None
    return GeoPoint(lat=la, lon=lo)


def _digest(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


# --- 돌발상황 -------------------------------------------------------------
def incident_kind(event_type: str, detail: str) -> IncidentKind:
    # '차량증가/정체'는 ITS 돌발정보가 직접 붙인 분류다. 속도 기준으로 우리가 판정하지 않는다.
    if detail == "차량증가/정체":
        return IncidentKind.congestion
    if event_type == "교통사고":
        return IncidentKind.accident
    if event_type in ("공사", "작업"):  # '작업'은 공식 샘플에만 보였지만 같은 뜻으로 본다
        return IncidentKind.construction
    if event_type == "기상":
        return IncidentKind.weather
    if event_type == "재난":
        return IncidentKind.disaster
    return IncidentKind.other


def parse_incidents(items: List[Raw]) -> List[Incident]:
    result = []
    for raw in items:
        location = _point(raw.get("coordY"), raw.get("coordX"))
        if location is None:
            continue  # 위치를 알 수 없는 항목은 지도·경고에 쓸 수 없다
        event_type, detail = _s(raw, "eventType"), _s(raw, "eventDetailType")
        result.append(
            Incident(
                id=_digest(_s(raw, "startDate"), _s(raw, "coordX"), _s(raw, "coordY"), _s(raw, "linkId"), event_type, _s(raw, "message")),
                kind=incident_kind(event_type, detail),
                road_type=_s(raw, "type"),
                event_type=event_type,
                event_detail_type=detail,
                road_name=_s(raw, "roadName"),
                road_no=_s(raw, "roadNo"),
                direction_text=_s(raw, "roadDrcType"),
                lanes_blocked=_s(raw, "lanesBlocked"),
                message=_s(raw, "message"),
                link_id=_s(raw, "linkId"),
                location=location,
                started_at=parse_its_datetime(raw.get("startDate")),
                ended_at=parse_its_datetime(raw.get("endDate")),
            )
        )
    return result


# --- 주의운전구간 ---------------------------------------------------------
_CAUTION_KIND = {
    "사고잦은구간": CautionKind.accident_prone,
    "차량증가/정체": CautionKind.congestion,
    "차로차단": CautionKind.lane_blocked,
    "터널역광": CautionKind.tunnel_glare,
    "작업": CautionKind.work,
    "졸음쉼터": CautionKind.rest_area,
}


def parse_caution_zones(items: List[Raw]) -> List[CautionZone]:
    result = []
    for raw in items:
        start_loc = _point(raw.get("startY"), raw.get("startX"))
        if start_loc is None:
            continue
        notice_loc = _point(raw.get("revY"), raw.get("revX"))
        outbrk = _s(raw, "outbrkType")
        priority = _float(raw.get("priority"))
        result.append(
            CautionZone(
                id=_s(raw, "occrrncId") or _digest(outbrk, _s(raw, "message"), _s(raw, "startStdLinkId"), _s(raw, "revStdLinkId")),
                kind=_CAUTION_KIND.get(outbrk, CautionKind.other),
                outbrk_type=outbrk,
                message=_s(raw, "message"),
                priority=int(priority) if priority is not None else None,
                step_type=_s(raw, "stepType"),
                start=CautionPoint(
                    location=start_loc,
                    link_id=_s(raw, "startStdLinkId"),
                    route_no=_s(raw, "routeNo"),
                    route_name=_s(raw, "routeName"),
                    direction_text=_s(raw, "roadDrcType"),
                ),
                notice=CautionPoint(
                    location=notice_loc,
                    link_id=_s(raw, "revStdLinkId"),
                    route_no=_s(raw, "revRouteNo"),
                    route_name=_s(raw, "revRouteName"),
                    direction_text=_s(raw, "revRoadDrcType"),
                )
                if notice_loc
                else None,
            )
        )
    return result


# --- 보호구역 -------------------------------------------------------------
_ZONE_TYPE = {"1": ZoneType.child, "2": ZoneType.senior, "3": ZoneType.disabled}
_ASSIGNMENT = {"1": "priority", "2": "designated"}


def parse_protection_zones(items: List[Raw]) -> List[ProtectionZone]:
    result = []
    for raw in items:
        geometry: Optional[Dict[str, Any]] = None
        center: Optional[GeoPoint] = None
        wkt = _s(raw, "fturGeomVl")
        if wkt:
            try:
                geometry = wkt_to_geojson(wkt)
                c = geometry_center(geometry)
                center = GeoPoint(lat=c[0], lon=c[1]) if c else None
            except WktError:
                geometry = None  # 형상을 못 읽어도 시설 정보는 남긴다. 위치가 없는 구역은 근접 경고에 쓰이지 않는다.
        result.append(
            ProtectionZone(
                id=_s(raw, "ptznMngNo"),
                name=_s(raw, "trgtFcltNm"),
                zone_type=_ZONE_TYPE.get(_s(raw, "fcltTypeCd"), ZoneType.unknown),
                facility_detail_code=_s(raw, "fcltDtlTypeCd"),
                parent_id=_s(raw, "rprsPtznMngNo"),
                in_use=_s(raw, "useYn").upper() == "Y",
                sgg_code=_s(raw, "sggCd"),
                emdong_code=_s(raw, "emdongCd"),
                std_code=_s(raw, "stdgCd"),
                assignment=_ASSIGNMENT.get(_s(raw, "assignType"), "unknown"),
                road_address=_s(raw, "roadNmAddr"),
                road_address_detail=_s(raw, "roadNmDaddr"),
                lot_address=_s(raw, "lotnoAddr"),
                lot_address_detail=_s(raw, "lotnoDaddr"),
                registered_on=_s(raw, "frstRegDt") or None,
                center=center,
                geometry=geometry,
            )
        )
    return result


# --- 지역(좌표 -> 시군구) ---------------------------------------------------
def parse_region(documents: List[Raw]) -> Optional[Region]:
    """Kakao coord2regioncode 의 documents 에서 법정동(region_type 'B')을 골라 시군구코드를 만든다.

    법정동코드는 시도 2 + 시군구 3 + 읍면동 3 + 리 2 = 10자리이고 앞 5자리가 시군구코드다.
    경찰청 보호구역 API 의 sggCd 가 현행 코드(강원 51, 전북 52, 대구 군위 27720, 일반구는 구 코드)를 쓰는 것은
    실제 호출로 확인했다. 행정동('H')은 코드 체계가 달라 쓰지 않는다.
    """
    for doc in documents:
        if _s(doc, "region_type") != "B":
            continue
        code = _s(doc, "code")
        if len(code) != 10 or not code.isdigit():
            raise api_error("UPSTREAM_BAD_RESPONSE")  # 코드 형식이 예상과 다르면 추측하지 않고 실패로 본다
        return Region(
            sgg_cd=code[:5],
            sido_name=_s(doc, "region_1depth_name"),
            sgg_name=_s(doc, "region_2depth_name"),
            emd_name=_s(doc, "region_3depth_name"),
            source="Kakao Local coord2regioncode",
        )
    return None


# --- 교통소통 -------------------------------------------------------------
def parse_traffic_flow(items: List[Raw]) -> List[TrafficFlowItem]:
    return [
        TrafficFlowItem(
            link_id=_s(raw, "linkId"),
            road_name=_s(raw, "roadName"),
            speed_kmh=_float(raw.get("speed")),
            travel_time_s=_float(raw.get("travelTime")),
            start_node_id=_s(raw, "startNodeId"),
            end_node_id=_s(raw, "endNodeId"),
            observed_at=parse_its_datetime(raw.get("createdDate")),
        )
        for raw in items
    ]


# --- 교통예측 -------------------------------------------------------------
_SECTION_TYPE = {"M": "main", "D": "detour"}


def parse_predictions(items: List[Raw]) -> List[PredictionItem]:
    return [
        PredictionItem(
            link_id=_s(raw, "linkId"),
            section_id=_s(raw, "sectionId"),
            section_type=_SECTION_TYPE.get(_s(raw, "sectionType"), "unknown"),
            detour_id=_s(raw, "detourId"),
            length=_float(raw.get("length")),
            speed_kmh=_float(raw.get("speed")),
        )
        for raw in items
    ]
