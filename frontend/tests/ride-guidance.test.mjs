// 자전거·대중교통 길안내 순수 로직 검증. 응답 모양은 카카오 REST 실호출(2026-11)에서 확인한 것을 따른다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RIDE_POLICY } from '../src/lib/navigation/guidanceEngine.ts';
import { turnKindOf } from '../src/lib/navigation/guidanceDisplay.ts';
import {
  INITIAL_RIDE,
  WALK_ARRIVE_FIXES,
  applyFix,
  buildTasks,
  buildTransitPlan,
  confirmTask,
  cyclingGuides,
  hintFor,
  isFinished,
  legFraction,
  rideTotals,
  INITIAL_STOP_TRACK,
  advanceStopTrack,
  canTrackStops,
  stopMarkOf,
  stopStatusOf,
  turnTypeOfText,
  undoTask,
  bearingDeg,
} from '../src/lib/navigation/rideGuidance.ts';

// 경도 0.001 ≈ 88m (위도 37.5)
const P = (i) => ({ lat: 37.5, lng: 127 + i * 0.001 });
const path = [P(0), P(1), P(2), P(3), P(4), P(5)];
// 실제 카카오 응답처럼 구간 경계 점이 앞 구간 끝과 다음 구간 시작에 겹쳐 있다: 지하철 [0..2], 환승 도보 [3..4], 버스 [5..7]
const tpath = [P(0), P(1), P(2), P(2), P(3), P(3), P(4), P(5)];

// ── 자전거 ──

test('안내 문구에 방향이 있을 때만 방향 코드가 된다', () => {
  assert.equal(turnTypeOfText('광화문교차로에서 좌회전 후 43m 이동'), 12);
  assert.equal(turnTypeOfText('우회전 후 278m 이동'), 13);
  assert.equal(turnTypeOfText('U턴 후 10m 이동'), 14);
  assert.equal(turnTypeOfText('횡단보도 이용'), undefined);
  assert.equal(turnTypeOfText('527m 이동'), undefined);
});

test('자전거 안내 지점: 경로 점에 맞는 문구만 지점이 되고 끝에 도착 지점이 붙는다', () => {
  const guides = cyclingGuides(path, [
    { text: '세종대로20길 109m 이동', point: P(0) },
    { text: '횡단보도 이용', point: P(2) },
    { text: '광화문교차로에서 좌회전 후 43m 이동', point: P(4) },
    { text: '좌표 없는 문구', point: null },
  ]);
  assert.deepEqual(guides.map((g) => [g.pathIndex, g.pointType, g.turnType]), [[0, 'S', undefined], [2, 'N', undefined], [4, 'N', 12], [5, 'E', undefined]]);
  assert.equal(turnKindOf(guides[2]), 'left');
  assert.equal(turnKindOf(guides[1]), 'generic'); // 방향 없는 문구는 일반 안내(문구 그대로)
  assert.equal(turnKindOf(guides[3]), 'arrive');
});

test('경로 점과 10m 넘게 어긋난 문구는 좌표를 지어내지 않고 버린다', () => {
  const far = { lat: 37.5005, lng: 127.0021 }; // P(2) 에서 약 55m
  const guides = cyclingGuides(path, [{ text: '우회전 후 10m 이동', point: far }]);
  assert.deepEqual(guides.map((g) => g.pointType), ['E']);
});

test('안내 지점은 경로 순서를 거슬러 가지 않는다', () => {
  const guides = cyclingGuides(path, [
    { text: '우회전 후 10m 이동', point: P(3) },
    { text: '좌회전 후 10m 이동', point: P(1) }, // 앞 지점보다 뒤에서만 찾으므로 P(1) 근처가 없어 버려진다
  ]);
  assert.deepEqual(guides.map((g) => g.pathIndex), [3, 5]);
});

test('경로가 점 하나뿐이면 안내 지점을 만들지 않는다', () => {
  assert.deepEqual(cyclingGuides([P(0)], [{ text: 'x', point: P(0) }]), []);
});

test('이동 방위: 동쪽 90도, 북쪽 0도, 같은 점은 null', () => {
  assert.equal(Math.round(bearingDeg(P(0), P(1))), 90);
  assert.equal(Math.round(bearingDeg(P(0), { lat: 37.501, lng: 127 })), 0);
  assert.equal(bearingDeg(P(0), P(0)), null);
});

