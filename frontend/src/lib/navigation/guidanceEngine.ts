// 길안내 엔진: GPS 위치 → 경로 진행·이탈·도착·남은 시간. React·expo 에 의존하지 않는 순수 코드만 둔다(Node 로 테스트).
// 이 저장소의 순수 모듈은 서로 런타임 import 를 하지 않아야 Node 로 바로 테스트할 수 있어서(확장자 없는 import 불가),
// 정책·기하·판정·추적 컨트롤러를 한 파일에 구역을 나눠 둔다. 화면은 useGuidanceTracking 훅만 쓰면 된다.
//
// 한계(중요):
//  - 아래 정책 숫자(이탈 거리·연속 횟수·도착 반경 등)는 설계상 임시 기준이다. 실제 주행·보행 GPS 로 검증하지 못했다.
//  - ETA 는 "기존 경로 소요시간 × 남은 거리 비율"의 근사값이다. 실시간 교통을 반영하지 않는다.
//  - 경로 매칭은 좌표 기하만 쓴다. 평행한 인접 도로·고가/지하 분리 도로를 구분하지 못한다.
import type { RouteGuide } from '../../map/parseRoutes';
import type { RouteInstruction, StyledRoute } from '../../map/navigationApi';
import type { LocationFailure } from '../location/failure';

// ───────────────────────── 1. 타입·정책 ─────────────────────────

export type GuidanceMode = 'driving' | 'walking';

export interface LatLng {
  lat: number;
  lng: number;
}

/** 안내용 경로. 재탐색해서 받은 경로는 반드시 새 id 를 달아야 이전 진행 상태가 새 경로에 적용되지 않는다. */
export interface NavRoute {
  id: string;
  /** 'api' 는 백엔드가 준 실제 경로, 'mock' 은 개발용 가상 경로(src/dev) */
  source: 'api' | 'mock';
  mode: GuidanceMode;
  path: LatLng[];
  /** 경로 응답의 전체 거리(m). GPS 위치를 받기 전 화면 표시용이다(진행 계산은 path 로 한다) */
  distanceM?: number;
  /** 기존 경로 응답의 소요시간(초). 없으면 ETA 를 계산하지 않는다 */
  durationSec?: number;
  /** include_guides 로 받았을 때만 있다. 없으면 다음 회전 안내는 만들지 않는다 */
  guides?: RouteGuide[];
  /** 턴바이턴 안내 문구와 안내 지점(point). 팀 TTS(useTurnInstructionSpeech)가 그 지점 근처에서 읽는다 */
  instructions?: RouteInstruction[];
}

export interface Fix {
  lat: number;
  lng: number;
  /** 수평 정확도(m). 모르면 null */
  accuracyM: number | null;
  timestampMs: number;
}

export interface GuidancePolicy {
  /** 이보다 정확도가 나쁜(큰) 위치는 판정에 쓰지 않는다(m) */
  maxAccuracyM: number;
  /** 경로에서 이만큼 벗어나면 이탈 관측 1회. 정확도가 나쁘면 accuracy × offRouteAccuracyFactor 로 넓힌다(m) */
  offRouteBaseM: number;
  offRouteAccuracyFactor: number;
  /** 이탈로 확정하려면 이탈 관측이 이만큼 연속이고, 첫 관측 후 이 시간 이상 지나야 한다 */
  offRouteConsecutive: number;
  offRouteMinDurationMs: number;
  /** 재탐색 요청 사이 최소 간격(ms). 실패해도 이 간격이 지나야 다시 요청한다 */
  rerouteCooldownMs: number;
  /** 도착 반경 = arrivalRadiusM + min(정확도, arrivalAccuracyCapM) */
  arrivalRadiusM: number;
  arrivalAccuracyCapM: number;
  arrivalConsecutive: number;
  /** 두 위치 사이 속도가 maxSpeedMps 를 넘고 거리가 jumpMinM 보다 길면 위치 점프로 본다 */
  maxSpeedMps: number;
  jumpMinM: number;
  /** 점프가 이만큼 연속으로 같은 곳을 가리키면 실제 이동으로 받아들인다 */
  jumpAcceptAfter: number;
  /** 새 위치가 이만큼(ms) 없으면 신호 끊김 */
  signalLostMs: number;
  /** 진행 위치를 찾을 때 현재 진행보다 이만큼 뒤까지 본다(m). 진행률 자체는 절대 줄지 않는다 */
  backToleranceM: number;
}

