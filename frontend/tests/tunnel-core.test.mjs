// 터널 접근: 데이터 검증(입구 좌표가 정확한 시설만), 접근 판정, 진행 방향 추정, 기상 판단, 단계 거리·표시 정책.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { APPROACH_CONFIG, findApproaches, makeRouteFilter, MotionEstimator } from '../src/lib/tunnel/approach.ts';
import { decidePresentation, createPresentationState, stageFor, stageThresholds, StageTracker } from '../src/lib/tunnel/alert.ts';
import { baseNameOf, parseTunnelDataset } from '../src/lib/tunnel/dataset.ts';
import { assessRoadWeather, parseRoadWeather } from '../src/lib/tunnel/weather.ts';
import { drive, pt, T0, tunnel, weatherJson } from './tunnel-fixtures.mjs';

const NOW = T0;
const obs = (o) => parseRoadWeather(weatherJson(o));
const heading = (deg) => ({ headingDeg: deg, speedMs: 22 });
const fixAt = (northM, eastM = 0) => ({ ...pt(northM, eastM), accuracyM: 5, timestampMs: T0 });

// ───────────── 데이터 검증 ─────────────

test('번들 데이터: 전부 정밀 좌표라 한 건도 걸러지지 않는다', () => {
  const file = JSON.parse(readFileSync(new URL('../src/data/tunnelEntrances.json', import.meta.url), 'utf8'));
  const { index, rejected } = parseTunnelDataset(file);
  assert.equal(index.facilities.length, file.tunnels.length);
  assert.ok(index.facilities.length > 1500, `정밀 터널 수 ${index.facilities.length}`);
  assert.deepEqual(Object.values(rejected).filter((n) => n > 0), []);
  // 모든 시설은 서로 다른 두 끝점과 양의 연장을 가진다.
  for (const f of index.facilities) {
    assert.ok(f.lengthM > 0);
    assert.notDeepEqual(f.a, f.b);
  }
});

test('좌표 없음·대표 좌표(점 하나)·한쪽 끝점·범위 밖·연장 불일치는 받아들이지 않는다', () => {
  const good = tunnel('ok');
  const base = { id: 'x', name: 'x터널', lengthM: 500, direction: 'both' };
  const bad = [
    { ...base, id: 'p', entranceA: [37.5, 127.0], entranceB: [37.50001, 127.0] }, // 1m: 점 하나
    { ...base, id: 'same', entranceA: [37.5, 127.0], entranceB: [37.5, 127.0] },
    { ...base, id: 'n', entranceA: null, entranceB: null },
    { ...base, id: 'zero', entranceA: [0, 0], entranceB: [0, 0] },
    { ...base, id: 'one', entranceA: [37.5, 127.0], entranceB: null },
    { ...base, id: 'oob', entranceA: [10, 127.0], entranceB: [10.004, 127.0] },
    { ...base, id: 'len', lengthM: 100, entranceA: [37.5, 127.0], entranceB: [37.52, 127.0] }, // 직선 2.2km 인데 연장 100m
    { ...base, id: 'nolen', lengthM: null, entranceA: [37.5, 127.0], entranceB: [37.504, 127.0] },
    'garbage',
    { name: 'noid', entranceA: [37.5, 127.0], entranceB: [37.504, 127.0] },
  ];
  const { index, rejected } = parseTunnelDataset({ tunnels: [good, ...bad] });
  assert.deepEqual(index.facilities.map((f) => f.id), ['ok']);
  assert.equal(rejected.pointOnly, 2);
  assert.equal(rejected.noCoords, 3);
  assert.equal(rejected.outsideKorea, 1);
  assert.equal(rejected.lengthMismatch, 1);
  assert.equal(rejected.lengthInvalid, 1);
  assert.equal(rejected.malformed, 2);
});

test('같은 id 중복은 한 번만 받는다', () => {
  const t = tunnel('dup');
  const { index, rejected } = parseTunnelDataset([t, t]);
  assert.equal(index.facilities.length, 1);
  assert.equal(rejected.duplicate, 1);
});