test('자전거·대중교통 정책의 모든 값이 숫자다', () => {
  for (const mode of ['cycling', 'transit']) {
    const policy = RIDE_POLICY[mode];
    assert.ok(policy && Object.values(policy).every((v) => Number.isFinite(v)), mode);
  }
});

// ── 대중교통: 구간 ──

const step = (type, extra = {}) => ({ type, distanceM: 1000, timeSec: 300, stops: [], vehicles: [], ...extra });
// 지하철(tpath 0~2) - 환승 도보(3~4) - 버스(5~7)
const option = (steps) => ({ type: 'BUS_AND_SUBWAY', distanceKm: 6, durationMin: 20, transfers: 1, fare: 1650, path: tpath, instructions: [], steps });
const threeSteps = () =>
  option([
    step('SUBWAY', { pathStartIndex: 0, stops: [{ name: 'A' }, { name: 'M' }, { name: 'B' }], vehicles: [{ name: '2호선' }, { name: '2호선' }] }),
    step('WALKING', { pathStartIndex: 3, distanceM: 120, timeSec: 150, stops: [{ name: 'B' }, { name: 'B' }] }),
    step('BUS', { pathStartIndex: 5, stops: [{ name: 'C' }, { name: 'D' }], vehicles: [{ name: '종로11', type: '마을' }] }),
  ]);

test('구간 좌표: pathStartIndex 로 구간의 시작·끝 위치를 정하고 이름·노선을 담는다', () => {
  const { legs, path: planPath } = buildTransitPlan(threeSteps(), P(0), P(5));
  assert.equal(planPath.length, 8); // 출발지·도착지가 path 끝과 같아 붙는 직선이 없다
  assert.deepEqual(legs.map((l) => [l.kind, l.startIndex, l.endIndex, l.transfer]), [['subway', 0, 2, false], ['walk', 3, 4, true], ['bus', 5, 7, false]]);
  assert.deepEqual([legs[0].fromName, legs[0].toName, legs[0].lineName, legs[0].stopCount], ['A', 'B', '2호선', 2]);
  assert.deepEqual(legs[0].stopNames, ['A', 'M', 'B']); // API 가 준 정거장 이름 그대로(승차·중간·하차)
  assert.deepEqual(legs[1].stopNames, []); // 도보 구간은 정거장 목록을 갖지 않는다
  assert.deepEqual(legs[2].startPoint, P(3));
  assert.deepEqual(legs[0].endPoint, legs[1].startPoint); // 겹친 경계 점
  assert.equal(legs[0].endM > 0, true);
});

test('출발지·도착지가 멀면 도보 구간을 앞뒤에 붙이고 안내 경로에 한 점씩 더한다', () => {
  const origin = { lat: 37.5, lng: 126.998 }; // P(0) 에서 약 176m
  const destination = { lat: 37.5, lng: 127.007 }; // P(5) 에서 약 176m
  const { legs, path: planPath } = buildTransitPlan(threeSteps(), origin, destination);
  assert.equal(planPath.length, 10);
  assert.deepEqual(legs.map((l) => [l.kind, l.source]), [['walk', 'access'], ['subway', 'step'], ['walk', 'step'], ['bus', 'step'], ['walk', 'egress']]);
  assert.deepEqual([legs[1].startIndex, legs[1].endIndex], [1, 3]); // 앞에 출발지 점이 하나 붙어 한 칸씩 밀린다
  assert.equal(legs[0].toName, 'A');
  assert.equal(legs[0].timeSec, null); // 직선 도보는 시간을 모른다
  assert.equal(Math.round(legs[0].distanceM / 10), 18);
});

test('옛 서버처럼 pathStartIndex 가 없으면 구간 좌표를 만들어내지 않는다', () => {
  const noIndex = threeSteps();
  noIndex.steps.forEach((s) => delete s.pathStartIndex);
  const { legs } = buildTransitPlan(noIndex, P(0), P(5));
  assert.equal(legs.length, 3);
  assert.ok(legs.every((l) => l.startIndex === null && l.endIndex === null && l.startPoint === null));
});

