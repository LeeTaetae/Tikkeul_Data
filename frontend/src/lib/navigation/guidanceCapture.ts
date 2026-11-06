// 개발 빌드 전용 진단: 카카오 네이티브 SDK 의 onGuidance 이벤트를 "관찰만" 하고 요약(또는 사용자가 따로 켠 경우 좌표)을 기기 메모리에 모은다.
// React·네이티브에 의존하지 않는 순수 로직이라 Node 로 테스트한다. 기존 위험 훅(useNativeHazardRail)·네이티브 모듈과 코드가 섞이지 않는다.
//
// 안전 장치
//  - 기본값 OFF. 사용자가 개발 화면에서 명시적으로 켠 뒤에만 이벤트 구독이 생긴다(OFF 이면 구독 자체가 없다 = 기존 동작과 같다).
//  - allowed(= __DEV__)가 false 이면 켜기가 거부되고 이벤트를 기록하지 않는다(운영 빌드).
//  - 저장은 기기 메모리뿐이다(파일·네트워크 없음). 앱을 끄면 사라지고, clear() 로 바로 지울 수 있다.
//  - 'summary' 수준은 좌표를 저장·출력하지 않는다(점 개수·잘림·간격 통계만). 'coordinates' 수준만 경로 점과 위치(소수 5자리)를 메모리에 둔다.
//  - 허용 목록에 있는 필드만 복사한다. 키·토큰 같은 다른 필드는 이벤트에 있어도 저장하지 않는다.
//  - 이 파일의 어떤 함수도 로그에 좌표를 넘기지 않는다.
import { parseNativeRoute, pickLatLng } from './nativeGuidanceFeed';

/** 네이티브(iOS·Android 공통)가 route 이벤트 하나에 실을 수 있는 최대 점 수. count 는 전체 점 수다. */
export const SDK_ROUTE_POINT_CAP = 6000;
export const MAX_ROUTE_EVENTS = 3;
export const MAX_LOCATION_EVENTS = 3600;
const COORD_DECIMALS = 5;

export type CaptureLevel = 'off' | 'summary' | 'coordinates';
/** none: 모두 실림 · cap: 6000점 상한에 걸려 뒤쪽이 잘림 · invalid_points: 상한 전인데 일부 점이 빠짐(좌표 해석 실패 등) · unknown: count 가 없음 */
export type TruncationCause = 'none' | 'cap' | 'invalid_points' | 'unknown';

export interface RouteSummary {
  atMs: number;
  reason: string;
  /** SDK 가 센 전체 점 수. 없으면 null */
  count: number | null;
  /** 실제로 이벤트에 실린 점 수 */
  delivered: number;
  /** count - delivered (count 를 모르면 null) */
  shortfall: number | null;
  /** 상한 때문에 경로 뒤쪽이 잘렸는가 */
  truncated: boolean;
  cause: TruncationCause;
  /** 앱의 parseNativeRoute 가 이 경로를 받아들이는가(한 점이라도 잘못되면 false → 위험 레일이 비게 된다) */
  appWouldUseRoute: boolean;
  keys: string[];
  /** 받아들여진 경로의 길이(m)와 점 간격 통계. 좌표는 포함하지 않는다 */
  lengthM: number | null;
  avgSpacingM: number | null;
  maxSpacingM: number | null;
  /** 잘렸다면 전체 길이 추정(점 간격이 고르다는 가정, 추정값) */
  estimatedFullLengthM: number | null;
}

export interface LocationStats {
  total: number;
  valid: number;
  invalid: number;
  hdopMin: number | null;
  hdopMax: number | null;
  speedMaxKmh: number | null;
  maxGapMs: number | null;
  gapsOver2500ms: number;
  firstAtMs: number | null;
  lastAtMs: number | null;
}

