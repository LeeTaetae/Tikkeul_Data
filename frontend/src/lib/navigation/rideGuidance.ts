// 자전거·대중교통 길안내 계산. 다른 모듈을 런타임 import 하지 않는 순수 함수라 Node 로도 테스트한다.
//
// 데이터 한계(2026-11 카카오 REST 실호출로 확인):
//  - 자전거(/v2/routing/bicycle): 안내 문구는 "광화문교차로에서 좌회전 후 43m 이동"처럼 일부 지점에만 방향이 있고,
//    "횡단보도 이용"·"527m 이동"은 방향이 없다. 방향 코드(turnType)는 없어서 문구에 "좌회전/우회전/U턴"이 있을 때만 방향으로 읽는다.
//  - 대중교통(/v2/routing/publictraffic): 구간(도보·버스·지하철)마다 좌표 목록과 정류장 이름은 주지만 정류장 좌표, 실시간 도착·위치,
//    출발지~첫 정류장·마지막 정류장~도착지 도보 구간은 주지 않는다.
//  - GPS 만으로 버스·지하철 탑승/하차를 확정하지 않는다. 탑승·하차는 사용자가 누르고, GPS 는 도보 구간 도착과 "근처" 힌트에만 쓴다.
import type { RouteGuide } from '../../map/parseRoutes';
import type { RouteInstruction, TransitRouteOption } from '../../map/navigationApi';

interface Pt {
  lat: number;
  lng: number;
}