// 자동차·도보 정책은 서로 다른 숫자를 쓴다(같은 이탈 거리라도 도보는 더 민감하고, 도착 반경은 더 좁다).
export const GUIDANCE_POLICY: Record<GuidanceMode, GuidancePolicy> = {
  driving: {
    maxAccuracyM: 50,
    offRouteBaseM: 40,
    offRouteAccuracyFactor: 1.5,
    offRouteConsecutive: 3,
    offRouteMinDurationMs: 4000,
    rerouteCooldownMs: 20_000,
    arrivalRadiusM: 25,
    arrivalAccuracyCapM: 25,
    arrivalConsecutive: 2,
    maxSpeedMps: 60,
    jumpMinM: 100,
    jumpAcceptAfter: 3,
    signalLostMs: 10_000,
    backToleranceM: 30,
  },
  walking: {
    maxAccuracyM: 40,
    offRouteBaseM: 30,
    offRouteAccuracyFactor: 1.5,
    offRouteConsecutive: 4,
    offRouteMinDurationMs: 8000,
    rerouteCooldownMs: 15_000,
    arrivalRadiusM: 15,
    arrivalAccuracyCapM: 20,
    arrivalConsecutive: 2,
    maxSpeedMps: 6,
    jumpMinM: 30,
    jumpAcceptAfter: 3,
    signalLostMs: 15_000,
    backToleranceM: 15,
  },
};

/** 한 번의 위치 갱신 사이에 경로를 따라 앞으로 갈 수 있는 최소 탐색 범위(m) */
const MIN_FORWARD_WINDOW_M = 150;
/** 위치 갱신 간격이 이보다 길어도 이 값으로 본다(초). 탐색 범위가 무한정 커지지 않게 한다 */
const MAX_GAP_SEC = 120;
/** 이동 속도를 잴 때 쓰는 위치 간격의 상한(초). 이보다 벌어지면 속도를 모르는 것으로 둔다 */
const SPEED_MAX_GAP_SEC = 10;
/** 속도 지수 평균의 새 값 비중 */
const SPEED_SMOOTHING = 0.4;
/** Tmap turnType 11 = 직진. 다음 "회전" 안내에서는 건너뛴다(코드표는 Tmap 문서 기준이며 실제 응답으로 확인하지 못했다) */
const TURN_STRAIGHT = 11;

export type GuidanceStatus = 'onRoute' | 'offRoute' | 'arrived' | 'invalidRoute';
export type IgnoredReason = 'invalidFix' | 'lowAccuracy' | 'jump';
export type GuidanceEvent = 'rerouteNeeded' | 'arrived';

export interface GuidanceEta {
  remainingSec: number;
  arrivalAtMs: number;
  /** 항상 true: 경로 소요시간을 남은 거리 비율로 나눈 근사값이다 */
  approximate: true;
  /** 항상 false: 실시간 교통을 반영하지 않았다. "실시간 교통 기반 ETA" 로 표시하면 안 된다 */
  realtimeTraffic: false;
}

export interface GuidanceSnapshot {
  status: GuidanceStatus;
  /** 이번 위치를 판정에 썼는지. false 면 아래 값은 직전 상태 그대로다 */
  fixUsed: boolean;
  ignoredReason: IgnoredReason | null;
  progressM: number;
  totalM: number;
  remainingM: number;
  /** 0~1. 줄어들지 않는다 */
  fraction: number;
  /** 이번 위치와 경로 사이 거리(m). 위치를 쓰지 않았으면 null */
  lateralM: number | null;
  /** guides 가 없거나 남은 회전 지점이 없으면 null */
  nextTurn: { guide: RouteGuide; distanceM: number } | null;
  /** 경로 소요시간이 없으면 null */
  eta: GuidanceEta | null;
  /** 최근 위치들로 잰 이동 속도(m/s). 아직 모르면 null(위험 도달 시간 TTC 를 계산하지 않는다) */
  speedMps: number | null;
  /** 이번 갱신에서 새로 생긴 사건. 같은 사건은 한 번만 나온다 */
  events: GuidanceEvent[];
}

