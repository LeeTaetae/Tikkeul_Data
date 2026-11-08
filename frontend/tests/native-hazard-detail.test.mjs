// 모바일(네이티브) 위험 레일: GPS 주행 시뮬레이션으로 표시·단계·통과 해제·중복 방지와, 탭 상세·단계 안내가 스냅샷에 실리는지 확인한다.
// 위험 판정 엔진은 바꾸지 않는다. Mock 경로·Mock 위험 데이터이며 실제 API 응답이 아니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prioritizeHazards } from '../src/lib/hazardPriority.ts';
import { buildHazardRail } from '../src/lib/hazardRail.ts';
import { classifyIncidentOnRoute } from '../src/lib/routeHazards.ts';
import { buildNativeRailSnapshot, railChanged, serializeNativeRail } from '../src/lib/navigation/nativeHazardRail.ts';
import { describeHazardForNative } from '../src/lib/navigation/nativeHazardText.ts';

const M = 111320;
const NOW = Date.parse('2026-10-30T12:00:00+09:00'); // 금요일 낮(등하교 시간 아님)
const ROUTE = { id: 'r', points: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.5 + 6000 / M, longitude: 127 }] };
const at = (northM) => ({ latitude: 37.5 + northM / M, longitude: 127 });
const alert = (id, type, northM, extra = {}) => ({
  id, eventKey: id, type, severity: 'danger', location: `${id} 부근`, description: '',
  updatedAt: new Date(NOW - 30 * 60_000).toISOString(), timeKind: 'started', directionScope: 'both', ...at(northM), ...extra,
});
const railAt = (alerts, progressM) =>
  buildHazardRail(prioritizeHazards(
    alerts.map((a) => ({ alert: a, match: classifyIncidentOnRoute(ROUTE, a, { mode: 'driving', progressM, gpsAccuracyM: 5, nowMs: NOW, dataStale: false }) })),
    { mode: 'driving', speedMps: 14 },
  ));
const snapAt = (alerts, progressM, opts = {}) => buildNativeRailSnapshot(railAt(alerts, progressM), { now: new Date(NOW), ...opts });

// 번역 키를 그대로 돌려주는 가짜 t. 어떤 키를 쓰는지 확인한다.
const t = (key, params) => (params ? `${key}${JSON.stringify(params)}` : key);

test('주행 시뮬레이션: 2km 안에 들어와야 보이고, 500·300·100m 단계로 바뀌고, 통과하면 사라진다', () => {
  const alerts = [alert('acc', 'accident', 3000)];
  const stages = [];
  for (let progress = 0; progress <= 3100; progress += 50) {
    const s = snapAt(alerts, progress);
    stages.push([progress, s.items[0]?.stage ?? null]);
  }
  const stageAt = (p) => stages.find(([x]) => x === p)[1];
  assert.equal(stageAt(800), null, '2.2km 전에는 보이지 않는다');
  assert.equal(stageAt(1100), 'advance', '2km 이내 사전 안내');
  assert.equal(stageAt(2400), 'advance', '600m 전은 아직 사전 안내');
  assert.equal(stageAt(2600), 'caution', '400m');
  assert.equal(stageAt(2800), 'approach', '200m');
  assert.equal(stageAt(2950), 'final', '100m 이내');
  assert.equal(stageAt(3100), null, '통과하면 레일에서 사라진다');
});

test('같은 유형 여러 건은 아이콘 하나: 서로 다른 유형 사이에서 가까운 것이 대표가 된다', () => {
  const s = snapAt([alert('a1', 'accident', 1500), alert('a2', 'accident', 900), alert('a3', 'accident', 1200)], 0);
  assert.equal(s.items.filter((i) => i.type === 'accident').length, 1);
  assert.equal(s.items[0].key, 'a2', '같은 등급이면 현재 위치에서 가장 가까운 사고');
});

test('통과 후 다음 같은 유형 위험이 대표로 올라온다', () => {
  const alerts = [alert('a1', 'accident', 500), alert('a2', 'accident', 1800)];
  assert.equal(snapAt(alerts, 0).items[0].key, 'a1');
  assert.equal(snapAt(alerts, 600).items[0].key, 'a2');
});

