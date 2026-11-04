// 네이티브(카카오 SDK) 길안내 화면이 보내는 위치·경로 이벤트를 JS 위험 로직의 입력으로 바꾼다. React·네이티브에 의존하지 않는 순수 함수라 Node 로 테스트한다.
// Android/iOS product onGuidance payloads are validated by coordinate range as well as key names.
import type { LatLng } from './guidanceEngine';

export interface NativeLocationEvent {
  lat: number;
  lng: number;
  speedKmh?: number;
  hdop?: number;
  posTrust?: boolean;
  valid?: boolean;
}

export interface NativePosition {
  lat: number;
  lng: number;
  /** SDK 는 미터 단위 정확도를 주지 않는다(hdop 만). 모르면 null — 위험 엔진은 null 을 "모름"으로 본다 */
  accuracyM: number | null;
  speedMps: number | null;
}

// 국내 서비스라 대한민국 범위 밖 좌표는 잘못된 값(KATEC 미변환, 경위도 뒤바뀜 등)으로 본다.
const inKorea = (lat: number, lng: number) => lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 경로 점 하나에서 위도·경도를 고른다. 키 이름으로 먼저 보고, 범위가 틀리면 뒤바뀐 것으로 다시 본다. 둘 다 아니면 null */
export function pickLatLng(point: Record<string, unknown>, keys: string[] = Object.keys(point)): LatLng | null {
  const latKey = keys.find((k) => /lat|^y$/i.test(k));
  const lngKey = keys.find((k) => /lng|lon|^x$/i.test(k));
  if (!latKey || !lngKey) return null;
  const a = point[latKey];
  const b = point[lngKey];
  if (!isNum(a) || !isNum(b)) return null;
  if (inKorea(a, b)) return { lat: a, lng: b };
  if (inKorea(b, a)) return { lat: b, lng: a };
  return null;
}

/**
 * 경로 이벤트의 점 목록 → 안내 경로 좌표. 한 점이라도 잘못되면 경로 전체를 버린다(일부만 쓰면 진행 거리가 틀어진다).
 * 이웃한 같은 점은 합친다. 점이 2개 미만이면 null.
 */
export function parseNativeRoute(points: unknown, keys?: string[]): LatLng[] | null {
  if (!Array.isArray(points)) return null;
  const path: LatLng[] = [];
  for (const raw of points) {
    if (!raw || typeof raw !== 'object') return null;
    const p = pickLatLng(raw as Record<string, unknown>, keys);
    if (!p) return null;
    const last = path[path.length - 1];
    if (!last || last.lat !== p.lat || last.lng !== p.lng) path.push(p);
  }
  return path.length >= 2 ? path : null;
}

/** 위치 이벤트 → 위험 훅 입력. valid=false·범위 밖이면 null(이 위치는 쓰지 않는다) */
export function parseNativeLocation(event: unknown): NativePosition | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Partial<NativeLocationEvent>;
  if (e.valid === false || !isNum(e.lat) || !isNum(e.lng) || !inKorea(e.lat, e.lng)) return null;
  const speedMps = isNum(e.speedKmh) && e.speedKmh >= 0 ? e.speedKmh / 3.6 : null;
  return { lat: e.lat, lng: e.lng, accuracyM: null, speedMps };
}

/**
 * 타이머가 멈춰도 동작하는 갱신 시계. Android 는 SDK 화면이 앞에 있으면 RN 호스트가 pause 되어 setInterval/setTimeout 이 멈출 수 있다(JavaTimerManager).
 * 그래서 위치 이벤트가 올 때마다 호출해서 "지금 다시 조회할 때인가"만 알려 준다. 시계 대신 이벤트가 박자를 만든다.
 */
export function createEventClock(intervalMs: number) {
  let last: number | null = null;
  return {
    /** 처음이거나 마지막 조회 후 intervalMs 가 지났으면 true 이고, 이때 기준 시각을 지금으로 옮긴다 */
    due(nowMs: number): boolean {
      if (last !== null && nowMs - last < intervalMs) return false;
      last = nowMs;
      return true;
    },
    /** 조회가 실패했을 때 다음 이벤트에서 바로 다시 시도하게 한다 */
    reset(): void {
      last = null;
    },
  };
}

/** 마지막 위치 이벤트 후 maxGapMs 가 지났으면 피드가 끊긴 것(화면에 "위험 정보 갱신 중단"을 알릴 때 쓴다). 한 번도 못 받았으면 끊긴 것이 아니라 아직 시작 전이다 */
export function isFeedStale(lastEventMs: number | null, nowMs: number, maxGapMs: number): boolean {
  return lastEventMs !== null && nowMs - lastEventMs > maxGapMs;
}