export interface GuidanceState {
  routeId: string;
  progressM: number;
  status: GuidanceStatus;
  lastFix: Fix | null;
  jumpRejects: number;
  offRouteCount: number;
  offRouteSinceMs: number | null;
  rerouteRequestedAtMs: number | null;
  rerouteInFlight: boolean;
  arrivalCount: number;
  arrived: boolean;
  /** 이동 속도(m/s)의 지수 평균. 위치 간격이 너무 벌어졌으면 null */
  speedMps: number | null;
}

export function initialState(routeId: string): GuidanceState {
  return {
    routeId,
    progressM: 0,
    status: 'onRoute',
    lastFix: null,
    jumpRejects: 0,
    offRouteCount: 0,
    offRouteSinceMs: null,
    rerouteRequestedAtMs: null,
    rerouteInFlight: false,
    arrivalCount: 0,
    arrived: false,
    speedMps: null,
  };
}

/** 경로 응답(StyledRoute)을 안내용 경로로 바꾼다. 재탐색 결과는 새 id 를 넘겨야 한다. */
export function toNavRoute(route: StyledRoute, mode: GuidanceMode, id: string, source: NavRoute['source'] = 'api'): NavRoute {
  const durationSec = route.durationMin > 0 ? route.durationMin * 60 : undefined;
  const distanceM = route.distanceKm > 0 ? route.distanceKm * 1000 : undefined;
  return { id, source, mode, path: route.path, distanceM, durationSec, guides: route.guides, instructions: route.instructions };
}

// ───────────────────────── 2. 기하 ─────────────────────────

const M_PER_DEG = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 두 좌표 사이 거리(m). 수 km 이내에서 오차가 작은 평면 근사다. */
function distanceM(a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

interface RouteIndex {
  originLat: number;
  originLng: number;
  k: number;
  xs: number[];
  ys: number[];
  /** cumM[i] = 경로 시작부터 i 번째 점까지 거리(m) */
  cumM: number[];
  totalM: number;
}

// 경로가 바뀌지 않는 동안 매 위치마다 다시 만들지 않는다.
const indexCache = new WeakMap<LatLng[], RouteIndex>();

function routeIndex(path: LatLng[]): RouteIndex {
  const cached = indexCache.get(path);
  if (cached) return cached;
  const o = path[0] ?? { lat: 0, lng: 0 };
  const k = Math.cos(toRad(o.lat));
  const xs = path.map((p) => (p.lng - o.lng) * M_PER_DEG * k);
  const ys = path.map((p) => (p.lat - o.lat) * M_PER_DEG);
  const cumM: number[] = [];
  let sum = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) sum += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    cumM.push(sum);
  }
  const index = { originLat: o.lat, originLng: o.lng, k, xs, ys, cumM, totalM: sum };
  indexCache.set(path, index);
  return index;
}

interface Projection {
  lateralM: number;
  offsetM: number;
}

// 위치를 경로의 선분들에 투영해 가장 가까운 것을 돌려준다. range 를 주면 그 거리 구간과 겹치는 선분만 본다.
function project(index: RouteIndex, p: LatLng, range?: { from: number; to: number }): Projection | null {
  const px = (p.lng - index.originLng) * M_PER_DEG * index.k;
  const py = (p.lat - index.originLat) * M_PER_DEG;
  let best: Projection | null = null;
  for (let i = 0; i < index.xs.length - 1; i++) {
    const start = index.cumM[i];
    const end = index.cumM[i + 1];
    if (end === start) continue; // 길이 0 선분
    if (range && (end < range.from || start > range.to)) continue;
    const dx = index.xs[i + 1] - index.xs[i];
    const dy = index.ys[i + 1] - index.ys[i];
    const len = end - start;
    const t = Math.min(1, Math.max(0, ((px - index.xs[i]) * dx + (py - index.ys[i]) * dy) / (len * len)));
    const lateralM = Math.hypot(px - (index.xs[i] + t * dx), py - (index.ys[i] + t * dy));
    if (!best || lateralM < best.lateralM) best = { lateralM, offsetM: start + t * len };
  }
  return best;
}

// ───────────────────────── 3. 판정 ─────────────────────────

const isValidFix = (f: Fix) =>
  Number.isFinite(f.lat) && Number.isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 && Number.isFinite(f.timestampMs);

