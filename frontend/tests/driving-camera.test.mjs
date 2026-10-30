// 차량 길안내 화면: 방향 안정화, 앞쪽 경로, 속도별 확대 단계, 카메라 이동 판단, 속도·제한속도 표시값.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AHEAD_RATIO_X,
  AHEAD_RATIO_Y,
  angleDiff,
  bearingDeg,
  buildPathIndex,
  carOffsetPx,
  CAMERA_MIN_MOVE_M,
  FOLLOW_LEVEL_MAX,
  FOLLOW_LEVEL_MIN,
  HEADING_MIN_MOVE_M,
  INITIAL_HEADING,
  LEVEL_MIN_DWELL_MS,
  nextFollowLevel,
  pathAhead,
  pointAtDistance,
  routeBearingAt,
  shouldMoveCamera,
  smoothAngle,
  unwrapAngle,
  updateHeading,
} from '../src/lib/navigation/drivingCamera.ts';
import { LIMIT_SHOW_AHEAD_M, LIMIT_SHOW_BEHIND_M, nearSchoolZone, speedKmhOf } from '../src/lib/navigation/drivingDisplay.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
const at = (northM, eastM = 0) => ({ lat: 37.5 + northM / M, lng: 127 + eastM / (M * K) });
// 북쪽으로 1000m 가다가 동쪽으로 1000m 가는 ㄱ자 경로
const L_PATH = [at(0), at(1000), at(1000, 1000)];

test('방위각: 북 0, 동 90, 남 180, 서 270', () => {
  assert.equal(Math.round(bearingDeg(at(0), at(100))), 0);
  assert.equal(Math.round(bearingDeg(at(0), at(0, 100))), 90);
  assert.equal(Math.round(bearingDeg(at(0), at(-100))), 180);
  assert.equal(Math.round(bearingDeg(at(0), at(0, -100))), 270);
});

test('각도: 가장 짧은 쪽으로 차이를 재고, 359 → 1 도 2도 차이다', () => {
  assert.equal(angleDiff(359, 1), 2);
  assert.equal(angleDiff(1, 359), -2);
  assert.equal(angleDiff(10, 190), -180);
  assert.equal(Math.round(smoothAngle(350, 10, 0.5)), 0);
  // 마커 회전은 한 바퀴 거꾸로 돌지 않게 이어지는 각도로
  assert.equal(unwrapAngle(359, 1), 361);
  assert.equal(unwrapAngle(361, 359), 359);
  assert.equal(unwrapAngle(null, 90), 90);
});

test('경로 위 위치와 방향: 구간이 바뀌면 방향이 바뀌고, 끝에서는 마지막 구간 방향을 쓴다', () => {
  const index = buildPathIndex(L_PATH);
  assert.ok(Math.abs(index.totalM - 2000) < 2);
  assert.equal(Math.round(routeBearingAt(index, 100)), 0);
  assert.equal(Math.round(routeBearingAt(index, 1500)), 90);
  assert.equal(Math.round(routeBearingAt(index, index.totalM)), 90); // 도착 지점
  assert.equal(Math.round(routeBearingAt(index, 5000)), 90); // 범위 밖
  assert.equal(routeBearingAt(buildPathIndex([at(0)]), 0), null);
  assert.equal(routeBearingAt(buildPathIndex([at(0), at(0)]), 0), null);
  const mid = pointAtDistance(index, 500);
  assert.ok(Math.abs((mid.lat - 37.5) * M - 500) < 1);
});

test('앞쪽 경로: 지나온 구간은 빼고 현재 지점부터 시작하며, 멀리 있는 쪽은 한도까지만', () => {
  const index = buildPathIndex(L_PATH);
  const ahead = pathAhead(index, 400);
  assert.ok(Math.abs((ahead[0].lat - 37.5) * M - 400) < 1); // 현재 지점에서 시작
  assert.equal(ahead.length, 3); // 현재 지점, 꺾이는 점, 끝점
  assert.deepEqual(ahead.at(-1), L_PATH[2]);
  const capped = pathAhead(index, 400, 500);
  assert.ok(Math.abs((capped.at(-1).lat - 37.5) * M - 900) < 1);
  assert.equal(capped.length, 2); // 한도 안(900m 지점까지)에 꺾이는 점(1000m)이 없다
  assert.equal(pathAhead(index, 5000).length, 2); // 끝을 넘어도 끝점만 남는다
  assert.deepEqual(pathAhead(buildPathIndex([]), 0), []);
});

