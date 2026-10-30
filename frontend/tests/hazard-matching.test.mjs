// E단계: ITS 돌발정보 경로 매칭(confirmed / probable / excluded), 우선순위 엔진(P0~P3), 중복 제거, 속도(TTC 입력).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dedupeInputs, PRIORITY_POLICY, prioritizeHazards, ttcOf } from '../src/lib/hazardPriority.ts';
import { classifyIncidentOnRoute, hazardKey, INCIDENT_MATCH_POLICY } from '../src/lib/routeHazards.ts';
import { advance } from '../src/lib/navigation/guidanceEngine.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
const NOW = Date.parse('2026-10-30T12:00:00+09:00');
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3600_000;

// 북쪽으로 2.2km 가는 직선 경로(진행 방위 0°). 위험은 경로 위 northM 지점에서 동쪽으로 eastM 벗어난 곳.
const ROUTE = { id: 'r', points: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 2200 / M, longitude: 127 }] };
const at = (northM, eastM = 0) => ({ latitude: 37.5 + northM / M, longitude: 127 + eastM / (M * K) });

const incident = (northM = 1000, extra = {}) => ({
  id: 'i1',
  type: 'accident',
  severity: 'danger',
  location: '',
  description: '',
  updatedAt: ago(30 * 60_000),
  timeKind: 'started',
  directionScope: 'both',
  eventKey: 'ek1',
  ...at(northM, extra.eastM ?? 0),
  ...extra,
});
const ctx = (extra = {}) => ({ mode: 'driving', progressM: 0, gpsAccuracyM: 5, nowMs: NOW, dataStale: false, ...extra });
const match = (alert, c = ctx()) => classifyIncidentOnRoute(ROUTE, alert, c);

// ───────────── 경로 매칭 ─────────────

test('양방향(원본이 확인)이고 경로 위·앞쪽·최신이면 confirmed', () => {
  const m = match(incident());
  assert.equal(m.class, 'confirmed');
  assert.equal(m.reason, 'directionBoth');
  assert.equal(m.directionBasis, 'both');
  assert.ok(Math.abs(m.distanceAlongRouteM - 1000) < 1);
  assert.ok(m.lateralM < 1);
});

test('단방향(기점/종점)은 우리 경로가 그쪽인지 알 수 없어 probable 이다(방향을 추론해 확정하지 않는다)', () => {
  const m = match(incident(1000, { directionScope: 'single' }));
  assert.equal(m.class, 'probable');
  assert.equal(m.reason, 'singleDirectionUnverified');
  assert.equal(m.directionBasis, 'unverified');
});

test('방향 미확인(unknown·값 없음)은 아주 가까워도 confirmed 가 아니다', () => {
  for (const directionScope of ['unknown', undefined]) {
    const m = match(incident(1000, { directionScope, eastM: 2 }));
    assert.equal(m.class, 'probable', String(directionScope));
    assert.equal(m.reason, 'directionUnknown');
  }
});

test('위험이 방위각(headingDeg)을 주면 경로 방향과 비교한다: 같으면 confirmed, 반대면 excluded', () => {
  const same = match(incident(1000, { directionScope: undefined, headingDeg: 5 }));
  assert.deepEqual([same.class, same.reason, same.directionBasis], ['confirmed', 'headingMatch', 'heading']);
  const opposite = match(incident(1000, { directionScope: undefined, headingDeg: 180 }));
  assert.deepEqual([opposite.class, opposite.reason], ['excluded', 'oppositeDirection']);
});

test('경로 밖은 excluded, 후보 범위(30m) 안이어도 15m 를 넘으면 확정하지 않는다', () => {
  assert.deepEqual([match(incident(1000, { eastM: 100 })).class, match(incident(1000, { eastM: 100 })).reason], ['excluded', 'offRoute']);
  const mid = match(incident(1000, { eastM: 25 }));
  assert.deepEqual([mid.class, mid.reason], ['probable', 'lateralUncertain']);
  assert.equal(match(incident(1000, { eastM: 10 })).class, 'confirmed');
  assert.equal(INCIDENT_MATCH_POLICY.driving.candidateLateralM, 30); // 임시 후보 기준
});

test('이미 통과한 위험은 제외하고, 내 위치와 오차 범위 안이면 앞인지 뒤인지 확신하지 않는다', () => {
  assert.deepEqual([match(incident(1000), ctx({ progressM: 1500 })).class, match(incident(1000), ctx({ progressM: 1500 })).reason], ['excluded', 'passed']);
  const near = match(incident(1000), ctx({ progressM: 1020 })); // 20m 뒤: 통과 여유(30m) 안
  assert.deepEqual([near.class, near.reason], ['probable', 'positionUncertain']);
  assert.ok(near.distanceAlongRouteM < 0);
  assert.equal(match(incident(1000), ctx({ progressM: 1100 })).class, 'excluded');
});