// 지나온 곳(progress 이하)과 출발점(S)·직진은 건너뛰고, 앞으로 만날 첫 안내 지점을 찾는다.
function findNextTurn(route: NavRoute, index: RouteIndex, progressM: number) {
  if (!route.guides) return null;
  const last = route.path.length - 1;
  let best: { guide: RouteGuide; offsetM: number } | null = null;
  for (const guide of route.guides) {
    if (guide.pointType === 'S' || guide.turnType === TURN_STRAIGHT) continue;
    const offsetM = index.cumM[Math.min(Math.max(guide.pathIndex, 0), last)];
    if (offsetM <= progressM + 1) continue;
    if (!best || offsetM < best.offsetM) best = { guide, offsetM };
  }
  return best ? { guide: best.guide, distanceM: best.offsetM - progressM } : null;
}

function buildSnapshot(
  route: NavRoute,
  index: RouteIndex,
  state: GuidanceState,
  extra: { fixUsed: boolean; ignoredReason: IgnoredReason | null; lateralM: number | null; events: GuidanceEvent[]; nowMs: number },
): GuidanceSnapshot {
  const totalM = index.totalM;
  const progressM = state.arrived ? totalM : Math.min(state.progressM, totalM);
  const remainingM = Math.max(0, totalM - progressM);
  const eta =
    route.durationSec && route.durationSec > 0 && totalM > 0
      ? (() => {
          const remainingSec = route.durationSec * (remainingM / totalM);
          return { remainingSec, arrivalAtMs: extra.nowMs + remainingSec * 1000, approximate: true as const, realtimeTraffic: false as const };
        })()
      : null;
  return {
    status: state.status,
    fixUsed: extra.fixUsed,
    ignoredReason: extra.ignoredReason,
    progressM,
    totalM,
    remainingM,
    fraction: totalM > 0 ? progressM / totalM : 0,
    lateralM: extra.lateralM,
    nextTurn: state.arrived ? null : findNextTurn(route, index, progressM),
    eta,
    speedMps: state.speedMps,
    events: extra.events,
  };
}

export interface AdvanceResult {
  state: GuidanceState;
  snapshot: GuidanceSnapshot;
}

/**
 * 위치 하나를 반영해 다음 상태와 화면용 스냅샷을 돌려준다. state 를 직접 바꾸지 않는다.
 * state.routeId 가 route.id 와 다르면(재탐색·다른 경로) 이전 상태를 버리고 새로 시작한다.
 */
