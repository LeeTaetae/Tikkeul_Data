// 경로 기반 위험 필터링. React 에 의존하지 않는 순수 함수만 둔다.
//
// 판단 기준은 "활성 경로의 좌표열"과 "위험의 위치·방향"이다. GPS 직선거리나 도로명 문자열로는 판단하지 않는다.
// 경로 위로 확인되지 않은 위험(경로 밖, 반대 방향, 방향 불명)은 onRoute 에 넣지 않는다.
//
// 한계(중요): 이 매칭은 좌표와 방위각을 기하학적으로 비교할 뿐이다.
//  - "실제 도로에서 같은 방향이다"를 확정하지 못한다. 평행한 인접 도로, 고가·지하 분리 도로, 같은 방향 진출입로를 구분하지 못한다.
//  - 임시 기준값(30m, 60°)은 Mock 시뮬레이션용이다. 실제 GPS 오차와 도로 폭에 맞춰 다시 정해야 한다.
//  - 정확한 판정은 도로 구간 ID(roadLinkId)나 상행/하행(direction) 같은 API 정보로 해야 한다.
import type { RoadAlert } from '../types/alert';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface Route {
  /** 경로 식별자. 재탐색하면 새 값이 된다(useHazardWarning 의 routeKey 로 쓴다). */
  id: string;
  points: RoutePoint[];
}

/** 경로 매칭을 통과한 위험구간. offsetM 은 경로 시작점부터 위험까지 경로를 따라 잰 거리다. */
export interface OnRouteHazard {
  alert: RoadAlert;
  offsetM: number;
}

/** 경로를 따라 계산한 남은 거리. 0 이하면 통과한 위험구간이다. */
export interface HazardApproach {
  alert: RoadAlert;
  distanceM: number;
}

export type RejectReason = 'offRoute' | 'oppositeDirection' | 'unknownDirection';

export interface MatchResult {
  onRoute: OnRouteHazard[];
  rejected: { alert: RoadAlert; reason: RejectReason }[];
}

export interface MatchOptions {
  maxLateralM?: number;
  maxHeadingDiffDeg?: number;
}

// Mock 시뮬레이션용 임시 기준
export const MATCH_MAX_LATERAL_M = 30;
export const MATCH_MAX_HEADING_DIFF_DEG = 60;

// 위도 1도 ≈ 111.32km. 경도는 cos(위도)를 곱한다. 수 km~수십 km 경로에서는 오차가 작은 근사다.
const M_PER_DEG = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** 두 방위각 사이의 각도 차이(0~180). */
function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

interface SegmentProjection {
  lateralM: number;
  offsetM: number;
  bearingDeg: number;
}

// 점 하나를 경로의 각 선분에 투영한다. 선분마다 수직 거리, 경로 시작 기준 위치, 선분의 진행 방위를 돌려준다.
function projections(route: Route, point: RoutePoint): SegmentProjection[] {
  const origin = route.points[0];
  if (!origin) return [];
  const k = Math.cos(toRad(origin.latitude));
  const xy = (p: RoutePoint) => ({
    x: (p.longitude - origin.longitude) * M_PER_DEG * k,
    y: (p.latitude - origin.latitude) * M_PER_DEG,
  });
  const pt = xy(point);

  const result: SegmentProjection[] = [];
  let startM = 0;
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = xy(route.points[i]);
    const b = xy(route.points[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const t = Math.min(1, Math.max(0, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (len * len)));
    result.push({
      lateralM: Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)),
      offsetM: startM + t * len,
      bearingDeg: (toDeg(Math.atan2(dx, dy)) + 360) % 360,
    });
    startM += len;
  }
  return result;
}

/** 경로에서 가장 가까운 지점. 판정과 무관하게 위치만 구한다(시뮬레이터가 기준 거리를 잡을 때 쓴다). */
export function projectOntoRoute(route: Route, point: RoutePoint): SegmentProjection | null {
  return projections(route, point).reduce<SegmentProjection | null>(
    (best, p) => (!best || p.lateralM < best.lateralM ? p : best),
    null,
  );
}

/**
 * 위험 후보 중 활성 경로 위에서, 진행 방향과 같은 방향으로 놓인 것만 골라 경로상 위치(offsetM)를 구한다.
 * 경로나 위험 데이터가 바뀔 때만 호출하면 되고, GPS 가 갱신될 때마다 하는 계산은 remainingHazards 뿐이다.
 */
export function matchHazardsToRoute(route: Route, alerts: RoadAlert[], options: MatchOptions = {}): MatchResult {
  const { maxLateralM = MATCH_MAX_LATERAL_M, maxHeadingDiffDeg = MATCH_MAX_HEADING_DIFF_DEG } = options;
  const result: MatchResult = { onRoute: [], rejected: [] };

  for (const alert of alerts) {
    // 경로에서 허용 거리 안에 있는 선분들
    const near = projections(route, alert).filter((p) => p.lateralM <= maxLateralM);
    if (near.length === 0) {
      result.rejected.push({ alert, reason: 'offRoute' });
      continue;
    }

    // omnidirectional 위험(보호구역 등 구역 전체에 적용되는 위험)은 방향 없이 가장 가까운 선분으로 판정한다.
    if (alert.omnidirectional) {
      const best = near.reduce((a, b) => (b.lateralM < a.lateralM ? b : a));
      result.onRoute.push({ alert, offsetM: best.offsetM });
      continue;
    }

    // 확장 지점: alert.roadLinkId / alert.direction 이 있고 경로가 구간 ID·방향 정보를 가지면,
    // 아래 방위각 비교보다 먼저 그 정보로 판정한다. 현재는 두 필드를 쓰지 않는다.
    if (alert.headingDeg == null) {
      result.rejected.push({ alert, reason: 'unknownDirection' });
      continue;
    }
    const heading = alert.headingDeg;
    const sameWay = near.filter((p) => angleDiff(p.bearingDeg, heading) <= maxHeadingDiffDeg);
    if (sameWay.length === 0) {
      result.rejected.push({ alert, reason: 'oppositeDirection' });
      continue;
    }
    const best = sameWay.reduce((a, b) => (b.lateralM < a.lateralM ? b : a));
    result.onRoute.push({ alert, offsetM: best.offsetM });
  }

  result.onRoute.sort((a, b) => a.offsetM - b.offsetM);
  return result;
}

/** 사용자의 경로 진행 거리(progressM)를 기준으로 위험까지 남은 거리를 계산한다. 통과한 위험은 0 이하가 된다. */
export function remainingHazards(onRoute: OnRouteHazard[], progressM: number): HazardApproach[] {
  return onRoute.map(({ alert, offsetM }) => ({ alert, distanceM: offsetM - progressM }));
}