const EARTH_R_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** route 이벤트 → 좌표 없는 요약. 앱이 쓰는 파서(parseNativeRoute)를 그대로 호출해 "앱이 실제로 쓸 수 있는 경로인지"를 함께 본다. */
export function summarizeRouteEvent(ev: Record<string, unknown>, atMs: number): RouteSummary {
  const points = Array.isArray(ev.points) ? ev.points : [];
  const delivered = points.length;
  const count = finite(ev.count) && ev.count >= 0 ? Math.floor(ev.count) : null;
  const keys = Array.isArray(ev.keys) ? (ev.keys as unknown[]).filter((k): k is string => typeof k === 'string') : [];
  const shortfall = count === null ? null : Math.max(0, count - delivered);
  let cause: TruncationCause;
  if (count === null) cause = 'unknown';
  else if (shortfall === 0) cause = 'none';
  else cause = delivered >= SDK_ROUTE_POINT_CAP ? 'cap' : 'invalid_points';

  const path = parseNativeRoute(points, keys.length ? keys : undefined);
  let lengthM: number | null = null;
  let avg: number | null = null;
  let max: number | null = null;
  if (path) {
    let total = 0;
    let maxGap = 0;
    for (let i = 1; i < path.length; i++) {
      const d = haversineM(path[i - 1], path[i]);
      total += d;
      if (d > maxGap) maxGap = d;
    }
    lengthM = Math.round(total);
    avg = path.length > 1 ? Math.round(total / (path.length - 1)) : null;
    max = Math.round(maxGap);
  }
  const estimated = lengthM !== null && count !== null && shortfall && delivered > 0 ? Math.round((lengthM * count) / delivered) : null;
  return {
    atMs, reason: typeof ev.reason === 'string' ? ev.reason : '', count, delivered, shortfall,
    truncated: cause === 'cap', cause, appWouldUseRoute: path !== null, keys, lengthM, avgSpacingM: avg, maxSpacingM: max,
    estimatedFullLengthM: estimated,
  };
}

/** 위치가 경로 위에 놓이는지(GPS 매칭)와 진행 방향을 보는 통계. 숫자뿐이고 좌표는 없다. */
export interface MatchStats {
  /** 경로가 있는 상태에서 유효 위치로 판정한 횟수 */
  evaluated: number;
  /** 경로에서 MATCH_LATERAL_M 이내(앱 매칭 기준과 같은 30m) */
  matched: number;
  offRoute: number;
  /** 경로가 오기 전에 온 위치 */
  noRoute: number;
  lateralMedianM: number | null;
  lateralP90M: number | null;
  lateralMaxM: number | null;
  /** 경로상 진행 거리가 50m 넘게 뒤로 간 횟수(재탐색·루프·경로 불일치 의심) */
  backwardJumps: number;
  /** 속도 5km/h 초과이고 angle 이 있을 때, 진행 방향이 경로 방향과 90° 넘게 다른 횟수. angle 의 기준(북=0 시계방향)은 아직 실기기로 확인하지 못했다 */
  headingOpposite: number;
  headingEvaluated: number;
  lastAlongM: number | null;
  routeLengthM: number | null;
  routeChanges: number;
}

export const MATCH_LATERAL_M = 30;
const BACKWARD_JUMP_M = 50;
const MAX_LATERAL_SAMPLES = 3600;

/** 경로 선분에 위치를 투영한다(지역 평면 근사). 직전 선분 주변을 먼저 보고, 멀면 전체를 본다. */
function createPathIndex(path: { lat: number; lng: number }[]) {
  const lat0 = path[0].lat;
  const lng0 = path[0].lng;
  const kx = EARTH_R_M * Math.cos(rad(lat0)) * (Math.PI / 180);
  const ky = EARTH_R_M * (Math.PI / 180);
  const xs = path.map((p) => (p.lng - lng0) * kx);
  const ys = path.map((p) => (p.lat - lat0) * ky);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const scan = (px: number, py: number, from: number, to: number) => {
    let best = { lateral: Infinity, along: 0, seg: 0, bearing: 0 };
    for (let i = from; i < to; i++) {
      const dx = xs[i + 1] - xs[i];
      const dy = ys[i + 1] - ys[i];
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((px - xs[i]) * dx + (py - ys[i]) * dy) / len2));
      const lateral = Math.hypot(px - (xs[i] + t * dx), py - (ys[i] + t * dy));
      if (lateral < best.lateral) best = { lateral, along: cum[i] + t * Math.sqrt(len2), seg: i, bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
    }
    return best;
  };
  return {
    length: cum[cum.length - 1],
    project(lat: number, lng: number, hintSeg: number) {
      const px = (lng - lng0) * kx;
      const py = (lat - lat0) * ky;
      const last = path.length - 2;
      let best = scan(px, py, Math.max(0, hintSeg - 300), Math.min(last, hintSeg + 1500) + 1);
      if (best.lateral > 80) best = scan(px, py, 0, last + 1);
      return best;
    },
  };
}
type PathIndex = ReturnType<typeof createPathIndex>;