export function advance(prev: GuidanceState | null, fix: Fix, route: NavRoute, policy: GuidancePolicy = GUIDANCE_POLICY[route.mode]): AdvanceResult {
  const index = routeIndex(route.path);
  let state = prev && prev.routeId === route.id ? prev : initialState(route.id);

  if (index.totalM <= 0) {
    state = { ...state, status: 'invalidRoute' };
    return { state, snapshot: buildSnapshot(route, index, state, { fixUsed: false, ignoredReason: null, lateralM: null, events: [], nowMs: fix.timestampMs }) };
  }

  const ignore = (reason: IgnoredReason, next: GuidanceState = state): AdvanceResult => ({
    state: next,
    snapshot: buildSnapshot(route, index, next, { fixUsed: false, ignoredReason: reason, lateralM: null, events: [], nowMs: fix.timestampMs }),
  });

  // 도착한 뒤에는 더 판정하지 않는다(추적은 컨트롤러가 끝낸다).
  if (state.arrived) return ignore('invalidFix');

  const last = state.lastFix;
  if (!isValidFix(fix) || (last && fix.timestampMs < last.timestampMs)) return ignore('invalidFix');
  if (fix.accuracyM != null && fix.accuracyM > policy.maxAccuracyM) return ignore('lowAccuracy');

  // 위치 점프: 직전에 받아들인 위치에서 물리적으로 갈 수 없는 속도로 멀어졌으면 한 번은 믿지 않는다.
  // 같은 곳이 연속으로 jumpAcceptAfter 번 나오면 실제로 이동한 것(터널 통과 후 등)으로 받아들인다.
  let gapSec = 0;
  let speedMps: number | null = null; // 이동 속도: 위치 간격이 충분히 짧고 물리적으로 가능한 값일 때만 갱신한다
  if (last) {
    const rawGapSec = (fix.timestampMs - last.timestampMs) / 1000;
    gapSec = Math.min(MAX_GAP_SEC, Math.max(1, rawGapSec));
    const moved = distanceM(last, fix);
    if (moved > policy.jumpMinM && moved / gapSec > policy.maxSpeedMps) {
      const rejects = state.jumpRejects + 1;
      if (rejects < policy.jumpAcceptAfter) return ignore('jump', { ...state, jumpRejects: rejects });
    } else if (rawGapSec > 0 && rawGapSec <= SPEED_MAX_GAP_SEC && moved / rawGapSec <= policy.maxSpeedMps) {
      const instant = moved / rawGapSec;
      speedMps = state.speedMps === null ? instant : state.speedMps * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING;
    }
  }
  const accuracy = fix.accuracyM ?? 0;
  const offRouteLimitM = Math.max(policy.offRouteBaseM, accuracy * policy.offRouteAccuracyFactor);

  // 진행 위치 찾기: 직전 진행 근처(앞쪽은 이동 가능한 거리만큼)에서 먼저 찾아, 경로가 자기 자신 옆을 지나도 엉뚱한 구간에 붙지 않게 한다.
  // 그 범위에 경로가 없으면(건너뛴 경우) 경로 전체에서 찾는다.
  let found: Projection | null = null;
  if (last) {
    const forwardM = Math.max(MIN_FORWARD_WINDOW_M, policy.maxSpeedMps * gapSec);
    found = project(index, fix, { from: state.progressM - policy.backToleranceM, to: state.progressM + forwardM });
  }
  if (!found || found.lateralM > offRouteLimitM) {
    const global = project(index, fix);
    if (global && (!found || global.lateralM < found.lateralM)) found = global;
  }
  if (!found) return ignore('invalidFix');

  const onRoute = found.lateralM <= offRouteLimitM;
  const events: GuidanceEvent[] = [];
  // 진행률은 앞으로만 간다. 이탈 중인 위치로는 진행을 옮기지 않는다.
  const progressM = onRoute ? Math.max(state.progressM, found.offsetM) : state.progressM;

  // 이탈: 이탈 관측이 연속으로 쌓이고 시간도 지나야 확정한다. 한 번이라도 경로 위로 돌아오면 처음부터 센다.
  let offRouteCount = 0;
  let offRouteSinceMs: number | null = null;
  let status: GuidanceStatus = 'onRoute';
  if (!onRoute) {
    offRouteCount = state.offRouteCount + 1;
    offRouteSinceMs = state.offRouteSinceMs ?? fix.timestampMs;
    const confirmed = offRouteCount >= policy.offRouteConsecutive && fix.timestampMs - offRouteSinceMs >= policy.offRouteMinDurationMs;
    if (confirmed || state.status === 'offRoute') status = 'offRoute';
  }

  // 재탐색 요청: 진행 중이면 다시 요청하지 않고, 쿨다운이 지나야 다음 요청을 낸다.
  let { rerouteInFlight, rerouteRequestedAtMs } = state;
  if (
    status === 'offRoute' &&
    !rerouteInFlight &&
    (rerouteRequestedAtMs === null || fix.timestampMs - rerouteRequestedAtMs >= policy.rerouteCooldownMs)
  ) {
    events.push('rerouteNeeded');
    rerouteInFlight = true;
    rerouteRequestedAtMs = fix.timestampMs;
  }

  // 도착: 도착 반경 안에 연속으로 들어와야 한다. 경로 절반도 못 온 채 출발점=도착점 근처인 경우는 제외한다.
  const destination = route.path[route.path.length - 1];
  const radiusM = policy.arrivalRadiusM + Math.min(accuracy, policy.arrivalAccuracyCapM);
  const nearDestination = distanceM(fix, destination) <= radiusM && progressM >= index.totalM * 0.5;
  const arrivalCount = nearDestination ? state.arrivalCount + 1 : 0;
  const arrived = arrivalCount >= policy.arrivalConsecutive;
  if (arrived) {
    status = 'arrived';
    events.push('arrived');
  }

  const next: GuidanceState = {
    routeId: route.id,
    progressM,
    status,
    lastFix: fix,
    jumpRejects: 0,
    offRouteCount,
    offRouteSinceMs,
    rerouteRequestedAtMs,
    rerouteInFlight,
    arrivalCount,
    arrived,
    speedMps,
  };
  return {
    state: next,
    snapshot: buildSnapshot(route, index, next, { fixUsed: true, ignoredReason: null, lateralM: found.lateralM, events, nowMs: fix.timestampMs }),
  };
}

