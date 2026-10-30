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

/**
 * 위험구간 식별자. 단계별 경고 이력(useHazardWarning)이 "같은 위험인가"를 판단하는 기준이다.
 * eventKey(같은 사건을 가리키는 안정 키)가 있으면 id 대신 쓴다. revision 이 있으면 다른 위험으로 보고 경고를 처음부터 다시 한다.
 * 그래서 revision 은 "경고를 다시 받아야 할 만큼 중요한 변경"에만 올려야 한다(문구·종료 시각이 조금 바뀐 정도로는 올리지 않는다).
 */
export function hazardKey(alert: Pick<RoadAlert, 'id' | 'eventKey' | 'revision'>): string {
  const base = alert.eventKey || alert.id;
  return alert.revision != null ? `${base}#${alert.revision}` : base;
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

// ───────────────────────── ITS 돌발정보(사고·공사·정체) 경로 매칭 ─────────────────────────
// 위 matchHazardsToRoute 는 방위각(headingDeg)이 있는 위험만 경로 위로 인정한다. ITS 돌발정보에는 방위각이 없고,
// 방향은 원문 roadDrcType(양방향 / 기점 / 종점 / 빈 값)뿐이다. 그래서 돌발정보는 아래 함수로 따로 분류한다.
//
// 분류 원칙: 확인된 것만 confirmed 로 올리고, 확인하지 못한 값은 추측해서 채우지 않는다.
//  - confirmed: 경로 위(근접)·앞쪽·방향 관련성이 모두 확인됨. 긴급 경고 후보가 될 수 있다.
//  - probable : 경로와 가깝지만 방향·위치·최신성 중 하나가 확인되지 않음. 정보성 표시 후보일 뿐 긴급 경고에 넣지 않는다.
//  - excluded : 경로 밖, 이미 통과, 반대 방향, 이미 끝남 등.

export type TravelKind = 'driving' | 'walking';
export type MatchClass = 'confirmed' | 'probable' | 'excluded';
export type MatchReason =
  // confirmed
  | 'directionBoth' // 원본이 양방향이라고 알려 줌
  | 'headingMatch' // 위험의 진행 방위(headingDeg)가 경로 방향과 일치(ITS 에는 없고, 방위를 주는 다른 출처용)
  | 'zoneOnRoute' // 구역 전체에 적용되는 등록 현황(어린이보호구역)이 경로 위(matchHazardsToRoute 가 판정). 돌발정보 분류(classifyIncidentOnRoute)는 이 값을 만들지 않는다
  // probable
  | 'directionUnknown' // 방향 정보가 비어 있음
  | 'singleDirectionUnverified' // 한쪽 방향(기점/종점)이지만 우리 경로가 그쪽인지 알 수 없음
  | 'lateralUncertain' // 후보 범위 안이지만 확정하기엔 경로에서 멀다
  | 'staleData' // 발생 시각이 너무 오래됐거나, 데이터 조회가 오래됐다
  | 'freshnessUnknown' // 발생 시각이 없어 최신성을 알 수 없다(사고·정체)
  | 'positionUncertain' // GPS 정확도가 낮거나 위험이 내 위치와 오차 범위 안이라 앞인지 뒤인지 확신할 수 없다
  | 'walkingNotConfirmable' // 돌발정보는 차량 통행 정보라 도보 경로에서는 확정하지 않는다
  // excluded
  | 'offRoute'
  | 'passed'
  | 'oppositeDirection'
  | 'ended'
  | 'notStarted'
  | 'missingLocation'
  | 'notApplicable'; // 이 이동수단과 무관한 유형(도보의 정체)

export type DirectionBasis = 'both' | 'heading' | 'unverified';
export type Freshness = 'fresh' | 'stale' | 'unknown';

export interface IncidentMatch {
  class: MatchClass;
  reason: MatchReason;
  /** 경로를 따라 내 위치에서 위험까지 남은 거리(m). 위치를 알 수 없으면 null. 음수면 오차 범위 안에서 방금 지나쳤을 수 있다 */
  distanceAlongRouteM: number | null;
  /** 경로와 위험 위치 사이 수직 거리(m) */
  lateralM: number | null;
  /** 방향 관련성을 무엇으로 확인했는지. unverified 는 확인하지 못했다는 뜻이다 */
  directionBasis: DirectionBasis;
  freshness: Freshness;
}

export interface IncidentMatchPolicy {
  /** 이 안이면 경로 후보로 본다(m). 임시 기준 — 확정 기준이 아니다 */
  candidateLateralM: number;
  /** confirmed 로 올릴 수 있는 최대 수직 거리(m) */
  confirmLateralM: number;
  /** 이만큼(m) 뒤로 지나쳤으면 통과한 위험으로 본다. GPS 정확도가 더 크면 그 값을 쓴다 */
  passedMarginM: number;
  /** GPS 정확도가 이보다 나쁘면(m) 남은 거리를 믿을 수 없어 confirmed 로 올리지 않는다 */
  maxConfirmAccuracyM: number;
  /** 발생 후 이 시간(ms)이 지나면 오래된 정보로 본다. 없는 유형은 시간으로 판단하지 않는다(장기 공사) */
  maxStartedAgeMs: Partial<Record<RoadAlert['type'], number>>;
  /** 이 이동수단에서 넘을 수 없는 최고 등급 */
  maxClass: 'confirmed' | 'probable';
  /** 이 이동수단과 무관해서 제외하는 유형 */
  notApplicableTypes: RoadAlert['type'][];
}

const HOUR_MS = 60 * 60 * 1000;

// 숫자는 모두 설계상 임시 기준이다. 실제 ITS 좌표 정밀도·갱신 주기로 검증하지 못했다(docs/HAZARD_PRIORITY.md).
export const INCIDENT_MATCH_POLICY: Record<TravelKind, IncidentMatchPolicy> = {
  driving: {
    candidateLateralM: MATCH_MAX_LATERAL_M,
    confirmLateralM: 15,
    passedMarginM: 30,
    maxConfirmAccuracyM: 30,
    maxStartedAgeMs: { accident: 6 * HOUR_MS, congestion: 3 * HOUR_MS },
    maxClass: 'confirmed',
    notApplicableTypes: [],
  },
  walking: {
    candidateLateralM: MATCH_MAX_LATERAL_M,
    confirmLateralM: 15,
    passedMarginM: 20,
    maxConfirmAccuracyM: 25,
    maxStartedAgeMs: { accident: 6 * HOUR_MS, congestion: 3 * HOUR_MS },
    maxClass: 'probable',
    notApplicableTypes: ['congestion'],
  },
};

export interface IncidentMatchContext {
  mode: TravelKind;
  /** 경로를 따라 진행한 거리(m) */
  progressM: number;
  /** 현재 위치의 GPS 정확도(m). 모르면 null */
  gpsAccuracyM: number | null;
  nowMs: number;
  /** 돌발정보 조회가 오래됐거나 서버가 마지막 성공 결과를 대신 내준 경우 true */
  dataStale: boolean;
}

function freshnessOf(alert: RoadAlert, policy: IncidentMatchPolicy, nowMs: number, dataStale: boolean): Freshness {
  if (dataStale) return 'stale';
  // 발생 시각의 의미(timeKind 'started')가 있는 실제 돌발정보만 시각으로 판단한다. 예시·등록 현황 데이터에는 적용하지 않는다.
  if (alert.timeKind !== 'started') return 'fresh';
  const maxAge = policy.maxStartedAgeMs[alert.type];
  if (maxAge === undefined) return 'fresh'; // 공사 등은 종료 시각(endedAt)으로만 판단한다
  const started = Date.parse(alert.updatedAt);
  if (!Number.isFinite(started)) return 'unknown';
  return nowMs - started > maxAge ? 'stale' : 'fresh';
}

/**
 * 돌발정보 하나를 경로에 대해 분류한다. 같은 경로가 한 지점을 두 번 지나면 앞으로 만날 첫 번째 통과를 기준으로 한다.
 * 진행 방향은 확인된 값만 쓴다: 양방향(directionScope 'both')이거나 위험이 방위각(headingDeg)을 줄 때만 confirmed 가 될 수 있고,
 * 한쪽 방향(single)·방향 없음(unknown)은 우리 경로가 그쪽인지 알 수 없으므로 probable 이다. 방향을 경로에서 추론해 채우지 않는다.
 * 한계: 위치만으로는 같은 도로인지 확정하지 못한다(교차하는 도로 위의 돌발정보가 교차로 근처에서 후보가 될 수 있다).
 */
export function classifyIncidentOnRoute(route: Route, alert: RoadAlert, ctx: IncidentMatchContext): IncidentMatch {
  const policy = INCIDENT_MATCH_POLICY[ctx.mode];
  const result = (
    cls: MatchClass,
    reason: MatchReason,
    extra: Partial<Pick<IncidentMatch, 'distanceAlongRouteM' | 'lateralM' | 'directionBasis'>> = {},
    freshness: Freshness = 'unknown',
  ): IncidentMatch => ({ class: cls, reason, distanceAlongRouteM: null, lateralM: null, directionBasis: 'unverified', freshness, ...extra });

  if (!Number.isFinite(alert.latitude) || !Number.isFinite(alert.longitude) || Math.abs(alert.latitude) > 90 || Math.abs(alert.longitude) > 180) {
    return result('excluded', 'missingLocation');
  }
  if (policy.notApplicableTypes.includes(alert.type)) return result('excluded', 'notApplicable');

  // 이미 끝났거나 아직 시작 전인 정보
  if (alert.endedAt) {
    const ended = Date.parse(alert.endedAt);
    if (Number.isFinite(ended) && ended <= ctx.nowMs) return result('excluded', 'ended');
  }
  if (alert.timeKind === 'started' && alert.updatedAt) {
    const started = Date.parse(alert.updatedAt);
    if (Number.isFinite(started) && started > ctx.nowMs) return result('excluded', 'notStarted');
  }
  const freshness = freshnessOf(alert, policy, ctx.nowMs, ctx.dataStale);

  const near = projections(route, alert);
  const candidates = near.filter((p) => p.lateralM <= policy.candidateLateralM);
  if (candidates.length === 0) {
    const nearest = near.reduce<number | null>((m, p) => (m === null || p.lateralM < m ? p.lateralM : m), null);
    return result('excluded', 'offRoute', { lateralM: nearest }, freshness);
  }

  // 통과 판정: GPS 정확도만큼은 앞인지 뒤인지 알 수 없다.
  const margin = Math.max(policy.passedMarginM, ctx.gpsAccuracyM ?? 0);
  const ahead = candidates.filter((p) => p.offsetM - ctx.progressM >= -margin);
  if (ahead.length === 0) {
    const last = candidates.reduce((a, b) => (b.offsetM > a.offsetM ? b : a));
    return result('excluded', 'passed', { distanceAlongRouteM: last.offsetM - ctx.progressM, lateralM: last.lateralM }, freshness);
  }

  // 방향: 방위각이 있으면 경로 방향과 비교해 반대면 제외한다. 없으면 양방향으로 확인된 경우만 방향 관련성을 인정한다.
  let pool = ahead;
  let basis: DirectionBasis = 'unverified';
  if (alert.headingDeg != null) {
    const heading = alert.headingDeg;
    pool = ahead.filter((p) => angleDiff(p.bearingDeg, heading) <= MATCH_MAX_HEADING_DIFF_DEG);
    if (pool.length === 0) {
      const p = ahead[0];
      return result('excluded', 'oppositeDirection', { distanceAlongRouteM: p.offsetM - ctx.progressM, lateralM: p.lateralM }, freshness);
    }
    basis = 'heading';
  } else if (alert.directionScope === 'both') {
    basis = 'both';
  }

  const pick = pool.reduce((a, b) => (b.offsetM < a.offsetM ? b : a));
  const distance = pick.offsetM - ctx.progressM;
  const base = { distanceAlongRouteM: distance, lateralM: pick.lateralM, directionBasis: basis };

  // 확정하지 못하는 이유를 우선순위대로 하나만 알린다(여럿이어도 probable).
  let reason: MatchReason | null = null;
  if (policy.maxClass === 'probable') reason = 'walkingNotConfirmable';
  else if (basis === 'unverified') reason = alert.directionScope === 'single' ? 'singleDirectionUnverified' : 'directionUnknown';
  else if (pick.lateralM > policy.confirmLateralM) reason = 'lateralUncertain';
  else if (freshness === 'stale') reason = 'staleData';
  else if (freshness === 'unknown') reason = 'freshnessUnknown';
  else if (ctx.gpsAccuracyM != null && ctx.gpsAccuracyM > policy.maxConfirmAccuracyM) reason = 'positionUncertain';
  else if (distance < 0) reason = 'positionUncertain';

  if (reason) return result('probable', reason, base, freshness);
  return result('confirmed', basis === 'both' ? 'directionBoth' : 'headingMatch', base, freshness);
}