function emptyMatchStats(): MatchStats {
  return { evaluated: 0, matched: 0, offRoute: 0, noRoute: 0, lateralMedianM: null, lateralP90M: null, lateralMaxM: null, backwardJumps: 0, headingOpposite: 0, headingEvaluated: 0, lastAlongM: null, routeLengthM: null, routeChanges: 0 };
}

function emptyLocationStats(): LocationStats {
  return { total: 0, valid: 0, invalid: 0, hdopMin: null, hdopMax: null, speedMaxKmh: null, maxGapMs: null, gapsOver2500ms: 0, firstAtMs: null, lastAtMs: null };
}

interface StoredRoute { reason: string; count: number | null; delivered: number; keys: string[]; points: [number, number][] }
interface StoredLocation { lat: number; lng: number; speedKmh?: number; angle?: number; hdop?: number; posTrust?: boolean; valid?: boolean; distFromS?: number; t: number }

export interface CaptureStatus {
  level: CaptureLevel;
  allowed: boolean;
  routeEvents: number;
  locationEvents: number;
  routes: RouteSummary[];
  location: LocationStats;
  /** 위치가 경로 위에 놓이는지·진행 방향 통계(숫자만) */
  match: MatchStats;
  /** 좌표를 메모리에 들고 있는가(coordinates 수준으로 기록했고 아직 지우지 않았다) */
  holdsCoordinates: boolean;
  droppedRoutes: number;
  droppedLocations: number;
  /** 기록 중 내부 오류 횟수(오류는 삼키고 세기만 한다. 이벤트 흐름에는 영향이 없다) */
  recorderErrors: number;
}

export interface CaptureOptions {
  /** false 면 켜기도 기록도 하지 않는다. 호출하는 쪽이 __DEV__ 를 넘긴다 */
  allowed: boolean;
  now: () => number;
  /** 요약 한 줄 출력용. 좌표는 절대 넘기지 않는다 */
  log?: (...args: unknown[]) => void;
}

export type FeedSubscribe = (listener: (event: Record<string, unknown>) => void) => () => void;