test('pathStartIndex 가 순서를 어기거나 범위 밖이면 전체를 믿지 않는다', () => {
  const swapped = threeSteps();
  swapped.steps[1].pathStartIndex = 5;
  swapped.steps[2].pathStartIndex = 3;
  assert.ok(buildTransitPlan(swapped, P(0), P(5)).legs.every((l) => l.startIndex === null));
  const outside = threeSteps();
  outside.steps[2].pathStartIndex = 99;
  assert.ok(buildTransitPlan(outside, P(0), P(5)).legs.every((l) => l.startIndex === null));
});

test('좌표가 없는 구간(null) 뒤 구간도 올바른 끝을 갖는다', () => {
  const o = option([
    step('SUBWAY', { pathStartIndex: 0, stops: [{ name: 'A' }, { name: 'B' }] }),
    step('WALKING', { stops: [] }), // 좌표 없음
    step('BUS', { pathStartIndex: 3, stops: [{ name: 'C' }, { name: 'D' }] }),
  ]);
  const { legs } = buildTransitPlan(o, P(0), P(5));
  assert.deepEqual(legs.map((l) => [l.startIndex, l.endIndex]), [[0, 2], [null, null], [3, 7]]);
});

test('구간이 없는 경로는 안내할 구간이 없다', () => {
  assert.equal(buildTransitPlan(option([]), P(0), P(5)).legs.length, 0);
});

// ── 대중교통: 진행 ──

const plan = () => buildTransitPlan(threeSteps(), { lat: 37.5, lng: 126.998 }, { lat: 37.5, lng: 127.007 });
const fixAt = (point, ts, accuracyM = 10) => ({ lat: point.lat, lng: point.lng, accuracyM, timestampMs: ts });

test('단계: 도보는 한 단계, 버스·지하철은 탑승과 이동 두 단계', () => {
  const { legs } = plan();
  assert.deepEqual(buildTasks(legs).map((t) => t.kind), ['walk', 'board', 'ride', 'walk', 'board', 'ride', 'walk']);
});

test('도보 단계는 도착 반경 안에서 연속 3번 위치를 받아야 넘어간다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  const end = legs[0].endPoint;
  let state = INITIAL_RIDE;
  for (let i = 0; i < WALK_ARRIVE_FIXES - 1; i++) state = applyFix(state, tasks, legs, fixAt(end, 1000 + i), 1000 + i);
  assert.equal(state.taskIndex, 0);
  state = applyFix(state, tasks, legs, fixAt(end, 1010), 1010);
  assert.equal(state.taskIndex, 1);
  assert.equal(tasks[state.taskIndex].kind, 'board');
});

test('같은 위치(같은 시각)를 여러 번 받아도 한 번만 센다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  let state = INITIAL_RIDE;
  for (let i = 0; i < 10; i++) state = applyFix(state, tasks, legs, fixAt(legs[0].endPoint, 1000), 1000);
  assert.equal(state.taskIndex, 0);
  assert.equal(state.arrivalCount, 1);
});

test('중간에 반경 밖 위치가 끼면 다시 센다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  const end = legs[0].endPoint;
  let state = INITIAL_RIDE;
  state = applyFix(state, tasks, legs, fixAt(end, 1000), 1000);
  state = applyFix(state, tasks, legs, fixAt(end, 1001), 1001);
  state = applyFix(state, tasks, legs, fixAt(P(5), 1002), 1002); // 멀리
  assert.equal(state.arrivalCount, 0);
  state = applyFix(state, tasks, legs, fixAt(end, 1003), 1003);
  assert.equal(state.taskIndex, 0);
});

test('정확도가 나쁘거나 모르거나 오래된 위치로는 넘어가지 않는다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  const end = legs[0].endPoint;
  for (const [fix, now] of [[fixAt(end, 1000, 80), 1000], [fixAt(end, 1000, null), 1000], [fixAt(end, 1000), 1000 + 60_000]]) {
    let state = INITIAL_RIDE;
    for (let i = 0; i < 5; i++) state = applyFix(state, tasks, legs, { ...fix, timestampMs: fix.timestampMs + i }, now + i);
    assert.equal(state.taskIndex, 0);
  }
});