test('baseNameOf: 방향·신구 괄호 접미와 공백을 뗀다', () => {
  assert.equal(baseNameOf('남산 1호터널 (상행)'), '남산1호터널');
  assert.equal(baseNameOf('죽령터널[하행]'), '죽령터널');
  assert.equal(baseNameOf('죽령터널'), '죽령터널');
});

test('그룹: 이름이 같고 끝점이 150m 안이면 같은 시설(쌍굴), 멀면 다른 시설', () => {
  const up = tunnel('u', { name: '가나터널(상행)', east: 0 });
  const down = tunnel('d', { name: '가나터널(하행)', east: 30 });
  const far = tunnel('f', { name: '가나터널(상행)', from: 6000, to: 6800 }); // 같은 이름, 6km 떨어진 다른 시설
  const other = tunnel('o', { name: '다라터널', east: 30 });
  const { index } = parseTunnelDataset([up, down, far, other]);
  const g = Object.fromEntries(index.facilities.map((f) => [f.id, f.groupId]));
  assert.equal(g.u, g.d);
  assert.notEqual(g.u, g.f);
  assert.notEqual(g.u, g.o);
});

test('index.near: 반경 안 시설만', () => {
  const { index } = parseTunnelDataset([tunnel('a'), tunnel('b', { from: 20_000, to: 20_800 })]);
  assert.deepEqual(index.near(pt(-300), 1000).map((f) => f.id), ['a']);
  assert.equal(index.near(pt(-300), 100).length, 0);
});

// ───────────── 접근 판정 ─────────────

const world = () => parseTunnelDataset([tunnel('t')]).index;

test('북쪽으로 달려 입구 A 에 접근: 입구는 a, 거리는 남은 거리', () => {
  const [ap] = findApproaches(world(), fixAt(-400), heading(0));
  assert.equal(ap.entrance, 'a');
  assert.ok(Math.abs(ap.distanceM - 400) < 3, String(ap.distanceM));
});

test('남쪽으로 달려 반대편에서 접근하면 입구는 b (출구와 입구가 방향으로 정해진다)', () => {
  const [ap] = findApproaches(world(), fixAt(1200), heading(180));
  assert.equal(ap.entrance, 'b');
  assert.ok(Math.abs(ap.distanceM - 400) < 3);
});

test('입구에서 멀어지는 중이거나 이미 터널 안(100m 넘게)이면 접근이 아니다', () => {
  assert.equal(findApproaches(world(), fixAt(-400), heading(180)).length, 0); // 남쪽으로 가는 중: 입구에서 멀어짐
  assert.equal(findApproaches(world(), fixAt(300), heading(0)).length, 0); // 터널 안 깊이
});

test('입구를 막 지난 위치는 음수 거리로 돌려준다(통과 인식용)', () => {
  const [ap] = findApproaches(world(), fixAt(30), heading(0));
  assert.ok(ap.distanceM < -25 && ap.distanceM > -35, String(ap.distanceM));
});

test('교차하는 도로(동쪽 진행)는 진입 방향이 아니다', () => {
  assert.equal(findApproaches(world(), fixAt(-60), heading(90)).length, 0);
});

test('입구 근처에서 100m 옆의 평행 도로는 걸러낸다', () => {
  assert.equal(findApproaches(world(), fixAt(-80, 100), heading(0)).length, 0);
  assert.equal(findApproaches(world(), fixAt(-80, 10), heading(0)).length, 1); // 터널 축 위(오차 10m)는 통과
});

test('멀리서(400m 앞) 100m 넘게 비껴가는 평행 도로는 거른다', () => {
  assert.equal(findApproaches(world(), fixAt(-400, 150), heading(0)).length, 0);
  assert.equal(findApproaches(world(), fixAt(-300, 120), heading(0)).length, 0);
});

