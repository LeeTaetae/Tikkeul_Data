// 길안내 화면에 보여줄 값 계산. 다른 모듈을 런타임 import 하지 않는 순수 함수라 Node 로도 테스트한다.

export type TurnKind = 'straight' | 'left' | 'right' | 'uturn' | 'arrive' | 'generic';

// 방향 아이콘을 쓰는 turnType 은 실제 TMAP 응답(자동차 8개 경로·도보 4개 경로)에서 안내 문구와 함께 확인한 것만 둔다.
//   11 "직진 후" · 12 "좌회전 후" · 13 "우회전 후" · 14 "U턴 후" · 17 "10시 방향 좌회전 후" · 18 "2시 방향 우회전 후"
//   19 "4시 방향 우회전 후" · 201 "도착"
// 응답에서 보지 못한 코드(예: 16 "8시 방향 좌회전")와, 방향이 아니라 시설을 뜻하는 코드(101~123 고속도로·고가·터널,
// 125~129 육교·지하보도, 211~217 횡단보도 등)는 일부러 넣지 않는다. 잘못된 방향 아이콘을 보여주는 것보다 일반 안내가 낫다.
const VERIFIED_TURN: Record<number, TurnKind> = {
  11: 'straight',
  12: 'left',
  13: 'right',
  14: 'uturn',
  17: 'left',
  18: 'right',
  19: 'right',
  201: 'arrive',
};

/** 안내 지점이 어느 방향인지. 확인된 코드가 아니면 'generic' 이고, 화면은 TMAP 이 준 안내 문구를 그대로 보여준다. */
export function turnKindOf(guide: { turnType?: number; pointType: string }): TurnKind {
  if (guide.turnType !== undefined && guide.turnType in VERIFIED_TURN) return VERIFIED_TURN[guide.turnType];
  // 도착 지점(point_type E, 도보는 EP)은 turnType 이 없어도 도착으로 본다.
  if (guide.pointType === 'E' || guide.pointType === 'EP') return 'arrive';
  return 'generic';
}

export interface DisplayEta {
  /** 남은 시간(분, 올림, 최소 1) */
  minutes: number;
  /** 예상 도착 시각(ms). now 에 남은 시간을 더한 값이다 */
  arrivalAtMs: number;
}

/**
 * 남은 시간(초)을 화면용 분·도착 시각으로 바꾼다. 도착 시각은 GPS 시각이 아니라 now(기기 시계)를 기준으로 한다.
 * 이 값은 기존 경로 소요시간을 남은 거리 비율로 나눈 근사값이며 실시간 교통을 반영하지 않는다.
 */
export function displayEta(remainingSec: number, nowMs: number): DisplayEta {
  const safe = Math.max(0, remainingSec);
  return { minutes: Math.max(1, Math.ceil(safe / 60)), arrivalAtMs: nowMs + safe * 1000 };
}

/** 분을 i18n 키와 값으로. 1시간 넘으면 "N시간 M분" (map.minutes · map.hours · map.hoursMinutes) */
export function durationLabel(totalMinutes: number): { key: string; params: Record<string, number> } {
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) return { key: 'map.minutes', params: { n: rounded } };
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes === 0 ? { key: 'map.hours', params: { n: hours } } : { key: 'map.hoursMinutes', params: { h: hours, m: minutes } };
}
