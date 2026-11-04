// 네이티브 주행 화면 위험 레일 정책(순서·유형별 대표·2km 사전 알림)과 네이티브 이벤트 어댑터, 타이머가 멈췄을 때의 대체 갱신 시계.
// 실기기 없이 Mock 이벤트로 확인한다. 위험 판정 엔진(P0~P3 계산)은 바꾸지 않는다는 점도 함께 고정한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prioritizeHazards } from '../src/lib/hazardPriority.ts';
import { buildHazardRail, orderRailItems, pickTypeRepresentatives } from '../src/lib/hazardRail.ts';
import { ADVANCE_NOTICE_M, isWithinAdvanceNotice, stageOf } from '../src/lib/hazardStage.ts';
import { classifyIncidentOnRoute } from '../src/lib/routeHazards.ts';
import { createEventClock, isFeedStale, parseNativeLocation, parseNativeRoute, pickLatLng } from '../src/lib/navigation/nativeGuidanceFeed.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
const NOW = Date.parse('2026-10-30T12:00:00+09:00');
const ROUTE = { id: 'r', points: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 5000 / M, longitude: 127 }] };
const at = (northM, eastM = 0) => ({ latitude: 37.5 + northM / M, longitude: 127 + eastM / (M * K) });
const alert = (id, northM, extra = {}) => ({
  id, eventKey: id, type: 'accident', severity: 'danger', location: id, description: '',
  updatedAt: new Date(NOW - 30 * 60_000).toISOString(), timeKind: 'started', directionScope: 'both', ...at(northM), ...extra,
});
const ctx = { mode: 'driving', progressM: 0, gpsAccuracyM: 5, nowMs: NOW, dataStale: false };
const engine = (alerts) => prioritizeHazards(alerts.map((a) => ({ alert: a, match: classifyIncidentOnRoute(ROUTE, a, ctx) })), { mode: 'driving', speedMps: 14 });
const rail = (alerts) => buildHazardRail(engine(alerts));
const item = (key, type, priority, matchClass, distanceM) => ({ key, type, priority, matchClass, distanceM });

// ── 표시 순서
test('엔진 순서에서는 probable 이 같은 P등급의 confirmed 보다 앞설 수 있다(레일 정렬이 필요한 이유)', () => {
  const confirmed = alert('c1', 2000, { type: 'construction', severity: 'caution' });
  const probable = alert('p1', 100, { directionScope: 'single', closure: 'full' });
  const raw = rail([probable, confirmed]);
  assert.deepEqual(raw.map((i) => [i.key, i.matchClass, i.priority]), [['p1', 'probable', 'P2'], ['c1', 'confirmed', 'P2']]);
  // 같은 P등급에서 confirmed 먼저
  assert.deepEqual(orderRailItems(raw).map((i) => i.key), ['c1', 'p1']);
});

test('정렬: P등급 → confirmed → 가까운 거리. P등급이 confirmed 여부보다 우선한다', () => {
  const sorted = orderRailItems([
    item('a', 'accident', 'P3', 'confirmed', 50),
    item('b', 'construction', 'P2', 'probable', 900),
    item('c', 'congestion', 'P2', 'confirmed', 1500),
    item('d', 'school_zone', 'P2', 'confirmed', 400),
    item('e', 'accident_prone', 'P0', 'confirmed', 800),
    item('f', 'accident', 'P2', 'probable', 100),
  ]);
  assert.deepEqual(sorted.map((i) => i.key), ['e', 'd', 'c', 'f', 'b', 'a']);
});

test('정렬은 입력을 바꾸지 않고(복사), 엔진 결과(priority·score)도 건드리지 않는다', () => {
  const alerts = [alert('x', 300), alert('y', 1200, { type: 'construction', severity: 'caution' })];
  const before = JSON.stringify(engine(alerts));
  const items = buildHazardRail(engine(alerts));
  const copy = JSON.stringify(items);
  orderRailItems(items);
  pickTypeRepresentatives(items);
  assert.equal(JSON.stringify(items), copy);
  assert.equal(JSON.stringify(engine(alerts)), before);
});