test('한계 확인: 400m 앞에서 60m 옆의 평행 도로는 통과한다 - 경로 필터가 있어야 거를 수 있다', () => {
  const side = fixAt(-400, 60);
  assert.equal(findApproaches(world(), side, heading(0)).length, 1);
  const route = { id: 'r', points: [{ latitude: pt(-900).lat, longitude: pt(-900).lng }, { latitude: pt(1200).lat, longitude: pt(1200).lng }] };
  const onRoute = makeRouteFilter(route);
  assert.equal(findApproaches(world(), fixAt(-400), heading(0), APPROACH_CONFIG, onRoute).length, 1);
  const farRoute = { id: 'r2', points: [{ latitude: pt(-900, 300).lat, longitude: pt(-900, 300).lng }, { latitude: pt(1200, 300).lat, longitude: pt(1200, 300).lng }] };
  assert.equal(findApproaches(world(), fixAt(-400), heading(0), APPROACH_CONFIG, makeRouteFilter(farRoute)).length, 0);
});

test('경로 필터: 경로가 터널과 반대 방향이면 거른다', () => {
  const reversed = { id: 'r3', points: [{ latitude: pt(1200).lat, longitude: pt(1200).lng }, { latitude: pt(-900).lat, longitude: pt(-900).lng }] };
  assert.equal(findApproaches(world(), fixAt(-400), heading(0), APPROACH_CONFIG, makeRouteFilter(reversed)).length, 0);
});

test('1.1km 밖 입구는 보지 않는다', () => {
  assert.equal(findApproaches(world(), fixAt(-1200), heading(0)).length, 0);
});

test('같은 방향으로 입력된 쌍굴 두 기록은 하나만 돌려준다', () => {
  const { index } = parseTunnelDataset([tunnel('t1', { name: '가나터널(상행)', east: 0 }), tunnel('t2', { name: '가나터널(하행)', east: 20 })]);
  assert.equal(findApproaches(index, fixAt(-300, 5), heading(0)).length, 1);
});

test('반대 차로 기록(시점·종점이 거꾸로)이어도 진행 방향으로 입구를 고른다', () => {
  const reversedRecord = { ...tunnel('rev'), entranceA: tunnel('rev').entranceB, entranceB: tunnel('rev').entranceA };
  const { index } = parseTunnelDataset([reversedRecord]);
  const [ap] = findApproaches(index, fixAt(-300), heading(0));
  assert.equal(ap.entrance, 'b'); // 기록상 B 가 실제로는 남쪽 입구
  assert.ok(Math.abs(ap.distanceM - 300) < 3);
});

test('입구 좌표를 모르는 터널(대표 좌표만)로는 접근 경고를 만들 수 없다', () => {
  const point = { id: 'pt', name: '점터널', lengthM: 800, direction: 'both', entranceA: [pt(0).lat, pt(0).lng], entranceB: [pt(0).lat, pt(0).lng] };
  const { index } = parseTunnelDataset([point]);
  assert.equal(index.facilities.length, 0);
  assert.equal(findApproaches(index, fixAt(-300), heading(0)).length, 0);
});

// ───────────── 진행 방향 추정 ─────────────

test('MotionEstimator: 정북 20m/s 이동에서 방향 0°, 속도 20m/s', () => {
  const est = new MotionEstimator();
  let m = null;
  for (const { fix } of drive({ startNorth: -500, endNorth: -400, speedKmh: 72 })) m = est.push(fix);
  assert.ok(m);
  assert.ok(Math.abs(m.speedMs - 20) < 0.5);
  assert.ok(m.headingDeg < 1 || m.headingDeg > 359);
});

test('MotionEstimator: 거의 움직이지 않으면 방향을 알 수 없다(잡음 방향으로 판정하지 않는다)', () => {
  const est = new MotionEstimator();
  const base = pt(-500);
  let m = 'x';
  for (let i = 0; i < 6; i++) m = est.push({ lat: base.lat + (i % 2) * 2e-6, lng: base.lng, accuracyM: 5, timestampMs: T0 + i * 1000 });
  assert.equal(m, null);
});