const M_PER_DEG = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 두 좌표 사이 거리(m). guidanceEngine 과 같은 평면 근사다. */
export function distanceM(a: Pt, b: Pt): number {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

/** from 에서 to 를 향한 방위(도, 북쪽 0 시계 방향). 두 점이 같으면 null */
export function bearingDeg(from: Pt, to: Pt): number | null {
  const dy = to.lat - from.lat;
  const dx = (to.lng - from.lng) * Math.cos(toRad((from.lat + to.lat) / 2));
  if (dx === 0 && dy === 0) return null;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

// ───────────────────────── 자전거 ─────────────────────────

/** 안내 지점 좌표가 경로 꼭짓점과 이만큼(m) 안에서 맞아야 같은 지점으로 본다. 카카오는 단계 시작 좌표를 path 점 그대로 준다. */
const SNAP_M = 10;

/** 안내 문구에 방향이 적혀 있을 때만 방향 코드로 바꾼다(Tmap turnType 과 같은 번호: 12 좌회전, 13 우회전, 14 U턴). 없으면 undefined. */
export function turnTypeOfText(text: string): number | undefined {
  if (/U\s?턴|유턴/i.test(text)) return 14;
  if (text.includes('좌회전')) return 12;
  if (text.includes('우회전')) return 13;
  return undefined;
}

/**
 * 자전거 경로의 안내 문구(좌표 포함)를 엔진이 쓰는 안내 지점(RouteGuide)으로 바꾼다.
 * 좌표가 없거나 경로 점과 맞지 않는 문구는 버리고, 좌표를 만들어 채우지 않는다. 마지막에는 경로 끝(도착)을 하나 둔다.
 */
export function cyclingGuides(path: Pt[], instructions: RouteInstruction[]): RouteGuide[] {
  if (path.length < 2) return [];
  const guides: RouteGuide[] = [];
  let from = 0; // 안내 지점은 경로 순서대로 나온다. 앞 지점보다 뒤에서만 찾는다.
  for (const instruction of instructions) {
    const point = instruction.point;
    if (!point) continue;
    let bestIndex = -1;
    let bestM = Infinity;
    for (let i = from; i < path.length; i++) {
      const d = distanceM(point, path[i]);
      if (d < bestM) {
        bestM = d;
        bestIndex = i;
      }
    }
    if (bestIndex < 0 || bestM > SNAP_M) continue;
    from = bestIndex;
    const guide: RouteGuide = {
      index: guides.length,
      lat: path[bestIndex].lat,
      lng: path[bestIndex].lng,
      pathIndex: bestIndex,
      pointType: guides.length === 0 && bestIndex === 0 ? 'S' : 'N',
      description: instruction.text,
      name: '',
      nextRoadName: '',
    };
    const turnType = turnTypeOfText(instruction.text);
    if (turnType !== undefined) guide.turnType = turnType;
    guides.push(guide);
  }
  const end = path[path.length - 1];
  guides.push({ index: guides.length, lat: end.lat, lng: end.lng, pathIndex: path.length - 1, pointType: 'E', description: '', name: '', nextRoadName: '' });
  return guides;
}

// ───────────────────────── 대중교통: 구간 ─────────────────────────

export type LegKind = 'walk' | 'bus' | 'subway';

export interface TransitLeg {
  kind: LegKind;
  /** step: 카카오가 준 구간. access/egress: 출발지~첫 지점, 마지막 지점~도착지를 직선으로 이은 도보(카카오는 이 구간을 주지 않는다) */
  source: 'step' | 'access' | 'egress';
  /** 버스·지하철 사이를 잇는 도보(환승) */
  transfer: boolean;
  distanceM: number;
  /** 구간 소요시간(초). access/egress 는 모른다 */
  timeSec: number | null;
  fromName: string;
  toName: string;
  lineName: string;
  /** 승차~하차 정거장 수(정류장 이름 목록 길이 - 1). 모르면 null */
  stopCount: number | null;
  /** 카카오가 준 정거장 이름을 승차~하차 순서대로. 첫 항목이 승차, 마지막이 하차다. 없으면 빈 배열 */
  stopNames: string[];
  /** stopNames 와 같은 순서. 서버가 공식 좌표로 검증한 정거장만 값이 있고 나머지는 null(좌표를 만들어내지 않는다) */
  stopPoints: (Pt | null)[];
  /** stopNames 와 같은 순서. 정거장 좌표를 이 구간 경로에 투영한 위치(안내 경로 시작부터 m). 경로에서 멀면 null */
  stopOffsets: (number | null)[];
  /** 안내용 경로(TransitPlan.path) 안 위치와 거기까지 거리(m). 구간 좌표를 모르면 null */
  startIndex: number | null;
  endIndex: number | null;
  startM: number | null;
  endM: number | null;
  startPoint: Pt | null;
  endPoint: Pt | null;
}

export interface TransitPlan {
  legs: TransitLeg[];
  /** 엔진이 따라갈 경로: [출발지?] + 카카오 path + [도착지?]. 앞뒤 직선은 출발지·도착지가 path 끝에서 30m 넘게 떨어졌을 때만 붙고, 지도에는 그리지 않는다 */
  path: Pt[];
}

/** 출발지·도착지가 경로 끝에서 이만큼(m) 넘게 떨어져 있어야 도보 구간으로 붙인다 */
const CONNECT_MIN_M = 30;

// pathStartIndex 가 하나라도 깨졌으면(옛 서버, 순서 어긋남, 범위 밖) 구간 좌표를 믿지 않는다.
function trustedStarts(option: TransitRouteOption): (number | null)[] {
  const starts = option.steps.map((s) => (typeof s.pathStartIndex === 'number' ? s.pathStartIndex : null));
  let previous = -1;
  for (const start of starts) {
    if (start === null) continue;
    if (!Number.isInteger(start) || start <= previous || start >= option.path.length) return starts.map(() => null);
    previous = start;
  }
  return starts;
}

/** 정거장 좌표가 이 구간 경로에서 이만큼(m) 넘게 떨어지면 쓰지 않는다(서버도 같은 검증을 하지만 한 번 더 확인한다) */
const STOP_MAX_OFF_PATH_M = 150;

// 구간 경로(path[from..to]) 위로 정거장 좌표를 투영해 (경로 시작부터 거리)를 구한다. 좌표가 없거나 경로에서 멀면 점도 위치도 null.
function stopPlacement(
  stops: { lat: number | null; lng: number | null }[],
  path: Pt[],
  cum: number[],
  from: number | null,
  to: number | null,
): { stopPoints: (Pt | null)[]; stopOffsets: (number | null)[] } {
  const stopPoints: (Pt | null)[] = [];
  const stopOffsets: (number | null)[] = [];
  for (const stop of stops) {
    let point: Pt | null = null;
    let offset: number | null = null;
    if (typeof stop.lat === 'number' && typeof stop.lng === 'number' && from !== null && to !== null) {
      let best = { d: Infinity, offset: 0 };
      for (let i = from; i < to; i++) {
        const a = path[i];
        const b = path[i + 1];
        const k = Math.cos(toRad((a.lat + b.lat) / 2));
        const ax = a.lng * M_PER_DEG * k;
        const ay = a.lat * M_PER_DEG;
        const bx = b.lng * M_PER_DEG * k;
        const by = b.lat * M_PER_DEG;
        const px = stop.lng * M_PER_DEG * k;
        const py = stop.lat * M_PER_DEG;
        const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2));
        const d = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
        if (d < best.d) best = { d, offset: cum[i] + t * (cum[i + 1] - cum[i]) };
      }
      if (best.d <= STOP_MAX_OFF_PATH_M) {
        point = { lat: stop.lat, lng: stop.lng };
        offset = best.offset;
      }
    }
    stopPoints.push(point);
    stopOffsets.push(offset);
  }
  return { stopPoints, stopOffsets };
}

