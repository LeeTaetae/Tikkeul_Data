// 네이티브 위험 레일 스냅샷(정책: 유형별 대표 1개, P등급→confirmed→거리, 최대 3개+N, 2km 이내, 통과 시 해제, 재탐색 시 교체)을 Mock 데이터로 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prioritizeHazards } from '../src/lib/hazardPriority.ts';
import { buildHazardRail } from '../src/lib/hazardRail.ts';
import { classifyIncidentOnRoute } from '../src/lib/routeHazards.ts';
import { EMPTY_NATIVE_RAIL, buildNativeRailSnapshot, railChanged, serializeNativeRail } from '../src/lib/navigation/nativeHazardRail.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
const NOW = Date.parse('2026-10-30T12:00:00+09:00'); // 금요일 낮(등하교 시간 아님)
const ROUTE = { id: 'r', points: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 6000 / M, longitude: 127 }] };
const at = (northM, eastM = 0) => ({ latitude: 37.5 + northM / M, longitude: 127 + eastM / (M * K) });
const alert = (id, type, northM, extra = {}) => ({
  id, eventKey: id, type, severity: 'danger', location: id, description: '',
  updatedAt: new Date(NOW - 30 * 60_000).toISOString(), timeKind: 'started', directionScope: 'both', ...at(northM), ...extra,
});
const railFor = (alerts, progressM = 0, ctxExtra = {}) =>
  buildHazardRail(
    prioritizeHazards(
      alerts.map((a) => ({ alert: a, match: classifyIncidentOnRoute(ROUTE, a, { mode: 'driving', progressM, gpsAccuracyM: 5, nowMs: NOW, dataStale: false, ...ctxExtra }) })),
      { mode: 'driving', speedMps: 14 },
    ),
  );
const snap = (alerts, progressM = 0, opts = {}) => buildNativeRailSnapshot(railFor(alerts, progressM), { now: new Date(NOW), ...opts });

// 보호구역·사고다발구역은 구역 전체 위험이라 incident 분류기가 아니라 registryZoneInput 방식으로 rail 항목을 만든다. 여기서는 RailItem 을 직접 만든다.
const railItem = (key, type, priority, matchClass, distanceM, extra = {}) => ({
  key, type, priority, matchClass, distanceM, emphasis: matchClass === 'confirmed' ? 'normal' : 'neutral', ttcSec: null,
  matchReason: 'onRoute', freshness: 'fresh', isSample: false,
  alert: { id: key, type, severity: 'caution', location: key, description: '', updatedAt: '', ...extra },
});

test('유형이 달라도 같은 유형은 대표 하나만: 사고 3건이 있어도 사고 아이콘은 하나다', () => {
  const s = snap([alert('a1', 'accident', 900), alert('a2', 'accident', 1200), alert('a3', 'accident', 1500), alert('c1', 'construction', 1000)]);
  assert.deepEqual(s.items.map((i) => i.type).sort(), ['accident', 'construction']);
  assert.equal(s.overflow, 0);
});

test('최대 3개만 보이고 나머지는 +N: 5유형 모두 있으면 3개 + overflow 2', () => {
  const rail = [
    railItem('z', 'school_zone', 'P2', 'confirmed', 600, { zoneType: 'child' }),
    railItem('p', 'accident_prone', 'P2', 'confirmed', 700),
    railItem('a', 'accident', 'P0', 'confirmed', 800),
    railItem('c', 'construction', 'P1', 'confirmed', 900),
    railItem('g', 'congestion', 'P3', 'confirmed', 400),
  ];
  const s = buildNativeRailSnapshot(rail, { now: new Date(NOW) });
  assert.equal(s.items.length, 3);
  assert.equal(s.overflow, 2);
  assert.deepEqual(s.items.map((i) => i.key), ['a', 'c', 'z']); // P0 → P1 → P2(같은 P2 안에서는 가까운 school_zone 600 이 accident_prone 700 보다 앞)
});

test('같은 P등급이면 confirmed 가 먼저이고, 그다음 가까운 거리 순이다', () => {
  const rail = [
    railItem('near-probable', 'construction', 'P1', 'probable', 300),
    railItem('far-confirmed', 'accident', 'P1', 'confirmed', 1500),
  ];
  const s = buildNativeRailSnapshot(rail, { now: new Date(NOW) });
  assert.deepEqual(s.items.map((i) => i.key), ['far-confirmed', 'near-probable']);
});

test('P등급 우선순위는 유지된다: 먼 P0 가 가까운 P2 보다 앞이다', () => {
  const rail = [railItem('near-p2', 'construction', 'P2', 'confirmed', 200), railItem('far-p0', 'accident', 'P0', 'confirmed', 1800)];
  assert.deepEqual(buildNativeRailSnapshot(rail, { now: new Date(NOW) }).items.map((i) => i.key), ['far-p0', 'near-p2']);
});

test('2km 사전 알림 거리 밖의 위험은 레일에 보이지 않고, 2km 이내로 들어오면 나타난다', () => {
  const far = alert('far', 'accident', 2600);
  assert.equal(snap([far], 0).items.length, 0); // 2600m 앞
  assert.equal(snap([far], 700).items.length, 1); // 1900m 앞
  assert.equal(snap([far], 700).items[0].stage, 'advance');
});

