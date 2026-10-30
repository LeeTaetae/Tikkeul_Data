// 길안내 엔진: GPS 재생 데이터로 진행률·이탈·도착·ETA 와 추적 컨트롤러(권한·재시작·재탐색)를 검증한다.
// 숫자 정책은 설계상 임시 기준이라, 여기서는 "정책대로 동작하는가"만 본다. 실제 주행·보행 GPS 로는 검증하지 않았다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  advance,
  createGuidanceTracker,
  GUIDANCE_POLICY,
  initialState,
  isSignalLost,
  rerouteFinished,
} from '../src/lib/navigation/guidanceEngine.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
// 기준점(37.5N, 127E)에서 북쪽 northM, 동쪽 eastM 만큼 떨어진 좌표
const pt = (northM, eastM) => ({ lat: 37.5 + northM / M, lng: 127 + eastM / (M * K) });

// 북쪽으로 1000m 간 뒤 동쪽으로 1000m (모서리 = path 인덱스 10), 총 2000m
const PATH = [...Array.from({ length: 11 }, (_, i) => pt(i * 100, 0)), ...Array.from({ length: 10 }, (_, i) => pt(1000, (i + 1) * 100))];
// 경로 위 s(m) 지점
const onPath = (s) => (s <= 1000 ? pt(s, 0) : pt(1000, s - 1000));

const guide = (index, pathIndex, extra = {}) => ({
  index,
  ...pt(0, 0),
  pathIndex,
  pointType: 'N',
  description: '',
  name: '',
  nextRoadName: '',
  ...extra,
});
const GUIDES = [
  guide(0, 0, { pointType: 'S', turnType: 200 }),
  guide(1, 10, { turnType: 13, description: '우회전', nextRoadName: '동로' }),
  guide(2, 20, { pointType: 'E', turnType: 201 }),
];

const route = (id, mode, extra = {}) => ({ id, source: 'api', mode, path: PATH, durationSec: mode === 'driving' ? 200 : 1600, guides: GUIDES, ...extra });
const DRIVE = route('r1', 'driving');
const WALK = route('w1', 'walking');

const fix = (position, tMs, accuracyM = 5) => ({ ...position, accuracyM, timestampMs: tMs });

// fixes 를 차례로 넣고 각 스냅샷을 모은다.
function replay(r, fixes, state = null) {
  const snapshots = [];
  for (const f of fixes) {
    const result = advance(state, f, r);
    state = result.state;
    snapshots.push(result.snapshot);
  }
  return { state, snapshots };
}

// 경로를 따라 stepM 씩, intervalMs 마다 한 번씩 위치를 만든다(시작~끝).
function along(startM, endM, stepM, intervalMs, t0 = 0) {
  const fixes = [];
  for (let s = startM, i = 0; s <= endM; s += stepM, i++) fixes.push(fix(onPath(s), t0 + i * intervalMs));
  return fixes;
}

// 재현 가능한 가짜 난수
function lcg(seed) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2; // -1 ~ 1
}

test('1. 자동차 정상 진행: 진행률은 줄지 않고, 이탈·재탐색 없이 도착 사건은 한 번', () => {
  const { snapshots } = replay(DRIVE, along(0, 2000, 15, 1000));
  for (let i = 1; i < snapshots.length; i++) assert.ok(snapshots[i].progressM >= snapshots[i - 1].progressM);
  assert.ok(snapshots.every((s) => s.status !== 'offRoute'));
  assert.equal(snapshots.filter((s) => s.events.includes('rerouteNeeded')).length, 0);
  assert.equal(snapshots.filter((s) => s.events.includes('arrived')).length, 1);
  const end = snapshots.at(-1);
  assert.equal(end.status, 'arrived');
  assert.equal(end.remainingM, 0);
  assert.equal(end.fraction, 1);
});