/** 재탐색 요청이 끝났다(성공·실패 모두). 실패하면 쿨다운이 지난 뒤 다시 요청한다. 성공하면 새 경로 id 로 상태가 새로 시작된다. */
export function rerouteFinished(state: GuidanceState): GuidanceState {
  return { ...state, rerouteInFlight: false };
}

/**
 * 이 속도(m/s) 이상으로 움직이던 중에만 "신호 끊김"으로 본다. 브라우저는 위치가 바뀔 때만 위치를 주므로, 멈춰 있거나 GPS 없이
 * Wi-Fi 위치만 쓰는 PC 에서는 콜백이 오래 안 오는 게 정상이다. 속도를 모르면(위치를 한 번만 받음) 움직이던 중이 아니라고 본다.
 */
export const SIGNAL_LOST_MIN_SPEED_MPS = 1.5;

/** 마지막 위치를 받은 뒤 signalLostMs 이상 지났으면 true */
export function isSignalLost(lastFixAtMs: number | null, nowMs: number, policy: GuidancePolicy): boolean {
  return lastFixAtMs !== null && nowMs - lastFixAtMs >= policy.signalLostMs;
}

// ───────────────────────── 4. 추적 컨트롤러 ─────────────────────────
// 위치 구독의 시작·정지·재시작·신호 끊김을 맡는다. 실제 위치 소스는 port 로 주입해서 expo-location 없이도 테스트한다.

export interface LocationSubscription {
  remove: () => void;
}

export interface LocationPort {
  /** 위치 권한을 확인하고 필요하면 요청한다. 쓸 수 있으면 'granted', 아니면 그 이유 */
  ensurePermission: () => Promise<'granted' | LocationFailure>;
  /** 연속 위치 구독을 시작한다. 시작하지 못하면 LocationFailure 값으로 reject 한다 */
  watch: (onFix: (fix: Fix) => void, onError: (reason: LocationFailure) => void) => Promise<LocationSubscription>;
}

export type TrackingPhase = 'idle' | 'starting' | 'tracking' | 'signalLost' | 'arrived' | 'failed';

export interface TrackingView {
  phase: TrackingPhase;
  snapshot: GuidanceSnapshot | null;
  failure: LocationFailure | null;
  /** 판정에 쓴 마지막 위치. 정확도 초과·점프로 걸러진 위치는 들어오지 않아, 지도 마커·추적이 튀는 위치를 따라가지 않는다 */
  position: Fix | null;
}

export const IDLE_VIEW: TrackingView = { phase: 'idle', snapshot: null, failure: null, position: null };

export interface GuidanceTracker {
  /** 안내할 경로를 맞춘다. null 이면 추적을 끝낸다. 같은 경로면 아무것도 하지 않고, 새 경로면 진행 상태만 새로 시작한다(구독은 유지). */
  sync: (route: NavRoute | null) => void;
  stop: () => void;
  /** 앱이 백그라운드로 가면 구독만 해제하고 경로·진행 상태는 유지한다 */
  pause: () => void;
  /** 돌아오면 다시 구독한다. 도착했으면 다시 시작하지 않는다 */
  resume: () => void;
  /** 주기적으로 불러 신호 끊김을 확인한다 */
  checkSignal: () => void;
}

export interface TrackerOptions {
  port: LocationPort;
  onChange: (view: TrackingView) => void;
  /** 이탈이 확정돼 재탐색이 필요할 때 한 번 불린다. 끝나면(성공이든 실패든) 컨트롤러가 요청 중 표시를 푼다 */
  onReroute?: (fix: Fix, route: NavRoute) => Promise<unknown> | void;
  now?: () => number;
}