export function buildTransitPlan(option: TransitRouteOption, origin: Pt, destination: Pt): TransitPlan {
  const base = option.path;
  if (base.length < 2 || option.steps.length === 0) return { legs: [], path: base };
  const lead = distanceM(origin, base[0]) > CONNECT_MIN_M;
  const tail = distanceM(base[base.length - 1], destination) > CONNECT_MIN_M;
  const shift = lead ? 1 : 0;
  const path = [...(lead ? [origin] : []), ...base, ...(tail ? [destination] : [])];

  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceM(path[i - 1], path[i]));

  const starts = trustedStarts(option);
  const isVehicle = (i: number) => option.steps[i]?.type === 'BUS' || option.steps[i]?.type === 'SUBWAY';
  const place = (startIndex: number | null, endIndex: number | null) => ({
    startIndex,
    endIndex,
    startM: startIndex === null ? null : cum[startIndex],
    endM: endIndex === null ? null : cum[endIndex],
    startPoint: startIndex === null ? null : path[startIndex],
    endPoint: endIndex === null ? null : path[endIndex],
  });

  const legs: TransitLeg[] = option.steps.map((step, i) => {
    const start = starts[i];
    let nextStart: number | null = null;
    for (let j = i + 1; j < starts.length && nextStart === null; j++) nextStart = starts[j];
    const startIndex = start === null ? null : start + shift;
    const endIndex = start === null ? null : (nextStart ?? base.length) - 1 + shift;
    const named = step.stops.filter((s) => s.name);
    const names = named.map((s) => s.name);
    const lineNames = [...new Set(step.vehicles.map((v) => v.name).filter(Boolean))];
    return {
      kind: step.type === 'SUBWAY' ? 'subway' : step.type === 'BUS' ? 'bus' : 'walk',
      source: 'step',
      transfer: step.type === 'WALKING' && isVehicle(i - 1) && isVehicle(i + 1),
      distanceM: step.distanceM,
      timeSec: step.timeSec,
      fromName: names[0] ?? '',
      toName: names[names.length - 1] ?? '',
      lineName: lineNames.join(', '),
      stopCount: names.length > 1 ? names.length - 1 : null,
      stopNames: step.type === 'WALKING' ? [] : names,
      ...stopPlacement(step.type === 'WALKING' ? [] : named, path, cum, startIndex, endIndex),
      ...place(startIndex, endIndex),
    };
  });

  const firstVehicle = legs.find((l) => l.kind !== 'walk');
  const walk = (source: 'access' | 'egress', distance: number, toName: string, startIndex: number, endIndex: number): TransitLeg => ({
    kind: 'walk', source, transfer: false, distanceM: distance, timeSec: null, fromName: '', toName, lineName: '', stopCount: null, stopNames: [], stopPoints: [], stopOffsets: [], ...place(startIndex, endIndex),
  });
  if (lead) legs.unshift(walk('access', distanceM(origin, base[0]), firstVehicle?.fromName ?? '', 0, 1));
  if (tail) legs.push(walk('egress', distanceM(base[base.length - 1], destination), '', path.length - 2, path.length - 1));
  return { legs, path };
}

