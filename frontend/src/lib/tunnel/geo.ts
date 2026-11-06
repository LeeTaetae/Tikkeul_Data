// 터널 접근 판정용 좌표 계산. React·React Native 에 의존하지 않는 순수 함수라 Node 로도 테스트한다.
export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_R_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a → b 방위각. 북 0°, 시계 방향. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** 두 방위각의 차이(0~180). */
export function angleDiffDeg(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** origin 기준 p 의 동(x)·북(y) 거리(m). 수 km 이내에서 쓰는 등장방형 근사. */
export function localOffsetM(origin: LatLng, p: LatLng): { x: number; y: number } {
  return {
    x: toRad(p.lng - origin.lng) * EARTH_R_M * Math.cos(toRad(origin.lat)),
    y: toRad(p.lat - origin.lat) * EARTH_R_M,
  };
}

/**
 * 터널 축(entrance → exit)을 기준으로 한 차량 위치.
 * along: 입구에서 출구 쪽으로 잰 거리. 음수면 입구 앞(아직 진입 전), 양수면 입구를 지나 터널 쪽이다.
 * lateralM: 축에서 옆으로 벗어난 거리.
 */
export function axisPosition(entrance: LatLng, exit: LatLng, p: LatLng): { alongM: number; lateralM: number } {
  const v = localOffsetM(entrance, exit);
  const w = localOffsetM(entrance, p);
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { alongM: 0, lateralM: Math.hypot(w.x, w.y) };
  const ux = v.x / len;
  const uy = v.y / len;
  return { alongM: w.x * ux + w.y * uy, lateralM: Math.abs(w.x * uy - w.y * ux) };
}
