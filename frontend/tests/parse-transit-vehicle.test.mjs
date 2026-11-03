// 서버 응답의 버스 vehicle 을 앱 모델로 바꿀 때 공식 정보를 믿는 조건
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTransitVehicle } from '../src/map/parseTransitVehicle.ts';

const base = { name: '402', type: '간선버스' };

test('서버가 high 로 확정한 노선은 노선 ID·운영 지역·유형을 그대로 받는다', () => {
  const v = parseTransitVehicle({ ...base, route_id: '100100063', operator_region: 'seoul', route_class: '간선', match_confidence: 'high', data_source: 'seoul_bus_route' });
  assert.deepEqual(v, { name: '402', type: '간선버스', routeId: '100100063', operatorRegion: 'seoul', routeClass: '간선' });
});

test('운영 지역만 확정되고 유형을 모르는 노선(서울 API 로 채운 경기·인천)은 유형만 null 이다', () => {
  const v = parseTransitVehicle({ ...base, route_id: 'G83', operator_region: 'gyeonggi', route_class: null, match_confidence: 'high' });
  assert.equal(v.routeId, 'G83');
  assert.equal(v.operatorRegion, 'gyeonggi');
  assert.equal(v.routeClass, null);
});

test('확정되지 않은 값은 일부만 쓰지 않고 모두 버린다 (high 가 아니거나 ID·지역이 없을 때)', () => {
  const none = { routeId: null, operatorRegion: null, routeClass: null };
  assert.deepEqual({ ...parseTransitVehicle({ ...base, route_id: 'R', operator_region: 'seoul', route_class: '간선', match_confidence: 'medium' }) }, { name: '402', type: '간선버스', ...none });
  assert.deepEqual({ ...parseTransitVehicle({ ...base, route_id: 'R', operator_region: null, route_class: '간선', match_confidence: 'high' }) }, { name: '402', type: '간선버스', ...none });
  assert.deepEqual({ ...parseTransitVehicle({ ...base, route_id: null, operator_region: 'seoul', route_class: '간선', match_confidence: 'high' }) }, { name: '402', type: '간선버스', ...none });
  assert.deepEqual({ ...parseTransitVehicle({ ...base }) }, { name: '402', type: '간선버스', ...none });
});

test('옛 서버 응답(필드 없음)과 이상한 값에도 오류 없이 빈 값이 된다', () => {
  assert.deepEqual(parseTransitVehicle(undefined), { name: '', type: null, routeId: null, operatorRegion: null, routeClass: null });
  assert.equal(parseTransitVehicle({ route_id: 5, operator_region: {}, match_confidence: 'high' }).operatorRegion, null);
});
