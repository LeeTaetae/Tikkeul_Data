// 위험 우선순위 엔진(HazardPriorityEngine). 경로 매칭(routeHazards.classifyIncidentOnRoute) 결과를 받아
// 중복을 없애고 P0~P3 우선순위와 표시·긴급 경고 자격을 정한다. React 에 의존하지 않는 순수 함수만 둔다.
// 점수 구성·임계값·근거는 docs/HAZARD_PRIORITY.md 에 있다. 모든 숫자는 설계상 임시 기준이며 실제 데이터로 검증하지 못했다.
//
// 원칙
//  - P0 는 "확정(confirmed)된, 앞쪽의, 가까운" 위험에서만 나온다. 점수가 높아도 이 조건이 없으면 P0 가 아니다.
//  - probable 은 P0·P1 이 될 수 없고, 긴급 경고 대상(urgentEligible)이 아니다.
//  - 유형(사고·공사·정체)과 통제 정도(closure)는 점수의 일부일 뿐, 그것만으로 긴급도를 정하지 않는다.
//    특히 closure 'full' 은 ITS 명세로 확인되지 않은 문자열 패턴이라 작은 가점만 주고 P0 조건에 쓰지 않는다.
//  - 확인되지 않은 값(속도·거리)은 추측하지 않고 null 로 둔다.
//  - revision 은 쓰지 않는다. 같은 사건은 eventKey(없으면 id)로 하나로 합친다.
import type { AlertSeverity, RoadAlert } from '../types/alert';
import type { IncidentMatch, MatchClass, TravelKind } from './routeHazards';

export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

/** [상한, 점수] 목록. 값이 상한 이하이면 그 점수를 준다(앞에서부터 처음 맞는 것). */
type Bands = ReadonlyArray<readonly [number, number]>;

export interface PriorityPolicy {
  /** 경로상 남은 거리(m)별 근접 점수 */
  proximityBands: Bands;
  /** 도달 예상 시간(초)별 점수. 속도를 모르면 이 항목은 0 이다 */
  ttcBands: Bands;
  /** 속도가 이보다 느리면 정지로 보고 TTC 를 계산하지 않는다(m/s) */
  minSpeedMps: number;
  /** P0 허용 거리(m). 속도를 알 때는 TTC 조건도 함께 본다 */
  p0MaxDistanceM: number;
  p0MaxTtcSec: number;
  /** 속도를 모를 때(TTC 없음) P0 허용 거리는 p0MaxDistanceM 의 이 비율로 더 좁힌다 */
  p0NoTtcDistanceRatio: number;
  p0MinScore: number;
  p1MinScore: number;
  p2ConfirmedMinScore: number;
  p2ProbableMinScore: number;
}

// 자동차와 도보는 속도가 달라 같은 거리의 뜻이 다르다. 거리·시간 띠를 따로 둔다.
export const PRIORITY_POLICY: Record<TravelKind, PriorityPolicy> = {
  driving: {
    proximityBands: [[100, 25], [300, 20], [500, 14], [1000, 8], [2000, 4]],
    ttcBands: [[10, 15], [20, 12], [40, 8], [90, 4]],
    minSpeedMps: 0.5,
    p0MaxDistanceM: 300,
    p0MaxTtcSec: 30,
    p0NoTtcDistanceRatio: 0.5,
    p0MinScore: 70,
    p1MinScore: 45,
    p2ConfirmedMinScore: 25,
    p2ProbableMinScore: 20,
  },
  walking: {
    proximityBands: [[30, 25], [100, 20], [200, 14], [400, 8], [800, 4]],
    ttcBands: [[15, 15], [40, 12], [90, 8], [180, 4]],
    minSpeedMps: 0.3,
    p0MaxDistanceM: 50,
    p0MaxTtcSec: 60,
    p0NoTtcDistanceRatio: 0.5,
    p0MinScore: 70,
    p1MinScore: 45,
    p2ConfirmedMinScore: 25,
    p2ProbableMinScore: 20,
  },
};

