// 터널 접근 + 기상 결합 + 중복 방지: GPS 주행을 흉내 내어 watcher 가 내는 이벤트 전체를 검증한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTunnelDataset } from '../src/lib/tunnel/dataset.ts';
import { parseRoadWeather } from '../src/lib/tunnel/weather.ts';
import { createTunnelWatcher } from '../src/lib/tunnel/watcher.ts';
import { drive, T0, tunnel, weatherJson } from './tunnel-fixtures.mjs';

const index = (...tunnels) => parseTunnelDataset(tunnels).index;
const wx = (o) => parseRoadWeather(weatherJson(o));
const SNOW = wx({ pty: 'snow', temp: -2 });
const RAIN = wx({ pty: 'rain', temp: 15 });
const CLEAR = wx({ pty: 'none', temp: 15 });

/** 점열을 watcher 에 넣고 이벤트를 시간순으로 모은다 */
function run(w, points, weather) {
  const events = [];
  for (const { fix, t } of points) for (const e of w.update(fix, typeof weather === 'function' ? weather(t) : weather, fix.timestampMs)) events.push({ ...e, t });
  return events;
}
const stages = (events) => events.filter((e) => e.kind === 'stage');

test('눈 + 80km/h 직선 주행: 3단계가 한 번씩 순서대로, 음성 1회, 진동은 마지막 단계만, 통과 후 cleared 1회', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const ev = run(w, drive({ startNorth: -2000, endNorth: 400, speedKmh: 80 }), SNOW);
  const st = stages(ev);
  assert.deepEqual(st.map((e) => e.stage), ['caution', 'approach', 'final']);
  assert.equal(st.filter((e) => e.presentation.tts).length, 1);
  assert.deepEqual(st.map((e) => e.presentation.haptic), [false, false, true]);
  assert.ok(st.every((e) => e.presentation.banner));
  assert.equal(ev.filter((e) => e.kind === 'cleared').length, 1);
  assert.equal(ev.filter((e) => e.kind === 'cleared')[0].t > st[2].t, true);
  // 단계 거리는 속도 적응형: 80km/h 에서 caution 은 500m 보다 멀리서 시작한다
  assert.ok(st[0].distanceM > 500 && st[0].distanceM <= 560, String(st[0].distanceM));
  assert.ok(st.every((e) => e.risk.basis === 'weather_only'));
});

test('비(15℃): 배너만 - 음성·진동 없음', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const st = stages(run(w, drive({ startNorth: -2000, endNorth: 100, speedKmh: 80 }), RAIN));
  assert.equal(st.length, 3);
  assert.ok(st.every((e) => e.presentation.banner && !e.presentation.tts && !e.presentation.haptic));
});

test('날씨가 맑음/없음/오래됨/형식 오류여도 터널 접근은 감지하되 경고는 내지 않는다', () => {
  for (const [label, weather] of [['맑음', CLEAR], ['없음', null], ['오래됨', wx({ pty: 'snow', ageMin: 120 })], ['PTY 결측', wx({ pty: 'unknown', missing: ['PTY'] })]]) {
    const w = createTunnelWatcher(index(tunnel('t')));
    const st = stages(run(w, drive({ startNorth: -2000, endNorth: 100, speedKmh: 80 }), weather));
    assert.equal(st.length, 3, label);
    assert.ok(st.every((e) => !e.presentation.banner && !e.presentation.tts && !e.presentation.haptic), label);
    if (label !== '맑음') assert.equal(st[0].risk.level, 'unknown', label);
  }
});

test('날씨가 주행 중에 바뀌면 이후 단계부터 반영된다', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const ev = run(w, drive({ startNorth: -2000, endNorth: 100, speedKmh: 80 }), (t) => (t < 70 ? CLEAR : SNOW));
  const st = stages(ev);
  assert.equal(st[0].presentation.banner, false); // caution 시점(맑음)
  assert.equal(st[st.length - 1].presentation.banner, true); // final 시점(눈)
});

