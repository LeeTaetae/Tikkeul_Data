import pytest

from app.adapters import (
    classify_closure,
    direction_scope,
    incident_kind,
    parse_caution_zones,
    parse_incidents,
    parse_predictions,
    parse_protection_zones,
    parse_traffic_flow,
)
from app.geo import BBox, WktError, geometry_center, wkt_to_geojson
from app.models import CautionKind, ClosureKind, DirectionScope, IncidentKind, ZoneType
from app.timeutil import parse_its_datetime
from tests.fixtures import (
    CAUTION_ITEMS,
    EVENT_ITEMS,
    FLOW_ITEMS,
    PREDICTION_ITEMS,
    WKT_COLLECTION,
    WKT_POINT,
    zone_item,
)


@pytest.mark.parametrize(
    "event_type,detail,expected",
    [
        ("교통사고", "충돌사고", IncidentKind.accident),
        ("공사", "", IncidentKind.construction),
        ("작업", "작업", IncidentKind.construction),
        ("기타돌발", "차량증가/정체", IncidentKind.congestion),  # ITS 공식 분류
        ("교통사고", "차량증가/정체", IncidentKind.congestion),
        ("기상", "", IncidentKind.weather),
        ("재난", "", IncidentKind.disaster),
        ("기타돌발", "", IncidentKind.other),
        ("처음 보는 값", "", IncidentKind.other),
    ],
)
def test_incident_kind(event_type, detail, expected):
    assert incident_kind(event_type, detail) == expected


def test_parse_incidents_normalizes_and_skips_items_without_location():
    items = parse_incidents(EVENT_ITEMS)
    assert len(items) == 3  # 좌표 없는 1건 제외
    accident = items[0]
    assert accident.kind == IncidentKind.accident
    assert (accident.location.lat, accident.location.lon) == (37.456747, 127.046344)  # coordY=위도, coordX=경도
    assert accident.started_at.isoformat() == "2026-10-28T06:11:45+09:00"
    assert accident.direction_text == "종점"  # 방위각이 아닌 원문 그대로
    assert items[2].ended_at.isoformat() == "2026-11-30T00:00:00+09:00"
    assert items[0].id == parse_incidents(EVENT_ITEMS)[0].id  # 같은 입력이면 같은 id
    assert len({i.id for i in items}) == 3


def test_parse_its_datetime():
    assert parse_its_datetime("20261028165500").hour == 16
    assert parse_its_datetime("") is None
    assert parse_its_datetime("2026-10-28") is None
    assert parse_its_datetime("20261328165500") is None  # 13월


def test_parse_caution_zones():
    zones = parse_caution_zones(CAUTION_ITEMS)
    assert [z.kind for z in zones] == [CautionKind.accident_prone, CautionKind.congestion]
    assert zones[0].notice is not None and zones[0].notice.route_name == "경부선"
    assert zones[1].notice is None  # 안내 위치 좌표가 비어 있으면 notice 없음
    assert zones[1].id == "20261028070000000001"
    assert zones[0].id and zones[0].priority == 1
    assert parse_caution_zones([{**CAUTION_ITEMS[0], "outbrkType": "처음 보는 값"}])[0].kind == CautionKind.other


def test_parse_flow_and_predictions():
    flow = parse_traffic_flow(FLOW_ITEMS)
    assert flow[0].speed_kmh == 14.0 and flow[0].observed_at.hour == 16
    assert flow[1].speed_kmh is None  # 빈 값은 None
    pred = parse_predictions(PREDICTION_ITEMS)
    assert [p.section_type for p in pred] == ["detour", "main"]
    assert pred[0].speed_kmh == 35.2


def test_parse_protection_zones():
    zone = parse_protection_zones([zone_item()])[0]
    assert zone.id == "111101011430"  # 숫자로 온 값도 문자열로
    assert zone.zone_type == ZoneType.child and zone.assignment == "designated" and zone.in_use is True
    assert zone.std_code == "11110146"  # 끝 공백 제거
    assert zone.registered_on == "20100101"
    assert parse_protection_zones([zone_item(fcltTypeCd="2")])[0].zone_type == ZoneType.senior
    assert parse_protection_zones([zone_item(fcltTypeCd="9")])[0].zone_type == ZoneType.unknown


def test_protection_zone_tm_coordinates_become_wgs84():
    zone = parse_protection_zones([zone_item()])[0]
    # 재동초등학교 부근(서울 종로구): 위도 37.58, 경도 126.985 근처여야 한다(EPSG:5181 검증값)
    assert zone.center is not None
    assert abs(zone.center.lat - 37.5789) < 0.002 and abs(zone.center.lon - 126.9852) < 0.002
    assert zone.geometry["type"] == "MultiPoint"
    lon, lat = zone.geometry["coordinates"][0]
    assert 124 < lon < 132 and 33 < lat < 39  # TM 미터 값이 그대로 나오면 안 된다


def test_geometry_collection_center_prefers_point():
    zone = parse_protection_zones([zone_item(fturGeomVl=WKT_COLLECTION)])[0]
    assert zone.geometry["type"] == "GeometryCollection"
    assert [g["type"] for g in zone.geometry["geometries"]] == ["Polygon", "Point"]
    assert zone.center is not None