test('GPS 정확도가 낮으면 남은 거리를 믿지 않아 confirmed 로 올리지 않고, 통과 판정 여유도 넓힌다', () => {
  const bad = match(incident(1000), ctx({ gpsAccuracyM: 45 }));
  assert.deepEqual([bad.class, bad.reason], ['probable', 'positionUncertain']);
  assert.equal(match(incident(1000), ctx({ gpsAccuracyM: 30 })).class, 'confirmed'); // 한계값 이하
  // 정확도 80m 면 70m 뒤의 위험도 아직 통과했다고 단정하지 않는다
  assert.equal(match(incident(1000), ctx({ progressM: 1070, gpsAccuracyM: 80 })).class, 'probable');
  assert.equal(match(incident(1000), ctx({ progressM: 1070, gpsAccuracyM: 5 })).class, 'excluded');
});

test('오래된 ITS 정보: 사고·정체는 시간이 지나면 probable, 장기 공사는 종료 시각으로만 판단한다', () => {
  const old = match(incident(1000, { updatedAt: ago(7 * HOUR) }));
  assert.deepEqual([old.class, old.reason, old.freshness], ['probable', 'staleData', 'stale']);
  assert.equal(match(incident(1000, { type: 'congestion', updatedAt: ago(4 * HOUR) })).reason, 'staleData');
  assert.equal(match(incident(1000, { type: 'construction', updatedAt: ago(30 * 24 * HOUR) })).class, 'confirmed');
  assert.equal(match(incident(1000), ctx({ dataStale: true })).reason, 'staleData'); // 서버가 마지막 성공 결과를 대신 준 경우
});

test('이미 끝났거나 아직 시작 전인 정보는 제외한다', () => {
  assert.deepEqual([match(incident(1000, { endedAt: ago(HOUR) })).class, match(incident(1000, { endedAt: ago(HOUR) })).reason], ['excluded', 'ended']);
  assert.equal(match(incident(1000, { endedAt: new Date(NOW + HOUR).toISOString() })).class, 'confirmed');
  assert.equal(match(incident(1000, { updatedAt: new Date(NOW + HOUR).toISOString() })).reason, 'notStarted');
});

test('데이터 누락: 좌표가 없으면 제외, 발생 시각이 없는 사고는 최신성을 몰라 probable, 방향 값이 없어도 오류 없이 처리', () => {
  assert.deepEqual([match({ ...incident(), latitude: NaN }).class, match({ ...incident(), latitude: NaN }).reason], ['excluded', 'missingLocation']);
  assert.equal(match({ ...incident(), longitude: undefined }).class, 'excluded');
  const noStart = match(incident(1000, { updatedAt: '' }));
  assert.deepEqual([noStart.class, noStart.reason, noStart.freshness], ['probable', 'freshnessUnknown', 'unknown']);
  assert.equal(match(incident(1000, { type: 'construction', updatedAt: '' })).class, 'confirmed');
  assert.equal(classifyIncidentOnRoute({ id: 'x', points: [] }, incident(), ctx()).class, 'excluded'); // 경로 없음
});

test('유형별·이동수단별 정책: 도보는 돌발정보를 확정하지 않고, 도보의 정체는 무관하다', () => {
  const walking = (extra) => match(incident(1000, extra), ctx({ mode: 'walking' }));
  assert.deepEqual([walking({}).class, walking({}).reason], ['probable', 'walkingNotConfirmable']);
  assert.deepEqual([walking({ type: 'construction' }).class, walking({ type: 'construction' }).reason], ['probable', 'walkingNotConfirmable']);
  assert.deepEqual([walking({ type: 'congestion' }).class, walking({ type: 'congestion' }).reason], ['excluded', 'notApplicable']);
  assert.equal(match(incident(1000, { type: 'congestion' })).class, 'confirmed'); // 자동차의 정체는 유효
  assert.notDeepEqual(INCIDENT_MATCH_POLICY.driving, INCIDENT_MATCH_POLICY.walking);
});