test('1. 진행 거리·남은 거리·다음 회전: 모서리 전과 후', () => {
  const { snapshots } = replay(DRIVE, [fix(onPath(500), 0), fix(onPath(1100), 40_000)]);
  const [before, after] = snapshots;
  assert.ok(Math.abs(before.progressM - 500) < 1);
  assert.ok(Math.abs(before.remainingM - 1500) < 1);
  assert.equal(before.nextTurn.guide.index, 1); // 출발(S) 지점은 건너뛴다
  assert.ok(Math.abs(before.nextTurn.distanceM - 500) < 1);
  assert.ok(before.lateralM < 1);
  assert.equal(after.nextTurn.guide.index, 2); // 모서리를 지나면 도착 지점
  assert.ok(Math.abs(after.nextTurn.distanceM - 900) < 1);
});

test('2. 도보 정상 진행', () => {
  const { snapshots } = replay(WALK, along(0, 2000, 10, 7000));
  for (let i = 1; i < snapshots.length; i++) assert.ok(snapshots[i].progressM >= snapshots[i - 1].progressM);
  assert.equal(snapshots.filter((s) => s.events.length > 0).map((s) => s.events.join()).join(), 'arrived');
  assert.equal(snapshots.at(-1).status, 'arrived');
});

test('3. 위치가 경로 밖으로 한 번 튀면 무시하고, 다음 정상 위치로 이어간다', () => {
  let { state } = replay(DRIVE, [fix(onPath(500), 0)]);
  const spike = advance(state, fix(pt(500, 600), 1000), DRIVE);
  assert.equal(spike.snapshot.fixUsed, false);
  assert.equal(spike.snapshot.ignoredReason, 'jump');
  assert.ok(Math.abs(spike.snapshot.progressM - 500) < 1);
  assert.equal(spike.snapshot.events.length, 0);
  const back = advance(spike.state, fix(onPath(515), 2000), DRIVE);
  assert.equal(back.snapshot.fixUsed, true);
  assert.ok(Math.abs(back.snapshot.progressM - 515) < 1);
  assert.equal(back.state.offRouteCount, 0);
});

test('3. 같은 곳이 연속으로 나오면 실제 이동(터널 통과 등)으로 받아들인다', () => {
  const { snapshots } = replay(DRIVE, [fix(onPath(100), 0), fix(onPath(1500), 1000), fix(onPath(1505), 2000), fix(onPath(1510), 3000)]);
  assert.deepEqual(snapshots.map((s) => s.ignoredReason), [null, 'jump', 'jump', null]);
  assert.ok(Math.abs(snapshots[3].progressM - 1510) < 1);
});

test('4. GPS 가 일시적으로 뒤로 가도 진행률은 줄지 않는다', () => {
  const { snapshots } = replay(DRIVE, [fix(onPath(800), 0), fix(onPath(770), 1000), fix(onPath(790), 2000), fix(onPath(820), 3000)]);
  assert.deepEqual(snapshots.map((s) => Math.round(s.progressM)), [800, 800, 800, 820]);
});

test('4. 좌우·앞뒤로 흔들리는 GPS 를 재생해도 진행률은 줄지 않고 이탈로 보지 않는다', () => {
  const noise = lcg(7);
  const fixes = [];
  for (let i = 0; i <= 100; i++) {
    const s = 200 + i * 12;
    const p = s <= 1000 ? pt(s + noise() * 8, noise() * 12) : pt(1000 + noise() * 12, s - 1000 + noise() * 8);
    fixes.push(fix(p, i * 1000, 10));
  }
  const { snapshots } = replay(DRIVE, fixes);
  for (let i = 1; i < snapshots.length; i++) assert.ok(snapshots[i].progressM >= snapshots[i - 1].progressM);
  assert.ok(snapshots.every((s) => s.status === 'onRoute' && !s.events.includes('rerouteNeeded')));
});