test('단계(stage)는 500/300/100m 기준을 따른다', () => {
  const a = alert('a', 'accident', 1000);
  const stageAt = (progress) => snap([a], progress).items[0].stage;
  assert.equal(stageAt(0), 'advance'); // 1000m
  assert.equal(stageAt(550), 'caution'); // 450m
  assert.equal(stageAt(750), 'approach'); // 250m
  assert.equal(stageAt(920), 'final'); // 80m
});

test('위험 지점을 통과하면 레일에서 사라진다', () => {
  const a = alert('a', 'accident', 1000);
  assert.equal(snap([a], 900).items.length, 1); // 100m 앞
  assert.equal(snap([a], 1100).items.length, 0); // 통과
});

test('보호구역: 어린이·노인·장애인은 school_zone 아이콘 하나로 합치고 zoneType 은 남긴다', () => {
  const rail = [
    railItem('child', 'school_zone', 'P2', 'confirmed', 800, { zoneType: 'child' }),
    railItem('senior', 'school_zone', 'P2', 'confirmed', 500, { zoneType: 'senior' }),
    railItem('disabled', 'school_zone', 'P2', 'confirmed', 1200, { zoneType: 'disabled' }),
  ];
  const s = buildNativeRailSnapshot(rail, { now: new Date(NOW) });
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].type, 'school_zone');
  assert.equal(s.items[0].zoneType, 'senior'); // 가장 가까운 구역이 대표
  assert.equal(s.overflow, 0);
  const noZoneType = buildNativeRailSnapshot([railItem('z', 'school_zone', 'P2', 'confirmed', 500)], { now: new Date(NOW) });
  assert.equal(noZoneType.items[0].zoneType, null);
});

test('기상·재난·터널 역광 같은 정의 밖 유형은 레일에 들어가지 않는다', () => {
  const rail = [railItem('w', 'weather', 'P0', 'confirmed', 300), railItem('t', 'tunnel_glare', 'P0', 'confirmed', 300), railItem('a', 'accident', 'P1', 'confirmed', 500)];
  assert.deepEqual(buildNativeRailSnapshot(rail, { now: new Date(NOW) }).items.map((i) => i.key), ['a']);
});

test('거리는 10m 단위로 반올림되고, 비어 있으면 빈 스냅샷이다', () => {
  assert.equal(snap([alert('a', 'accident', 1004)]).items[0].distanceM, 1000);
  assert.deepEqual(buildNativeRailSnapshot([], { now: new Date(NOW) }), EMPTY_NATIVE_RAIL);
});

test('railChanged: 내용이 같으면 다시 보내지 않고, 단계·순서·개수가 바뀌면 보낸다 (거리는 50m 단위)', () => {
  const a = alert('a', 'accident', 1000);
  const s1 = snap([a], 0);
  const s2 = snap([a], 10); // 10m 이동 — 표시 변화 없음
  assert.equal(railChanged(s1, s2), false);
  assert.equal(railChanged(s1, snap([a], 80)), true); // 50m 단위를 넘음
  assert.equal(railChanged(s1, snap([a], 600)), true); // advance → caution
  assert.equal(railChanged(null, EMPTY_NATIVE_RAIL), false); // 처음부터 비어 있으면 보낼 것이 없다
  assert.equal(railChanged(s1, EMPTY_NATIVE_RAIL), true); // 사라질 때는 비우라고 알려야 한다
});

test('Mock 주행: 사고→공사→통과 순으로 레일이 바뀌고, 재탐색(경로·데이터 교체) 시 최신 정보로 교체된다', () => {
  const accident = alert('acc', 'accident', 1200);
  const works = alert('con', 'construction', 1800);
  const seen = [];
  for (const progress of [0, 300, 800, 1150, 1290, 1710, 1900]) {
    seen.push(snap([accident, works], progress).items.map((i) => `${i.type}:${i.stage}`).join(','));
  }
  assert.deepEqual(seen, [
    'accident:advance,construction:advance', // 0m: 사고 1200m 앞 + 공사 1800m 앞(둘 다 2km 이내)
    'accident:advance,construction:advance', // 300m: 사고 900m 앞, 공사 1500m 앞
    'accident:caution,construction:advance', // 800m: 사고 400m 앞, 공사 1000m 앞
    'accident:final,construction:advance', // 1150m: 사고 50m 앞
    'construction:advance', // 1290m: 사고 통과 → 공사 510m 앞
    'construction:final', // 1710m: 공사 90m 앞
    '', // 1900m: 공사도 통과 → 비어 있음
  ]);
  // 재탐색: 새 경로 기준으로 새 위험 목록이 오면 이전 목록이 아니라 새 목록만 보인다.
  const rerouted = snap([alert('new-acc', 'accident', 500)], 0);
  assert.deepEqual(rerouted.items.map((i) => i.key), ['new-acc']);
});

test('serializeNativeRail: 좌표·위치·원문 텍스트 없이 번호·유형·단계만 담긴다', () => {
  const json = serializeNativeRail(snap([alert('a', 'accident', 1000, { location: '서울시 어딘가 123', description: '사고 발생' })]));
  assert.doesNotMatch(json, /latitude|longitude|lat|lng|location|description|어딘가|사고 발생/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.v, 1);
  assert.deepEqual(Object.keys(parsed.items[0]).sort(), ['distanceM', 'emphasis', 'key', 'priority', 'stage', 'type', 'zoneType']);
});