test('경로가 같은 지점을 두 번 지나면 앞으로 만날 첫 통과를 기준으로 한다', () => {
  const loop = { id: 'loop', points: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 1000 / M, longitude: 127 }, { latitude: 37.5 + 1000 / M, longitude: 127 + 100 / (M * K) }, { latitude: 37.5, longitude: 127 + 100 / (M * K) }, { latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 1000 / M, longitude: 127 }] };
  const hazard = incident(500, { directionScope: 'both' });
  const first = classifyIncidentOnRoute(loop, hazard, ctx({ progressM: 0 }));
  assert.ok(Math.abs(first.distanceAlongRouteM - 500) < 1);
  const second = classifyIncidentOnRoute(loop, hazard, ctx({ progressM: 1500 })); // 첫 통과는 지났다 → 두 번째 통과
  assert.ok(Math.abs(second.distanceAlongRouteM - 1200) < 2 && second.class === 'confirmed'); // 두 번째 통과는 경로상 2700m 지점
});

// ───────────── 우선순위 엔진 ─────────────

const prioritize = (items, c = {}) => prioritizeHazards(items, { mode: 'driving', speedMps: null, ...c });
const entry = (alertExtra = {}, matchExtra = {}, northM = 1000) => {
  const alert = incident(northM, alertExtra);
  return { alert, match: { ...match(alert), ...matchExtra } };
};

test('P0: 확정 + 앞쪽 + 최신 + 가까움 + 점수. 정확히 이 조건에서만 나온다', () => {
  const [near] = prioritize([entry({}, {}, 100)]);
  assert.equal(near.priority, 'P0');
  assert.deepEqual([near.urgentEligible, near.displayEligible, near.matchClass], [true, true, 'confirmed']);
  assert.ok(near.matchConfidence >= 0.9);
  const [far] = prioritize([entry({}, {}, 1200)]);
  assert.notEqual(far.priority, 'P0'); // 먼 위험은 P0 가 아니다
  const [stale] = prioritize([entry({}, { freshness: 'unknown' }, 100)]);
  assert.notEqual(stale.priority, 'P0'); // 최신성이 확인되지 않으면 P0 가 아니다
});

test('P0 오판 방지: probable 은 아무리 가까워도 P0·P1·긴급 경고가 될 수 없다', () => {
  for (const [alertExtra, reason] of [[{ directionScope: 'single' }, 'single'], [{ directionScope: undefined }, 'unknown'], [{ eastM: 25 }, 'lateral']]) {
    const [h] = prioritize([entry(alertExtra, {}, 50)]);
    assert.equal(h.matchClass, 'probable', reason);
    assert.ok(['P2', 'P3'].includes(h.priority), `${reason}: ${h.priority}`);
    assert.equal(h.urgentEligible, false, reason);
    assert.equal(h.displayEligible, true, reason);
  }
});

test('P0 오판 방지: closure 가 full 이라는 이유만으로, 또는 유형(사고·공사·정체)만으로 P0 가 되지 않는다', () => {
  // 공사 + 전면 통제 문자열: 점수가 P0 기준에 못 미친다
  const [construction] = prioritize([entry({ type: 'construction', severity: 'caution', closure: 'full' }, {}, 200)]);
  assert.notEqual(construction.priority, 'P0');
  // 정체는 가장 가까워도 P0 가 아니다
  const [congestion] = prioritize([entry({ type: 'congestion', severity: 'busy', closure: 'full' }, {}, 20)]);
  assert.notEqual(congestion.priority, 'P0');
  // 사고여도 멀면 P0 가 아니고, closure 가 full 이어도 가까운 사고의 P0 판정은 closure 때문이 아니다
  const [farAccident] = prioritize([entry({ closure: 'full' }, {}, 1500)]);
  assert.notEqual(farAccident.priority, 'P0');
  const full = prioritize([entry({ closure: 'full' }, {}, 100)])[0];
  const none = prioritize([entry({ closure: 'none' }, {}, 100)])[0];
  assert.equal(full.priority, none.priority); // 같은 조건이면 closure 값과 무관하게 같은 등급
});

test('속도를 알면 TTC 를 계산하고, 모르면 null 이며 P0 거리가 더 좁아진다', () => {
  const policy = PRIORITY_POLICY.driving;
  assert.equal(ttcOf(200, null, policy), null);
  assert.equal(ttcOf(200, 0.1, policy), null); // 정지에 가까운 속도
  assert.equal(Math.round(ttcOf(200, 10, policy)), 20);
  const e = entry({}, {}, 200);
  assert.equal(prioritize([e])[0].ttcSec, null);
  assert.notEqual(prioritize([e])[0].priority, 'P0'); // 속도를 모르면 200m 는 P0 거리(150m) 밖
  const fast = prioritize([e], { speedMps: 14 })[0];
  assert.equal(Math.round(fast.ttcSec), 14);
  assert.equal(fast.priority, 'P0');
  assert.notEqual(prioritize([e], { speedMps: 3 })[0].priority, 'P0'); // 도달까지 66초: 즉각적이지 않다
});