test('방향: 경로 위에서는 경로 방향을 따르고, 부드럽게 돌며, 작은 변화는 무시한다', () => {
  let s = updateHeading(INITIAL_HEADING, { position: at(10), speedMps: 10, routeBearing: 0 });
  assert.equal(s.headingDeg, 0);
  s = updateHeading(s, { position: at(20), speedMps: 10, routeBearing: 2 }); // 데드밴드 안
  assert.equal(s.headingDeg, 0);
  s = updateHeading(s, { position: at(30), speedMps: 10, routeBearing: 90 }); // 코너
  assert.ok(s.headingDeg > 0 && s.headingDeg < 90, `한 번에 90도로 튀지 않는다: ${s.headingDeg}`);
  for (let i = 0; i < 20; i++) s = updateHeading(s, { position: at(40), speedMps: 10, routeBearing: 90 });
  assert.ok(Math.abs(angleDiff(s.headingDeg, 90)) < 5);
});

test('방향: 멈춰 있거나 속도를 모르면 직전 방향을 그대로 둔다(GPS 흔들림에 돌지 않는다)', () => {
  const moving = updateHeading(INITIAL_HEADING, { position: at(10), speedMps: 10, routeBearing: 45 });
  for (const speedMps of [0, 0.4, 1.4, null]) {
    const s = updateHeading(moving, { position: at(10, 3), speedMps, routeBearing: 200 });
    assert.equal(s.headingDeg, 45, `speed=${speedMps}`);
  }
});

test('방향: 처음 시작할 때는 멈춰 있어도 경로 방향으로 맞추고, 경로 방향도 없으면 아직 모른다', () => {
  assert.equal(updateHeading(INITIAL_HEADING, { position: at(0), speedMps: null, routeBearing: 120 }).headingDeg, 120);
  assert.equal(updateHeading(INITIAL_HEADING, { position: at(0), speedMps: 0, routeBearing: null }).headingDeg, null);
});

test('방향: 경로를 벗어나면 위치 변화로 재되, 충분히 움직였을 때만 바꾼다', () => {
  let s = updateHeading(INITIAL_HEADING, { position: at(0), speedMps: 10, routeBearing: null });
  assert.equal(s.headingDeg, null); // 기준 위치만 잡는다
  s = updateHeading(s, { position: at(HEADING_MIN_MOVE_M - 2), speedMps: 10, routeBearing: null });
  assert.equal(s.headingDeg, null); // 너무 조금 움직였다
  s = updateHeading(s, { position: at(0, 20), speedMps: 10, routeBearing: null });
  assert.ok(Math.abs(angleDiff(s.headingDeg, 90)) < 2); // 동쪽으로 20m
});

test('driving zoom stays at level 1 even at highway and replay speeds', () => {
  for (const speed of [null, 0, 13.9, 30, 40, 60]) {
    const initial = nextFollowLevel(null, speed, 0);
    assert.equal(initial.level, 1);
    assert.equal(nextFollowLevel(initial, speed, LEVEL_MIN_DWELL_MS * 2).level, 1);
    assert.equal(nextFollowLevel({ level: 6, changedAtMs: 0 }, speed, 1000).level, 1);
  }
  assert.equal(FOLLOW_LEVEL_MIN, FOLLOW_LEVEL_MAX);
});

test('카메라 이동 판단: 처음·확대 단계 변화·충분한 이동·충분한 방향 변화에서만 움직인다', () => {
  const base = { position: at(0), headingDeg: 0, level: 3 };
  assert.equal(shouldMoveCamera(null, base), true);
  assert.equal(shouldMoveCamera(base, { ...base, position: at(CAMERA_MIN_MOVE_M - 1) }), false);
  assert.equal(shouldMoveCamera(base, { ...base, position: at(CAMERA_MIN_MOVE_M + 1) }), true);
  assert.equal(shouldMoveCamera(base, { ...base, headingDeg: 8 }), false);
  assert.equal(shouldMoveCamera(base, { ...base, headingDeg: 15 }), true);
  assert.equal(shouldMoveCamera(base, { ...base, headingDeg: 355 }), false); // 5도 차이
  assert.equal(shouldMoveCamera(base, { ...base, level: 4 }), true);
  assert.equal(shouldMoveCamera({ ...base, headingDeg: null }, { ...base, headingDeg: 10 }), true);
  assert.equal(shouldMoveCamera({ ...base, headingDeg: null }, { ...base, headingDeg: null }), false);
});

test('차 위치: 진행 방향 반대쪽으로 비킨다. 북쪽으로 가면 아래, 동쪽으로 가면 왼쪽', () => {
  const size = { width: 400, height: 800 };
  const none = { top: 0, bottom: 0, left: 0, right: 0 };
  const north = carOffsetPx(0, size, none);
  assert.ok(Math.abs(north.dx) < 1e-9);
  assert.ok(Math.abs(north.dy - AHEAD_RATIO_Y * 800) < 1e-9); // 아래쪽
  const east = carOffsetPx(90, size, none);
  assert.ok(Math.abs(east.dx + AHEAD_RATIO_X * 400) < 1e-9); // 왼쪽
  assert.ok(Math.abs(east.dy) < 1e-9);
  const south = carOffsetPx(180, size, none);
  assert.ok(south.dy < 0); // 위쪽
  const unknown = carOffsetPx(null, size, none);
  assert.deepEqual([unknown.dx, unknown.dy], [0, 0]);
});

