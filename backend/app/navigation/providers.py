import asyncio
import re
from typing import Optional, Protocol

import httpx

from .schemas import LatLng, NearbyPlace, PlaceSearchResult, RouteGuide, RouteInstruction, RouteOption, TransitRouteOption, TransitStep, TransitStop, TransitVehicle

# Kakao 로컬 검색은 중국어 쿼리를 매칭하지 못한다(실호출로 확인, 2026-11-03: 한국어·영어는 결과가 나오지만 중국어는 항상 빈 배열).
# 한자(CJK 통합 한자) 쿼리이고 한글이 섞여 있지 않을 때만 파파고로 한국어로 번역해 검색어를 바꿔치기한다.
_CJK_PATTERN = re.compile(r"[一-鿿]")
_HANGUL_PATTERN = re.compile(r"[가-힣]")


async def _papago_translate(text: str, source: str, target: str, client_id: str, client_secret: str) -> str:
    async with httpx.AsyncClient(timeout=3.0) as client:
        resp = await client.post(
            "https://papago.apigw.ntruss.com/nmt/v1/translation",
            headers={
                "X-NCP-APIGW-API-KEY-ID": client_id,
                "X-NCP-APIGW-API-KEY": client_secret,
            },
            data={"source": source, "target": target, "text": text},
        )
        resp.raise_for_status()
        return resp.json()["message"]["result"]["translatedText"]


async def translate_chinese_query_to_korean(query: str, client_id: str, client_secret: str) -> str:
    """중국어로만 된 검색어를 한국어로 번역한다. 번역 실패·키 미설정 시 원문을 그대로 돌려준다(검색 자체는 막지 않음)."""
    if not client_id or not client_secret:
        return query
    if not _CJK_PATTERN.search(query) or _HANGUL_PATTERN.search(query):
        return query
    try:
        return await _papago_translate(query, "zh-CN", "ko", client_id, client_secret)
    except Exception:
        return query


# Kakao 검색 결과(장소명·주소)는 항상 한국어다. 영어/중국어 화면에서는 관련검색어도 그 언어로 보여야
# 자연스러워서(사용자 확인, 2026-11-03), 화면 언어가 ko 가 아니면 결과를 그 언어로 번역해 돌려준다.
# 결과 하나당 호출하면 느려지니 모든 장소명+주소를 줄바꿈으로 묶어 한 번에 번역한다(파파고는 줄바꿈 단위를 보존함).
_RESULT_LANG_TO_PAPAGO_TARGET = {"en": "en", "zh": "zh-CN"}


async def translate_places_to_language(
    places: list[PlaceSearchResult], lang: Optional[str], client_id: str, client_secret: str
) -> list[PlaceSearchResult]:
    target = _RESULT_LANG_TO_PAPAGO_TARGET.get(lang or "")
    if not target or not client_id or not client_secret or not places:
        return places
    lines = [field for p in places for field in (p.name, p.address)]
    try:
        translated_text = await _papago_translate("\n".join(lines), "ko", target, client_id, client_secret)
    except Exception:
        return places
    translated_lines = translated_text.split("\n")
    if len(translated_lines) != len(lines):
        return places
    return [
        PlaceSearchResult(name=translated_lines[i * 2], address=translated_lines[i * 2 + 1], lat=p.lat, lng=p.lng)
        for i, p in enumerate(places)
    ]

# 카카오 로컬의 전체 카테고리 그룹 코드(developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-category).
# find_place_at 이 "좌표 하나 근처엔 뭐가 있나"를 알아보려고 이 전부를 훑는다(카카오는 좌표→장소명 역조회가 없다).
_ALL_CATEGORY_GROUP_CODES = [
    "MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9",
    "CT1", "AG2", "PO3", "AT4", "AD5", "FD6", "CE7", "HP8", "PM9",
]


def _category_label(category_name: str) -> str:
    """카카오 category_name 은 "여행 > 관광,명소 > 공원" 같은 상위>하위 경로다. 가장 구체적인 마지막 항목만 보여준다."""
    parts = [p.strip() for p in category_name.split(">") if p.strip()]
    return parts[-1] if parts else ""


class NavigationProvider(Protocol):
    name: str

    async def get_route(self, origin: LatLng, destination: LatLng) -> RouteOption: ...


