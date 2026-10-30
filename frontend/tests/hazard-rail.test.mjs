// F단계: 위험 레일 모델(엔진 순서 유지, 최대 3개 + N, confirmed/probable 구분, 숨김 규칙, 상세 정보 사실만).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prioritizeHazards } from '../src/lib/hazardPriority.ts';
import { buildHazardRail, describeHazard, fitVisible, overflowFits, RAIL_MAX_VISIBLE, registryZoneInput, splitRail } from '../src/lib/hazardRail.ts';
import { classifyIncidentOnRoute } from '../src/lib/routeHazards.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
const NOW = Date.parse('2026-10-30T12:00:00+09:00');
const ROUTE = { id: 'r', points: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 3000 / M, longitude: 127 }] };
const at = (northM, eastM = 0) => ({ latitude: 37.5 + northM / M, longitude: 127 + eastM / (M * K) });

const alert = (id, northM, extra = {}) => ({
  id,
  eventKey: id,
  type: 'accident',
  severity: 'danger',
  location: `${id} 위치`,
  description: '',
  updatedAt: new Date(NOW - 30 * 60_000).toISOString(),
  timeKind: 'started',
  directionScope: 'both',
  ...at(northM, extra.eastM ?? 0),
  ...extra,
});
const ctx = (extra = {}) => ({ mode: 'driving', progressM: 0, gpsAccuracyM: 5, nowMs: NOW, dataStale: false, ...extra });
const rank = (alerts, c = ctx(), speedMps = null, route = ROUTE) =>
  prioritizeHazards(alerts.map((a) => ({ alert: a, match: classifyIncidentOnRoute(route, a, c) })), { mode: c.mode, speedMps });
const rail = (alerts, c, speedMps, route) => buildHazardRail(rank(alerts, c, speedMps, route));

test('위험 0개: 레일이 비고 +N 도 없다', () => {
  const items = rail([]);
  assert.deepEqual(items, []);
  assert.deepEqual(splitRail(items, RAIL_MAX_VISIBLE), { visible: [], overflow: 0 });
});

test('위험 1~3개: 모두 보이고 +N 이 없다', () => {
  for (const n of [1, 2, 3]) {
    const items = rail(Array.from({ length: n }, (_, i) => alert(`a${i}`, 400 + i * 300, { eventKey: `k${i}` })));
    const { visible, overflow } = splitRail(items, RAIL_MAX_VISIBLE);
    assert.equal(visible.length, n);
    assert.equal(overflow, 0);
  }
});

test('위험 4개 이상: 3개만 보이고 나머지는 +N', () => {
  const items = rail(Array.from({ length: 6 }, (_, i) => alert(`a${i}`, 400 + i * 300, { eventKey: `k${i}` })));
  assert.equal(items.length, 6);
  const { visible, overflow } = splitRail(items, RAIL_MAX_VISIBLE);
  assert.deepEqual([visible.length, overflow], [3, 3]);
  assert.deepEqual(visible.map((i) => i.key), items.slice(0, 3).map((i) => i.key));
});

test('정렬: 레일은 우선순위 엔진의 순서를 그대로 쓰고 새로 정렬하지 않는다', () => {
  const ranked = rank([alert('far', 1800), alert('near', 100), alert('mid', 700)]);
  assert.deepEqual(buildHazardRail(ranked).map((i) => i.key), ranked.map((h) => h.dedupeKey));
  assert.equal(buildHazardRail(ranked)[0].key, 'near'); // 엔진이 P0 로 본 가장 가까운 확정 위험이 맨 위
  // 일부러 엔진과 다른 순서로 넣어도 입력 순서가 그대로 나온다(UI 가 점수를 다시 매기지 않는다는 증거)
  const shuffled = [ranked[2], ranked[0], ranked[1]];
  assert.deepEqual(buildHazardRail(shuffled).map((i) => i.key), shuffled.map((h) => h.dedupeKey));
});

test('confirmed / probable 구분: 긴급 강조는 확정 + P0 만, 미확인은 항상 neutral', () => {
  const items = rail([alert('sure', 100), alert('maybe', 120, { directionScope: 'single' }), alert('mild', 1900, { type: 'construction', severity: 'caution' })]);
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.deepEqual([byKey.sure.matchClass, byKey.sure.emphasis, byKey.sure.priority], ['confirmed', 'strong', 'P0']);
  assert.deepEqual([byKey.maybe.matchClass, byKey.maybe.emphasis], ['probable', 'neutral']);
  assert.equal(byKey.maybe.matchReason, 'singleDirectionUnverified');
  assert.equal(byKey.mild.matchClass, 'confirmed');
  assert.notEqual(byKey.mild.emphasis, 'strong'); // 확정이어도 낮은 등급은 긴급 강조가 아니다
  // 먼 사고는 엔진이 P1 을 줘도(유형·심각도 점수) 긴급 강조하지 않는다
  const far = rail([alert('far', 2600)])[0];
  assert.deepEqual([far.priority, far.emphasis], ['P1', 'normal']);
});