test('차 위치: 위 카드·아래 패널이 가리는 만큼 보이는 영역 안에서 잡는다', () => {
  const size = { width: 400, height: 800 };
  const covered = { top: 150, bottom: 250, left: 0, right: 0 }; // 보이는 영역 400px, 가운데 y=350
  const north = carOffsetPx(0, size, covered);
  const carY = 400 + north.dy;
  assert.ok(Math.abs(carY - (350 + AHEAD_RATIO_Y * 400)) < 1e-9);
  assert.ok(carY > 150 && carY < 800 - 250); // 가려지는 영역 안으로 들어가지 않는다
  const unknown = carOffsetPx(null, size, covered);
  assert.ok(Math.abs(400 + unknown.dy - 350) < 1e-9);
});

test('속도 표시: km/h 정수, 멈춰 있을 때 흔들림은 0, 모르면 null', () => {
  assert.equal(speedKmhOf(null), null);
  assert.equal(speedKmhOf(Number.NaN), null);
  assert.equal(speedKmhOf(-1), null);
  assert.equal(speedKmhOf(0.5), 0); // 1.8km/h
  assert.equal(speedKmhOf(10), 36);
  assert.equal(speedKmhOf(13.9), 50);
});

test('보호구역 주의 안내: 보호구역 지점 앞 300m ~ 지난 뒤 100m 안에서만 보인다', () => {
  assert.equal(nearSchoolZone([], 0), false);
  assert.equal(nearSchoolZone([1000], 1000 - LIMIT_SHOW_AHEAD_M - 1), false);
  assert.equal(nearSchoolZone([1000], 1000 - LIMIT_SHOW_AHEAD_M), true);
  assert.equal(nearSchoolZone([1000], 1000), true);
  assert.equal(nearSchoolZone([1000], 1000 + LIMIT_SHOW_BEHIND_M), true);
  assert.equal(nearSchoolZone([1000], 1000 + LIMIT_SHOW_BEHIND_M + 1), false);
  assert.equal(nearSchoolZone([500, 3000], 2800), true); // 여러 곳 중 하나
});
import { headingUpOffsetPx } from '../src/lib/navigation/drivingCamera.ts';

test('heading-up: every bearing keeps the car at the same lower screen position', () => {
  const size = { width: 390, height: 844 };
  const insets = { top: 160, bottom: 140, left: 0, right: 0 };
  const expected = carOffsetPx(0, size, insets);
  for (const heading of [0, 45, 90, 180, 270, 359]) {
    const offset = headingUpOffsetPx(heading, size, insets);
    const angle = -heading * Math.PI / 180;
    const screenX = offset.dx * Math.cos(angle) - offset.dy * Math.sin(angle);
    const screenY = offset.dx * Math.sin(angle) + offset.dy * Math.cos(angle);
    assert.ok(Math.abs(screenX - expected.dx) < 1e-8);
    assert.ok(Math.abs(screenY - expected.dy) < 1e-8);
    assert.ok(screenY > 0);
  }
});
import { test as zoomTest } from 'node:test';
zoomTest('additional driving scale preserves the lower-center car anchor on wide screens', () => {
  for (const width of [390, 1167, 1920]) {
    const size = { width, height: 844 };
    const insets = { top: 180, bottom: 240, left: 0, right: 0 };
    const scale = Math.max(2, Math.min(4, width / 390));
    for (const heading of [0, 90, 180, 236, 359]) {
      const base = headingUpOffsetPx(heading, size, insets);
      const scaled = headingUpOffsetPx(heading, size, insets, scale);
      assert.ok(Math.abs(scaled.dx * scale - base.dx) < 1e-8);
      assert.ok(Math.abs(scaled.dy * scale - base.dy) < 1e-8);
    }
  }
});
test('remaining line advances on every small GPS step without a 15m tail', () => {
  const index = buildPathIndex(L_PATH);
  for (const progress of [0, 1, 4, 8, 12, 14.9, 15.1, 999, 1001, 1004]) {
    const remaining = pathAhead(index, progress);
    assert.deepEqual(remaining[0], pointAtDistance(index, progress));
    const firstOldVertex = index.path.findIndex((p, i) => index.cumM[i] < progress && remaining.some(q => q.lat === p.lat && q.lng === p.lng));
    assert.equal(firstOldVertex, -1);
  }
});