class TmapProvider:
    name = "tmap"

    def __init__(self, app_key: str) -> None:
        self._app_key = app_key

    async def get_route(self, origin: LatLng, destination: LatLng) -> RouteOption:
        route, _ = await self.get_route_styled(origin, destination)
        return route

    # searchOption 값은 Tmap 공식 문서(tmap-skopenapi.readme.io)로 확인함:
    # 0=교통최적+추천, 1=무료우선, 4=고속도로우선, 10=최단거리, 19=어린이보호구역 회피.
    async def get_route_styled(
        self, origin: LatLng, destination: LatLng, search_option: str = "0"
    ) -> tuple[RouteOption, list[RouteInstruction]]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                "https://apis.openapi.sk.com/tmap/routes?version=1",
                headers={"appKey": self._app_key},
                json={
                    "startX": origin.lng,
                    "startY": origin.lat,
                    "endX": destination.lng,
                    "endY": destination.lat,
                    "reqCoordType": "WGS84GEO",
                    "resCoordType": "WGS84GEO",
                    "searchOption": search_option,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        # 2026-10-28 실제 호출로 검증됨: features[0].properties에 totalDistance/totalTime(start 지점 기준).
        return parse_tmap_route(data)

    async def get_pedestrian_route(self, origin: LatLng, destination: LatLng) -> tuple[RouteOption, list[RouteInstruction]]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
                headers={"appKey": self._app_key},
                json={
                    "startX": origin.lng,
                    "startY": origin.lat,
                    "endX": destination.lng,
                    "endY": destination.lat,
                    "startName": "출발",
                    "endName": "도착",
                    "reqCoordType": "WGS84GEO",
                    "resCoordType": "WGS84GEO",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        # 2026-10-28 실제 호출로 검증됨: 자동차 API와 같은 features[0].properties 구조.
        return parse_tmap_route(data)


class NaverProvider:
    name = "naver"

    def __init__(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret

    async def get_route(self, origin: LatLng, destination: LatLng) -> RouteOption:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://maps.apigw.ntruss.com/map-direction/v1/driving",
                headers={
                    "X-NCP-APIGW-API-KEY-ID": self._client_id,
                    "X-NCP-APIGW-API-KEY": self._client_secret,
                },
                params={
                    "start": f"{origin.lng},{origin.lat}",
                    "goal": f"{destination.lng},{destination.lat}",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        # 2026-10-28 실제 호출로 검증됨: route.traoptimal[0].summary.{distance,duration}, path는 [lng, lat] 배열.
        route = data["route"]["traoptimal"][0]
        summary = route["summary"]
        path = [LatLng(lat=coord[1], lng=coord[0]) for coord in route["path"]]
        return RouteOption(
            provider="naver",
            distance_km=summary.get("distance", 0) / 1000,
            duration_min=summary.get("duration", 0) / 60000,
            path=path,
        )


class KakaoRoutingProvider:
    """자전거·대중교통 경로. 카카오맵 REST API(developers.kakao.com/docs/ko/kakaomap/rest-api) 기준.

    실제 키로 호출해 응답 구조(route.legs[].steps[] / routes[0].steps[])를 검증함(2026-10-28).
    """

    name = "kakao"
    # 카카오 게이트웨이가 모든 dapi.kakao.com 호출에 KA 헤더(os+origin)를 강제함(문서에는 없음, 실호출로 확인).
    # 이 앱 키는 Web 플랫폼으로 등록돼 있어 os=web 이어야 통과한다. origin 값 자체는 검증되지 않는다.
    _KA_HEADER = "os/web origin/http://localhost:8081"

    def __init__(self, rest_api_key: str) -> None:
        self._rest_api_key = rest_api_key

    async def get_bicycle_route(self, origin: LatLng, destination: LatLng) -> tuple[RouteOption, list[RouteInstruction]]:
        return await self._get_route(
            "https://dapi.kakao.com/v2/routing/bicycle", origin, destination, nested_key="route"
        )

    async def get_transit_route(self, origin: LatLng, destination: LatLng) -> tuple[RouteOption, list[RouteInstruction]]:
        return await self._get_route(
            "https://dapi.kakao.com/v2/routing/publictraffic", origin, destination, nested_key="routes"
        )

    # 대중교통은 버스/지하철/버스+지하철 조합으로 여러 경로가 온다 — 전부 내려서 프론트에서 고르게 한다.
    async def get_transit_routes(
        self, origin: LatLng, destination: LatLng
    ) -> tuple[list[TransitRouteOption], dict[str, int]]:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://dapi.kakao.com/v2/routing/publictraffic",
                headers={"Authorization": f"KakaoAK {self._rest_api_key}", "KA": self._KA_HEADER},
                params={
                    "start_x": origin.lng,
                    "start_y": origin.lat,
                    "end_x": destination.lng,
                    "end_y": destination.lat,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        counts = data.get("properties") or {}
        options: list[TransitRouteOption] = []
        for route in data.get("routes", []):
            properties = route["properties"]
            raw_steps = route["steps"]
            instructions = [s["properties"]["guidance"] for s in raw_steps if s["properties"].get("guidance")]
            path = [
                LatLng(lat=point[1], lng=point[0])
                for step in raw_steps
                for point in step.get("path", {}).get("points", [])
            ]
            steps = [
                TransitStep(
                    type=sp.get("type", "WALKING"),
                    distance_m=sp.get("distance", 0),
                    time_sec=sp.get("time", 0),
                    stops=[TransitStop(name=st.get("name", "")) for st in sp.get("stops", [])],
                    vehicles=[
                        TransitVehicle(name=v.get("name", ""), type=v.get("type"))
                        for v in sp.get("vehicles", [])
                    ],
                )
                for s in raw_steps
                for sp in [s["properties"]]
            ]
            fare = properties.get("fare") or {}
            options.append(
                TransitRouteOption(
                    type=properties.get("type", "BUS"),
                    distance_km=properties.get("totalDistance", 0) / 1000,
                    duration_min=properties.get("totalTime", 0) / 60,
                    transfers=properties.get("transfers", 0),
                    fare=fare.get("value", fare.get("min", 0)),
                    path=path,
                    instructions=instructions,
                    steps=steps,
                )
            )
        return options, {
            "total": counts.get("total", len(options)),
            "bus": counts.get("bus", 0),
            "subway": counts.get("subway", 0),
            "bus_and_subway": counts.get("busAndSubway", 0),
        }

    async def _get_route(
        self, url: str, origin: LatLng, destination: LatLng, *, nested_key: str
    ) -> tuple[RouteOption, list[RouteInstruction]]:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"KakaoAK {self._rest_api_key}", "KA": self._KA_HEADER},
                params={
                    "start_x": origin.lng,
                    "start_y": origin.lat,
                    "end_x": destination.lng,
                    "end_y": destination.lat,
                },
            )
            resp.raise_for_status()
            data = resp.json()
        if nested_key == "route":
            root = data["route"]
            steps = [step for leg in root["legs"] for step in leg["steps"]]
        else:
            root = data["routes"][0]
            steps = root["steps"]
        properties = root["properties"]
        instructions = [
            RouteInstruction(text=s["properties"]["guidance"], point=_step_point(s))
            for s in steps
            if s["properties"].get("guidance")
        ]
        path = [
            LatLng(lat=point[1], lng=point[0])
            for step in steps
            for point in step.get("path", {}).get("points", [])
        ]
        route = RouteOption(
            provider="kakao",
            distance_km=properties.get("totalDistance", 0) / 1000,
            duration_min=properties.get("totalTime", 0) / 60,
            path=path,
        )
        return route, instructions

    async def reverse_geocode(self, point: LatLng) -> Optional[str]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://dapi.kakao.com/v2/local/geo/coord2address.json",
                headers={"Authorization": f"KakaoAK {self._rest_api_key}", "KA": self._KA_HEADER},
                params={"x": point.lng, "y": point.lat},
            )
            resp.raise_for_status()
            data = resp.json()
        documents = data.get("documents") or []
        if not documents:
            return None
        doc = documents[0]
        road = doc.get("road_address")
        if road and road.get("address_name"):
            return road["address_name"]
        address = doc.get("address")
        return address.get("address_name") if address else None

    # category_group_code 가 있으면 카카오 카테고리 검색을, 없으면(헤어샵처럼 전용 코드가 없는 업종) 키워드 검색을 쓴다.
    # 둘 다 응답 모양(documents[].{place_name,address_name,x,y,distance})이 같아 같은 방식으로 NearbyPlace 를 만든다.
    async def search_nearby(
        self,
        point: LatLng,
        radius_m: int,
        *,
        category_group_code: Optional[str] = None,
        keyword: Optional[str] = None,
    ) -> list["NearbyPlace"]:
        url = (
            "https://dapi.kakao.com/v2/local/search/category.json"
            if category_group_code
            else "https://dapi.kakao.com/v2/local/search/keyword.json"
        )
        params = {
            "x": point.lng,
            "y": point.lat,
            "radius": radius_m,
            "sort": "distance",
            "size": 15,
        }
        if category_group_code:
            params["category_group_code"] = category_group_code
        else:
            params["query"] = keyword
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"KakaoAK {self._rest_api_key}", "KA": self._KA_HEADER},
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            NearbyPlace(
                name=doc["place_name"],
                lat=float(doc["y"]),
                lng=float(doc["x"]),
                address=doc.get("road_address_name") or doc.get("address_name", ""),
                distance_m=int(doc["distance"]) if doc.get("distance") else 0,
                category=_category_label(doc.get("category_name", "")),
            )
            for doc in data.get("documents", [])
        ]

    # 지도를 탭한 좌표 근처에서 가장 가까운 장소 하나를 찾는다. 카카오는 좌표→장소명 역조회를 지원하지 않아,
    # 전체 카테고리(_ALL_CATEGORY_GROUP_CODES)를 좁은 반경으로 한 번에 훑어(asyncio.gather) 가장 가까운 결과를 고르는
    # best-effort 방식이다. 반경 안에 아무 장소도 없으면 None(= 호출 쪽은 주소만 보여준다).
    async def find_place_at(self, point: LatLng, radius_m: int = 60) -> Optional[NearbyPlace]:
        async def fetch(group_code: str) -> list[dict]:
            try:
                return await self._category_documents(point, radius_m, group_code)
            except Exception:
                return []

        results = await asyncio.gather(*(fetch(code) for code in _ALL_CATEGORY_GROUP_CODES))
        candidates = [doc for docs in results for doc in docs]
        if not candidates:
            return None
        nearest = min(candidates, key=lambda d: int(d.get("distance") or radius_m))
        return NearbyPlace(
            name=nearest["place_name"],
            lat=float(nearest["y"]),
            lng=float(nearest["x"]),
            address=nearest.get("road_address_name") or nearest.get("address_name", ""),
            distance_m=int(nearest["distance"]) if nearest.get("distance") else 0,
            category=_category_label(nearest.get("category_name", "")),
        )

    async def _category_documents(self, point: LatLng, radius_m: int, category_group_code: str) -> list[dict]:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://dapi.kakao.com/v2/local/search/category.json",
                headers={"Authorization": f"KakaoAK {self._rest_api_key}", "KA": self._KA_HEADER},
                params={"x": point.lng, "y": point.lat, "radius": radius_m, "sort": "distance", "size": 1, "category_group_code": category_group_code},
            )
            resp.raise_for_status()
            return resp.json().get("documents", [])

    # 자유 검색(장소명·주소 아무거나). 홈 화면 도착지 검색과 자동완성에 쓴다. 전국 범위 - radius 로 가두지 않는다.
    # point 를 주면 그 좌표 근처 결과를 우선 정렬한다(카카오 기본 정렬: 정확도순이지만 x/y 가 있으면 가중치를 준다).
    async def search_keyword(self, query: str, point: Optional[LatLng] = None, size: int = 8) -> list[PlaceSearchResult]:
        params: dict[str, object] = {"query": query, "size": size}
        if point:
            params["x"] = point.lng
            params["y"] = point.lat
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://dapi.kakao.com/v2/local/search/keyword.json",
                headers={"Authorization": f"KakaoAK {self._rest_api_key}", "KA": self._KA_HEADER},
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            PlaceSearchResult(
                name=doc["place_name"],
                lat=float(doc["y"]),
                lng=float(doc["x"]),
                address=doc.get("road_address_name") or doc.get("address_name", ""),
            )
            for doc in data.get("documents", [])
        ]


