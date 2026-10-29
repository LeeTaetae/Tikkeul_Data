// 샘플 데이터. 교통 공공데이터 API 확정(TBD) 전까지 화면 확인용으로만 쓴다.
export type AlertKind = 'jam' | 'work' | 'block' | 'zone';

export interface TrafficAlert {
  id: string;
  kind: AlertKind;
  place: string;
  distanceM: number;
}

export const SAMPLE_UPDATED_AT = '2026-10-28T09:20:00+09:00';

export const SAMPLE_ALERTS: TrafficAlert[] = [
  { id: 'a1', kind: 'zone', place: '한울초등학교 앞', distanceM: 300 },
  { id: 'a2', kind: 'jam', place: '강변북로 성수대교 방면', distanceM: 1200 },
  { id: 'a3', kind: 'work', place: '테헤란로 역삼역 사거리', distanceM: 2100 },
  { id: 'a4', kind: 'block', place: '세종대로 광화문 광장 일대', distanceM: 4800 },
  { id: 'a5', kind: 'zone', place: '새싹어린이집 주변', distanceM: 5300 },
];