test('상세 문장은 웹 HazardDetail 과 같은 i18n 키를 쓰고 거리를 넣지 않는다(거리 때문에 매번 바뀌지 않게)', () => {
  const item = railAt([alert('acc', 'accident', 1500)], 0)[0];
  const text = describeHazardForNative(item, t, 'ko');
  assert.match(text, /nav\.rail\.locationLabel/);
  assert.match(text, /acc 부근/);
  assert.match(text, /nav\.rail\.class\.confirmed/);
  assert.match(text, /nav\.rail\.source\.its/);
  assert.doesNotMatch(text, /\d+m\b/);
  const closer = railAt([alert('acc', 'accident', 1500)], 400)[0];
  assert.equal(describeHazardForNative(closer, t, 'ko'), text);
});

test('스냅샷: describe 가 있으면 detail 이 실리고, warning 이 있으면 단계 안내가 실린다. 없으면 필드가 없다(구버전 호환)', () => {
  const plain = snapAt([alert('acc', 'accident', 1500)], 0);
  assert.equal('detail' in plain.items[0], false);
  assert.equal('warning' in plain, false);
  const rich = snapAt([alert('acc', 'accident', 1500)], 0, {
    describe: (item) => `detail:${item.key}`,
    warning: { key: 'acc:advance', stage: 'advance', text: '1.5km 앞 사고' },
  });
  assert.equal(rich.items[0].detail, 'detail:acc');
  assert.deepEqual(rich.warning, { key: 'acc:advance', stage: 'advance', text: '1.5km 앞 사고' });
  assert.equal(JSON.parse(serializeNativeRail(rich)).warning.text, '1.5km 앞 사고');
});

test('railChanged: 새 단계 안내·상세 문장이 바뀌면 다시 보내고, 같은 내용이면 보내지 않는다', () => {
  const base = { describe: () => 'd' };
  const a = snapAt([alert('acc', 'accident', 1500)], 0, { ...base, warning: { key: 'acc:advance', stage: 'advance', text: 'x' } });
  const same = snapAt([alert('acc', 'accident', 1500)], 10, { ...base, warning: { key: 'acc:advance', stage: 'advance', text: 'x' } });
  assert.equal(railChanged(a, same), false);
  const next = snapAt([alert('acc', 'accident', 1500)], 0, { ...base, warning: { key: 'acc:caution', stage: 'caution', text: 'y' } });
  assert.equal(railChanged(a, next), true);
  const noWarning = snapAt([alert('acc', 'accident', 1500)], 0, base);
  assert.equal(railChanged(a, noWarning), true);
  assert.equal(railChanged(null, { v: 1, items: [], overflow: 0, warning: { key: 'k', stage: 'final', text: 't' } }), true);
});

test('기상·터널 역광은 레일 유형에 없다', () => {
  const s = snapAt([alert('w', 'weather', 1000)], 0);
  assert.equal(s.items.length, 0);
});

test('GPS 진행에 따라 유형별 대표가 가장 가까운 위험으로 갱신된다(사고·공사 동일 정책, 등급 무관)', () => {
  const alerts = [
    alert('acc-far', 'accident', 2500), alert('acc-near', 'accident', 1200, { severity: 'caution' }),
    alert('con-far', 'construction', 2200, { severity: 'danger' }), alert('con-near', 'construction', 1000, { severity: 'caution' }),
  ];
  const keys = (p) => snapAt(alerts, p).items.map((i) => i.key).sort();
  assert.deepEqual(keys(0), ['acc-near', 'con-near']);
  assert.deepEqual(keys(1100), ['acc-near', 'con-far']);
  assert.deepEqual(keys(1300), ['acc-far', 'con-far']);
  assert.deepEqual(keys(2300), ['acc-far']);
  assert.deepEqual(keys(2600), []);
});

test('실제 경로 위가 아닌 위험(경로 밖·확인 불가)은 대표가 되지 않는다', () => {
  const off = alert('off', 'accident', 800, { longitude: 127.01 });
  const on = alert('on', 'accident', 1800);
  assert.deepEqual(snapAt([off, on], 0).items.map((i) => i.key), ['on']);
  const unverified = alert('single', 'accident', 500, { directionScope: 'single' });
  assert.deepEqual(snapAt([unverified, on], 0).items.map((i) => i.key), ['on']);
});