// ───────────────────────── 대중교통: 진행 ─────────────────────────

/** 사용자가 거치는 단계. 도보는 GPS 도착으로 넘어가고, 탑승(board)·이동(ride)은 사용자가 확인해야 넘어간다. */
export type TaskKind = 'walk' | 'board' | 'ride';

export interface TransitTask {
  kind: TaskKind;
  legIndex: number;
}

export function buildTasks(legs: TransitLeg[]): TransitTask[] {
  return legs.flatMap((leg, legIndex): TransitTask[] =>
    leg.kind === 'walk' ? [{ kind: 'walk', legIndex }] : [{ kind: 'board', legIndex }, { kind: 'ride', legIndex }],
  );
}

export interface RideFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  timestampMs: number;
}

/** 도보 구간 끝에서 이 거리(m) + min(정확도, 상한) 안에 들어와야 "도착"으로 본다 */
export const WALK_ARRIVE_M = 40;
export const WALK_ARRIVE_ACCURACY_CAP_M = 25;
/** 정확도가 이보다 나쁘거나 모르는 위치는 자동 전환에 쓰지 않는다 */
export const FIX_MAX_ACCURACY_M = 40;
/** 도착 반경 안에 이만큼 연속으로 들어와야 자동으로 다음 단계로 넘어간다(한 번 튄 위치로 넘어가지 않게) */
export const WALK_ARRIVE_FIXES = 3;
/** 이보다 오래된 위치는 쓰지 않는다 */
export const FIX_MAX_AGE_MS = 15_000;
export const NEAR_BOARD_M = 60;
export const NEAR_ALIGHT_M = 300;

export interface RideState {
  taskIndex: number;
  arrivalCount: number;
  lastFixAtMs: number | null;
  /** 사용자가 이 단계로 되돌아왔으면 그 단계는 자동으로 넘기지 않는다 */
  holdAutoTask: number | null;
}

export const INITIAL_RIDE: RideState = { taskIndex: 0, arrivalCount: 0, lastFixAtMs: null, holdAutoTask: null };

export const isFinished = (state: RideState, tasks: TransitTask[]): boolean => state.taskIndex >= tasks.length;

/**
 * 위치 하나를 반영한다. 자동으로 넘어가는 것은 "도보 단계가 끝 지점에 도착"한 경우뿐이고, 한 번에 한 단계만 앞으로 간다.
 * 탑승·하차는 GPS 로 확정하지 않는다. 같은 위치(같은 시각)를 두 번 세지 않는다.
 */
export function applyFix(state: RideState, tasks: TransitTask[], legs: TransitLeg[], fix: RideFix | null, nowMs: number): RideState {
  if (isFinished(state, tasks) || !fix) return state;
  const task = tasks[state.taskIndex];
  const leg = legs[task.legIndex];
  if (task.kind !== 'walk' || !leg.endPoint || state.holdAutoTask === state.taskIndex) return state;
  if (state.lastFixAtMs === fix.timestampMs) return state;
  const accuracy = fix.accuracyM;
  const usable = accuracy !== null && accuracy <= FIX_MAX_ACCURACY_M && nowMs - fix.timestampMs <= FIX_MAX_AGE_MS;
  const hit = usable && distanceM(fix, leg.endPoint) <= WALK_ARRIVE_M + Math.min(accuracy, WALK_ARRIVE_ACCURACY_CAP_M);
  const count = hit ? state.arrivalCount + 1 : 0;
  if (count >= WALK_ARRIVE_FIXES) return { taskIndex: state.taskIndex + 1, arrivalCount: 0, lastFixAtMs: fix.timestampMs, holdAutoTask: null };
  return { ...state, arrivalCount: count, lastFixAtMs: fix.timestampMs };
}

