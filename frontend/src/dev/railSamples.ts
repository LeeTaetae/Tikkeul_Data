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