// 점수 구성(합 최대 95). 가중치는 같은 상황에서 "무엇이 더 위험한가"의 상대적 순서만 정한다.
export const TYPE_POINTS: Record<RoadAlert['type'], number> = { accident: 30, construction: 20, school_zone: 25, congestion: 12 };
export const SEVERITY_POINTS: Record<AlertSeverity, number> = { danger: 15, caution: 8, busy: 4 };
export const FRESH_POINTS = 5;
/** 통제 정도 가점. full 은 문자열 패턴으로 읽은 미확인 값이라 partial 보다 약간만 더 준다 */
export const CLOSURE_POINTS = { full: 5, partial: 2, unknown: 0, none: 0 } as const;
/** 확정 여부에 따른 배율. probable 은 점수를 절반으로 줄여 높은 점수가 나와도 확정 위험보다 앞서지 않게 한다 */
export const CONFIDENCE_FACTOR: Record<Exclude<MatchClass, 'excluded'>, number> = { confirmed: 1, probable: 0.5 };
/** 출력용 신뢰도(0~1). 점수 배율과는 별개로 "얼마나 확인됐는가"를 나타낸다 */
export const MATCH_CONFIDENCE = { confirmed: 0.9, probableFresh: 0.5, probableStale: 0.35, excluded: 0 } as const;

export type PriorityReason =
  | 'confirmedImminent' // P0
  | 'confirmedHighScore' // P1
  | 'confirmedModerate' // P2
  | 'probableInformational' // P2·P3: 확정되지 않아 정보성으로만
  | 'lowScore' // P3
  | 'excluded'; // 경로와 무관·통과·반대 방향 등. 이유는 matchReason

export interface PriorityInput {
  alert: RoadAlert;
  match: IncidentMatch;
}

export interface PriorityContext {
  mode: TravelKind;
  /** 현재 속도(m/s). 모르면 null — 그러면 TTC 는 null 이다 */
  speedMps: number | null;
}

export interface PrioritizedHazard {
  alert: RoadAlert;
  /** 중복 판정 키(eventKey, 없으면 id). revision 은 쓰지 않는다 */
  dedupeKey: string;
  priority: Priority;
  matchClass: MatchClass;
  /** 0~1. 얼마나 확인됐는가 */
  matchConfidence: number;
  reason: PriorityReason;
  /** 경로 매칭이 알려 준 이유(왜 confirmed/probable/excluded 인지) */
  matchReason: IncidentMatch['reason'];
  /** 정보의 최신성(매칭 결과 그대로). 화면이 오래된 위험을 강조하지 않게 하는 데 쓴다 */
  freshness: IncidentMatch['freshness'];
  distanceAlongRouteM: number | null;
  /** 도달 예상 시간(초). 속도를 모르거나 정지 중이면 null */
  ttcSec: number | null;
  /** 점수(0~95). 우선순위 정렬과 문서화용. 긴급 여부는 점수가 아니라 priority·matchClass 로 정한다 */
  score: number;
  /** 화면에 정보로 보여줄 수 있는가(excluded 가 아님) */
  displayEligible: boolean;
  /** 기존 단계별 긴급 경고(500·300·100m)에 넣을 수 있는가: confirmed 이고 앞쪽이며 P0~P2 */
  urgentEligible: boolean;
}

const bandPoints = (value: number, bands: Bands): number => {
  for (const [limit, points] of bands) if (value <= limit) return points;
  return 0;
};

export function ttcOf(distanceM: number | null, speedMps: number | null, policy: PriorityPolicy): number | null {
  if (distanceM === null || speedMps === null || !(speedMps >= policy.minSpeedMps)) return null;
  return Math.max(0, distanceM) / speedMps;
}

export function dedupeKeyOf(alert: Pick<RoadAlert, 'id' | 'eventKey'>): string {
  return alert.eventKey || alert.id;
}

function rank(input: PriorityInput): [number, number, number] {
  // 같은 사건의 여러 항목 중 고를 기준: 확정 > 후보, 더 가까운 것, 발생 시각이 늦은 것
  const cls = input.match.class === 'confirmed' ? 0 : input.match.class === 'probable' ? 1 : 2;
  const dist = Math.abs(input.match.distanceAlongRouteM ?? Number.MAX_SAFE_INTEGER);
  const started = Date.parse(input.alert.updatedAt);
  return [cls, dist, Number.isFinite(started) ? -started : 0];
}

function better(a: PriorityInput, b: PriorityInput): PriorityInput {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? a : b;
  return a;
}

/** 같은 사건(eventKey, 없으면 id)을 하나로 합친다. 입력 순서와 revision 은 결과에 영향을 주지 않는다. */
export function dedupeInputs(inputs: PriorityInput[]): PriorityInput[] {
  const byKey = new Map<string, PriorityInput>();
  for (const input of inputs) {
    const key = dedupeKeyOf(input.alert);
    const prev = byKey.get(key);
    byKey.set(key, prev ? better(prev, input) : input);
  }
  return [...byKey.values()];
}