/** 사용자가 "다음 단계"(도착·탑승·하차 확인)를 눌렀다 */
export function confirmTask(state: RideState, tasks: TransitTask[]): RideState {
  if (isFinished(state, tasks)) return state;
  return { taskIndex: state.taskIndex + 1, arrivalCount: 0, lastFixAtMs: state.lastFixAtMs, holdAutoTask: null };
}

/** 잘못 눌렀을 때 한 단계 되돌린다. 되돌아온 단계는 자동으로 다시 넘어가지 않는다 */
export function undoTask(state: RideState): RideState {
  if (state.taskIndex <= 0) return state;
  const taskIndex = state.taskIndex - 1;
  return { taskIndex, arrivalCount: 0, lastFixAtMs: state.lastFixAtMs, holdAutoTask: taskIndex };
}

export type RideHint = 'nearBoard' | 'nearAlight';

/** 승차 지점·하차 지점 "근처"라는 알림. 탑승·하차를 확정하는 값이 아니다 */
export function hintFor(task: TransitTask | undefined, leg: TransitLeg | undefined, fix: RideFix | null, nowMs: number): RideHint | null {
  if (!task || !leg || !fix || fix.accuracyM === null || fix.accuracyM > 50 || nowMs - fix.timestampMs > FIX_MAX_AGE_MS) return null;
  if (task.kind === 'board' && leg.startPoint && distanceM(fix, leg.startPoint) <= NEAR_BOARD_M) return 'nearBoard';
  if (task.kind === 'ride' && leg.endPoint && distanceM(fix, leg.endPoint) <= NEAR_ALIGHT_M) return 'nearAlight';
  return null;
}

/** 구간 안 진행(0~1). progressM 은 엔진이 잰 path 위 진행 거리. 구간 좌표를 모르면 0 */
export function legFraction(leg: TransitLeg, progressM: number): number {
  if (leg.startM === null || leg.endM === null || leg.endM <= leg.startM) return 0;
  return Math.min(1, Math.max(0, (progressM - leg.startM) / (leg.endM - leg.startM)));
}

export interface RideTotals {
  remainingM: number;
  /** 시간을 아는 구간만 더한 남은 시간(초). 하나도 모르면 null */
  remainingSec: number | null;
  /** 0~1, 거리 기준 */
  fraction: number;
}

/** 지금 단계의 구간은 activeFraction 만큼 지났다고 보고, 그 뒤 구간은 전부 남았다고 센다. 탑승 전(board)에는 지나온 만큼이 없다. */
export function rideTotals(legs: TransitLeg[], tasks: TransitTask[], taskIndex: number, activeFraction: number): RideTotals {
  const total = legs.reduce((sum, l) => sum + l.distanceM, 0);
  if (taskIndex >= tasks.length) return { remainingM: 0, remainingSec: 0, fraction: 1 };
  const activeIndex = tasks[taskIndex].legIndex;
  const fraction = tasks[taskIndex].kind === 'board' ? 0 : Math.min(1, Math.max(0, activeFraction));
  let remainingM = legs[activeIndex].distanceM * (1 - fraction);
  let known = false;
  let remainingSec = 0;
  const active = legs[activeIndex];
  if (active.timeSec !== null) {
    known = true;
    remainingSec += active.timeSec * (1 - fraction);
  }
  for (let i = activeIndex + 1; i < legs.length; i++) {
    remainingM += legs[i].distanceM;
    if (legs[i].timeSec !== null) {
      known = true;
      remainingSec += legs[i].timeSec as number;
    }
  }
  return { remainingM, remainingSec: known ? remainingSec : null, fraction: total > 0 ? Math.min(1, Math.max(0, 1 - remainingM / total)) : 0 };
}