test('5. 정확도가 나쁜 위치는 판정에 쓰지 않는다(이탈로도 세지 않는다)', () => {
  const start = replay(DRIVE, [fix(onPath(300), 0)]).state;
  const bad = Array.from({ length: 10 }, (_, i) => fix(pt(300, 200), 1000 + i * 1000, 120));
  const { state, snapshots } = replay(DRIVE, bad, start);
  assert.ok(snapshots.every((s) => !s.fixUsed && s.ignoredReason === 'lowAccuracy' && s.status === 'onRoute' && s.events.length === 0));
  assert.equal(state.offRouteCount, 0);
});

test('5. 정확도가 나쁠수록 이탈 거리를 넓게 본다', () => {
  const start = replay(DRIVE, [fix(onPath(300), 0)]).state;
  const sharp = advance(start, fix(pt(300, 60), 1000, 5), DRIVE); // 한계 40m 초과 → 이탈 관측
  const fuzzy = advance(start, fix(pt(300, 60), 1000, 45), DRIVE); // 한계 max(40, 67.5) → 경로 위
  assert.equal(sharp.state.offRouteCount, 1);
  assert.equal(fuzzy.state.offRouteCount, 0);
});

test('8. 실제 이탈: 연속 관측과 시간 조건을 채워야 확정되고, 재탐색 요청은 한 번만 나온다', () => {
  let { state } = replay(DRIVE, [fix(onPath(300), 0)]);
  const sample = (t) => {
    const r = advance(state, fix(pt(300, 80), t), DRIVE);
    state = r.state;
    return r.snapshot;
  };
  assert.equal(sample(1000).status, 'onRoute'); // 1번째
  assert.equal(sample(2000).status, 'onRoute'); // 2번째
  assert.equal(sample(3000).status, 'onRoute'); // 3번째지만 첫 관측(1s)부터 2s 밖에 안 지났다
  const confirmed = sample(5000); // 4s 경과
  assert.equal(confirmed.status, 'offRoute');
  assert.deepEqual(confirmed.events, ['rerouteNeeded']);
  assert.ok(Math.abs(confirmed.lateralM - 80) < 1);
  for (let t = 6000; t <= 15_000; t += 1000) assert.deepEqual(sample(t).events, []); // 요청 중에는 다시 요청하지 않는다
  assert.ok(Math.abs(sample(16_000).progressM - 300) < 1); // 이탈 중에는 진행을 옮기지 않는다
});

test('8. 이탈 관측 중간에 경로로 돌아오면 처음부터 센다(단발 이상치로 확정하지 않는다)', () => {
  let { state } = replay(DRIVE, [fix(onPath(300), 0)]);
  const seq = [pt(300, 80), pt(300, 80), onPath(310), pt(310, 80), pt(310, 80)];
  for (const [i, p] of seq.entries()) {
    const r = advance(state, fix(p, 1000 + i * 3000), DRIVE);
    state = r.state;
    assert.notEqual(r.snapshot.status, 'offRoute');
    assert.equal(r.snapshot.events.length, 0);
  }
});

test('8. 재탐색이 실패하면 쿨다운이 지난 뒤에만 다시 요청한다', () => {
  let { state } = replay(DRIVE, [fix(onPath(300), 0)]);
  const events = [];
  for (let t = 1000; t <= 40_000; t += 1000) {
    let r = advance(state, fix(pt(300, 80), t), DRIVE);
    state = r.state;
    if (r.snapshot.events.includes('rerouteNeeded')) {
      events.push(t);
      state = rerouteFinished(state); // 요청이 (실패로) 끝났다
    }
  }
  // 첫 이탈 관측 1000ms + 4s = 5000ms 에 첫 요청, 쿨다운 20s 뒤 25000ms 에 두 번째(45000ms 는 범위 밖)
  assert.deepEqual(events, [5000, 25_000]);
});