// ── 유형별 대표
test('같은 유형이 여러 건이면 아이콘은 하나: 같은 P등급·같은 확정도에서는 가장 가까운 것', () => {
  const items = rail([alert('a1', 1800, { eventKey: 'k1' }), alert('a2', 600, { eventKey: 'k2' }), alert('a3', 1200, { eventKey: 'k3' })]);
  assert.equal(items.length, 3);
  const reps = pickTypeRepresentatives(items);
  assert.equal(reps.length, 1);
  assert.equal(reps[0].key, 'k2');
});

test('유형이 다르면 각각 하나씩 보인다(사고·공사·정체·사고다발구역·보호구역)', () => {
  const reps = pickTypeRepresentatives([
    item('1', 'accident', 'P1', 'confirmed', 700), item('2', 'accident', 'P1', 'confirmed', 300),
    item('3', 'construction', 'P2', 'confirmed', 900), item('4', 'congestion', 'P3', 'confirmed', 1500),
    item('5', 'accident_prone', 'P2', 'confirmed', 1000), item('6', 'school_zone', 'P2', 'confirmed', 500),
    item('7', 'school_zone', 'P2', 'confirmed', 1900),
  ]);
  // P1 사고(300m) → P2 confirmed 를 가까운 순(보호구역 500 → 공사 900 → 사고다발구역 1000) → P3 정체
  assert.deepEqual(reps.map((i) => i.key), ['2', '6', '3', '5', '4']);
  assert.equal(new Set(reps.map((i) => i.type)).size, reps.length);
});

test('대표는 확정도를 거리보다 먼저 본다: 가까운 probable 보다 먼 confirmed 가 대표(같은 P등급)', () => {
  const reps = pickTypeRepresentatives([item('near', 'accident', 'P2', 'probable', 100), item('far', 'accident', 'P2', 'confirmed', 1800)]);
  assert.deepEqual(reps.map((i) => i.key), ['far']);
});

test('통과한 위험은 레일에서 해제되고, 같은 유형의 다음 위험이 대표가 된다', () => {
  const alerts = [alert('a1', 300, { eventKey: 'k1' }), alert('a2', 1500, { eventKey: 'k2' })];
  const passed = prioritizeHazards(
    alerts.map((a) => ({ alert: a, match: classifyIncidentOnRoute(ROUTE, a, { ...ctx, progressM: 400 }) })), { mode: 'driving', speedMps: 14 });
  assert.deepEqual(pickTypeRepresentatives(buildHazardRail(passed)).map((i) => i.key), ['k2']);
});

test('경로 밖 위험은 레일에 없다', () => {
  assert.deepEqual(rail([alert('off', 500, { eventKey: 'off', ...at(500, 300) })]), []);
});

// ── 2km 사전 알림
test('사전 알림은 2km 이내부터이고 500/300/100m 단계는 그대로다', () => {
  assert.equal(ADVANCE_NOTICE_M, 2000);
  assert.equal(isWithinAdvanceNotice(2000), true);
  assert.equal(isWithinAdvanceNotice(2001), false);
  assert.equal(isWithinAdvanceNotice(0), false); // 이미 지난 위험
  assert.deepEqual([2500, 1999, 501, 500, 301, 300, 101, 100].map((d) => stageOf(d)), ['advance', 'advance', 'advance', 'caution', 'caution', 'approach', 'approach', 'final']);
});

// ── 네이티브 이벤트 어댑터
test('경로 점의 키 이름이 latitude/longitude, lat/lng, x/y 여도 위도·경도를 고른다', () => {
  assert.deepEqual(pickLatLng({ latitude: 37.5, longitude: 127 }), { lat: 37.5, lng: 127 });
  assert.deepEqual(pickLatLng({ lat: 37.5, lng: 127 }), { lat: 37.5, lng: 127 });
  assert.deepEqual(pickLatLng({ x: 127, y: 37.5 }), { lat: 37.5, lng: 127 });
});

test('키 이름과 값이 뒤바뀌어도(위도 자리에 경도) 범위로 바로잡고, 국내 범위 밖·KATEC 값은 버린다', () => {
  assert.deepEqual(pickLatLng({ latitude: 127, longitude: 37.5 }), { lat: 37.5, lng: 127 });
  assert.equal(pickLatLng({ x: 314159, y: 551234 }), null); // KATEC 그대로
  assert.equal(pickLatLng({ latitude: 0, longitude: 0 }), null);
  assert.equal(pickLatLng({ foo: 1, bar: 2 }), null);
});