export function createGuidanceCapture(options: CaptureOptions, subscribe: FeedSubscribe) {
  let level: CaptureLevel = 'off';
  let unsubscribe: (() => void) | null = null;
  let routes: RouteSummary[] = [];
  let storedRoutes: StoredRoute[] = [];
  let storedLocations: StoredLocation[] = [];
  let locStats = emptyLocationStats();
  let routeEventsTotal = 0;
  let droppedRoutes = 0;
  let droppedLocations = 0;
  let recorderErrors = 0;
  let startedAtMs = 0;
  let sessionHeldCoordinates = false;
  // 위치 매칭용 작업 상태. 현재 경로를 메모리에 잠시 들고 있지만 어디에도 출력·로그·export 하지 않고, 끄기·삭제·수준 변경 때 버린다.
  let pathIndex: PathIndex | null = null;
  let hintSeg = 0;
  let prevAlong: number | null = null;
  let matchStats = emptyMatchStats();
  let lateralSamples: number[] = [];

  const reset = () => {
    routes = []; storedRoutes = []; storedLocations = []; locStats = emptyLocationStats();
    routeEventsTotal = 0; droppedRoutes = 0; droppedLocations = 0; recorderErrors = 0; sessionHeldCoordinates = false;
    pathIndex = null; hintSeg = 0; prevAlong = null; matchStats = emptyMatchStats(); lateralSamples = [];
  };

  function quantile(sorted: number[], q: number): number | null {
    return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 10) / 10 : null;
  }

  function matchLocation(ev: Record<string, unknown>) {
    const m = matchStats;
    if (!pathIndex || ev.valid === false || !finite(ev.lat) || !finite(ev.lng)) {
      if (!pathIndex && ev.valid !== false) m.noRoute++;
      return;
    }
    const p = pathIndex.project(ev.lat, ev.lng, hintSeg);
    hintSeg = p.seg;
    m.evaluated++;
    if (p.lateral <= MATCH_LATERAL_M) m.matched++; else m.offRoute++;
    lateralSamples.push(p.lateral);
    if (lateralSamples.length > MAX_LATERAL_SAMPLES) lateralSamples.shift();
    m.lateralMaxM = Math.max(m.lateralMaxM ?? 0, Math.round(p.lateral * 10) / 10);
    if (prevAlong !== null && p.along < prevAlong - BACKWARD_JUMP_M && p.lateral <= MATCH_LATERAL_M) m.backwardJumps++;
    if (p.lateral <= MATCH_LATERAL_M) prevAlong = p.along;
    m.lastAlongM = Math.round(p.along);
    if (finite(ev.angle) && finite(ev.speedKmh) && ev.speedKmh > 5 && p.lateral <= MATCH_LATERAL_M) {
      m.headingEvaluated++;
      const diff = Math.abs(((ev.angle - p.bearing + 540) % 360) - 180);
      if (diff > 90) m.headingOpposite++;
    }
  }

  function recordRoute(ev: Record<string, unknown>, atMs: number) {
    const summary = summarizeRouteEvent(ev, atMs);
    routeEventsTotal++;
    routes.push(summary);
    if (routes.length > MAX_ROUTE_EVENTS) { routes.shift(); droppedRoutes++; }
    options.log?.(`route reason=${summary.reason} count=${summary.count} delivered=${summary.delivered} truncated=${summary.truncated} cause=${summary.cause}` +
      ` appUsesRoute=${summary.appWouldUseRoute} lengthM=${summary.lengthM} avgSpacingM=${summary.avgSpacingM} maxSpacingM=${summary.maxSpacingM}`);
    // 위치 매칭용: 앱 파서가 받아들인 경로만 쓴다(앱이 버리는 경로면 매칭할 경로가 없다).
    const path = parseNativeRoute(ev.points, summary.keys.length ? summary.keys : undefined);
    if (matchStats.evaluated > 0 || pathIndex) matchStats.routeChanges++;
    pathIndex = path ? createPathIndex(path) : null;
    hintSeg = 0;
    prevAlong = null;
    matchStats.routeLengthM = pathIndex ? Math.round(pathIndex.length) : null;
    if (level !== 'coordinates') return;
    // 좌표 수준: 점을 앱 파서와 같은 규칙으로 읽어 보관한다. 한 점이라도 읽을 수 없으면 경로 전체를 보관하지 않는다(앱도 그 경로는 버린다).
    const raw = Array.isArray(ev.points) ? (ev.points as unknown[]) : [];
    const keys = summary.keys.length ? summary.keys : undefined;
    const pts: [number, number][] = [];
    for (const p of raw) {
      const ll = p && typeof p === 'object' ? pickLatLng(p as Record<string, unknown>, keys) : null;
      if (!ll) return;
      pts.push([round(ll.lng, COORD_DECIMALS), round(ll.lat, COORD_DECIMALS)]);
    }
    storedRoutes.push({ reason: summary.reason, count: summary.count, delivered: summary.delivered, keys: ['x', 'y'], points: pts });
    if (storedRoutes.length > MAX_ROUTE_EVENTS) storedRoutes.shift();
    sessionHeldCoordinates = true;
  }

  function recordLocation(ev: Record<string, unknown>, atMs: number) {
    const s = locStats;
    s.total++;
    if (ev.valid === false) s.invalid++; else s.valid++;
    if (finite(ev.hdop)) {
      s.hdopMin = s.hdopMin === null ? ev.hdop : Math.min(s.hdopMin, ev.hdop);
      s.hdopMax = s.hdopMax === null ? ev.hdop : Math.max(s.hdopMax, ev.hdop);
    }
    if (finite(ev.speedKmh)) s.speedMaxKmh = s.speedMaxKmh === null ? ev.speedKmh : Math.max(s.speedMaxKmh, ev.speedKmh);
    if (s.lastAtMs !== null) {
      const gap = atMs - s.lastAtMs;
      s.maxGapMs = s.maxGapMs === null ? gap : Math.max(s.maxGapMs, gap);
      if (gap > 2500) s.gapsOver2500ms++;
    }
    s.firstAtMs ??= atMs;
    s.lastAtMs = atMs;
    matchLocation(ev);
    if (level !== 'coordinates' || !finite(ev.lat) || !finite(ev.lng)) return;
    // 허용 목록만 복사한다(다른 필드는 이벤트에 있어도 저장하지 않는다).
    const item: StoredLocation = { lat: round(ev.lat, COORD_DECIMALS), lng: round(ev.lng, COORD_DECIMALS), t: round((atMs - startedAtMs) / 1000, 1) };
    if (finite(ev.speedKmh)) item.speedKmh = round(ev.speedKmh, 1);
    if (finite(ev.angle)) item.angle = round(ev.angle, 0);
    if (finite(ev.hdop)) item.hdop = round(ev.hdop, 2);
    if (typeof ev.posTrust === 'boolean') item.posTrust = ev.posTrust;
    if (typeof ev.valid === 'boolean') item.valid = ev.valid;
    if (finite(ev.distFromS)) item.distFromS = Math.round(ev.distFromS);
    storedLocations.push(item);
    if (storedLocations.length > MAX_LOCATION_EVENTS) { storedLocations.shift(); droppedLocations++; }
    sessionHeldCoordinates = true;
  }

  /** 이벤트 한 개를 기록한다. 어떤 오류도 밖으로 던지지 않는다(이벤트 흐름·기존 훅에 영향이 없어야 한다). */
  function record(ev: Record<string, unknown>): void {
    if (!options.allowed || level === 'off') return;
    try {
      const at = options.now();
      if (ev.kind === 'route') recordRoute(ev, at);
      else if (ev.kind === 'location') recordLocation(ev, at);
    } catch {
      recorderErrors++;
    }
  }

  /** 수준을 바꾼다. 'off' 는 구독을 끊는다(기록은 남으므로 export/clear 가능). 켜기는 allowed 가 false 이면 거부하고 구독도 만들지 않는다. */
  function setLevel(next: CaptureLevel): boolean {
    if (next === 'off') {
      unsubscribe?.();
      unsubscribe = null;
      level = 'off';
      pathIndex = null; // 작업용 경로는 끄는 즉시 버린다(통계 숫자만 남는다)
      return true;
    }
    if (!options.allowed) return false;
    unsubscribe?.();
    unsubscribe = null;
    reset(); // 수준을 바꾸면 이전 기록(좌표 포함)은 버리고 새로 시작한다
    level = next;
    startedAtMs = options.now();
    unsubscribe = subscribe(record);
    return true;
  }

  function matchSnapshot(): MatchStats {
    const sorted = lateralSamples.slice().sort((a, b) => a - b);
    return { ...matchStats, lateralMedianM: quantile(sorted, 0.5), lateralP90M: quantile(sorted, 0.9) };
  }

  function status(): CaptureStatus {
    return {
      level, allowed: options.allowed, routeEvents: routeEventsTotal, locationEvents: locStats.total, routes: routes.slice(), location: { ...locStats }, match: matchSnapshot(),
      holdsCoordinates: storedRoutes.length > 0 || storedLocations.length > 0, droppedRoutes, droppedLocations, recorderErrors,
    };
  }

  /** 메모리의 기록을 모두 지운다(좌표 포함). 구독 상태(켜짐/꺼짐)는 그대로다. */
  function clear(): void {
    reset();
  }

  /** 공유용 텍스트. 좌표를 보관 중이면 native_replay.py 가 읽는 JSONL, 아니면 좌표 없는 요약 JSON. */
  function exportText(): string {
    if (storedRoutes.length === 0 && storedLocations.length === 0) {
      return JSON.stringify({ kind: 'guidance-capture-summary', coordinates: false, routes, location: locStats, match: matchSnapshot(), droppedRoutes, recorderErrors }, null, 1);
    }
    const lines: string[] = [];
    for (const r of storedRoutes) lines.push(JSON.stringify({ kind: 'route', reason: r.reason, count: r.count ?? r.delivered, keys: r.keys, points: r.points }));
    for (const l of storedLocations) lines.push(JSON.stringify({ kind: 'location', ...l }));
    return lines.join('\n');
  }

  return { setLevel, record, status, clear, exportText };
}

export type GuidanceCapture = ReturnType<typeof createGuidanceCapture>;