test('오래된 위험은 강조하지 않는다(최신이 아니면 확정이어도 strong 이 아니다)', () => {
  const [h] = rank([alert('a', 100)]);
  assert.equal(buildHazardRail([h])[0].emphasis, 'strong');
  assert.equal(buildHazardRail([{ ...h, freshness: 'stale' }])[0].emphasis, 'normal');
  const old = rail([alert('old', 100, { updatedAt: new Date(NOW - 8 * 3600_000).toISOString() })])[0];
  assert.deepEqual([old.matchClass, old.emphasis, old.freshness], ['probable', 'neutral', 'stale']);
});

test('excluded 는 숨긴다(경로 밖·반대 방향·끝난 위험)', () => {
  const items = rail([
    alert('off', 500, { eastM: 200 }),
    alert('opposite', 500, { directionScope: undefined, headingDeg: 180 }),
    alert('ended', 500, { endedAt: new Date(NOW - 3600_000).toISOString() }),
    alert('ok', 800),
  ]);
  assert.deepEqual(items.map((i) => i.key), ['ok']);
});

test('이미 통과한 위험은 레일에서 사라진다', () => {
  const alerts = [alert('a', 500), alert('b', 1500)];
  assert.deepEqual(rail(alerts, ctx({ progressM: 0 })).map((i) => i.key).sort(), ['a', 'b']);
  assert.deepEqual(rail(alerts, ctx({ progressM: 800 })).map((i) => i.key), ['b']); // a 는 지났다
  assert.deepEqual(rail(alerts, ctx({ progressM: 2000 })), []);
  // 오차 범위 안(뒤로 20m)에서 앞뒤를 모르는 위험도 "지난 것"으로 보고 레일에서 뺀다
  assert.deepEqual(rail([alert('edge', 1000)], ctx({ progressM: 1020 })), []);
});

test('중복 위험 제거: 같은 event_key 는 하나, revision·문구가 달라도 새 위험처럼 보이지 않는다', () => {
  const items = rail([alert('i1', 600, { eventKey: 'same', revision: 'r1' }), alert('i2', 600, { eventKey: 'same', revision: 'r2', description: '문구 변경' })]);
  assert.equal(items.length, 1);
  // 호출한 쪽이 같은 키를 두 번 넘겨도 레일은 한 번만
  const [h] = rank([alert('x', 300)]);
  assert.equal(buildHazardRail([h, h, { ...h }]).length, 1);
});

test('재탐색 후 새 경로에 맞춰 갱신: 같은 위험이 새 경로에서는 경로 밖이면 사라진다', () => {
  const alerts = [alert('on-a', 800), alert('on-both', 1500)];
  assert.deepEqual(rail(alerts).map((i) => i.key).sort(), ['on-a', 'on-both']);
  // 새 경로: 동쪽으로 벗어난 평행 경로(위험은 원래 경로 위에 있다)
  const rerouted = { id: 'r2', points: [{ latitude: 37.5, longitude: 127 + 300 / (M * K) }, { latitude: 37.5 + 3000 / M, longitude: 127 + 300 / (M * K) }] };
  assert.deepEqual(rail(alerts, ctx(), null, rerouted), []);
});

test('예시 데이터 구분: isSample 은 레일 항목에 그대로 담기고 상세에서 출처가 예시로 나온다', () => {
  const sample = rail([alert('s', 400, { isSample: true, timeKind: undefined })])[0];
  assert.equal(sample.isSample, true);
  assert.equal(describeHazard(sample).source, 'sample');
  assert.ok(describeHazard(sample).notes.includes('sample'));
  const real = rail([alert('r', 400)])[0];
  assert.equal(real.isSample, false);
  assert.equal(describeHazard(real).source, 'its');
});