test('20km/h 미만 서행: 감지는 하되 경고는 내지 않는다', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const st = stages(run(w, drive({ startNorth: -600, endNorth: 50, speedKmh: 15 }), SNOW));
  assert.ok(st.length > 0);
  assert.ok(st.every((e) => !e.presentation.banner));
});

test('GPS 잡음(σ=12m, 30개 시드): 단계는 시설당 최대 1회씩, 음성은 최대 1회', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const w = createTunnelWatcher(index(tunnel('t')));
    const ev = run(w, drive({ startNorth: -1500, endNorth: 300, speedKmh: 70, noiseM: 12, seed, accuracyM: 12 }), SNOW);
    const st = stages(ev);
    const counts = st.reduce((acc, e) => ({ ...acc, [e.stage]: (acc[e.stage] ?? 0) + 1 }), {});
    for (const [stage, n] of Object.entries(counts)) assert.ok(n <= 1, `seed ${seed}: ${stage} ${n}회`);
    assert.ok(st.filter((e) => e.presentation.tts).length <= 1, `seed ${seed}: 음성 중복`);
    assert.ok(st.length >= 1, `seed ${seed}: 감지 못 함`);
    assert.ok(ev.filter((e) => e.kind === 'cleared').length <= 1, `seed ${seed}: cleared 중복`);
  }
});

test('GPS 공백(10초 간격 100km/h): 건너뛴 먼 단계는 나중에 나오지 않고 마지막 단계는 반드시 알린다', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const w = createTunnelWatcher(index(tunnel('t')));
    const pts = drive({ startNorth: -1800 + seed * 7, endNorth: 200, speedKmh: 100, dt: 5, noiseM: 5, seed });
    const st = stages(run(w, pts, SNOW));
    const order = ['caution', 'approach', 'final'];
    assert.ok(st.length >= 1);
    assert.ok(st.every((e, i) => i === 0 || order.indexOf(e.stage) > order.indexOf(st[i - 1].stage)), `seed ${seed}: 단계 순서/중복 ${st.map((e) => e.stage)}`);
  }
});

test('쌍굴이 같은 방향으로 입력된 두 기록: 경고는 한 번만', () => {
  const w = createTunnelWatcher(index(tunnel('t1', { name: '가나터널(상행)', east: 0 }), tunnel('t2', { name: '가나터널(하행)', east: 22 })));
  const ev = run(w, drive({ startNorth: -2000, endNorth: 300, speedKmh: 80, eastM: 6 }), SNOW);
  assert.deepEqual(stages(ev).map((e) => e.stage), ['caution', 'approach', 'final']);
  assert.equal(ev.filter((e) => e.kind === 'cleared').length, 1);
});

test('반대 방향(남쪽으로) 주행: 반대편 입구 B 로 접근하며 같은 규칙이 적용된다', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const ev = run(w, drive({ startNorth: 2800, endNorth: 400, speedKmh: 80 }), SNOW);
  const st = stages(ev);
  assert.deepEqual(st.map((e) => e.stage), ['caution', 'approach', 'final']);
  assert.ok(Math.abs(st[2].entrance.lat - tunnel('t').entranceB[0]) < 1e-5);
});

test('터널에서 멀어지는 방향/반대 차로 주행/교차 도로는 경고하지 않는다', () => {
  const idx = index(tunnel('t'));
  const away = run(createTunnelWatcher(idx), drive({ startNorth: -1000, endNorth: -2000, speedKmh: 80 }), SNOW);
  assert.equal(away.length, 0);
  const parallel = run(createTunnelWatcher(idx), drive({ startNorth: -300, endNorth: 50, speedKmh: 80, eastM: 120 }), SNOW);
  assert.equal(parallel.length, 0); // 입구 150m 안에서 120m 옆 도로
});