test('9. 재탐색 후 새 경로 id 로 넘기면 이전 진행·이탈·도착 상태가 초기화된다', () => {
  const far = replay(DRIVE, [fix(onPath(1500), 0)]).state;
  assert.ok(far.progressM > 1400);
  // 같은 state 를 새 경로(id 다름)에 넣는다 — 이전 경로의 진행 거리가 따라오면 안 된다
  const newRoute = route('r2', 'driving');
  const r = advance(far, fix(onPath(50), 1000), newRoute);
  assert.equal(r.state.routeId, 'r2');
  assert.ok(Math.abs(r.snapshot.progressM - 50) < 1);
  assert.equal(r.state.rerouteInFlight, false);
  assert.equal(r.state.offRouteCount, 0);
  assert.equal(r.state.arrived, false);
});

test('10. 도착은 한 번만 알리고, 도착 뒤 위치는 무시한다', () => {
  const { state, snapshots } = replay(DRIVE, [fix(onPath(1960), 0), fix(onPath(1985), 1000), fix(onPath(1999), 2000), fix(onPath(1999), 3000), fix(onPath(1500), 4000)]);
  assert.deepEqual(snapshots.map((s) => s.events.join()), ['', '', 'arrived', '', '']);
  assert.equal(state.arrived, true);
  assert.equal(snapshots.at(-1).status, 'arrived');
  assert.equal(snapshots.at(-1).progressM, snapshots.at(-1).totalM);
});

test('10. 도착 반경 안이라도 한 번만 들어온 것으로는 도착이 아니다', () => {
  const { snapshots } = replay(DRIVE, [fix(onPath(1960), 0), fix(onPath(1990), 1000), fix(onPath(1960), 2000)]);
  assert.ok(snapshots.every((s) => !s.events.includes('arrived')));
});

test('10. 출발점과 도착점이 같은 경로에서 출발 직후를 도착으로 보지 않는다', () => {
  const loop = [pt(0, 0), pt(100, 0), pt(100, 100), pt(0, 100), pt(0, 0)];
  const r = route('loop', 'driving', { path: loop, guides: undefined });
  const { snapshots } = replay(r, [fix(pt(0, 0), 0), fix(pt(2, 0), 1000), fix(pt(4, 0), 2000)]);
  assert.ok(snapshots.every((s) => s.status === 'onRoute' && s.events.length === 0));
});

test('6. ETA: 경로 소요시간을 남은 거리 비율로 나눈 근사값이며 실시간 교통이 아니다', () => {
  const { snapshots } = replay(DRIVE, [fix(onPath(1000), 5000)]);
  const { eta } = snapshots[0];
  assert.ok(Math.abs(eta.remainingSec - 100) < 0.5);
  assert.ok(Math.abs(eta.arrivalAtMs - (5000 + 100_000)) < 500);
  assert.equal(eta.approximate, true);
  assert.equal(eta.realtimeTraffic, false);
});

test('6. 소요시간 정보가 없으면 ETA 를 만들지 않는다', () => {
  const { snapshots } = replay(route('r-no-eta', 'driving', { durationSec: undefined }), [fix(onPath(1000), 0)]);
  assert.equal(snapshots[0].eta, null);
  assert.ok(snapshots[0].remainingM > 0); // 남은 거리는 그대로 나온다
});

test('11. guides 가 없으면 다음 회전 안내는 없고 나머지는 정상 동작한다', () => {
  const { snapshots } = replay(route('r-no-guides', 'driving', { guides: undefined }), [fix(onPath(500), 0)]);
  assert.equal(snapshots[0].nextTurn, null);
  assert.ok(Math.abs(snapshots[0].remainingM - 1500) < 1);
});

test('12. 선택 필드가 빠진 guide(turnType 없음)도 다음 안내 지점으로 쓴다', () => {
  const partial = [guide(0, 0, { pointType: 'S' }), guide(1, 10, { pointType: '' })]; // turnType·leg 값 없음
  const { snapshots } = replay(route('r-partial', 'driving', { guides: partial }), [fix(onPath(500), 0)]);
  assert.equal(snapshots[0].nextTurn.guide.index, 1);
  assert.equal(snapshots[0].nextTurn.guide.turnType, undefined);
});