test('탑승·이동 단계는 GPS 가 어디를 가리켜도 자동으로 넘어가지 않는다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  for (const start of [1, 2]) {
    let state = { ...INITIAL_RIDE, taskIndex: start };
    for (let i = 0; i < 10; i++) state = applyFix(state, tasks, legs, fixAt(legs[tasks[start].legIndex].endPoint, 2000 + i), 2000 + i);
    assert.equal(state.taskIndex, start);
  }
});

test('수동 확인은 한 단계씩만 앞으로 가고 끝에서 멈춘다. 되돌린 도보 단계는 자동으로 다시 넘어가지 않는다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  let state = INITIAL_RIDE;
  for (let i = 0; i < tasks.length; i++) state = confirmTask(state, tasks);
  assert.equal(isFinished(state, tasks), true);
  assert.equal(confirmTask(state, tasks).taskIndex, tasks.length);

  state = { ...INITIAL_RIDE, taskIndex: 1 };
  state = undoTask(state); // 도보 단계로 되돌림
  for (let i = 0; i < 5; i++) state = applyFix(state, tasks, legs, fixAt(legs[0].endPoint, 3000 + i), 3000 + i);
  assert.equal(state.taskIndex, 0);
  assert.equal(undoTask(INITIAL_RIDE).taskIndex, 0);
});

test('근처 힌트는 탑승 지점·하차 지점 근처에서만 나오고, 정확도가 나쁘면 나오지 않는다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  assert.equal(hintFor(tasks[1], legs[1], fixAt(legs[1].startPoint, 1000), 1000), 'nearBoard');
  assert.equal(hintFor(tasks[1], legs[1], fixAt(legs[1].endPoint, 1000), 1000), null); // 탑승 단계에서 하차 지점은 힌트가 아니다
  assert.equal(hintFor(tasks[2], legs[1], fixAt(legs[1].endPoint, 1000), 1000), 'nearAlight');
  assert.equal(hintFor(tasks[2], legs[1], fixAt(legs[1].endPoint, 1000, 90), 1000), null);
  assert.equal(hintFor(tasks[2], legs[1], null, 1000), null);
});

test('남은 거리·시간: 지금 구간은 지난 만큼 빼고 뒤 구간은 전부 남는다. 탑승 전에는 빼지 않는다', () => {
  const { legs } = plan();
  const tasks = buildTasks(legs);
  const total = legs.reduce((s, l) => s + l.distanceM, 0);
  const atStart = rideTotals(legs, tasks, 0, 0);
  assert.equal(Math.round(atStart.remainingM), Math.round(total));
  assert.equal(atStart.fraction, 0);
  // legs[1] = 지하철(1000m, 300s). 이동 단계에서 절반 지났다
  const half = rideTotals(legs, tasks, 2, 0.5);
  const after = legs.slice(2).reduce((s, l) => s + l.distanceM, 0);
  assert.equal(Math.round(half.remainingM), Math.round(500 + after));
  // 같은 구간이라도 탑승 단계에서는 지난 만큼이 없다
  assert.equal(Math.round(rideTotals(legs, tasks, 1, 0.9).remainingM), Math.round(1000 + after));
  assert.equal(rideTotals(legs, tasks, tasks.length, 0).remainingM, 0);
  // 시간: 직선 도보는 시간을 모르므로 아는 구간만 더한다
  assert.equal(rideTotals(legs, tasks, 0, 0).remainingSec, 300 + 150 + 300);
});

test('구간 진행률은 경로 위 진행 거리로 구하고, 구간 좌표를 모르면 0 이다', () => {
  const { legs } = plan();
  const mid = (legs[1].startM + legs[1].endM) / 2;
  assert.equal(Math.round(legFraction(legs[1], mid) * 100), 50);
  assert.equal(legFraction(legs[1], 0), 0);
  assert.equal(legFraction(legs[1], 1e9), 1);
  assert.equal(legFraction({ ...legs[1], startM: null }, mid), 0);
});

// ── 현재 정거장 자동 판정 ──