test('이어지는 터널(앞 터널 출구에서 600m): 두 번째는 followInCluster 로 배너만, 음성·진동 없음', () => {
  const w = createTunnelWatcher(index(tunnel('t1', { name: '가터널' }), tunnel('t2', { name: '나터널', from: 1400, to: 2200 })));
  const ev = run(w, drive({ startNorth: -1500, endNorth: 2400, speedKmh: 80 }), SNOW);
  const first = stages(ev).filter((e) => e.facility.id === 't1');
  const second = stages(ev).filter((e) => e.facility.id === 't2');
  assert.equal(first.length, 3);
  assert.ok(first.some((e) => e.presentation.tts));
  assert.ok(second.length >= 1);
  assert.ok(second.every((e) => e.followInCluster && e.presentation.banner && !e.presentation.tts && !e.presentation.haptic));
});

test('멀리 떨어진 두 터널은 이어지는 터널이 아니다: 각각 음성 한 번(쿨다운 90초 이후)', () => {
  const w = createTunnelWatcher(index(tunnel('t1', { name: '가터널' }), tunnel('t2', { name: '나터널', from: 9000, to: 9800 })));
  const ev = run(w, drive({ startNorth: -1500, endNorth: 9900, speedKmh: 60 }), SNOW);
  const byId = (id) => stages(ev).filter((e) => e.facility.id === id);
  assert.ok(byId('t1').every((e) => !e.followInCluster));
  assert.ok(byId('t2').every((e) => !e.followInCluster));
  assert.equal(byId('t1').filter((e) => e.presentation.tts).length, 1);
  assert.equal(byId('t2').filter((e) => e.presentation.tts).length, 1);
});

test('통과 직후에는 다시 알리지 않고, 3km 넘게 멀어진 뒤 다시 접근하면 새로 알린다', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const first = run(w, drive({ startNorth: -1500, endNorth: 4800, speedKmh: 80 }), SNOW);
  assert.equal(stages(first).length, 3);
  // 같은 점에서 되돌아 남쪽으로: 출구 B 쪽에서 다시 접근. 멀어졌으므로 이력을 잊었다.
  const back = run(w, drive({ startNorth: 4800, endNorth: 400, speedKmh: 80 }).map((p) => ({ ...p, fix: { ...p.fix, timestampMs: p.fix.timestampMs + 3_600_000 } })), SNOW);
  assert.equal(stages(back).length, 3);
});

test('입구 좌표를 모르는 터널(대표 좌표만)과 정밀 터널이 섞여도 정밀 터널만 경고한다', () => {
  const pointOnly = { id: 'pt', name: '점터널', lengthM: 900, direction: 'both', entranceA: tunnel('x').entranceA, entranceB: tunnel('x').entranceA };
  const noCoords = { id: 'nc', name: '무좌표터널', lengthM: 900, direction: 'both', entranceA: [0, 0], entranceB: [0, 0] };
  const w = createTunnelWatcher(parseTunnelDataset([pointOnly, noCoords]).index);
  assert.equal(run(w, drive({ startNorth: -2000, endNorth: 300, speedKmh: 80 }), SNOW).length, 0);
});

test('reset 후에는 이력이 비워져 같은 터널을 다시 알린다', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const pts = drive({ startNorth: -2000, endNorth: 100, speedKmh: 80 });
  assert.equal(stages(run(w, pts, SNOW)).length, 3);
  w.reset();
  assert.equal(stages(run(w, pts, SNOW)).length, 3);
});

test('진행 방향을 알 수 없는 정지 상태에서는 이벤트가 없다', () => {
  const w = createTunnelWatcher(index(tunnel('t')));
  const still = Array.from({ length: 20 }, (_, i) => ({ fix: { lat: 37.4955, lng: 127, accuracyM: 5, timestampMs: T0 + i * 1000 }, t: i }));
  assert.equal(run(w, still, SNOW).length, 0);
});
