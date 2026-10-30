// C단계: 홈→길안내 화면 전달(세션 저장소)과 가상 GPS 재생, 컨트롤러가 지도에 넘기는 위치(position)를 검증한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createReplayPort, replayFixes, replayRerouteFrom } from '../src/dev/guidanceReplay.ts';
import { advance, createGuidanceTracker, GUIDANCE_POLICY } from '../src/lib/navigation/guidanceEngine.ts';
import { clearGuidanceRequest, getGuidanceRequest, guidanceTargetOf, setGuidanceRequest } from '../src/lib/navigation/guidanceSession.ts';

const O = { lat: 37.5, lng: 127.0 };
const D = { lat: 37.51, lng: 127.01 };

test('2. 선택한 경로 스타일로 안내 이동수단·스타일을 정한다(자동차 스타일은 그대로 유지)', () => {
  for (const style of ['recommended', 'toll_free', 'major_road', 'shortest', 'avoid_school_zone']) {
    assert.deepEqual(guidanceTargetOf(style), { mode: 'driving', style });
  }
  assert.deepEqual(guidanceTargetOf('walking'), { mode: 'walking', style: 'recommended' });
});

test('2. 자전거·대중교통은 실시간 길안내 대상이 아니다(기존 홈 동작 유지)', () => {
  assert.equal(guidanceTargetOf('cycling'), null);
  assert.equal(guidanceTargetOf('transit'), null);
});

test('1. 안내 요청은 메모리에만 있고 새 객체로 넣어야 새 요청으로 구분된다', () => {
  clearGuidanceRequest();
  assert.equal(getGuidanceRequest(), null);
  const first = { origin: O, destination: D, mode: 'driving', style: 'shortest', destinationLabel: '목적지' };
  setGuidanceRequest(first);
  assert.equal(getGuidanceRequest(), first);
  const second = { ...first };
  setGuidanceRequest(second);
  assert.notEqual(getGuidanceRequest(), first); // 같은 내용이라도 새 객체면 화면이 다시 불러온다
  assert.deepEqual(getGuidanceRequest().origin, O);
  clearGuidanceRequest();
  assert.equal(getGuidanceRequest(), null);
});

// ───────────── 가상 GPS 재생 ─────────────

const PATH = [
  { lat: 37.56, lng: 127.085 },
  { lat: 37.5446, lng: 127.0557 },
  { lat: 37.5321, lng: 127.0316 },
  { lat: 37.49, lng: 127.04 },
];
const route = (path = PATH, id = 'test') => ({ id, source: 'mock', mode: 'driving', path, durationSec: 900 });

test('가상 GPS(replay): 경로를 따라가며 이탈·재탐색 없이 도착한다', () => {
  const r = route();
  let state = null;
  const events = [];
  for (const fix of replayFixes(r.path, 'replay')) {
    const result = advance(state, fix, r);
    state = result.state;
    events.push(...result.snapshot.events);
    assert.notEqual(result.snapshot.status, 'offRoute');
  }
  assert.deepEqual(events, ['arrived']);
});

test('가상 GPS: 마지막 지점에서 멈춰 도착 판정에 필요한 연속 위치가 보장된다', () => {
  const fixes = replayFixes(PATH, 'replay', 2000); // 간격을 일부러 크게(2km) 잡아도
  const end = PATH.at(-1);
  const last3 = fixes.slice(-3);
  assert.ok(last3.every((f) => f.lat === end.lat && f.lng === end.lng));
  let state = null;
  const events = [];
  for (const fix of fixes) {
    const result = advance(state, fix, route());
    state = result.state;
    events.push(...result.snapshot.events);
  }
  assert.ok(events.includes('arrived'));
});

test('가상 GPS(offroute): 이탈이 확정돼 재탐색 요청이 나온다', () => {
  const r = route();
  let state = null;
  const events = [];
  for (const fix of replayFixes(r.path, 'offroute')) {
    const result = advance(state, fix, r);
    state = result.state;
    events.push(...result.snapshot.events);
  }
  assert.equal(events.filter((e) => e === 'rerouteNeeded').length, 1);
  assert.ok(events.includes('arrived'));
});

test('가상 GPS 의 위치 간격은 자동차 점프 기준보다 작다(정상 위치가 점프로 걸러지지 않는다)', () => {
  const fixes = replayFixes(PATH, 'replay', 40);
  const policy = GUIDANCE_POLICY.driving;
  for (let i = 1; i < fixes.length; i++) {
    const r = advance(null, fixes[i - 1], route());
    const next = advance(r.state, fixes[i], route());
    assert.equal(next.snapshot.fixUsed, true, `fix ${i}`);
  }
  assert.ok(40 < policy.jumpMinM);
});

test('가상 재탐색 경로: 현재 위치에서 시작해 원래 경로의 남은 점으로 이어진다', () => {
  const here = { lat: 37.545, lng: 127.056 };
  const next = replayRerouteFrom(here, PATH);
  assert.deepEqual(next[0], here);
  assert.deepEqual(next.at(-1), PATH.at(-1));
  assert.ok(next.length >= 2 && next.length < PATH.length + 1);
});

// ───────────── 컨트롤러 → 지도 위치(position) ─────────────

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakePort() {
  const port = {
    onFix: null,
    subscriptions: [],
    ensurePermission: async () => 'granted',
    watch: async (onFix) => {
      port.onFix = onFix;
      const sub = { removed: false, remove: () => (sub.removed = true) };
      port.subscriptions.push(sub);
      return sub;
    },
  };
  return port;
}