// 정거장 5개가 동쪽으로 약 1km(경도 0.0113) 간격. 경로 거리는 정거장 순서대로 0, 1000, 2000 ...(m) 근처다.
const STOP_LNG = (i) => 127 + i * 0.0113;
const stopPoint = (i) => ({ lat: 37.5, lng: STOP_LNG(i) });
const POINTS = [0, 1, 2, 3, 4].map(stopPoint);
const OFFSETS = [0, 1000, 2000, 3000, 4000];
const fixNear = (i, ts, accuracyM = 15, dLng = 0) => ({ lat: 37.5, lng: STOP_LNG(i) + dLng, accuracyM, timestampMs: ts });
const stepTrack = (track, fix, over = {}) =>
  advanceStopTrack(track, { points: POINTS, offsets: OFFSETS, fix, nowMs: fix ? fix.timestampMs : 0, progressM: over.progressM ?? 1000, onRoute: over.onRoute ?? true });
const confirmAt = (track, i, startTs, progressM) => {
  for (let k = 0; k < 3; k++) track = stepTrack(track, fixNear(i, startTs + k), { progressM });
  return track;
};

test('구간 정거장 좌표: 서버가 검증한 정거장만 점과 경로상 위치를 갖고, 나머지는 null 이다', () => {
  const o = option([
    step('SUBWAY', {
      pathStartIndex: 0,
      stops: [
        { name: 'A', lat: P(0).lat, lng: P(0).lng, matchConfidence: 'high' },
        { name: 'M', lat: null, lng: null, matchConfidence: null }, // 매칭 못 함
        { name: 'B', lat: P(2).lat, lng: P(2).lng, matchConfidence: 'medium' },
      ],
    }),
    step('WALKING', { pathStartIndex: 3 }),
    step('BUS', { pathStartIndex: 5, stops: [{ name: 'C' }, { name: 'D' }] }), // 옛 서버: 좌표 필드 없음
  ]);
  const { legs } = buildTransitPlan(o, P(0), P(5));
  assert.deepEqual(legs[0].stopPoints, [P(0), null, P(2)]);
  assert.equal(legs[0].stopOffsets[1], null);
  assert.ok(legs[0].stopOffsets[2] > legs[0].stopOffsets[0]); // 경로를 따라 앞쪽
  assert.deepEqual(legs[2].stopPoints, [null, null]);
  assert.equal(canTrackStops(legs[0]), true); // 좌표가 있는 정거장이 2개
  assert.equal(canTrackStops(legs[2]), false);
});

test('경로에서 150m 넘게 떨어진 정거장 좌표는 쓰지 않는다', () => {
  const o = option([step('SUBWAY', { pathStartIndex: 0, stops: [{ name: 'A', lat: 37.52, lng: P(0).lng }, { name: 'B', lat: P(2).lat, lng: P(2).lng }] })]);
  const { legs } = buildTransitPlan(o, P(0), P(5));
  assert.deepEqual(legs[0].stopPoints, [null, P(2)]);
});

test('정거장 반경 안에서 같은 정거장이 연속 3번 확인되어야 현재 정거장이 된다', () => {
  let track = stepTrack(INITIAL_STOP_TRACK, fixNear(1, 1000), { progressM: 1000 });
  track = stepTrack(track, fixNear(1, 1001), { progressM: 1000 });
  assert.equal(track.index, null);
  track = stepTrack(track, fixNear(1, 1002), { progressM: 1000 });
  assert.equal(track.index, 1);
  assert.equal(track.near, true);
});

test('같은 위치(같은 시각)를 여러 번 받아도 한 번만 센다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let i = 0; i < 10; i++) track = stepTrack(track, fixNear(1, 1000));
  assert.equal(track.index, null);
  assert.equal(track.streak, 1);
});

test('가장 가까운 정거장이라는 이유만으로는 정하지 않는다: 반경 밖이면 확정하지 않는다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 6; k++) track = stepTrack(track, fixNear(1, 1000 + k, 15, 0.0045), { progressM: 1400 }); // 정거장 1 에서 약 400m 떨어진 곳
  assert.equal(track.index, null);
});

test('두 정거장에서 거의 같은 거리면(차이 100m 미만) 확정하지 않는다', () => {
  const close = { points: [stopPoint(0), { lat: 37.5, lng: STOP_LNG(0) + 0.0009 }], offsets: [0, 80] };
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 6; k++) track = advanceStopTrack(track, { ...close, fix: fixNear(0, 1000 + k, 15, 0.00045), nowMs: 1000 + k, progressM: 40, onRoute: true });
  assert.equal(track.index, null);
});