test('자동차·도보 정책 차이: 같은 거리의 근접 점수와 P0 거리가 다르다', () => {
  assert.notDeepEqual(PRIORITY_POLICY.driving, PRIORITY_POLICY.walking);
  const e = entry({}, {}, 200);
  const car = prioritize([e], { mode: 'driving', speedMps: 14 })[0];
  const walk = prioritize([e], { mode: 'walking', speedMps: 14 })[0];
  assert.ok(car.score > walk.score);
  assert.equal(PRIORITY_POLICY.walking.p0MaxDistanceM < PRIORITY_POLICY.driving.p0MaxDistanceM, true);
});

test('excluded 는 표시·긴급 대상이 아니고, 이유가 남는다', () => {
  const [h] = prioritize([entry({ eastM: 100 })]);
  assert.deepEqual([h.matchClass, h.displayEligible, h.urgentEligible, h.reason, h.matchReason], ['excluded', false, false, 'excluded', 'offRoute']);
  assert.equal(h.matchConfidence, 0);
});

test('정렬: 중요한 순(P0 → P3)이고 같은 등급은 점수·거리 순', () => {
  const list = prioritize([
    entry({ id: 'far', eventKey: 'k-far' }, {}, 1800),
    entry({ id: 'near', eventKey: 'k-near' }, {}, 100),
    entry({ id: 'probable', eventKey: 'k-prob', directionScope: 'single' }, {}, 80),
  ]);
  assert.deepEqual(list.map((h) => h.alert.id), ['near', 'far', 'probable']);
  assert.equal(list[0].priority, 'P0');
});

test('중복 제거: 같은 event_key 는 id·revision·문구가 달라도 하나이고, 확정 > 후보, 더 가까운 것이 남는다', () => {
  const a = entry({ id: 'a', eventKey: 'same', revision: 'rv1' }, {}, 600);
  const b = entry({ id: 'b', eventKey: 'same', revision: 'rv2' }, {}, 400);
  const probable = entry({ id: 'c', eventKey: 'same', directionScope: 'single' }, {}, 100);
  const merged = dedupeInputs([a, b, probable]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].alert.id, 'b'); // 확정 중 더 가까운 것
  assert.equal(prioritize([b, a, probable]).length, 1);
  // 입력 순서가 달라도 결과는 같다
  assert.equal(dedupeInputs([probable, b, a])[0].alert.id, 'b');
  // event_key 가 없으면 id 로 구분한다
  const plain = dedupeInputs([entry({ id: 'x', eventKey: undefined }), entry({ id: 'y', eventKey: undefined }), entry({ id: 'x', eventKey: undefined }, {}, 300)]);
  assert.equal(plain.length, 2);
});

test('revision 만 바뀌어도 같은 위험이라 반복 긴급 경고하지 않는다(식별자가 같다)', () => {
  const a = incident(1000, { revision: undefined });
  const b = { ...a, description: '문구가 바뀜', endedAt: new Date(NOW + 5 * HOUR).toISOString() };
  assert.equal(hazardKey(a), hazardKey(b));
  assert.equal(prioritize([{ alert: a, match: match(a) }, { alert: b, match: match(b) }]).length, 1);
});

// ───────────── 속도 추정(TTC 입력) ─────────────

test('엔진: 위치 간격이 짧으면 속도를 지수 평균으로 추정하고, 간격이 벌어지면 모른다고 둔다', () => {
  const route = { id: 'sp', source: 'api', mode: 'driving', path: [{ lat: 37.5, lng: 127 }, { lat: 37.5 + 5000 / M, lng: 127 }] };
  const fix = (northM, t) => ({ lat: 37.5 + northM / M, lng: 127, accuracyM: 5, timestampMs: t });
  let state = null;
  const speeds = [];
  for (const [n, t] of [[0, 0], [14, 1000], [28, 2000], [42, 3000]]) {
    const r = advance(state, fix(n, t), route);
    state = r.state;
    speeds.push(r.snapshot.speedMps);
  }
  assert.equal(speeds[0], null); // 첫 위치: 아직 모른다
  assert.ok(Math.abs(speeds[3] - 14) < 0.5);
  const gap = advance(state, fix(500, 60_000), route); // 57초 만의 위치: 속도 추정에 쓰지 않는다
  assert.equal(gap.snapshot.speedMps, null);
});
