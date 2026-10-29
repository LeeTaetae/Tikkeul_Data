// 백엔드 응답 → 화면용 타입 변환, 그리고 실제 데이터가 경로 기반 경고에 연결되지 않는다는 점을 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  childProtectionZonesToAlerts,
  incidentToAlert,
  incidentsToAlerts,
  protectionZoneToAlert,
  sortCautionZones,
  sortProtectionZones,
} from '../src/lib/api/convert.ts';
import { localizeAlert } from '../src/lib/localizeAlert.ts';
import { MATCH_MAX_LATERAL_M, matchHazardsToRoute } from '../src/lib/routeHazards.ts';
import { MOCK_ROUTE_A } from '../src/dev/mockRoute.ts';

const incident = (over = {}) => ({
  id: 'i1', kind: 'accident', road_type: '고속도로', event_type: '교통사고', event_detail_type: '충돌사고',
  road_name: '경부선', road_no: '1', direction_text: '종점', lanes_blocked: '2차로 차단', message: '추돌 사고',
  link_id: '1210000711', location: { lat: 37.456747, lon: 127.046344 },
  started_at: '2026-10-28T06:11:45+09:00', ended_at: null, ...over,
});

test('사고·공사·ITS 정체 분류는 알림으로 변환하고, 기상·재난·기타는 뺀다', () => {
  const kinds = ['accident', 'construction', 'congestion', 'weather', 'disaster', 'other'];
  const alerts = incidentsToAlerts(kinds.map((kind, n) => incident({ id: 'k' + n, kind })), '위치 없음');
  assert.deepEqual(alerts.map((a) => a.type), ['accident', 'congestion', 'construction']);
});

test('변환 결과는 API 가 준 사실만 담는다', () => {
  const a = incidentToAlert(incident(), '위치 없음');
  assert.equal(a.location, '경부선');
  assert.equal(a.description, '추돌 사고 · 2차로 차단');
  assert.equal(a.updatedAt, '2026-10-28T06:11:45+09:00');
  assert.equal(a.timeKind, 'started'); // 갱신이 아니라 발생 시각
  assert.equal(a.latitude, 37.456747);
  assert.equal(a.longitude, 127.046344);
  assert.equal(a.severity, 'danger');
  assert.ok(!('translations' in a), '번역을 만들어 넣지 않는다');
  assert.ok(!('headingDeg' in a), '방향을 만들어 넣지 않는다');
  assert.ok(!a.isSample);
});

test('빈 값 처리: 도로명이 없으면 대체 문구, 설명이 없으면 세부 유형, 발생 시각이 없으면 빈 문자열', () => {
  const a = incidentToAlert(incident({ road_name: ' ', message: ' ', lanes_blocked: '', event_detail_type: '차량증가/정체', kind: 'congestion', started_at: null }), '위치 없음');
  assert.equal(a.location, '위치 없음');
  assert.equal(a.description, '차량증가/정체');
  assert.equal(a.updatedAt, '');
});

test('정렬: 사고 → 정체 → 공사, 같은 유형은 최근 발생 순', () => {
  const list = [
    incident({ id: 'c-old', kind: 'construction', started_at: '2026-08-11T00:00:00+09:00' }),
    incident({ id: 'c-new', kind: 'construction', started_at: '2026-10-01T00:00:00+09:00' }),
    incident({ id: 'jam', kind: 'congestion' }),
    incident({ id: 'acc', kind: 'accident' }),
  ];
  assert.deepEqual(incidentsToAlerts(list, '').map((a) => a.id), ['acc', 'jam', 'c-new', 'c-old']);
});

test('번역이 없는 실제 데이터는 어떤 언어에서도 원문(한국어)을 그대로 쓴다', () => {
  const a = incidentToAlert(incident(), '');
  for (const lang of ['ko', 'en', 'zh']) assert.deepEqual(localizeAlert(a, lang), { location: '경부선', description: '추돌 사고 · 2차로 차단' });
});