// ───────────────────────── 대중교통: 현재 정거장 자동 판정 ─────────────────────────
// 서버가 공식 좌표로 검증해 준 정거장(지금은 서울·수도권 지하철)만 대상이다. 버스는 좌표 파일에 방향 정보가 없어 양쪽 정류장을 구분할 수 없으므로 하지 않는다.
//
// 한계(실환경 검증 전):
//  - 아래 숫자(반경·연속 횟수·허용 오차)는 설계상 임시 기준이다. 실제 열차를 타고 검증하지 못했다.
//  - 지하 구간에서는 GPS 가 거의 들어오지 않는다. 그때는 마지막으로 확인한 정거장을 그대로 두고 "마지막 확인 위치"로만 보여준다(다음 정거장으로 옮기지 않는다).
//  - "도착"과 "통과"는 구분하지 못한다. 정거장 반경 안에서 위치가 연속으로 확인됐다는 뜻이라 "현재 역 인근"으로만 표현한다.
//  - 가장 가까운 정거장 하나로 정하지 않는다. 반경 안 + 다음으로 가까운 정거장과 충분히 차이 + 경로 진행 거리와 일치 + 같은 정거장이 연속 확인되어야 한다.

/** 정거장 반경 = 기본 + min(정확도, 상한) */
export const STOP_RADIUS_M = 80;
export const STOP_RADIUS_ACCURACY_CAP_M = 40;
/** 이보다 정확도가 나쁘거나 모르는 위치는 판정에 쓰지 않는다 */
export const STOP_MAX_ACCURACY_M = 50;
/** 가장 가까운 정거장이 다음으로 가까운 정거장보다 이만큼(m) 더 가까워야 한다 */
export const STOP_MARGIN_M = 100;
/** 정거장의 경로상 위치와 엔진이 잰 진행 거리가 이만큼(+정확도) 이내로 맞아야 한다 */
export const STOP_PROGRESS_AGREE_M = 250;
/** 같은 정거장이 연속으로 이만큼 확인되어야 바뀐다. 마지막 확인 정거장에서 이 수보다 멀리 건너뛰면 더 많이 요구한다 */
export const STOP_CONFIRM_FIXES = 3;
export const STOP_JUMP_CONFIRM_FIXES = 5;
export const STOP_MAX_NORMAL_ADVANCE = 2;

export interface StopTrack {
  /** 마지막으로 확인된 정거장 순번(구간 stopNames 안). 아직 없으면 null. 줄어들지 않는다 */
  index: number | null;
  /** 직전 위치가 그 정거장 반경 안이었다 */
  near: boolean;
  streakIndex: number | null;
  streak: number;
  lastFixAtMs: number | null;
}

export const INITIAL_STOP_TRACK: StopTrack = { index: null, near: false, streakIndex: null, streak: 0, lastFixAtMs: null };

export interface StopTrackInput {
  points: (Pt | null)[];
  offsets: (number | null)[];
  fix: RideFix | null;
  nowMs: number;
  /** 엔진이 잰 안내 경로 위 진행 거리(m). 모르면 null */
  progressM: number | null;
  /** 엔진이 위치를 경로 위로 판정했다 */
  onRoute: boolean;
}

/** 좌표가 확인된 정거장이 둘 이상이어야 자동 판정을 한다 */
export const canTrackStops = (leg: TransitLeg): boolean => leg.stopPoints.filter((p) => p !== null).length >= 2;

/**
 * 위치 하나를 반영한다. 쓸 수 없는 위치(정확도 나쁨·오래됨·경로 이탈·진행 거리 모름)는 마지막 확인 정거장을 그대로 두고 near 만 끈다.
 * 쓸 수 있는 위치는 한 정거장 후보만 세고, 후보가 연속으로 확인되어야 index 가 바뀐다. 같은 위치(같은 시각)는 한 번만 센다.
 */