test('12. 직진(11) 안내는 다음 회전에서 건너뛰고, 경로 범위를 벗어난 pathIndex 는 끝점으로 본다', () => {
  const guides = [guide(0, 5, { turnType: 11 }), guide(1, 999, { turnType: 12 })];
  const { snapshots } = replay(route('r-clamp', 'driving', { guides }), [fix(onPath(100), 0)]);
  assert.equal(snapshots[0].nextTurn.guide.index, 1);
  assert.ok(Math.abs(snapshots[0].nextTurn.distanceM - 1900) < 1);
});

test('13. 자동차·도보 정책은 분리돼 있다: 같은 35m 이탈이 자동차는 경로 위, 도보는 이탈 관측', () => {
  assert.notDeepEqual(GUIDANCE_POLICY.driving, GUIDANCE_POLICY.walking);
  // 10초 간격이면 35m 이동은 점프가 아니다(3.5m/s)
  const drive = advance(replay(DRIVE, [fix(onPath(300), 0)]).state, fix(pt(300, 35), 10_000), DRIVE);
  const walk = advance(replay(WALK, [fix(onPath(300), 0)]).state, fix(pt(300, 35), 10_000), WALK);
  assert.equal(drive.state.offRouteCount, 0);
  assert.equal(walk.state.offRouteCount, 1);
});

test('13. 같은 도착 거리(22m)라도 자동차는 도착, 도보는 아직', () => {
  const near = [fix(pt(1000, 978), 0), fix(pt(1000, 978), 1000)];
  const nearPath = onPath(1978);
  assert.ok(Math.abs(nearPath.lng - near[0].lng) < 1e-9);
  const warmUp = (r) => replay(r, [fix(onPath(1900), -10_000)]).state;
  assert.ok(replay(DRIVE, near, warmUp(DRIVE)).snapshots.some((s) => s.events.includes('arrived')));
  assert.ok(replay(WALK, near, warmUp(WALK)).snapshots.every((s) => !s.events.includes('arrived')));
});

test('13. 위치 점프 기준도 다르다: 1초에 50m 는 자동차에선 정상, 도보에선 점프', () => {
  const drive = advance(replay(DRIVE, [fix(onPath(100), 0)]).state, fix(onPath(150), 1000), DRIVE);
  const walk = advance(replay(WALK, [fix(onPath(100), 0)]).state, fix(onPath(150), 1000), WALK);
  assert.equal(drive.snapshot.fixUsed, true);
  assert.equal(walk.snapshot.ignoredReason, 'jump');
});

test('잘못된 위치(NaN 좌표, 과거 시각)와 길이 0 인 경로는 안전하게 무시한다', () => {
  const start = replay(DRIVE, [fix(onPath(300), 5000)]).state;
  assert.equal(advance(start, { lat: NaN, lng: 127, accuracyM: 5, timestampMs: 6000 }, DRIVE).snapshot.ignoredReason, 'invalidFix');
  assert.equal(advance(start, fix(onPath(310), 1000), DRIVE).snapshot.ignoredReason, 'invalidFix'); // 직전 위치보다 과거
  const empty = route('r-empty', 'driving', { path: [pt(0, 0), pt(0, 0)] });
  assert.equal(advance(null, fix(pt(0, 0), 0), empty).snapshot.status, 'invalidRoute');
});

test('신호 끊김은 정책 시간 이후에만', () => {
  assert.equal(isSignalLost(null, 99_999, GUIDANCE_POLICY.driving), false);
  assert.equal(isSignalLost(0, 9_999, GUIDANCE_POLICY.driving), false);
  assert.equal(isSignalLost(0, 10_000, GUIDANCE_POLICY.driving), true);
  assert.equal(isSignalLost(0, 14_000, GUIDANCE_POLICY.walking), false);
});