test('엔진이 잰 경로 진행 거리와 정거장 위치가 크게 어긋나면 확정하지 않는다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 6; k++) track = stepTrack(track, fixNear(3, 1000 + k), { progressM: 500 }); // 정거장 3(3000m)인데 진행은 500m
  assert.equal(track.index, null);
});

test('정확도가 나쁘거나 모르거나 오래된 위치, 경로 이탈 중인 위치로는 판정하지 않는다', () => {
  const cases = [
    [fixNear(1, 1000, 90), 1000, true],
    [fixNear(1, 1000, null), 1000, true],
    [fixNear(1, 1000), 1000 + 60_000, true],
    [fixNear(1, 1000), 1000, false],
  ];
  for (const [fix, now, onRoute] of cases) {
    let track = INITIAL_STOP_TRACK;
    for (let k = 0; k < 6; k++) track = advanceStopTrack(track, { points: POINTS, offsets: OFFSETS, fix: { ...fix, timestampMs: fix.timestampMs + k }, nowMs: now + k, progressM: 1000, onRoute });
    assert.equal(track.index, null);
  }
});

test('GPS 가 끊기면 마지막 확인 정거장을 유지하고 near 만 끈다. 다음 정거장으로 옮기지 않는다', () => {
  let track = confirmAt(INITIAL_STOP_TRACK, 1, 1000, 1000);
  assert.equal(track.index, 1);
  track = advanceStopTrack(track, { points: POINTS, offsets: OFFSETS, fix: null, nowMs: 90_000, progressM: 1000, onRoute: true });
  assert.equal(track.index, 1);
  assert.equal(track.near, false);
  assert.equal(stopMarkOf(track, 90_000, true).near, false); // 화면: 마지막 확인 위치
});

test('최근 15초 안에 유효한 위치가 있으면 인근, 15초를 넘기면 마지막 확인 위치로 바뀐다(속도와 무관하게)', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 3; k++) track = stepTrack(track, fixNear(1, 1000 + k));
  const last = 1002;
  assert.equal(stopMarkOf(track, last + 1000, true).near, true);
  assert.equal(stopMarkOf(track, last + 15_000, true).near, true); // 경계: 15초 이내
  assert.equal(stopMarkOf(track, last + 15_001, true).near, false); // 새 위치가 없으면 오래된 위치를 현재로 보여주지 않는다
  assert.equal(stopMarkOf(track, last + 15_001, true).index, 1); // 마지막 확인 정거장은 유지
  assert.equal(stopMarkOf(INITIAL_STOP_TRACK, 5, true), undefined);
});

test('열차가 서 있다가 출발해도(새 위치 없음) 15초 뒤에는 이전 역을 현재 위치로 표시하지 않는다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 3; k++) track = stepTrack(track, fixNear(1, 1000 + k));
  const mark = stopMarkOf(track, 1002 + 30_000, true); // 30초 동안 새 위치가 없었다
  assert.equal(mark.near, false);
  assert.equal(mark.index, 1);
});

test('위치 추적이 끊기거나 실패한 상태면(tracking=false) 즉시 마지막 확인 위치로만 보인다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 3; k++) track = stepTrack(track, fixNear(1, 1000 + k));
  assert.equal(stopMarkOf(track, 1003, true).near, true);
  assert.equal(stopMarkOf(track, 1003, false).near, false);
  assert.equal(stopMarkOf(track, 1003, false).index, 1); // 마지막 확인 정거장은 유지
});

test('정확도가 나빠진 위치가 오면 즉시 near 를 끈다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 3; k++) track = stepTrack(track, fixNear(1, 1000 + k));
  track = stepTrack(track, fixNear(1, 1010, 90));
  assert.equal(stopMarkOf(track, 1010, true).near, false);
  assert.equal(track.index, 1);
});

test('위치가 오래 끊겨도 다음 정거장으로 자동 이동하지 않는다', () => {
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 3; k++) track = stepTrack(track, fixNear(1, 1000 + k));
  for (const gapMs of [20_000, 120_000, 600_000]) {
    track = advanceStopTrack(track, { points: POINTS, offsets: OFFSETS, fix: null, nowMs: 1002 + gapMs, progressM: 1000, onRoute: true });
    assert.equal(track.index, 1);
    assert.equal(stopMarkOf(track, 1002 + gapMs, true).index, 1);
  }
});