export function advanceStopTrack(prev: StopTrack, input: StopTrackInput): StopTrack {
  const { points, offsets, fix, nowMs, progressM, onRoute } = input;
  const accuracy = fix?.accuracyM ?? null;
  const usable = fix !== null && accuracy !== null && accuracy <= STOP_MAX_ACCURACY_M && nowMs - fix.timestampMs <= FIX_MAX_AGE_MS && progressM !== null && onRoute;
  if (!usable) return prev.near || prev.streak > 0 ? { ...prev, near: false, streakIndex: null, streak: 0 } : prev;
  if (prev.lastFixAtMs === fix.timestampMs) return prev;

  const from = prev.index ?? 0; // 이미 지나간 정거장으로는 돌아가지 않는다
  const ranked: { i: number; d: number }[] = [];
  for (let i = from; i < points.length; i++) {
    const point = points[i];
    if (point && offsets[i] !== null) ranked.push({ i, d: distanceM(fix, point) });
  }
  ranked.sort((x, y) => x.d - y.d);
  const best = ranked[0];
  const second = ranked[1];
  const within = best !== undefined && best.d <= STOP_RADIUS_M + Math.min(accuracy, STOP_RADIUS_ACCURACY_CAP_M);
  const agrees = best !== undefined && Math.abs((offsets[best.i] as number) - progressM) <= STOP_PROGRESS_AGREE_M + accuracy;
  const clear = best !== undefined && (second === undefined || second.d - best.d >= STOP_MARGIN_M);
  const candidate = within && agrees && clear ? best.i : null;

  const base = { lastFixAtMs: fix.timestampMs };
  if (candidate === null) return { ...prev, ...base, near: false, streakIndex: null, streak: 0 };
  if (candidate === prev.index) return { ...prev, ...base, near: true, streakIndex: null, streak: 0 };

  const streak = prev.streakIndex === candidate ? prev.streak + 1 : 1;
  const jump = prev.index !== null && candidate - prev.index > STOP_MAX_NORMAL_ADVANCE;
  if (streak >= (jump ? STOP_JUMP_CONFIRM_FIXES : STOP_CONFIRM_FIXES)) return { index: candidate, near: true, streakIndex: null, streak: 0, ...base };
  return { ...prev, ...base, near: false, streakIndex: candidate, streak };
}

export interface StopMark {
  index: number;
  /** true: 지금 그 정거장 반경 안에서 위치가 확인되고 있다. false: 마지막으로 확인된 정거장일 뿐이다(GPS 끊김·정거장 사이) */
  near: boolean;
}

/** 구간 키(화면이 정한 구간 식별자)별 표시 */
export type StopMarks = Record<string, StopMark>;

/**
 * 화면에 보일 표시. 확인된 정거장이 없으면 undefined.
 * near("현재 역 인근")는 다음을 모두 만족할 때만 켠다: 직전에 쓸 수 있던 위치가 그 정거장 반경 안이었고, 위치 추적이 살아 있고(tracking),
 * 그 위치가 FIX_MAX_AGE_MS(15초) 이내다. 새 위치가 15초 넘게 없거나, 추적이 끊기거나 실패했거나, 정확도가 나빠 위치를 못 쓰면 즉시 near=false
 * ("마지막 확인 위치")가 된다. 정차 중이라는 이유로 오래된 위치를 현재로 보여주지 않는다(열차가 출발했는데 이전 역을 현재로 오인할 수 있다).
 * 마지막으로 확인한 정거장(index)은 그대로 둔다. 위치가 끊겼다고 다음 정거장으로 옮기지 않는다.
 */
export function stopMarkOf(track: StopTrack, nowMs: number, tracking: boolean): StopMark | undefined {
  if (track.index === null) return undefined;
  const fresh = track.lastFixAtMs !== null && nowMs - track.lastFixAtMs <= FIX_MAX_AGE_MS;
  return { index: track.index, near: track.near && tracking && fresh };
}

export type StopStatus = 'passed' | 'current' | 'upcoming';

/** 표시가 없으면 모든 정거장을 upcoming(기존 색)으로 둔다. 있으면 앞은 passed, 같은 곳은 current, 뒤는 upcoming. */
export function stopStatusOf(index: number, mark: StopMark | undefined): StopStatus {
  if (!mark) return 'upcoming';
  if (index < mark.index) return 'passed';
  return index === mark.index ? 'current' : 'upcoming';
}