def test_polygon_only_center_is_ring_average():
    geo = wkt_to_geojson("POLYGON((198671.4 453509.8,198668.2 453322.3,198640.7 453315.6,198671.4 453509.8))")
    lat, lon = geometry_center(geo)
    assert 37.57 < lat < 37.59 and 126.98 < lon < 126.99


@pytest.mark.parametrize("wkt", ["MULTIPOINT(198745.9 453404.9, 198750.0 453410.0)", "POINT(198745.9 453404.9)", "LINESTRING(198745.9 453404.9, 198750.0 453410.0)"])
def test_wkt_variants_parse(wkt):
    assert wkt_to_geojson(wkt)["type"] in ("MultiPoint", "Point", "LineString")


@pytest.mark.parametrize("wkt", ["", "NOTWKT(1 2)", "POINT(1)", "POLYGON((1 2,3 4", "CIRCULARSTRING(1 2,3 4,5 6)"])
def test_invalid_wkt_raises(wkt):
    with pytest.raises(WktError):
        wkt_to_geojson(wkt)


def test_bad_geometry_keeps_zone_without_location():
    zone = parse_protection_zones([zone_item(fturGeomVl="이건 WKT 가 아니다")])[0]
    assert zone.geometry is None and zone.center is None and zone.name


def test_bbox_snapping_widens_to_grid_and_filters_precisely():
    box = BBox(126.905, 127.034, 37.461, 37.5)
    snapped = box.snapped()
    assert (snapped.min_lon, snapped.max_lon, snapped.min_lat, snapped.max_lat) == (126.90, 127.04, 37.46, 37.50)
    assert snapped.contains(37.4605, 126.9051) and not box.contains(37.4605, 126.9051)


# --- 돌발정보 추가 필드: 통제 정도·방향 범위·안정 키 (추가 전용) ------------------------------
@pytest.mark.parametrize(
    "block_type,lanes_blocked,expected",
    [
        ("차로부분통제", "2차로 차단", ClosureKind.partial),  # 관측한 실제 값
        ("차로전면통제", "", ClosureKind.full),  # '전면' 문자열 패턴(ITS 명세로는 확인하지 못했다)
        ("", "", ClosureKind.none),
        ("   ", "", ClosureKind.none),
        ("", "1차로 차단", ClosureKind.unknown),  # 차단 문구만 있고 유형이 없으면 만들어내지 않는다
        ("기타통제", "", ClosureKind.unknown),  # 모르는 값은 부분/전면으로 추측하지 않는다
    ],
)
def test_classify_closure(block_type, lanes_blocked, expected):
    assert classify_closure(block_type, lanes_blocked) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("양방향", DirectionScope.both),
        ("기점", DirectionScope.single),
        ("종점", DirectionScope.single),
        ("", DirectionScope.unknown),
        ("상행", DirectionScope.unknown),
    ],
)
def test_direction_scope(text, expected):
    assert direction_scope(text) == expected


def test_parse_incidents_keeps_closure_direction_and_raw_fields():
    accident, congestion, construction = parse_incidents(EVENT_ITEMS)
    assert (accident.lanes_block_type, accident.closure) == ("차로부분통제", ClosureKind.partial)
    assert accident.lanes_blocked == "2차로 차단" and accident.direction_text == "종점"  # 원문은 그대로
    assert accident.direction_scope == DirectionScope.single
    assert (congestion.closure, congestion.direction_scope) == (ClosureKind.none, DirectionScope.unknown)
    assert (construction.closure, construction.direction_scope) == (ClosureKind.none, DirectionScope.both)
    assert construction.ended_at is not None


def test_incident_event_key_is_stable_when_only_the_message_changes():
    original = parse_incidents([EVENT_ITEMS[0]])[0]
    reworded = parse_incidents([{**EVENT_ITEMS[0], "message": "추돌 사고 (정리 중)"}])[0]
    assert reworded.id != original.id  # 기존 id 는 문구까지 해시한다(호환을 위해 그대로 둔다)
    assert reworded.event_key == original.event_key  # 같은 사건은 같은 키
    assert reworded.revision != original.revision  # 내용이 바뀐 것은 revision 으로 알 수 있다


@pytest.mark.parametrize(
    "change",
    [{"coordX": "127.046400"}, {"coordY": "37.456800"}, {"startDate": "20261028061146"}, {"linkId": "1210000712"}, {"eventType": "공사"}],
)
def test_incident_event_key_separates_different_events(change):
    original = parse_incidents([EVENT_ITEMS[0]])[0]
    other = parse_incidents([{**EVENT_ITEMS[0], **change}])[0]
    assert other.event_key != original.event_key


def test_incident_revision_changes_with_closure_or_end_time():
    original = parse_incidents([EVENT_ITEMS[0]])[0]
    for change in ({"lanesBlocked": "1차로 차단"}, {"lanesBlockType": "차로전면통제"}, {"endDate": "20261028120000"}):
        assert parse_incidents([{**EVENT_ITEMS[0], **change}])[0].revision != original.revision
    assert parse_incidents([EVENT_ITEMS[0]])[0].revision == original.revision  # 같은 입력은 같은 값
