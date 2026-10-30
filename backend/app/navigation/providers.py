from typing import Optional, Protocol

import httpx

from .schemas import LatLng, RouteGuide, RouteOption, TransitRouteOption, TransitStep, TransitStop, TransitVehicle


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
    ) -> tuple[RouteOption, list[str]]:
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

    async def get_pedestrian_route(self, origin: LatLng, destination: LatLng) -> tuple[RouteOption, list[str]]:
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

    async def get_bicycle_route(self, origin: LatLng, destination: LatLng) -> tuple[RouteOption, list[str]]:
        return await self._get_route(
            "https://dapi.kakao.com/v2/routing/bicycle", origin, destination, nested_key="route"
        )

    async def get_transit_route(self, origin: LatLng, destination: LatLng) -> tuple[RouteOption, list[str]]:
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
    ) -> tuple[RouteOption, list[str]]:
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
        instructions = [s["properties"]["guidance"] for s in steps if s["properties"].get("guidance")]
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


def parse_tmap_route(data: dict) -> tuple[RouteOption, list[str]]:
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

    instructions = [f["properties"]["description"] for f in features[1:] if f["properties"].get("description")]
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