test('MotionEstimator: 정확도 나쁜 점·시간이 거꾸로 간 점은 쓰지 않거나 이력을 버린다', () => {
  const est = new MotionEstimator();
  assert.equal(est.push({ ...pt(-500), accuracyM: 120, timestampMs: T0 }), null);
  est.push({ ...pt(-500), accuracyM: 5, timestampMs: T0 + 1000 });
  est.push({ ...pt(-470), accuracyM: 5, timestampMs: T0 + 2000 });
  // 시간이 과거로 → 이력 초기화, 새 점 하나로는 방향을 모른다
  assert.equal(est.push({ ...pt(-440), accuracyM: 5, timestampMs: T0 }), null);
});

// ───────────── 기상 판단 ─────────────

const risk = (o, ageMin = 10) => assessRoadWeather(obs({ ageMin, ...o }), NOW);

test('눈은 warning, 비+저온(≤3℃)은 warning, 비만은 caution', () => {
  assert.deepEqual([risk({ pty: 'snow' }).level, risk({ pty: 'snow' }).reasons], ['warning', ['snow']]);
  assert.equal(risk({ pty: 'rain_snow', temp: 8 }).level, 'warning');
  assert.deepEqual([risk({ pty: 'rain', temp: 2 }).level, risk({ pty: 'rain', temp: 2 }).reasons], ['warning', ['rain', 'low_temp']]);
  assert.deepEqual([risk({ pty: 'rain', temp: 15 }).level, risk({ pty: 'rain', temp: 15 }).reasons], ['caution', ['rain']]);
  assert.equal(risk({ pty: 'shower', temp: 20 }).level, 'caution');
});

test('강수 없이 저온(≤2℃)이면서 젖음/습도 높음이면 caution, 건조·온화하면 none', () => {
  assert.equal(risk({ pty: 'none', temp: 1, reh: 90 }).level, 'caution');
  assert.equal(risk({ pty: 'none', temp: 1, rain: 0.5, reh: 40 }).level, 'caution');
  assert.equal(risk({ pty: 'none', temp: 1, reh: 40 }).level, 'none'); // 춥지만 건조: 결빙을 단정할 근거가 없다
  assert.equal(risk({ pty: 'none', temp: 12, reh: 95 }).level, 'none');
});

test('관측값만으로는 결빙을 확정하지 않는다: basis 는 weather_only, 이유에 결빙 단정이 없다', () => {
  const r = risk({ pty: 'snow', temp: -5 });
  assert.equal(r.basis, 'weather_only');
  assert.ok(r.reasons.every((x) => ['rain', 'snow', 'low_temp', 'wet_or_humid'].includes(x)));
  assert.ok(!JSON.stringify(r).match(/ice|freez|결빙|얼/i));
});

test('관측 없음·오래됨·미래 시각·강수형태 결측은 unknown (안전이 아니다)', () => {
  assert.equal(assessRoadWeather(null, NOW).level, 'unknown');
  assert.equal(assessRoadWeather(null, NOW).note, 'observation_unavailable');
  assert.equal(risk({ pty: 'snow' }, 90).level, 'unknown');
  assert.equal(risk({ pty: 'snow' }, 90).note, 'observation_stale');
  assert.equal(risk({ pty: 'snow' }, -30).level, 'unknown'); // 미래
  assert.equal(risk({ pty: 'unknown', missing: ['PTY'], temp: 10 }).level, 'unknown');
  assert.equal(risk({ pty: 'unknown', temp: null }).level, 'unknown');
  // 오래돼도 눈 관측이 "없음"으로 바뀌지 않는다
  assert.notEqual(risk({ pty: 'snow' }, 90).level, 'none');
});

test('기온 결측이어도 눈·비 자체는 판단한다', () => {
  assert.equal(risk({ pty: 'snow', temp: null, missing: ['T1H'] }).level, 'warning');
  assert.equal(risk({ pty: 'rain', temp: null, missing: ['T1H'] }).level, 'caution');
});

