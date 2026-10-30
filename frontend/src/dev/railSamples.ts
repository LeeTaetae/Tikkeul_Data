// 개발 전용: 위험 레일 확인용 가상 위험. 실제 위험이 아니며 모두 isSample 이다("예시" 표시가 붙는다).
// 가상 경로 A(src/dev/mockRoute.ts) 위에 놓아, 확정·미확인·4개 이상(+N)·방향 정보 없음 같은 경우를 브라우저에서 볼 수 있게 한다.
// /navigation?test=replay 에서만 쓴다. 지울 때는 src/dev/ 와 app/navigation.tsx 의 사용부만 걷어내면 된다.
import { MOCK_ALERTS } from '../data/mockAlert';
import type { RoadAlert } from '../types/alert';
import { MOCK_ROUTE_A } from './mockRoute';

// 경로 A 의 인접한 두 꼭짓점의 중간(경로 위 한 점)
const mid = (i: number) => {
  const a = MOCK_ROUTE_A.points[i];
  const b = MOCK_ROUTE_A.points[i + 1];
  return { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
};

const sample = (id: string, type: RoadAlert['type'], severity: RoadAlert['severity'], place: string, directionScope: RoadAlert['directionScope'], segment: number): RoadAlert => ({
  id,
  eventKey: id,
  type,
  severity,
  location: place,
  description: '개발용 예시 위험입니다. 실제 위험이 아닙니다.',
  updatedAt: '2026-10-28T09:00:00+09:00',
  isSample: true,
  directionScope,
  ...mid(segment),
});

export const RAIL_TEST_ALERTS: RoadAlert[] = [
  sample('s-single-accident', 'accident', 'danger', '예시: 한쪽 방향(기점/종점)만 알려진 사고', 'single', 0),
  sample('s-both-construction', 'construction', 'caution', '예시: 양방향 공사', 'both', 1),
  sample('s-unknown-congestion', 'congestion', 'busy', '예시: 방향 정보 없는 정체', 'unknown', 2),
  sample('s-both-accident', 'accident', 'danger', '예시: 양방향 사고', 'both', 3),
];

/** 기존 가상 위험 3건 + 레일 확인용 4건 */
export const RAIL_TEST_SAMPLES: RoadAlert[] = [...MOCK_ALERTS, ...RAIL_TEST_ALERTS];

// ───────────── 음성(TTS) 확인용 가상 데이터 ─────────────
// /navigation?test=replay 에서만 쓴다. 실제 안내 문구·실제 방지턱·실제 보호구역이 아니다. 문구에 "(테스트)"를 붙여 구분한다.

/** 가상 경로 A 의 꼭짓점(안내 지점)마다 하나씩. point 가 있어야 팀 TTS 가 그 지점 근처에서 읽는다 */
export const TEST_INSTRUCTIONS = MOCK_ROUTE_A.points.map((p, i) => ({
  text: `(테스트) ${i + 1}번째 안내 지점입니다`,
  point: { lat: p.latitude, lng: p.longitude },
}));

/** 가상 경로 A 위의 과속방지턱(두 번째 구간의 중간) */
export const TEST_SPEED_BUMPS = [{ lat: mid(1).latitude, lng: mid(1).longitude }];

/** 가상 어린이보호구역(세 번째 구간의 중간). 가상 재생은 시속 약 144km 로 달려 과속 음성 경고가 나온다 */
export const TEST_SCHOOL_ZONES: RoadAlert[] = [
  {
    id: 's-school-zone',
    eventKey: 's-school-zone',
    type: 'school_zone',
    severity: 'caution',
    location: '예시: 가상 어린이보호구역',
    description: '개발용 예시 보호구역입니다. 실제 보호구역이 아닙니다.',
    updatedAt: '',
    isSample: true,
    omnidirectional: true,
    ...mid(2),
  },
];