test('경로 이벤트: 정상 변환, 이웃한 같은 점 합침, 한 점이라도 잘못되면 경로 전체를 버린다', () => {
  const ok = [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5, longitude: 127 }, { latitude: 37.51, longitude: 127.01 }];
  assert.deepEqual(parseNativeRoute(ok), [{ lat: 37.5, lng: 127 }, { lat: 37.51, lng: 127.01 }]);
  assert.equal(parseNativeRoute([...ok, { latitude: 'x', longitude: 1 }]), null);
  assert.equal(parseNativeRoute([ok[0]]), null);
  assert.equal(parseNativeRoute(undefined), null);
  assert.equal(parseNativeRoute([null, ok[0]]), null);
});

test('위치 이벤트: km/h → m/s, 정확도는 모르므로 null, valid=false·범위 밖·깨진 값은 버린다', () => {
  assert.deepEqual(parseNativeLocation({ lat: 37.5, lng: 127, speedKmh: 36, hdop: 12, posTrust: true, valid: true }), { lat: 37.5, lng: 127, accuracyM: null, speedMps: 10 });
  assert.equal(parseNativeLocation({ lat: 37.5, lng: 127 }).speedMps, null);
  assert.equal(parseNativeLocation({ lat: 37.5, lng: 127, speedKmh: -1 }).speedMps, null);
  assert.equal(parseNativeLocation({ lat: 37.5, lng: 127, valid: false }), null);
  assert.equal(parseNativeLocation({ lat: 0, lng: 0 }), null);
  assert.equal(parseNativeLocation({ lat: NaN, lng: 127 }), null);
  assert.equal(parseNativeLocation(null), null);
});

// ── 타이머가 멈췄을 때의 대체 갱신
test('이벤트 시계: 타이머 없이 위치 이벤트(1초 간격)만으로 60초마다 갱신이 도래한다', () => {
  const clock = createEventClock(60_000);
  const due = [];
  for (let t = 0; t <= 180; t++) if (clock.due(t * 1000)) due.push(t);
  assert.deepEqual(due, [0, 60, 120, 180]);
});

test('이벤트 시계: 이벤트가 오래 끊겼다 다시 오면 즉시 갱신하고, 실패하면 reset 으로 다음 이벤트에서 재시도한다', () => {
  const clock = createEventClock(60_000);
  assert.equal(clock.due(0), true);
  assert.equal(clock.due(30_000), false);
  assert.equal(clock.due(300_000), true); // 5분 끊김 뒤 첫 이벤트
  assert.equal(clock.due(301_000), false);
  clock.reset();
  assert.equal(clock.due(302_000), true);
});

test('피드 중단 감지: 한 번도 못 받았으면 중단이 아니고, 마지막 이벤트 후 기준을 넘기면 중단', () => {
  assert.equal(isFeedStale(null, 99_999, 10_000), false);
  assert.equal(isFeedStale(1_000, 10_000, 10_000), false);
  assert.equal(isFeedStale(1_000, 11_001, 10_000), true);
});

// ── 종합: Mock 주행(위치 이벤트 열) → 레일
test('Mock 주행: 위치 이벤트가 진행하면서 사고 레일이 거리 감소 후 통과 시 사라지고 다음 사고가 대표가 된다', () => {
  const alerts = [alert('near', 1000, { eventKey: 'near' }), alert('far', 3000, { eventKey: 'far' })];
  const reps = (progressM) => pickTypeRepresentatives(buildHazardRail(prioritizeHazards(
    alerts.map((a) => ({ alert: a, match: classifyIncidentOnRoute(ROUTE, a, { ...ctx, progressM }) })), { mode: 'driving', speedMps: 14 }))).map((i) => i.key);
  assert.deepEqual(reps(0), ['near']);
  assert.deepEqual(reps(900), ['near']);
  assert.deepEqual(reps(1200), ['far']);
  assert.deepEqual(reps(3200), []);
});