def _int_or_none(value: object) -> Optional[int]:
    """Tmap 이 숫자를 숫자·문자열 어느 쪽으로 주든 정수로 읽는다. 읽을 수 없으면 None(값을 만들어내지 않는다)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(round(value))
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def parse_tmap_route(data: dict) -> tuple[RouteOption, list[RouteInstruction]]:
    """Tmap 경로(자동차·보행자 공통 GeoJSON)를 RouteOption + 안내 문구 + 회전 안내 지점으로 바꾼다.

    path·instructions·총 거리/시간은 기존 동작과 같다(path 는 모든 피처의 좌표를 이어 붙인 것이라 Point 좌표도 들어 있다).
    guides 는 Point 피처마다 하나: 좌표·turnType·도로명을 Tmap 이 준 그대로 담고, path 에서의 위치(path_index)를 함께 준다.
    Tmap 응답의 Point/LineString 필드는 공식 문서 샘플 기준이다(실제 호출로 모든 필드를 확인하지는 못했다). 없는 값은 비워 둔다.
    """
    features = data["features"]
    properties = features[0]["properties"]
    path: list[LatLng] = []
    guides: list[RouteGuide] = []
    # 각 guide 다음에 이어지는 LineString 들의 거리·시간 합. 한 구간이라도 값이 없으면 그 합은 모른다(None).
    legs: list[dict] = []

    for feature in features:
        geometry = feature["geometry"]
        coords = _coerce_coordinates(geometry)
        props = feature.get("properties") or {}
        if geometry.get("type") == "Point" and coords:
            listed_index = _int_or_none(props.get("index"))
            guides.append(
                RouteGuide(
                    index=listed_index if listed_index is not None else len(guides),
                    lat=coords[0][1],
                    lng=coords[0][0],
                    path_index=len(path),
                    turn_type=_int_or_none(props.get("turnType")),
                    point_type=_text(props.get("pointType")),
                    description=_text(props.get("description")),
                    name=_text(props.get("name")),
                    next_road_name=_text(props.get("nextRoadName")),
                )
            )
            legs.append({"distance": 0, "time": 0, "distance_ok": True, "time_ok": True, "segments": 0})
        elif geometry.get("type") == "LineString" and legs:
            leg = legs[-1]
            leg["segments"] += 1
            distance, seconds = _int_or_none(props.get("distance")), _int_or_none(props.get("time"))
            if distance is None:
                leg["distance_ok"] = False
            else:
                leg["distance"] += distance
            if seconds is None:
                leg["time_ok"] = False
            else:
                leg["time"] += seconds
        path.extend(LatLng(lat=coord[1], lng=coord[0]) for coord in coords)

    for guide, leg in zip(guides, legs):
        if leg["segments"] > 0:
            guide.leg_distance_m = leg["distance"] if leg["distance_ok"] else None
            guide.leg_time_sec = leg["time"] if leg["time_ok"] else None

    # 안내 문구는 지점 좌표(point)와 함께 준다. 프런트 TTS 가 그 지점 근처에서 읽는다(point 가 없으면 텍스트만 표시).
    instructions = [
        RouteInstruction(text=f["properties"]["description"], point=_feature_point(f))
        for f in features[1:]
        if f["properties"].get("description")
    ]
    route = RouteOption(
        provider="tmap",
        distance_km=properties.get("totalDistance", 0) / 1000,
        duration_min=properties.get("totalTime", 0) / 60,
        path=path,
        guides=guides,
    )
    return route, instructions


def _coerce_coordinates(geometry: dict) -> list[list[float]]:
    if geometry["type"] == "LineString":
        return geometry["coordinates"]
    if geometry["type"] == "Point":
        return [geometry["coordinates"]]
    return []


# Tmap 안내지점(guide) feature 의 좌표. Point geometry 는 좌표 하나뿐이다.
def _feature_point(feature: dict) -> Optional[LatLng]:
    coords = _coerce_coordinates(feature["geometry"])
    return LatLng(lat=coords[0][1], lng=coords[0][0]) if coords else None


# 카카오 step 의 시작 지점. TTS 로 "이 지점 근처에서" 읽을 위치로 쓴다.
def _step_point(step: dict) -> Optional[LatLng]:
    points = step.get("path", {}).get("points", [])
    return LatLng(lat=points[0][1], lng=points[0][0]) if points else None
