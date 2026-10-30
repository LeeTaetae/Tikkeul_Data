// D단계: 회전 안내 방향 판정(검증된 turnType 만), ETA 표시값, 위험 식별자(revision 반복 경고), 가상 경로 위험 매칭 회귀.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOCK_ALERTS } from '../src/data/mockAlert.ts';
import { MOCK_ROUTE_A } from '../src/dev/mockRoute.ts';
import { displayEta, durationLabel, turnKindOf } from '../src/lib/navigation/guidanceDisplay.ts';
import { hazardKey, matchHazardsToRoute, remainingHazards } from '../src/lib/routeHazards.ts';

const guide = (turnType, pointType = 'N') => ({ turnType, pointType });

test('2. 실제 TMAP 응답에서 안내 문구와 함께 확인한 turnType 만 방향으로 보여준다', () => {
  assert.equal(turnKindOf(guide(11)), 'straight');
  assert.equal(turnKindOf(guide(12)), 'left');
  assert.equal(turnKindOf(guide(13)), 'right');
  assert.equal(turnKindOf(guide(14)), 'uturn');
  assert.equal(turnKindOf(guide(17)), 'left'); // 10시 방향 좌회전
  assert.equal(turnKindOf(guide(18)), 'right'); // 2시 방향 우회전
  assert.equal(turnKindOf(guide(19)), 'right'); // 4시 방향 우회전
  assert.equal(turnKindOf(guide(201, 'E')), 'arrive');
});

test('2. 모르는 turnType 은 잘못된 방향 아이콘 대신 일반 안내(generic)로 처리한다', () => {
  for (const code of [16, 101, 104, 117, 118, 119, 120, 121, 125, 126, 142, 211, 212, 213, 999]) {
    assert.equal(turnKindOf(guide(code)), 'generic', String(code));
  }
  assert.equal(turnKindOf(guide(undefined)), 'generic'); // turn_type 자체가 없는 guide
});

test('2. 도착 지점(E·EP)은 turnType 이 없어도 도착으로 본다', () => {
  assert.equal(turnKindOf(guide(undefined, 'E')), 'arrive');
  assert.equal(turnKindOf(guide(undefined, 'EP')), 'arrive');
  assert.equal(turnKindOf(guide(undefined, 'N')), 'generic');
});

test('3. ETA 표시값: 분은 올림(최소 1), 도착 시각은 넘겨준 현재 시각에 남은 시간을 더한 값', () => {
  assert.deepEqual(displayEta(600, 1_000_000), { minutes: 10, arrivalAtMs: 1_000_000 + 600_000 });
  assert.equal(displayEta(61, 0).minutes, 2);
  assert.equal(displayEta(0, 0).minutes, 1);
  assert.equal(displayEta(-5, 0).minutes, 1); // 음수는 0 으로
  assert.equal(displayEta(-5, 7).arrivalAtMs, 7);
});

test('3. 소요시간 표기는 홈과 같은 i18n 키를 쓴다(1시간 넘으면 시간·분)', () => {
  assert.deepEqual(durationLabel(7), { key: 'map.minutes', params: { n: 7 } });
  assert.deepEqual(durationLabel(60), { key: 'map.hours', params: { n: 1 } });
  assert.deepEqual(durationLabel(69.4), { key: 'map.hoursMinutes', params: { h: 1, m: 9 } });
});

const alert = (extra = {}) => ({ id: 'i1', ...extra });

test('1. 위험 식별자: 같은 사건(eventKey)은 id 가 달라도 같은 위험이다', () => {
  assert.equal(hazardKey(alert({ id: 'a', eventKey: 'ek' })), hazardKey(alert({ id: 'b', eventKey: 'ek' })));
  assert.notEqual(hazardKey(alert({ id: 'a', eventKey: 'ek1' })), hazardKey(alert({ id: 'a', eventKey: 'ek2' })));
  assert.equal(hazardKey(alert({ id: 'a' })), 'a'); // eventKey 가 없으면 기존처럼 id
});

test('1. 위험 식별자: revision 은 제공자가 올렸을 때만 다른 위험으로 구분한다(기존 동작 유지)', () => {
  assert.notEqual(hazardKey(alert({ revision: 1 })), hazardKey(alert({ revision: 2 })));
  assert.equal(hazardKey(alert({ revision: 1 })), hazardKey(alert({ revision: 1 })));
  assert.equal(hazardKey(alert({ eventKey: 'ek', revision: 'r' })), 'ek#r');
});

test('1. 실제 돌발정보가 변환되면 revision 이 없어, 사소한 갱신으로 같은 위험이 반복 경고되지 않는다', async () => {
  const { incidentToAlert } = await import('../src/lib/api/convert.ts');
  const incident = (revision) => ({
    id: 'i1', kind: 'accident', road_type: '', event_type: '', event_detail_type: '', road_name: '길', road_no: '', direction_text: '',
    lanes_blocked: '', message: '사고', link_id: '', location: { lat: 37.5, lon: 127 }, started_at: null, ended_at: null,
    event_key: 'ek', revision,
  });
  const a = incidentToAlert(incident('rv1'), '위치');
  const b = incidentToAlert(incident('rv2'), '위치'); // 종료 시각만 늘어난 갱신
  assert.equal(hazardKey(a), hazardKey(b));
});

test('1. 가상 경로 위험 매칭 회귀: 경로 A 에서 위험 3건이 순서대로 나오고 모두 예시 데이터다', () => {
  const onRoute = matchHazardsToRoute(MOCK_ROUTE_A, MOCK_ALERTS).onRoute;
  assert.deepEqual(onRoute.map((h) => h.alert.id), ['m1', 'm3', 'm2']);
  assert.ok(onRoute.every((h) => h.alert.isSample === true)); // 실제 데이터와 구분(예시 데이터 표시)
  const first = onRoute[0];
  assert.equal(Math.round(remainingHazards(onRoute, first.offsetM - 500)[0].distanceM), 500);
});
