// 위치 → 조회 영역 계산. 다른 모듈을 import 하지 않는 순수 함수라 Node 로도 테스트한다.

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface BBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** ITS 돌발·주의운전구간 조회 반경(m). 백엔드 한도(한 변 0.3도)보다 훨씬 작다. */
export const SEARCH_RADIUS_M = 5000;
/** 위도 1도의 길이(m). 경도 1도는 여기에 cos(위도)를 곱한다. */
const M_PER_DEG = 111320;
/** 조회 영역을 맞추는 격자(도). 백엔드 캐시 격자와 같아, 같은 격자 안에서는 요청이 바뀌지 않는다. */
export const GRID_DEG = 0.01;

/** 서비스 지역(대한민국 영토, 제주·울릉·독도 포함)을 넉넉히 감싼 범위. 백엔드 service.py 의 KOREA_LAT/LON 과 같다. */
export const KOREA_BOUNDS = { minLat: 32.5, maxLat: 39.0, minLon: 123.5, maxLon: 132.5 };

export function isInKorea(c: Coords): boolean {
  return c.latitude >= KOREA_BOUNDS.minLat && c.latitude <= KOREA_BOUNDS.maxLat && c.longitude >= KOREA_BOUNDS.minLon && c.longitude <= KOREA_BOUNDS.maxLon;
}

const snap = (v: number, step: number) => Math.round(Math.round(v / step) * step * 1e6) / 1e6;

export function bboxAround(center: Coords, radiusM: number = SEARCH_RADIUS_M): BBox {
  const dLat = radiusM / M_PER_DEG;
  // 위도가 높을수록 경도 1도가 짧아진다. 같은 거리를 덮으려면 경도 폭을 cos(위도)로 나눠 넓힌다.
  const dLon = radiusM / (M_PER_DEG * Math.cos((center.latitude * Math.PI) / 180));
  return {
    minLon: center.longitude - dLon,
    maxLon: center.longitude + dLon,
    minLat: center.latitude - dLat,
    maxLat: center.latitude + dLat,
  };
}

/** 여러 좌표(경로)를 전부 덮는 영역. paddingM 만큼 여유를 둔다. 좌표가 많을 수 있어 스프레드 대신 reduce 로 훑는다. */
export function bboxForPoints(points: Coords[], paddingM: number): BBox {
  const extent = points.reduce(
    (acc, p) => ({
      minLat: Math.min(acc.minLat, p.latitude),
      maxLat: Math.max(acc.maxLat, p.latitude),
      minLon: Math.min(acc.minLon, p.longitude),
      maxLon: Math.max(acc.maxLon, p.longitude),
    }),
    { minLat: points[0].latitude, maxLat: points[0].latitude, minLon: points[0].longitude, maxLon: points[0].longitude },
  );
  const midLat = (extent.minLat + extent.maxLat) / 2;
  const dLat = paddingM / M_PER_DEG;
  const dLon = paddingM / (M_PER_DEG * Math.cos((midLat * Math.PI) / 180));
  return {
    minLon: extent.minLon - dLon,
    maxLon: extent.maxLon + dLon,
    minLat: extent.minLat - dLat,
    maxLat: extent.maxLat + dLat,
  };
}

export interface SearchArea {
  /** 같은 격자 안의 위치는 같은 key 가 된다. 데이터 조회를 다시 할지 판단하는 기준이다. */
  key: string;
  bbox: BBox;
}

/** 위치를 0.01도(약 1km) 격자 중심으로 맞춘 뒤 반경 영역을 만든다. GPS 가 조금 흔들려도 같은 요청이 된다. */
export function areaFor(coords: Coords): SearchArea {
  const center: Coords = { latitude: snap(coords.latitude, GRID_DEG), longitude: snap(coords.longitude, GRID_DEG) };
  return { key: `${center.latitude.toFixed(2)},${center.longitude.toFixed(2)}`, bbox: bboxAround(center) };
}

export interface RegionQuery {
  key: string;
  lat: number;
  lon: number;
}

/** 시군구 변환용 좌표. 소수 3자리(약 110m)로 반올림해 서버로 보낸다. */
export function regionQueryFor(coords: Coords): RegionQuery {
  const lat = Math.round(coords.latitude * 1000) / 1000;
  const lon = Math.round(coords.longitude * 1000) / 1000;
  return { key: `${lat.toFixed(3)},${lon.toFixed(3)}`, lat, lon };
}
