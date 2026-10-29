// 기존 경로 기반 경고 로직 회귀: 이번 연동에서 routeHazards 동작이 바뀌지 않았음을 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOCK_ALERTS } from '../src/data/mockAlert.ts';
import { MOCK_ROUTE_A, MOCK_ROUTE_B, OFF_ROUTE_ALERT, OPPOSITE_ALERT } from '../src/dev/mockRoute.ts';
import { formatDistance } from '../src/lib/distance.ts';
import { matchHazardsToRoute, remainingHazards } from '../src/lib/routeHazards.ts';
import { formatDateTimeKst, formatTimeKst } from '../src/lib/time.ts';

const all = [...MOCK_ALERTS, OPPOSITE_ALERT, OFF_ROUTE_ALERT];

test('경로 A: 경로 위 3건, 반대 방향·경로 밖은 제외', () => {
  const m = matchHazardsToRoute(MOCK_ROUTE_A, all);
  assert.deepEqual(m.onRoute.map((h) => h.alert.id), ['m1', 'm3', 'm2']);
  assert.deepEqual(Object.fromEntries(m.rejected.map((r) => [r.alert.id, r.reason])), { 's-opposite': 'oppositeDirection', 's-offroute': 'offRoute' });
});

test('경로 B(재탐색): 사고(m1)만 경로에 남는다', () => {
  assert.deepEqual(matchHazardsToRoute(MOCK_ROUTE_B, all).onRoute.map((h) => h.alert.id), ['m1']);
});

test('방향 정보가 없는 위험은 경로 위에 있어도 제외', () => {
  const noHeading = { ...MOCK_ALERTS[0], id: 'nh', headingDeg: undefined };
  assert.deepEqual(matchHazardsToRoute(MOCK_ROUTE_A, [noHeading]).rejected.map((r) => r.reason), ['unknownDirection']);
});

test('남은 거리는 경로를 따라 계산하고 통과하면 0 이하', () => {
  const onRoute = matchHazardsToRoute(MOCK_ROUTE_A, MOCK_ALERTS).onRoute;
  const m1 = onRoute[0];
  assert.equal(Math.round(remainingHazards(onRoute, m1.offsetM - 500)[0].distanceM), 500);
  assert.ok(remainingHazards(onRoute, m1.offsetM + 1)[0].distanceM <= 0);
});

test('거리·시각 표기', () => {
  assert.deepEqual([2000, 995, 480, 104].map(formatDistance), ['2km', '1km', '480m', '100m']);
  assert.equal(formatTimeKst('2026-10-28T06:11:45+09:00'), '06:11');
  const now = new Date('2026-10-28T10:00:00+09:00');
  assert.equal(formatDateTimeKst('2026-10-28T06:11:45+09:00', now), '06:11'); // 오늘은 시각만
  assert.equal(formatDateTimeKst('2026-08-11T00:00:00+09:00', now), '08.11 00:00'); // 다른 날은 날짜 포함
  assert.equal(formatDateTimeKst('2026-10-27T23:59:00+09:00', now), '10.27 23:59');
  assert.equal(formatDateTimeKst('이상한 값', now), '');
});
