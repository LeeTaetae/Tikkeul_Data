"""2026-10-28 실제 응답 구조(필드명·값 형태)를 따라 직접 만든 테스트 데이터. 실제 응답 원문이 아니다."""
from typing import Any, Dict, List

KEYS = {
    "its_traffic_api_key": "SECRET-TRAFFIC-KEY",
    "its_event_api_key": "SECRET-EVENT-KEY",
    "its_prediction_api_key": "SECRET-PRED-KEY",
    "its_caution_api_key": "SECRET-CAUTION-KEY",
    "protection_zone_service_key": "SECRET-ZONE-KEY",
    "kakao_rest_api_key": "SECRET-KAKAO-KEY",
}

EVENT_ITEMS: List[Dict[str, Any]] = [
    {"type": "고속도로", "eventType": "교통사고", "eventDetailType": "충돌사고", "startDate": "20261028061145",
     "coordX": "127.046344", "coordY": "37.456747", "linkId": "1210000711", "roadName": "경부선", "roadNo": "1",
     "roadDrcType": "종점", "lanesBlockType": "차로부분통제", "lanesBlocked": "2차로 차단", "message": "추돌 사고", "endDate": ""},
    {"type": "고속도로", "eventType": "기타돌발", "eventDetailType": "차량증가/정체", "startDate": "20261028070000",
     "coordX": "127.050000", "coordY": "37.470000", "linkId": "1210000800", "roadName": "경부선", "roadNo": "1",
     "roadDrcType": "", "lanesBlockType": "", "lanesBlocked": "", "message": " ", "endDate": ""},
    {"type": "국도", "eventType": "공사", "eventDetailType": "", "startDate": "20260811000000",
     "coordX": "127.098000", "coordY": "37.590000", "linkId": "1320000100", "roadName": "국도3호선", "roadNo": "3",
     "roadDrcType": "양방향", "lanesBlockType": "", "lanesBlocked": "", "message": "도로포장 공사", "endDate": "20261130000000"},
    # 위치를 알 수 없는 항목: 건너뛰어야 한다
    {"type": "기타", "eventType": "공사", "eventDetailType": "", "startDate": "20260101000000",
     "coordX": "", "coordY": "", "linkId": "", "roadName": "", "roadNo": "", "roadDrcType": "", "lanesBlockType": "",
     "lanesBlocked": "", "message": "좌표 없음", "endDate": ""},
]

CAUTION_ITEMS: List[Dict[str, Any]] = [
    {"message": "사고잦은구간 추돌주의", "stepType": "0", "outbrkType": "사고잦은구간", "priority": "1", "routeName": "",
     "routeNo": "0010", "roadDrcType": "기점", "startStdLinkId": "2040002903", "startX": "127.046344", "startY": "37.456747",
     "revRouteName": "경부선", "revRouteNo": "0010", "revRoadDrcType": "기점", "revStdLinkId": "2040002903",
     "revX": "127.041562", "revY": "37.461772", "occrrncId": ""},
    {"message": "전방 차량증가 정체 주의", "stepType": "0", "outbrkType": "차량증가/정체", "priority": "1", "routeName": "",
     "routeNo": "0010", "roadDrcType": "종점", "startStdLinkId": "2040002904", "startX": "127.060000", "startY": "37.480000",
     "revRouteName": "", "revRouteNo": "", "revRoadDrcType": "", "revStdLinkId": "", "revX": "", "revY": "",
     "occrrncId": "20261028070000000001"},
]

FLOW_ITEMS: List[Dict[str, Any]] = [
    {"roadName": "종로", "roadDrcType": "", "linkNo": "", "linkId": "1000000301", "startNodeId": "1000008600",
     "endNodeId": "1000008900", "speed": "14", "travelTime": "38.8", "createdDate": "20261028165500"},
    {"roadName": "청계천로", "roadDrcType": "", "linkNo": "", "linkId": "1000000302", "startNodeId": "1000008900",
     "endNodeId": "1000009000", "speed": "", "travelTime": "", "createdDate": "20261028165500"},
]

PREDICTION_ITEMS: List[Dict[str, Any]] = [
    {"fcastDate": "20261028", "fcastHour": "16", "linkId": "2030003902", "sectionId": "10", "sectionType": "D",
     "detourId": "10", "length": "193.5", "speed": "35.2"},
    {"fcastDate": "20261028", "fcastHour": "16", "linkId": "2030003903", "sectionId": "10", "sectionType": "M",
     "detourId": "", "length": "120", "speed": "80"},
]

# 서울 종로구 재동초등학교 부근 TM 좌표(EPSG:5181)로 만든 형상
WKT_POINT = "MULTIPOINT((198745.9338 453404.9304))"
WKT_COLLECTION = (
    "GEOMETRYCOLLECTION(POLYGON((198671.4 453509.8,198668.2 453322.3,198640.7 453315.6,198671.4 453509.8)),"
    "POINT(198650.0 453400.0))"
)


def zone_item(**over: Any) -> Dict[str, Any]:
    base = {"ptznMngNo": 111101011430, "trgtFcltNm": "재동초등학교병설유치원", "fcltTypeCd": "1", "fcltDtlTypeCd": "103",
            "rprsPtznMngNo": 111101011431, "useYn": "Y", "sggCd": "11110", "emdongCd": "146", "stdgCd": "11110146  ",
            "assignType": "2", "roadNmAddr": "서울특별시 종로구 북촌로4길 7 (가회동)", "roadNmDaddr": "재동초등학교병설유치원",
            "lotnoAddr": "서울특별시 종로구 가회동 210", "lotnoDaddr": "재동초등학교병설유치원", "fturGeomVl": WKT_POINT,
            "frstRegDt": "20100101"}
    base.update(over)
    return base


def its_ok(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"header": {"resultCode": 0, "resultMsg": "SUCCESS"}, "body": {"totalCount": len(items), "items": items}}


def its_error(code: int) -> Dict[str, Any]:
    return {"header": {"resultCode": code, "resultMsg": "error"}, "body": ""}


def zone_ok(items: List[Dict[str, Any]], page: int = 1, total_pages: int = 1) -> Dict[str, Any]:
    return {"response": {"header": {"resultCode": "00", "resultMsg": "성공"},
                         "body": {"items": {"item": items}, "numOfRows": 200, "pageNo": page,
                                  "totalCount": len(items), "totalPages": total_pages}}}


def zone_header(code: str, message: str = "") -> Dict[str, Any]:
    return {"response": {"header": {"resultCode": code, "resultMsg": message}}}