test('상세 정보: 있는 사실만 담고, 없으면 만들어 내지 않는다', () => {
  const real = describeHazard(rail([alert('r', 400)])[0]);
  assert.equal(real.startedIso !== null, true);
  assert.deepEqual(real.notes, []);
  assert.equal(real.unverifiedReason, null);

  const noStart = describeHazard(rail([alert('c', 400, { type: 'construction', updatedAt: '' })])[0]);
  assert.equal(noStart.startedIso, null); // 발생 시각이 없으면 null — 시각을 지어내지 않는다

  const probable = describeHazard(rail([alert('p', 400, { directionScope: undefined })])[0]);
  assert.equal(probable.unverifiedReason, 'directionUnknown');
  assert.ok(probable.notes.includes('unverified'));

  const stale = describeHazard(rail([alert('o', 400, { updatedAt: new Date(NOW - 9 * 3600_000).toISOString() })])[0]);
  assert.ok(stale.notes.includes('stale') && stale.notes.includes('unverified'));
});

test('어린이보호구역: 같은 엔진으로 순위를 매기고, 등록 현황이라 시각 정보를 만들지 않는다', () => {
  const zone = { id: 'z1', type: 'school_zone', severity: 'caution', location: '가능초등학교', description: '', updatedAt: '', latitude: 37.5, longitude: 127 };
  const input = registryZoneInput(zone, 600);
  assert.deepEqual([input.match.class, input.match.reason, input.match.freshness], ['confirmed', 'zoneOnRoute', 'fresh']);
  const ranked = prioritizeHazards([input, ...rank([alert('acc', 900)]).map((h) => ({ alert: h.alert, match: classifyIncidentOnRoute(ROUTE, h.alert, ctx()) }))], { mode: 'driving', speedMps: null });
  const items = buildHazardRail(ranked);
  assert.equal(items.length, 2);
  const zoneItem = items.find((i) => i.type === 'school_zone');
  assert.equal(zoneItem.matchClass, 'confirmed');
  const detail = describeHazard(zoneItem);
  assert.equal(detail.source, 'registry');
  assert.equal(detail.startedIso, null);
  assert.ok(detail.notes.includes('registry')); // 실시간 정보가 아니라는 안내
  // 지난 구역은 레일에서 뺀다
  assert.deepEqual(buildHazardRail(prioritizeHazards([registryZoneInput(zone, -50)], { mode: 'driving', speedMps: null })), []);
});

test('레일 개수는 쓸 수 있는 세로 공간에 맞춰 줄어들고(+N 으로 대신 표시), 하나도 안 들어가면 0', () => {
  assert.equal(fitVisible(5, 400, 84, 36), 3);
  assert.equal(fitVisible(5, 250, 84, 36), 2); // 2*84+36 = 204 ≤ 250, 3개는 288 > 250
  assert.equal(fitVisible(5, 130, 84, 36), 1);
  assert.equal(fitVisible(5, 100, 84, 36), 1); // 아이콘 하나 들어갈 공간이면 "+N" 만 남기지 않고 아이콘 하나는 보인다
  assert.equal(fitVisible(5, 60, 84, 36), 0); // 하나도 못 들어가면 0(화면은 레일을 숨긴다)
  assert.equal(fitVisible(2, 170, 84, 36), 2); // +N 이 필요 없으면 그 높이를 빼지 않는다
  assert.equal(fitVisible(0, 500, 84, 36), 0);
  assert.equal(RAIL_MAX_VISIBLE, 3);
});

test('이미 확정된 긴급 경고 대상은 레일 표시와 무관하다: probable 은 urgentEligible 이 아니다(단계 경고에 들어가지 않는다)', () => {
  const ranked = rank([alert('sure', 100), alert('maybe', 100, { directionScope: 'single', eventKey: 'm' })]);
  const urgent = ranked.filter((h) => h.urgentEligible).map((h) => h.alert.id);
  assert.deepEqual(urgent, ['sure']);
  assert.equal(buildHazardRail(ranked).length, 2); // 레일에는 둘 다 보인다
});

test('+N 알약이 안 들어가면 배지로 대신한다: overflowFits', () => {
  assert.equal(overflowFits(5, 3, 400, 84, 36), true); // 3*84+36 = 288 ≤ 400
  assert.equal(overflowFits(5, 1, 100, 84, 36), false); // 84+36 = 120 > 100 → 아이콘 위 배지로
  assert.equal(overflowFits(2, 2, 100, 84, 36), true); // 넘치는 것이 없으면 알약이 필요 없다
  assert.equal(overflowFits(0, 0, 0, 84, 36), true);
});

test('작은 화면(낮은 높이): 320×640 에서 경고 카드가 떴을 때도 아이콘이 하나 이상 남는다', () => {
  // 대략의 값: 레일 시작 210, 하단 예약 = 패널 134 + 경고 190 + 여백 → 사용 가능 높이 74, 작은 아이콘 한 칸 74
  assert.equal(fitVisible(6, 74, 74, 36), 1);
  assert.equal(overflowFits(6, 1, 74, 74, 36), false); // 알약은 못 들어가 배지로
});