test('parseRoadWeather: 형식이 틀리면 null, 모르는 PTY 값은 unknown', () => {
  assert.equal(parseRoadWeather(null), null);
  assert.equal(parseRoadWeather({}), null);
  assert.equal(parseRoadWeather({ observed_at: 'not a date' }), null);
  assert.equal(parseRoadWeather({ observed_at: '2026-11-05T12:00:00+09:00', temp_c: 'x' }), null);
  assert.equal(parseRoadWeather({ observed_at: '2026-11-05T12:00:00+09:00', pty: 'meteor' }).pty, 'unknown');
  const ok = parseRoadWeather(weatherJson({ pty: 'snow', temp: -1 }));
  assert.equal(ok.pty, 'snow');
  assert.equal(ok.tempC, -1);
});

// ───────────── 단계 거리·표시 정책 ─────────────

test('stageThresholds: 고정은 500/300/100, 적응형은 속도에 비례하되 단조·상한이 있다', () => {
  assert.deepEqual(stageThresholds(10, 'fixed'), [500, 300, 100]);
  assert.deepEqual(stageThresholds(10, 'adaptive'), [500, 300, 100]); // 36km/h: 기존 값보다 가까워지지 않는다
  const [c, a, f] = stageThresholds(100 / 3.6, 'adaptive'); // 100km/h
  assert.ok(c > a && a > f && f >= 100);
  assert.ok(c <= 1000 && a <= 600 && f <= 300);
  assert.ok(Math.abs(c - 694) < 2 && Math.abs(f - 194) < 2, `${c} ${a} ${f}`);
  const [c2, a2, f2] = stageThresholds(60, 'adaptive'); // 비현실적 속도도 상한/단조 유지
  assert.ok(c2 - a2 >= 50 - 1e-9 && a2 - f2 >= 50 - 1e-9);
});

test('stageFor: 경계값', () => {
  const t = [500, 300, 100];
  assert.equal(stageFor(501, t), null);
  assert.equal(stageFor(500, t), 'caution');
  assert.equal(stageFor(300, t), 'approach');
  assert.equal(stageFor(100, t), 'final');
  assert.equal(stageFor(0, t), null);
  assert.equal(stageFor(-5, t), null);
});

const T = [500, 300, 100];

test('StageTracker: 단계는 한 번씩만, 요동쳐도 되돌아가지 않는다', () => {
  const tr = new StageTracker();
  const out = [450, 520, 480, 290, 310, 295, 90, 120, 80].map((d) => tr.step('k', d, T));
  assert.deepEqual(out, ['caution', null, null, 'approach', null, null, 'final', null, null]);
});

test('StageTracker: 먼 단계를 건너뛰어 들어와도(GPS 공백) 가까운 단계 하나만, 먼 단계는 나중에 안 나온다', () => {
  const tr = new StageTracker();
  assert.equal(tr.step('k', 80, T), 'final');
  assert.equal(tr.step('k', 400, T), null);
  assert.equal(tr.step('k', 250, T), null);
});

test('StageTracker: 통과(−20m 이하)는 cleared 한 번, 이후 아무것도 없다. 본 단계가 없으면 조용히 끝난다', () => {
  const tr = new StageTracker();
  tr.step('k', 80, T);
  assert.equal(tr.step('k', -10, T), null); // 아직 입구 근처(GPS 오차)
  assert.equal(tr.step('k', -25, T), 'cleared');
  assert.equal(tr.step('k', -40, T), null);
  assert.equal(tr.step('k', 50, T), null); // 되돌아와도 다시 알리지 않는다
  assert.equal(tr.step('quiet', -60, T), null); // 본 적 없는 시설을 통과: 알림 없음
});