export function createGuidanceTracker({ port, onChange, onReroute, now = Date.now }: TrackerOptions): GuidanceTracker {
  let route: NavRoute | null = null;
  let state: GuidanceState | null = null;
  let subscription: LocationSubscription | null = null;
  let lastFixAt: number | null = null;
  let view: TrackingView = IDLE_VIEW;
  // 구독을 새로 만들 때마다 늘려서, 이전 구독의 늦게 온 콜백·응답이 새 상태를 건드리지 못하게 한다.
  let generation = 0;

  const emit = (next: TrackingView) => {
    view = next;
    onChange(next);
  };
  const release = () => {
    generation++;
    subscription?.remove();
    subscription = null;
  };

  const handleFix = (fix: Fix, mine: number) => {
    if (mine !== generation || !route) return;
    const current = route;
    const result = advance(state, fix, current);
    state = result.state;
    lastFixAt = now();
    const { snapshot } = result;

    if (snapshot.events.includes('rerouteNeeded') && onReroute) {
      const done = () => {
        if (route === current && state) state = rerouteFinished(state);
      };
      try {
        Promise.resolve(onReroute(fix, current)).then(done, done);
      } catch {
        done();
      }
    }
    if (snapshot.status === 'arrived') {
      // 도착하면 위치 추적을 끝낸다. 도착 상태는 화면에 남는다.
      release();
      emit({ phase: 'arrived', snapshot, failure: null, position: result.state.lastFix });
      return;
    }
    emit({ phase: 'tracking', snapshot, failure: null, position: result.state.lastFix });
  };

  const subscribe = async () => {
    release();
    const mine = generation;
    emit({ phase: 'starting', snapshot: view.snapshot, position: view.position, failure: null });
    const permission = await port.ensurePermission().catch((): LocationFailure => 'unavailable');
    if (mine !== generation) return;
    if (permission !== 'granted') return emit({ phase: 'failed', snapshot: view.snapshot, position: view.position, failure: permission });
    try {
      const sub = await port.watch(
        (fix) => handleFix(fix, mine),
        (reason) => {
          if (mine !== generation) return;
          // 일시적인 신호 문제는 끊김으로, 권한·서비스 문제는 실패로 알린다.
          if (reason === 'timeout' || reason === 'unavailable') emit({ phase: 'signalLost', snapshot: view.snapshot, position: view.position, failure: null });
          else emit({ phase: 'failed', snapshot: view.snapshot, position: view.position, failure: reason });
        },
      );
      if (mine !== generation) return sub.remove(); // 구독을 기다리는 사이 정지·교체됐다
      subscription = sub;
      lastFixAt = now();
      emit({ phase: 'tracking', snapshot: view.snapshot, position: view.position, failure: null });
    } catch (reason) {
      if (mine !== generation) return;
      emit({ phase: 'failed', snapshot: view.snapshot, position: view.position, failure: typeof reason === 'string' ? (reason as LocationFailure) : 'unavailable' });
    }
  };

  const stop = () => {
    release();
    route = null;
    state = null;
    lastFixAt = null;
    if (view !== IDLE_VIEW) emit(IDLE_VIEW);
  };

  const sync = (next: NavRoute | null) => {
    if (!next) return stop();
    if (!route) {
      route = next;
      state = null;
      view = IDLE_VIEW;
      void subscribe();
    } else if (route.id !== next.id) {
      // 재탐색: 이전 경로의 진행·이탈·도착 상태를 모두 버린다. 구독이 살아 있으면 그대로 쓰고, 끝났으면(도착 후 등) 다시 시작한다.
      // 단, 마지막 재탐색 요청 시각은 넘겨서 쿨다운이 이어지게 한다. 안 그러면 새 경로도 계속 벗어난 채일 때 몇 초마다 재탐색이 반복된다.
      const lastRequestAt = state?.rerouteRequestedAtMs ?? null;
      route = next;
      state = lastRequestAt === null ? null : { ...initialState(next.id), rerouteRequestedAtMs: lastRequestAt };
      lastFixAt = now();
      if (subscription) emit({ phase: 'tracking', snapshot: null, failure: null, position: view.position });
      else void subscribe();
    } else {
      route = next;
    }
  };

  return {
    sync,
    stop,
    pause: release,
    resume() {
      if (route && !subscription && view.phase !== 'arrived') void subscribe();
    },
    checkSignal() {
      const wasMoving = (state?.speedMps ?? 0) >= SIGNAL_LOST_MIN_SPEED_MPS;
      if (route && view.phase === 'tracking' && wasMoving && isSignalLost(lastFixAt, now(), GUIDANCE_POLICY[route.mode])) {
        emit({ phase: 'signalLost', snapshot: view.snapshot, position: view.position, failure: null });
      }
    },
  };
}
