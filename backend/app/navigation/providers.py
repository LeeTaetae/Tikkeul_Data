from typing import Optional, Protocol

import httpx

from .schemas import LatLng, RouteInstruction, RouteOption, TransitRouteOption, TransitStep, TransitStop, TransitVehicle


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
        properties = data["features"][0]["properties"]
        path = [
            LatLng(lat=coord[1], lng=coord[0])
            for feature in data["features"]
            for coord in _coerce_coordinates(feature["geometry"])
        ]
        instructions = [
            RouteInstruction(text=f["properties"]["description"], point=_feature_point(f))
            for f in data["features"][1:]
            if f["properties"].get("description")
        ]
        route = RouteOption(
            provider="tmap",
            distance_km=properties.get("totalDistance", 0) / 1000,
            duration_min=properties.get("totalTime", 0) / 60,
            path=path,
        )
        return route, instructions

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
        properties = data["features"][0]["properties"]
        path = [
            LatLng(lat=coord[1], lng=coord[0])
            for feature in data["features"]
            for coord in _coerce_coordinates(feature["geometry"])
        ]
        instructions = [
            RouteInstruction(text=f["properties"]["description"], point=_feature_point(f))
            for f in data["features"][1:]
            if f["properties"].get("description")
        ]
        route = RouteOption(
            provider="tmap",
            distance_km=properties.get("totalDistance", 0) / 1000,
            duration_min=properties.get("totalTime", 0) / 60,
            path=path,
        )
        return route, instructions


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
