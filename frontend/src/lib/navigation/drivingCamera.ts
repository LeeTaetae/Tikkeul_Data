// 차량 길안내 화면의 카메라·방향 계산. 지도 SDK 를 모르는 순수 코드라 Node 로 테스트한다.
//
// 카카오맵 SDK 는 지도 회전·기울기를 지원하지 않는다(setCenter·panTo·setLevel 만 있다). 그래서 지도는 북쪽이 위인 채로 두고,
// ① 진행 방향 앞쪽 길이 보이도록 차를 진행 반대쪽으로 비켜 놓고 ② 방향은 차량 화살표 마커만 돌려 보여준다.
// 즉 차가 항상 화면 아래 가운데에 오는 것은 북쪽으로 갈 때뿐이다. 다른 방향에서는 그 방향에 맞춰 차가 치우친다.

export interface LatLng {
  lat: number;
  lng: number;
}

const M_PER_DEG = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

function distanceM(a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

// ───────────────────────── 1. 각도 ─────────────────────────

/** a → b 방위각(북=0, 시계 방향, 0~360). 두 점이 같으면 0 */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  const east = (b.lng - a.lng) * k;
  const north = b.lat - a.lat;
  return (toDeg(Math.atan2(east, north)) + 360) % 360;
}

/** to - from 을 가장 짧은 회전 각도(-180~180)로 */
export function angleDiff(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** 각도를 짧은 쪽으로 alpha(0~1) 만큼 다가간다 */
export function smoothAngle(prev: number, next: number, alpha: number): number {
  return (prev + angleDiff(prev, next) * alpha + 360) % 360;
}

/** 마커 회전용: 359° → 1° 처럼 넘어갈 때 한 바퀴 거꾸로 돌지 않도록 이전 값에 이어지는 각도로 바꾼다 */
export function unwrapAngle(prevContinuous: number | null, nextDeg: number): number {
  if (prevContinuous === null) return nextDeg;
  return prevContinuous + angleDiff(prevContinuous, nextDeg);
}

// ───────────────────────── 2. 경로 위 위치 ─────────────────────────

export interface PathIndex {
  path: LatLng[];
  /** 각 점까지의 누적 거리(m). cumM[0] = 0 */
  cumM: number[];
  totalM: number;
}

export function buildPathIndex(path: LatLng[]): PathIndex {
  const cumM = [0];
  for (let i = 1; i < path.length; i++) cumM.push(cumM[i - 1] + distanceM(path[i - 1], path[i]));
  return { path, cumM, totalM: cumM[cumM.length - 1] ?? 0 };
}

/** 경로 시작에서 distM 만큼 간 지점. 범위 밖은 양 끝점. 경로가 비어 있으면 null */
export function pointAtDistance(index: PathIndex, distM: number): LatLng | null {
  const { path, cumM, totalM } = index;
  if (path.length === 0) return null;
  if (distM <= 0 || path.length === 1) return path[0];
  if (distM >= totalM) return path[path.length - 1];
  let lo = 0;
  let hi = cumM.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumM[mid] <= distM) lo = mid;
    else hi = mid;
  }
  const span = cumM[hi] - cumM[lo];
  const t = span > 0 ? (distM - cumM[lo]) / span : 0;
  return { lat: path[lo].lat + (path[hi].lat - path[lo].lat) * t, lng: path[lo].lng + (path[hi].lng - path[lo].lng) * t };
}

/** 경로 위 progressM 지점에서 lookaheadM 앞까지의 진행 방향. 길이가 없는 경로는 null */
export function routeBearingAt(index: PathIndex, progressM: number, lookaheadM = 25): number | null {
  if (index.totalM <= 0) return null;
  // 도착 지점 근처에서는 앞쪽이 모자라므로 뒤로 물려 마지막 구간 방향을 쓴다.
  const from = Math.max(0, Math.min(progressM, index.totalM - lookaheadM));
  const a = pointAtDistance(index, from);
  const b = pointAtDistance(index, Math.min(index.totalM, from + lookaheadM));
  return a && b ? bearingDeg(a, b) : null;
}

/** 지나온 구간을 뺀 앞쪽 경로(현재 지점부터). maxAheadM 보다 먼 쪽은 그리지 않는다(긴 경로를 자주 다시 그리지 않기 위함) */
export function pathAhead(index: PathIndex, progressM: number, maxAheadM = 10_000): LatLng[] {
  const { path, cumM, totalM } = index;
  if (path.length < 2) return path;
  const start = Math.max(0, Math.min(progressM, totalM));
  const end = Math.min(totalM, start + maxAheadM);
  const first = pointAtDistance(index, start);
  const last = pointAtDistance(index, end);
  if (!first || !last) return path;
  const middle: LatLng[] = [];
  for (let i = 0; i < path.length; i++) if (cumM[i] > start && cumM[i] < end) middle.push(path[i]);
  return [first, ...middle, last];
}

// ───────────────────────── 3. 진행 방향(화살표) ─────────────────────────

/** 이 속도(m/s) 미만이면 멈춘 것으로 본다. 멈춘 동안은 GPS 흔들림으로 방향을 바꾸지 않는다 */
export const HEADING_MOVING_MPS = 1.5;
/** 경로 밖에서 위치 변화로 방향을 잴 때 필요한 최소 이동 거리(m) */
export const HEADING_MIN_MOVE_M = 6;
/** 이보다 작은 방향 변화는 무시한다(도) */
export const HEADING_DEADBAND_DEG = 4;
/** 방향을 새 값 쪽으로 옮기는 비율. 클수록 빨리 돌고 작을수록 부드럽다 */
export const HEADING_SMOOTHING = 0.35;

export interface HeadingState {
  headingDeg: number | null;
  /** 경로를 벗어났을 때 위치 변화로 방향을 재기 위한 기준 위치 */
  last: LatLng | null;
}