// ── 버스 정류장 자동 판정 (TAGO 로 확정된 정류장 좌표) ──

// 정류장 6개가 동쪽으로 약 250m 간격(경도 0.0028)인 버스 구간. 서버가 확정한 좌표만 있고, 확정 못 한 정류장은 null 이다.
const BUS_LNG = (i) => 127 + i * 0.0028;
const busStopsApi = [0, 1, 2, 3, 4, 5].map((i) => ({ name: `정류장${i}`, lat: 37.5, lng: BUS_LNG(i), matchConfidence: 'high' }));
const busOption = (stops) => ({
  type: 'BUS', distanceKm: 1.5, durationMin: 10, transfers: 0, fare: 1500, instructions: [],
  path: [0, 1, 2, 3, 4, 5].flatMap((i) => [{ lat: 37.5, lng: BUS_LNG(i) }, { lat: 37.5, lng: BUS_LNG(i) + 0.0014 }]).slice(0, 11),
  steps: [{ type: 'BUS', distanceM: 1500, timeSec: 600, stops, vehicles: [{ name: '31', type: '일반' }], pathStartIndex: 0 }],
});

test('버스 구간도 서버가 확정한 정류장 좌표가 둘 이상이면 자동 판정 대상이고, 좌표가 없으면 아니다', () => {
  const origin = { lat: 37.5, lng: BUS_LNG(0) };
  const dest = { lat: 37.5, lng: BUS_LNG(5) };
  const { legs } = buildTransitPlan(busOption(busStopsApi), origin, dest);
  const bus = legs.find((l) => l.kind === 'bus');
  assert.equal(canTrackStops(bus), true);
  assert.equal(bus.stopPoints.filter(Boolean).length, 6);
  const none = buildTransitPlan(busOption(busStopsApi.map((s) => ({ name: s.name, lat: null, lng: null, matchConfidence: null }))), origin, dest).legs.find((l) => l.kind === 'bus');
  assert.equal(canTrackStops(none), false); // 확정 못 한 구간은 판정하지 않는다(좌표를 만들어내지 않는다)
});

test('버스 정류장 사이 250m: 정류장 반경 안에서 연속 확인되면 그 정류장이 되고, 정류장 사이(약 125m)에서는 확정하지 않는다', () => {
  const { legs, path } = buildTransitPlan(busOption(busStopsApi), { lat: 37.5, lng: BUS_LNG(0) }, { lat: 37.5, lng: BUS_LNG(5) });
  const bus = legs.find((l) => l.kind === 'bus');
  const input = (fix, progressM) => ({ points: bus.stopPoints, offsets: bus.stopOffsets, fix, nowMs: fix.timestampMs, progressM, onRoute: true });
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 3; k++) track = advanceStopTrack(track, input({ lat: 37.5, lng: BUS_LNG(2), accuracyM: 12, timestampMs: 1000 + k }, bus.stopOffsets[2]));
  assert.equal(track.index, 2);
  let between = INITIAL_STOP_TRACK;
  for (let k = 0; k < 6; k++) between = advanceStopTrack(between, input({ lat: 37.5, lng: (BUS_LNG(2) + BUS_LNG(3)) / 2, accuracyM: 12, timestampMs: 2000 + k }, (bus.stopOffsets[2] + bus.stopOffsets[3]) / 2));
  assert.equal(between.index, null);
});

test('버스 정류장이 100m 이내로 붙어 있으면(인접 정류장과 구분 불가) 확정하지 않는다', () => {
  const close = [{ name: 'a', lat: 37.5, lng: 127.0, matchConfidence: 'high' }, { name: 'b', lat: 37.5, lng: 127.0009, matchConfidence: 'high' }, { name: 'c', lat: 37.5, lng: 127.006, matchConfidence: 'high' }];
  const points = close.map((s) => ({ lat: s.lat, lng: s.lng }));
  let track = INITIAL_STOP_TRACK;
  for (let k = 0; k < 8; k++) track = advanceStopTrack(track, { points, offsets: [0, 80, 520], fix: { lat: 37.5, lng: 127.00045, accuracyM: 10, timestampMs: 1000 + k }, nowMs: 1000 + k, progressM: 40, onRoute: true });
  assert.equal(track.index, null);
});