function scoreOf(input: PriorityInput, distance: number | null, ttcSec: number | null, policy: PriorityPolicy) {
  const { alert, match } = input;
  const parts = {
    type: TYPE_POINTS[alert.type],
    severity: SEVERITY_POINTS[alert.severity],
    proximity: distance === null ? 0 : bandPoints(Math.max(0, distance), policy.proximityBands),
    ttc: ttcSec === null ? 0 : bandPoints(ttcSec, policy.ttcBands),
    freshness: match.freshness === 'fresh' ? FRESH_POINTS : 0,
    closure: alert.closure ? CLOSURE_POINTS[alert.closure] : 0,
  };
  const raw = Object.values(parts).reduce((sum, v) => sum + v, 0);
  const factor = match.class === 'excluded' ? 0 : CONFIDENCE_FACTOR[match.class];
  return { score: Math.round(raw * factor * 10) / 10, parts };
}

function prioritizeOne(input: PriorityInput, ctx: PriorityContext): PrioritizedHazard {
  const policy = PRIORITY_POLICY[ctx.mode];
  const { alert, match } = input;
  const distance = match.distanceAlongRouteM;
  const ttcSec = ttcOf(distance, ctx.speedMps, policy);
  const { score } = scoreOf(input, distance, ttcSec, policy);
  const base = {
    alert,
    dedupeKey: dedupeKeyOf(alert),
    matchClass: match.class,
    matchReason: match.reason,
    freshness: match.freshness,
    distanceAlongRouteM: distance,
    ttcSec,
    score,
  };

  if (match.class === 'excluded') {
    return { ...base, priority: 'P3', matchConfidence: MATCH_CONFIDENCE.excluded, reason: 'excluded', displayEligible: false, urgentEligible: false };
  }

  const ahead = distance !== null && distance > 0;
  let priority: Priority;
  let reason: PriorityReason;
  if (match.class === 'confirmed') {
    // P0: 확정 + 앞쪽 + 최신 + 가까움(속도를 알면 TTC 도, 모르면 더 좁은 거리) + 점수. 하나라도 빠지면 P0 가 아니다.
    const maxDistance = ttcSec === null ? policy.p0MaxDistanceM * policy.p0NoTtcDistanceRatio : policy.p0MaxDistanceM;
    const imminent =
      ahead &&
      match.freshness === 'fresh' &&
      distance <= maxDistance &&
      (ttcSec === null || ttcSec <= policy.p0MaxTtcSec) &&
      score >= policy.p0MinScore;
    if (imminent) [priority, reason] = ['P0', 'confirmedImminent'];
    else if (score >= policy.p1MinScore) [priority, reason] = ['P1', 'confirmedHighScore'];
    else if (score >= policy.p2ConfirmedMinScore) [priority, reason] = ['P2', 'confirmedModerate'];
    else [priority, reason] = ['P3', 'lowScore'];
  } else {
    // probable: 최고 P2. P0·P1 이 될 수 없다.
    if (score >= policy.p2ProbableMinScore) [priority, reason] = ['P2', 'probableInformational'];
    else [priority, reason] = ['P3', 'probableInformational'];
  }

  const matchConfidence =
    match.class === 'confirmed' ? MATCH_CONFIDENCE.confirmed : match.freshness === 'stale' ? MATCH_CONFIDENCE.probableStale : MATCH_CONFIDENCE.probableFresh;
  return {
    ...base,
    priority,
    matchConfidence,
    reason,
    displayEligible: true,
    urgentEligible: match.class === 'confirmed' && ahead && priority !== 'P3',
  };
}

const ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * 경로 매칭 결과를 중복 제거한 뒤 우선순위를 매겨 중요한 순으로 돌려준다(P0 → P3, 같으면 점수 높은 것, 더 가까운 것).
 * excluded 도 결과에 남기되 displayEligible·urgentEligible 이 false 다(호출한 쪽이 이유를 볼 수 있게).
 */
export function prioritizeHazards(inputs: PriorityInput[], ctx: PriorityContext): PrioritizedHazard[] {
  return dedupeInputs(inputs)
    .map((input) => prioritizeOne(input, ctx))
    .sort(
      (a, b) =>
        ORDER[a.priority] - ORDER[b.priority] ||
        b.score - a.score ||
        (a.distanceAlongRouteM ?? Number.MAX_SAFE_INTEGER) - (b.distanceAlongRouteM ?? Number.MAX_SAFE_INTEGER) ||
        a.dedupeKey.localeCompare(b.dedupeKey),
    );
}