test('실제 돌발 데이터는 방향 정보가 없어 경로 기반 경고(routeHazards)에 연결되지 않는다', () => {
  // 위험이 경로 위에 정확히 놓여 있어도, headingDeg 가 없으면 경로상 위험으로 단정하지 않는다.
  const p = MOCK_ROUTE_A.points[1];
  const a = incidentToAlert(incident({ location: { lat: p.latitude, lon: p.longitude } }), '');
  const result = matchHazardsToRoute(MOCK_ROUTE_A, [a]);
  assert.equal(result.onRoute.length, 0);
  assert.deepEqual(result.rejected.map((r) => r.reason), ['unknownDirection']);
  assert.ok(MATCH_MAX_LATERAL_M > 0);
});

test('주의운전구간은 priority 순, 보호구역은 어린이 → 노인 → 장애인 순', () => {
  const z = (id, priority) => ({ id, priority });
  assert.deepEqual(sortCautionZones([z('b', null), z('a', 2), z('c', 1)]).map((x) => x.id), ['c', 'a', 'b']);
  const p = (name, zone_type) => ({ name, zone_type });
  assert.deepEqual(sortProtectionZones([p('나', 'senior'), p('다', 'child'), p('가', 'child')]).map((x) => x.name), ['가', '다', '나']);
});

const zone = (over = {}) => ({
  id: 'z1', name: '행복초등학교', zone_type: 'child', facility_detail_code: '', parent_id: '', in_use: true,
  sgg_cd: '', emdong_code: '', std_code: '', assignment: 'priority',
  road_address: '서울특별시 강남구 테헤란로 1', road_address_detail: '', lot_address: '', lot_address_detail: '',
  registered_on: null, center: { lat: 37.5, lon: 127.03 }, geometry: null, ...over,
});

test('어린이보호구역만 경로 매칭용 알림으로 바꾸고, 다른 보호구역·좌표 없는 구역은 뺀다', () => {
  assert.equal(protectionZoneToAlert(zone({ zone_type: 'senior' })), null);
  assert.equal(protectionZoneToAlert(zone({ center: null })), null);
  const a = protectionZoneToAlert(zone());
  assert.equal(a.type, 'school_zone');
  assert.equal(a.severity, 'caution');
  assert.equal(a.location, '서울특별시 강남구 테헤란로 1');
  assert.equal(a.description, '행복초등학교');
  assert.equal(a.latitude, 37.5);
  assert.equal(a.longitude, 127.03);
  assert.equal(a.omnidirectional, true);
  assert.ok(!('headingDeg' in a), '방향을 만들어 넣지 않는다');
});

test('도로명주소가 없으면 지번주소, 둘 다 없으면 시설명을 위치로 쓴다', () => {
  assert.equal(protectionZoneToAlert(zone({ road_address: '', lot_address: '강남구 역삼동 1' })).location, '강남구 역삼동 1');
  assert.equal(protectionZoneToAlert(zone({ road_address: '', lot_address: '' })).location, '행복초등학교');
});

test('어린이보호구역은 방향 없이도(omnidirectional) 경로 위 위험으로 매칭된다', () => {
  const p = MOCK_ROUTE_A.points[1];
  const a = protectionZoneToAlert(zone({ center: { lat: p.latitude, lon: p.longitude } }));
  const result = matchHazardsToRoute(MOCK_ROUTE_A, [a]);
  assert.equal(result.onRoute.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.ok(MATCH_MAX_LATERAL_M > 0);
});

test('childProtectionZonesToAlerts: 어린이 외 유형과 좌표 없는 항목은 걸러낸다', () => {
  const zones = [zone({ id: 'c1' }), zone({ id: 's1', zone_type: 'senior' }), zone({ id: 'c2', center: null })];
  assert.deepEqual(childProtectionZonesToAlerts(zones).map((a) => a.id), ['c1']);
});