export const INITIAL_HEADING: HeadingState = { headingDeg: null, last: null };

export interface HeadingInput {
  position: LatLng;
  /** 엔진이 추정한 속도(m/s). 모르면 null */
  speedMps: number | null;
  /** 경로 위에 있을 때 그 지점의 경로 방향. 경로를 벗어났거나 모르면 null */
  routeBearing: number | null;
}

/**
 * 화살표 방향을 갱신한다. 경로 위에서는 GPS 방향이 아니라 경로 방향을 쓰고(GPS heading 은 느리거나 틀리기 쉽다),
 * 경로를 벗어났을 때만 위치 변화로 잰다. 멈춰 있으면 직전 방향을 그대로 둔다.
 */
export function updateHeading(state: HeadingState, input: HeadingInput): HeadingState {
  const moving = input.speedMps !== null && input.speedMps >= HEADING_MOVING_MPS;
  // 처음에는 멈춰 있어도 경로 방향으로 화살표를 맞춘다.
  if (!moving) return state.headingDeg === null && input.routeBearing !== null ? { ...state, headingDeg: input.routeBearing } : state;

  let target = input.routeBearing;
  let last = state.last;
  if (target === null) {
    if (state.last && distanceM(state.last, input.position) >= HEADING_MIN_MOVE_M) {
      target = bearingDeg(state.last, input.position);
      last = input.position;
    } else if (!state.last) {
      last = input.position;
    }
  } else {
    last = input.position;
  }
  if (target === null) return { ...state, last };
  if (state.headingDeg === null) return { headingDeg: target, last };
  if (Math.abs(angleDiff(state.headingDeg, target)) < HEADING_DEADBAND_DEG) return { ...state, last };
  return { headingDeg: smoothAngle(state.headingDeg, target, HEADING_SMOOTHING), last };
}

// ───────────────────────── 4. 속도에 따른 확대 단계 ─────────────────────────

/** 주행 중에는 가장 가까운 확대를 유지한다. 카카오 level은 작을수록 확대된다. */
export const FOLLOW_LEVEL_MIN = 1;
export const FOLLOW_LEVEL_MAX = 1;
/** 단계를 바꾼 뒤 이 시간 안에는 다시 바꾸지 않는다(ms) */
export const LEVEL_MIN_DWELL_MS = 8000;

export interface LevelState {
  level: number;
  changedAtMs: number;
}

export function nextFollowLevel(state: LevelState | null, _speedMps: number | null, nowMs: number): LevelState {
  return state?.level === FOLLOW_LEVEL_MIN ? state : { level: FOLLOW_LEVEL_MIN, changedAtMs: nowMs };
}

// ───────────────────────── 5. 카메라 이동 판단·위치 ─────────────────────────

export interface CameraTarget {
  position: LatLng;
  headingDeg: number | null;
  level: number;
}

/** 이보다 덜 움직이고(m) 방향도 덜 바뀌면(도) 카메라를 다시 옮기지 않는다 */
export const CAMERA_MIN_MOVE_M = 4;
export const CAMERA_MIN_TURN_DEG = 12;

export function shouldMoveCamera(prev: CameraTarget | null, next: CameraTarget): boolean {
  if (!prev) return true;
  if (prev.level !== next.level) return true;
  if (distanceM(prev.position, next.position) >= CAMERA_MIN_MOVE_M) return true;
  if (prev.headingDeg === null || next.headingDeg === null) return prev.headingDeg !== next.headingDeg;
  return Math.abs(angleDiff(prev.headingDeg, next.headingDeg)) >= CAMERA_MIN_TURN_DEG;
}

export interface ViewInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 화면 아래 중앙의 차량 자리를, 회전 전 지도 픽셀 좌표로 변환한다. */
export function headingUpOffsetPx(headingDeg: number, size: { width: number; height: number }, insets: ViewInsets, scale = 1) {
  const offset = carOffsetPx(0, size, insets);
  const angle = toRad(headingDeg);
  return {
    dx: (offset.dx * Math.cos(angle) - offset.dy * Math.sin(angle)) / scale,
    dy: (offset.dx * Math.sin(angle) + offset.dy * Math.cos(angle)) / scale,
  };
}

/** 진행 방향 앞쪽에 쓰는 화면 비율: 보이는 영역 높이·너비의 이만큼 차를 반대쪽으로 비킨다 */
export const AHEAD_RATIO_Y = 0.3;
export const AHEAD_RATIO_X = 0.22;

/**
 * 차가 놓일 화면 위치를 지도 컨테이너 중심에서의 픽셀 차이(dx 오른쪽+, dy 아래+)로 돌려준다.
 * 가려지는 부분(위 카드·아래 패널 등 insets)을 뺀 영역의 가운데에서, 진행 방향 반대쪽으로 비킨다.
 * 방향을 모르면 그 영역 가운데에 둔다.
 */
export function carOffsetPx(headingDeg: number | null, size: { width: number; height: number }, insets: ViewInsets): { dx: number; dy: number } {
  const visibleW = Math.max(0, size.width - insets.left - insets.right);
  const visibleH = Math.max(0, size.height - insets.top - insets.bottom);
  const centerX = insets.left + visibleW / 2;
  const centerY = insets.top + visibleH / 2;
  const forwardX = headingDeg === null ? 0 : Math.sin(toRad(headingDeg));
  const forwardY = headingDeg === null ? 0 : -Math.cos(toRad(headingDeg));
  const carX = centerX - forwardX * AHEAD_RATIO_X * visibleW;
  const carY = centerY - forwardY * AHEAD_RATIO_Y * visibleH;
  return { dx: carX - size.width / 2, dy: carY - size.height / 2 };
}