// ───────────── 추적 컨트롤러(권한·정지/재시작·재탐색) ─────────────

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakePort(overrides = {}) {
  const port = {
    permission: 'granted',
    watchError: null,
    subscriptions: [],
    onFix: null,
    onError: null,
    ensurePermission: async () => port.permission,
    watch: async (onFix, onError) => {
      if (port.watchError) throw port.watchError;
      port.onFix = onFix;
      port.onError = onError;
      const sub = { removed: false, remove: () => (sub.removed = true) };
      port.subscriptions.push(sub);
      return sub;
    },
    ...overrides,
  };
  return port;
}

function setup(options = {}) {
  const port = options.port ?? fakePort();
  const views = [];
  let nowMs = 0;
  const tracker = createGuidanceTracker({ port, onChange: (v) => views.push(v), onReroute: options.onReroute, now: () => nowMs });
  return { port, tracker, views, last: () => views.at(-1), setNow: (v) => (nowMs = v) };
}

test('6. 위치 권한을 거부하면 failed(denied)이고 구독을 만들지 않는다', async () => {
  const t = setup({ port: fakePort({ permission: 'denied' }) });
  t.tracker.sync(DRIVE);
  await flush();
  assert.equal(t.last().phase, 'failed');
  assert.equal(t.last().failure, 'denied');
  assert.equal(t.port.subscriptions.length, 0);
});

test('6. 위치 서비스가 꺼져 있거나 구독이 실패하면 failed 와 이유를 알린다', async () => {
  const off = setup({ port: fakePort({ permission: 'servicesDisabled' }) });
  off.tracker.sync(DRIVE);
  await flush();
  assert.deepEqual([off.last().phase, off.last().failure], ['failed', 'servicesDisabled']);

  const broken = setup({ port: fakePort({ watchError: 'unavailable' }) });
  broken.tracker.sync(DRIVE);
  await flush();
  assert.deepEqual([broken.last().phase, broken.last().failure], ['failed', 'unavailable']);
});

test('7. 추적 시작 → 정지(구독 해제) → 재시작하면 진행 상태가 새로 시작된다', async () => {
  const t = setup();
  t.tracker.sync(DRIVE);
  await flush();
  assert.equal(t.last().phase, 'tracking');
  t.port.onFix(fix(onPath(800), 1000));
  assert.ok(Math.abs(t.last().snapshot.progressM - 800) < 1);

  t.tracker.sync(null); // 안내 종료
  assert.equal(t.port.subscriptions[0].removed, true);
  assert.equal(t.last().phase, 'idle');
  assert.equal(t.last().snapshot, null);

  t.tracker.sync(DRIVE); // 같은 경로로 다시 시작
  await flush();
  assert.equal(t.port.subscriptions.length, 2);
  assert.equal(t.last().snapshot, null);
  t.port.onFix(fix(onPath(100), 1000));
  assert.ok(Math.abs(t.last().snapshot.progressM - 100) < 1);
});

test('7. 앱이 백그라운드로 가면 구독만 끊고, 돌아오면 이어서(진행률 유지) 다시 구독한다', async () => {
  const t = setup();
  t.tracker.sync(DRIVE);
  await flush();
  t.port.onFix(fix(onPath(800), 1000));
  t.tracker.pause();
  assert.equal(t.port.subscriptions[0].removed, true);
  t.tracker.resume();
  await flush();
  assert.equal(t.port.subscriptions.length, 2);
  t.port.onFix(fix(onPath(790), 30_000)); // 돌아온 첫 위치가 조금 뒤여도 진행률은 줄지 않는다
  assert.ok(t.last().snapshot.progressM >= 800 - 1);
});

test('7. 정지한 뒤 늦게 도착한 위치·구독 응답은 무시한다', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const t = setup({ port: fakePort({ ensurePermission: async () => (await gate, 'granted') }) });
  t.tracker.sync(DRIVE);
  t.tracker.stop(); // 권한 확인을 기다리는 중에 정지
  release();
  await flush();
  assert.equal(t.port.subscriptions.length, 0);
  assert.equal(t.last().phase, 'idle');
});