test('StageTracker.retainOnly: 멀어진 시설은 잊어서 다시 지나면 다시 알린다', () => {
  const tr = new StageTracker();
  tr.step('k', 80, T);
  tr.step('k', -30, T);
  tr.retainOnly(new Set(['k']));
  assert.equal(tr.step('k', 80, T), null); // 아직 범위 안: 기억
  tr.retainOnly(new Set()); // 멀어짐
  assert.equal(tr.step('k', 80, T), 'final');
});

const baseInput = { stage: 'caution', tteS: 20, speedKmh: 80, lengthM: 800, key: 'k', followInCluster: false, nowMs: NOW };
const warn = { level: 'warning', reasons: ['snow'], basis: 'weather_only' };
const caut = { level: 'caution', reasons: ['rain'], basis: 'weather_only' };

test('표시: unknown/none 은 아무것도 내지 않는다', () => {
  for (const level of ['unknown', 'none']) {
    const p = decidePresentation({ ...baseInput, risk: { level, reasons: [], basis: 'unknown' } }, createPresentationState());
    assert.deepEqual([p.banner, p.tts, p.haptic], [false, false, false]);
  }
});

test('표시: caution 은 배너만(음성·진동 없음), 200m 미만 터널은 알리지 않는다', () => {
  const p = decidePresentation({ ...baseInput, risk: caut, stage: 'final' }, createPresentationState());
  assert.deepEqual([p.banner, p.tts, p.haptic], [true, false, false]);
  const short = decidePresentation({ ...baseInput, risk: caut, lengthM: 150 }, createPresentationState());
  assert.equal(short.banner, false);
  assert.equal(decidePresentation({ ...baseInput, risk: warn, lengthM: 150 }, createPresentationState()).banner, true); // 눈은 짧아도 알린다
});

test('표시: warning 음성은 시설당 한 번, 입구 8~30초 전일 때만, 진동은 final 에서만', () => {
  const st = createPresentationState();
  const a = decidePresentation({ ...baseInput, risk: warn, stage: 'caution', tteS: 25 }, st);
  assert.deepEqual([a.banner, a.tts, a.haptic], [true, true, false]);
  const b = decidePresentation({ ...baseInput, risk: warn, stage: 'approach', tteS: 14 }, st);
  assert.deepEqual([b.banner, b.tts, b.haptic], [true, false, false]); // 같은 시설: 음성 없음
  const c = decidePresentation({ ...baseInput, risk: warn, stage: 'final', tteS: 5 }, st);
  assert.deepEqual([c.banner, c.tts, c.haptic], [true, false, true]);
});

test('표시: 너무 이르면(30초 초과) 음성을 미루고, 너무 늦으면(8초 미만) 음성 없이 배너', () => {
  const st = createPresentationState();
  assert.equal(decidePresentation({ ...baseInput, risk: warn, tteS: 45 }, st).tts, false);
  assert.equal(decidePresentation({ ...baseInput, risk: warn, tteS: 4, stage: 'final' }, st).tts, false);
  assert.equal(decidePresentation({ ...baseInput, risk: warn, tteS: 20, stage: 'approach' }, st).tts, true); // 미룬 음성은 다음 단계에서
});

test('표시: 90초 안에 다른 터널 음성이 있었으면 쿨다운, 20km/h 미만은 알림 없음, 이어지는 터널은 배너만', () => {
  const st = createPresentationState();
  decidePresentation({ ...baseInput, risk: warn, key: 'a' }, st);
  assert.equal(decidePresentation({ ...baseInput, risk: warn, key: 'b', nowMs: NOW + 30_000 }, st).tts, false);
  assert.equal(decidePresentation({ ...baseInput, risk: warn, key: 'c', nowMs: NOW + 100_000 }, st).tts, true);
  assert.equal(decidePresentation({ ...baseInput, risk: warn, key: 'd', speedKmh: 10 }, createPresentationState()).banner, false);
  const follow = decidePresentation({ ...baseInput, risk: warn, followInCluster: true, stage: 'final' }, createPresentationState());
  assert.deepEqual([follow.banner, follow.tts, follow.haptic], [true, false, false]);
});
