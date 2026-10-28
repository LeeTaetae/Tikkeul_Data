// 개발 전용: 시뮬레이터가 쓰는 가상 경로와 시나리오용 위험. 실제 도로·실제 교통정보가 아니다.
// 지울 때는 src/dev/ 폴더와 app/index.tsx 의 시뮬레이터 사용부만 걷어내면 된다.
import type { Route } from '../lib/routeHazards';
import type { RoadAlert } from '../types/alert';

// 경로 A: 시작 → m1(사고) → m3(정체) → m2(공사) → 끝 순서로 지나는 약 10km 가상 경로.
// 각 위험은 이전 지점에서 2km 넘게 떨어져 있어, 위험마다 "2km 전방" 시나리오를 따로 돌릴 수 있다.
// 선분 방위: 시작→m1 236°, m1→m3 237°, m3→m2 173°, m2→끝 165° (MOCK_ALERTS 의 headingDeg 는 이에 맞춘 값)
export const MOCK_ROUTE_A: Route = {
  id: 'route-a',
  points: [
    { latitude: 37.56, longitude: 127.085 },
    { latitude: 37.5446, longitude: 127.0557 },
    { latitude: 37.5321, longitude: 127.0316 },
    { latitude: 37.5006, longitude: 127.0364 },
    { latitude: 37.49, longitude: 127.04 },
  ],
};

// 경로 B(재탐색 결과): m1 까지는 같고 그 뒤 서쪽으로 갈라진다. A 의 m3·m2 는 B 에서 "경로 밖"이 된다.
export const MOCK_ROUTE_B: Route = {
  id: 'route-b',
  points: [
    { latitude: 37.56, longitude: 127.085 },
    { latitude: 37.5446, longitude: 127.0557 },
    { latitude: 37.55, longitude: 127.03 },
    { latitude: 37.555, longitude: 127.01 },
  ],
};

// 시나리오 전용 위험. MOCK_ALERTS 에 넣지 않아 위험 알림 페이지에는 나타나지 않는다.
// 반대 방향: 경로 A 의 m1→m3 선분 한가운데, 진행 방향과 정반대(237°+180°)
export const OPPOSITE_ALERT: RoadAlert = {
  id: 's-opposite',
  type: 'accident',
  severity: 'danger',
  location: '[시나리오] 반대 방향 차로의 사고',
  description: '경로와 같은 위치지만 반대 방향 차로라서 알림이 없어야 해요.',
  updatedAt: '2026-10-28T09:20:00+09:00',
  latitude: 37.53835,
  longitude: 127.04365,
  isSample: true,
  headingDeg: 57,
};

// 경로 밖: 경로 A 의 m3→m2 선분 한가운데에서 동쪽으로 약 400m 떨어진 곳, 방향은 같음
export const OFF_ROUTE_ALERT: RoadAlert = {
  id: 's-offroute',
  type: 'construction',
  severity: 'caution',
  location: '[시나리오] 경로에서 떨어진 도로의 공사',
  description: '경로에서 400m 정도 떨어진 도로라서 알림이 없어야 해요.',
  updatedAt: '2026-10-28T09:10:00+09:00',
  latitude: 37.51635,
  longitude: 127.0385,
  isSample: true,
  headingDeg: 173,
};