test('신호가 끊기면 signalLost, 새 위치가 오면 다시 tracking', async () => {
  const t = setup();
  t.tracker.sync(DRIVE);
  await flush();
  t.port.onFix(fix(onPath(86), 0));
  t.port.onFix(fix(onPath(100), 1000)); // 초속 14m 로 움직이던 중
  t.setNow(9_000);
  t.tracker.checkSignal();
  assert.equal(t.last().phase, 'tracking');
  t.setNow(10_000);
  t.tracker.checkSignal();
  assert.equal(t.last().phase, 'signalLost');
  assert.ok(t.last().snapshot); // 마지막 진행 상태는 남아 있다
  t.port.onFix(fix(onPath(130), 12_000));
  assert.equal(t.last().phase, 'tracking');
});

test('멈춰 있거나 속도를 모르면(PC 브라우저처럼 위치가 드물게 오는 경우) 오래 위치가 안 와도 신호 끊김으로 보지 않는다', async () => {
  const still = setup();
  still.tracker.sync(DRIVE);
  await flush();
  still.port.onFix(fix(onPath(100), 0));
  still.port.onFix(fix(onPath(100), 1000)); // 같은 자리 → 속도 0
  still.setNow(120_000);
  still.tracker.checkSignal();
  assert.equal(still.last().phase, 'tracking');

  const once = setup();
  once.tracker.sync(DRIVE);
  await flush();
  once.port.onFix(fix(onPath(100), 0)); // 위치를 한 번만 받음 → 속도 모름
  once.setNow(120_000);
  once.tracker.checkSignal();
  assert.equal(once.last().phase, 'tracking');
});

test('10. 도착하면 위치 추적을 끝내고, 돌아와도 다시 구독하지 않는다', async () => {
  const t = setup();
  t.tracker.sync(DRIVE);
  await flush();
  t.port.onFix(fix(onPath(1985), 1000));
  t.port.onFix(fix(onPath(1999), 2000));
  assert.equal(t.last().phase, 'arrived');
  assert.equal(t.port.subscriptions[0].removed, true);
  t.tracker.resume();
  await flush();
  assert.equal(t.port.subscriptions.length, 1);
});

test('8·9. 이탈이 이어져도 재탐색은 한 번만 부르고, 새 경로를 주면 구독은 유지한 채 상태가 초기화된다', async () => {
  const calls = [];
  const t = setup({ onReroute: (f, r) => (calls.push(r.id), new Promise(() => {})) }); // 응답이 오지 않는 요청
  t.tracker.sync(DRIVE);
  await flush();
  t.port.onFix(fix(onPath(300), 0));
  for (let s = 1; s <= 30; s++) t.port.onFix(fix(pt(300, 80), s * 1000));
  assert.deepEqual(calls, ['r1']);
  assert.equal(t.last().snapshot.status, 'offRoute');

  t.tracker.sync(route('r2', 'driving')); // 재탐색 결과
  assert.equal(t.port.subscriptions.length, 1);
  assert.equal(t.port.subscriptions[0].removed, false);
  assert.equal(t.last().snapshot, null);
  t.port.onFix(fix(onPath(40), 40_000));
  assert.equal(t.last().snapshot.status, 'onRoute');
  assert.ok(Math.abs(t.last().snapshot.progressM - 40) < 1);
});

test('8. 재탐색 요청이 실패(reject)해도 쿨다운 뒤에는 다시 요청한다', async () => {
  const calls = [];
  const t = setup({ onReroute: async (f) => (calls.push(f.timestampMs), Promise.reject(new Error('network'))) });
  t.tracker.sync(DRIVE);
  await flush();
  t.port.onFix(fix(onPath(300), 0));
  for (let s = 1; s <= 30; s++) {
    t.port.onFix(fix(pt(300, 80), s * 1000));
    await flush();
  }
  assert.deepEqual(calls, [5000, 25_000]);
});

test('초기 상태 객체는 매번 새로 만들어진다(경로 간 공유 금지)', () => {
  assert.notEqual(initialState('a'), initialState('a'));
  assert.equal(initialState('a').progressM, 0);
});