const LINE = [O, { lat: 37.5 + 2000 / 111320, lng: 127.0 }]; // 북쪽 2km
const at = (northM) => ({ lat: 37.5 + northM / 111320, lng: 127.0 });
const fix = (p, t, accuracyM = 5) => ({ ...p, accuracyM, timestampMs: t });

test('5·6. 지도에 넘기는 position 은 엔진이 받아들인 위치만 따른다(점프·낮은 정확도 위치는 무시)', async () => {
  const port = fakePort();
  const views = [];
  const tracker = createGuidanceTracker({ port, onChange: (v) => views.push(v) });
  tracker.sync(route(LINE));
  await flush();
  assert.equal(views.at(-1).position, null); // 첫 위치 전에는 마커가 없다

  port.onFix(fix(at(500), 1000));
  const accepted = views.at(-1).position;
  assert.ok(Math.abs(accepted.lat - at(500).lat) < 1e-9);

  port.onFix(fix({ lat: 37.5 + 500 / 111320, lng: 127.02 }, 2000)); // 1초에 1.7km: 점프
  assert.deepEqual(views.at(-1).position, accepted);
  assert.equal(views.at(-1).snapshot.ignoredReason, 'jump');

  port.onFix(fix(at(520), 3000, 200)); // 정확도 200m: 낮은 정확도
  assert.deepEqual(views.at(-1).position, accepted);
  assert.equal(views.at(-1).snapshot.ignoredReason, 'lowAccuracy');

  port.onFix(fix(at(530), 4000));
  assert.ok(Math.abs(views.at(-1).position.lat - at(530).lat) < 1e-9);
});

test('15·16. 도착하면 추적이 끝나도 마지막 위치와 도착 상태는 남고, 종료(stop)하면 모두 지워진다', async () => {
  const port = fakePort();
  const views = [];
  const tracker = createGuidanceTracker({ port, onChange: (v) => views.push(v) });
  tracker.sync(route(LINE));
  await flush();
  port.onFix(fix(at(1985), 1000));
  port.onFix(fix(at(1999), 2000));
  const arrived = views.at(-1);
  assert.equal(arrived.phase, 'arrived');
  assert.ok(arrived.position);
  assert.equal(port.subscriptions[0].removed, true);

  tracker.sync(null);
  assert.equal(views.at(-1).phase, 'idle');
  assert.equal(views.at(-1).position, null);
});

test('12·14. 재탐색으로 새 경로를 받아도 쿨다운은 이어진다(계속 벗어나 있어도 몇 초마다 재탐색하지 않는다)', async () => {
  const port = fakePort();
  const requests = [];
  const tracker = createGuidanceTracker({ port, onChange: () => {}, onReroute: (f, r) => requests.push([f.timestampMs, r.id]) });
  tracker.sync(route(LINE, 'a'));
  await flush();
  const east = (t, north = 300) => fix({ lat: 37.5 + north / 111320, lng: 127.0 + 0.001 }, t); // 경로에서 약 88m
  port.onFix(fix(at(300), 0));
  for (let t = 1000; t <= 6000; t += 1000) port.onFix(east(t));
  await flush();
  assert.deepEqual(requests, [[5000, 'a']]);

  tracker.sync(route(LINE, 'b')); // 재탐색 성공: 새 경로(그래도 계속 벗어난 상태)
  for (let t = 7000; t <= 24_000; t += 1000) port.onFix(east(t));
  await flush();
  assert.deepEqual(requests, [[5000, 'a']]); // 마지막 요청(5000ms) + 쿨다운 20s = 25000ms 전에는 다시 부르지 않는다
  port.onFix(east(25_000));
  await flush();
  assert.deepEqual(requests.map((r) => r[1]), ['a', 'b']);
});

test('17. 화면을 떠나(sync(null)) 구독이 해제되고, 다시 들어오면 새로 구독한다', async () => {
  const port = fakePort();
  const tracker = createGuidanceTracker({ port, onChange: () => {} });
  tracker.sync(route(LINE));
  await flush();
  tracker.sync(null);
  assert.equal(port.subscriptions[0].removed, true);
  tracker.sync(route(LINE));
  await flush();
  assert.equal(port.subscriptions.length, 2);
  assert.equal(port.subscriptions[1].removed, false);
});

test('가상 GPS 포트: 구독을 끊었다 이으면 이어서 보내고, 끝나면 멈춘다', async () => {
  const fixes = replayFixes(PATH, 'replay', 2000);
  const port = createReplayPort(fixes, 1);
  const got = [];
  const first = await port.watch((f) => got.push(f), () => {});
  await new Promise((r) => setTimeout(r, 15));
  first.remove();
  const countAtPause = got.length;
  assert.ok(countAtPause > 0);
  const second = await port.watch((f) => got.push(f), () => {});
  await new Promise((r) => setTimeout(r, 15));
  second.remove();
  assert.deepEqual(got.slice(0, 2).map((f) => f.timestampMs), [0, 1000]); // 처음부터 순서대로
  assert.equal(got[countAtPause].timestampMs, countAtPause * 1000); // 이어서 보낸다(처음부터 다시 보내지 않는다)
});
