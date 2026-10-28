import math
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from pyproj import Transformer

# 경찰청 보호구역 지오메트리(WKT)의 좌표계. 공식 문서에는 명시돼 있지 않다.
# 종로구 보호구역 9곳을 OSM 지오코딩 위치와 대조해 EPSG:5181(KGD2002 중부원점)로 확인했다.
# 중앙값 오차: 5181 = 41m, 5174 = 317m, 2097 = 359m, 5186 = 약 100km. (지오코더 자체 오차가 수십 m 있다)
ZONE_SOURCE_CRS = "EPSG:5181"
_TO_WGS84 = Transformer.from_crs(ZONE_SOURCE_CRS, "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class BBox:
    min_lon: float
    max_lon: float
    min_lat: float
    max_lat: float

    def snapped(self, step: float = 0.01) -> "BBox":
        """영역을 step(도) 격자에 맞춰 바깥쪽으로 넓힌다. 캐시 적중률을 높이고 요청 좌표 정밀도를 낮춘다."""

        def down(v: float) -> float:
            return round(math.floor(round(v / step, 6)) * step, 6)

        def up(v: float) -> float:
            return round(math.ceil(round(v / step, 6)) * step, 6)

        return BBox(down(self.min_lon), up(self.max_lon), down(self.min_lat), up(self.max_lat))

    def contains(self, lat: float, lon: float) -> bool:
        return self.min_lat <= lat <= self.max_lat and self.min_lon <= lon <= self.max_lon

    def its_params(self) -> Dict[str, str]:
        return {
            "minX": "%.6f" % self.min_lon,
            "maxX": "%.6f" % self.max_lon,
            "minY": "%.6f" % self.min_lat,
            "maxY": "%.6f" % self.max_lat,
        }


# --- WKT 파서 -------------------------------------------------------------
_TOKEN = re.compile(r"\s*(?:([A-Za-z]+)|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|([(),]))")
_GEOJSON_TYPE = {
    "POINT": "Point",
    "MULTIPOINT": "MultiPoint",
    "LINESTRING": "LineString",
    "MULTILINESTRING": "MultiLineString",
    "POLYGON": "Polygon",
    "MULTIPOLYGON": "MultiPolygon",
}


class WktError(ValueError):
    pass


class _Parser:
    def __init__(self, text: str):
        self.tokens: List[Tuple[str, str]] = []
        pos = 0
        text = text.strip()
        while pos < len(text):
            m = _TOKEN.match(text, pos)
            if not m:
                raise WktError("WKT 토큰을 읽지 못했다")
            word, num, sym = m.groups()
            self.tokens.append(("w", word.upper()) if word else ("n", num) if num else ("s", sym))
            pos = m.end()
        self.i = 0

    def _peek(self) -> Optional[Tuple[str, str]]:
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def _next(self) -> Tuple[str, str]:
        tok = self._peek()
        if tok is None:
            raise WktError("WKT 가 도중에 끝났다")
        self.i += 1
        return tok

    def _expect(self, sym: str) -> None:
        if self._next() != ("s", sym):
            raise WktError("WKT 에 '%s' 가 필요하다" % sym)

    def _coord(self) -> List[float]:
        values = []
        while self._peek() is not None and self._peek()[0] == "n":
            values.append(float(self._next()[1]))
        if len(values) < 2:
            raise WktError("좌표는 숫자 2개 이상이어야 한다")
        return values[:2]

    def _nested(self) -> List[Any]:
        self._expect("(")
        items: List[Any] = []
        while True:
            items.append(self._nested() if self._peek() == ("s", "(") else self._coord())
            if self._peek() == ("s", ","):
                self._next()
                continue
            break
        self._expect(")")
        return items

    def geometry(self) -> Dict[str, Any]:
        kind, name = self._next()
        if kind != "w":
            raise WktError("지오메트리 이름이 필요하다")
        if name == "GEOMETRYCOLLECTION":
            self._expect("(")
            geoms = [self.geometry()]
            while self._peek() == ("s", ","):
                self._next()
                geoms.append(self.geometry())
            self._expect(")")
            return {"type": "GeometryCollection", "geometries": geoms}
        if name not in _GEOJSON_TYPE:
            raise WktError("지원하지 않는 지오메트리: %s" % name)
        payload = self._nested()
        if name == "POINT":
            coords: Any = payload[0]
        elif name == "MULTIPOINT":  # MULTIPOINT((x y),(x y)) 와 MULTIPOINT(x y, x y) 둘 다 받는다
            coords = [p[0] if isinstance(p[0], list) else p for p in payload]
        else:
            coords = payload
        return {"type": _GEOJSON_TYPE[name], "coordinates": coords}


def _map_coords(coords: Any) -> Any:
    if coords and isinstance(coords[0], (int, float)):
        lon, lat = _TO_WGS84.transform(coords[0], coords[1])
        if not (math.isfinite(lon) and math.isfinite(lat)):
            raise WktError("좌표 변환 결과가 유효하지 않다")
        return [round(lon, 6), round(lat, 6)]
    return [_map_coords(c) for c in coords]


def _convert(geom: Dict[str, Any]) -> Dict[str, Any]:
    if geom["type"] == "GeometryCollection":
        return {"type": "GeometryCollection", "geometries": [_convert(g) for g in geom["geometries"]]}
    return {"type": geom["type"], "coordinates": _map_coords(geom["coordinates"])}


def wkt_to_geojson(wkt: str) -> Dict[str, Any]:
    """보호구역 WKT(TM 좌표)를 WGS84 GeoJSON 으로 바꾼다. 실패하면 WktError."""
    return _convert(_Parser(wkt).geometry())


def geometry_center(geom: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """(lat, lon). 첫 점이 있으면 그 점, 없으면 첫 폴리곤 바깥 고리의 꼭짓점 평균."""
    kind = geom["type"]
    if kind == "GeometryCollection":
        centers = [geometry_center(g) for g in geom["geometries"]]
        points = [c for g, c in zip(geom["geometries"], centers) if g["type"] in ("Point", "MultiPoint") and c]
        return points[0] if points else next((c for c in centers if c), None)
    coords = geom["coordinates"]
    if kind == "Point":
        return coords[1], coords[0]
    if kind == "MultiPoint":
        return (coords[0][1], coords[0][0]) if coords else None
    ring = coords[0] if kind == "Polygon" and coords else (coords[0][0] if kind == "MultiPolygon" and coords else None)
    if kind == "LineString":
        ring = coords
    if not ring:
        return None
    return sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)
