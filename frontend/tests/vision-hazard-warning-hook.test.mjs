// 한 프레임 처리의 순수 부분: threshold 통과 필터 → 가장 심한 단계 판정 → 진동 여부.
// 모델 recall(~0.57)로 단발성 미탐지가 흔하다 — 단계는 오르는 건 즉시, 내리는 건 N프레임 연속 확인 후 반영해서
// final→advance→final 같은 깜빡임 재진동을 막는다(리뷰 finding 2).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INITIAL_VISION_FRAME_STATE, isNearPrev, reduceVisionFrame, STAGE_DROP_HOLD_FRAMES } from '../src/lib/vision/useVisionHazardWarning.ts';
import { sensitivityProfileFor } from '../src/lib/vision/sensitivityProfile.ts';

const personFinal = [{ class: 'person', confidence: 0.9, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }];
const animalBelowThreshold = [{ class: 'animal', confidence: 0.1, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }];

test('여러 탐지 중 threshold를 넘은 것만 보고, 가장 심한 단계로 올라가면 진동한다', () => {
  const profile = sensitivityProfileFor(false);
  const r = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, [...animalBelowThreshold, ...personFinal], profile);
  assert.equal(r.state.stage, 'final');
  assert.equal(r.vibrate, true);
  assert.equal(r.state.topClass, 'person');
});

test('아무 탐지도 없고 이미 advance면 진동하지 않는다', () => {
  const r = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, [], sensitivityProfileFor(false));
  assert.equal(r.state.stage, 'advance');
  assert.equal(r.vibrate, false);
  assert.equal(r.state.topClass, null);
});

test('final 상태에서 한 프레임만 놓쳐도(미탐지) 즉시 advance로 떨어지지 않고 유지한다(hold)', () => {
  const profile = sensitivityProfileFor(false);
  const atFinal = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinal, profile);
  const oneMiss = reduceVisionFrame(atFinal.state, [], profile);
  assert.equal(oneMiss.state.stage, 'final'); // 유지
  assert.equal(oneMiss.state.topClass, 'person'); // 배너도 깜빡이지 않는다
  assert.equal(oneMiss.vibrate, false); // 유지 중이라 재진동 없음
});

test(`연속 ${STAGE_DROP_HOLD_FRAMES}프레임 미탐지가 지속되면 advance로 내려간다`, () => {
  const profile = sensitivityProfileFor(false);
  let state = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinal, profile).state;
  for (let i = 0; i < STAGE_DROP_HOLD_FRAMES - 1; i++) {
    const r = reduceVisionFrame(state, [], profile);
    assert.equal(r.state.stage, 'final', `${i + 1}번째 미탐지까지는 유지`);
    state = r.state;
  }
  const dropped = reduceVisionFrame(state, [], profile);
  assert.equal(dropped.state.stage, 'advance');
  assert.equal(dropped.state.topClass, null);
  assert.equal(dropped.vibrate, false); // 하락은 진동하지 않는다
});

test('hold 중 다시 탐지되면(실제로 재진입이 아니라 유지) 재진동하지 않는다', () => {
  const profile = sensitivityProfileFor(false);
  const atFinal = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinal, profile);
  const oneMiss = reduceVisionFrame(atFinal.state, [], profile);
  const backAgain = reduceVisionFrame(oneMiss.state, personFinal, profile);
  assert.equal(backAgain.state.stage, 'final');
  assert.equal(backAgain.vibrate, false); // 쭉 final 유지였을 뿐, 벗어났다 들어온 게 아니다
});

test('단계가 완전히 내려갔다가(advance) 다시 올라가면 재진동한다', () => {
  const profile = sensitivityProfileFor(false);
  let state = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinal, profile).state;
  for (let i = 0; i < STAGE_DROP_HOLD_FRAMES; i++) state = reduceVisionFrame(state, [], profile).state;
  assert.equal(state.stage, 'advance');
  const reentered = reduceVisionFrame(state, personFinal, profile);
  assert.equal(reentered.state.stage, 'final');
  assert.equal(reentered.vibrate, true);
});

// 빠른 객체 대응: 후보 기준(0.4)~즉시 기준(0.6) 사이는 연속 2프레임에 잡혀야 경고한다. 단발성 오탐은 걸러진다.
const personFinalMid = [{ class: 'person', confidence: 0.5, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }];
const vehicleFinalMid = [{ class: 'vehicle', confidence: 0.5, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }];

test('즉시 기준 이상이면 한 프레임만으로 경고한다', () => {
  const r = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinal, sensitivityProfileFor(false));
  assert.equal(r.state.stage, 'final');
  assert.equal(r.vibrate, true);
});

test('후보 신뢰도(0.4~0.6)는 한 프레임만으로는 경고하지 않는다', () => {
  const r = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinalMid, sensitivityProfileFor(false));
  assert.equal(r.state.stage, 'advance');
  assert.equal(r.vibrate, false);
  assert.deepEqual(r.state.prevBoxes, [personFinalMid[0].box]);
});

test('후보 신뢰도가 연속 2프레임 잡히면 경고한다', () => {
  const profile = sensitivityProfileFor(false);
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinalMid, profile);
  const second = reduceVisionFrame(first.state, personFinalMid, profile);
  assert.equal(second.state.stage, 'final');
  assert.equal(second.state.topClass, 'person');
  assert.equal(second.vibrate, true);
});

test('후보가 한 프레임 끊기면 확정하지 않는다', () => {
  const profile = sensitivityProfileFor(false);
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinalMid, profile);
  const gap = reduceVisionFrame(first.state, [], profile);
  assert.equal(reduceVisionFrame(gap.state, personFinalMid, profile).state.stage, 'advance');
});

// 빠른 객체는 프레임마다 클래스가 바뀌기 쉽다(킥보드↔사람, 오토바이↔차) - 클래스가 아니라 위치로 같은 객체인지 본다.
test('클래스가 달라도 같은 자리에서 연속으로 잡히면 확정한다', () => {
  const profile = sensitivityProfileFor(false);
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinalMid, profile);
  const second = reduceVisionFrame(first.state, vehicleFinalMid, profile);
  assert.equal(second.state.stage, 'final');
  assert.equal(second.state.topClass, 'vehicle');
});

test('프레임 사이에 박스 폭 절반만큼 옆으로 움직여도 같은 객체로 확정한다', () => {
  const profile = sensitivityProfileFor(false);
  const moved = [{ class: 'person', confidence: 0.5, box: { x: 0.5, y: 0.5, width: 0.1, height: 0.4 } }];
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, personFinalMid, profile);
  assert.equal(reduceVisionFrame(first.state, moved, profile).state.stage, 'final');
});

test('ROI 안이라도 떨어진 자리의 후보끼리는 확정하지 않는다', () => {
  const profile = sensitivityProfileFor(false);
  // 둘 다 ROI 바닥(폭 0.25~0.75) 안이지만 서로 떨어져 있다.
  const left = [{ class: 'person', confidence: 0.5, box: { x: 0.26, y: 0.6, width: 0.04, height: 0.38 } }];
  const right = [{ class: 'person', confidence: 0.5, box: { x: 0.7, y: 0.6, width: 0.04, height: 0.38 } }];
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, left, profile);
  assert.equal(first.state.prevBoxes.length, 1);
  assert.equal(reduceVisionFrame(first.state, right, profile).state.stage, 'advance');
});

test('직전 프레임에 즉시 기준으로 잡힌 자리에서 후보로 떨어져도 단계 상승은 반영한다', () => {
  const profile = sensitivityProfileFor(false);
  const approachInstant = [{ class: 'kickboard', confidence: 0.7, box: { x: 0.45, y: 0.6, width: 0.1, height: 0.2 } }];
  const finalCandidate = [{ class: 'person', confidence: 0.45, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }];
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, approachInstant, profile);
  assert.equal(first.state.stage, 'approach');
  const second = reduceVisionFrame(first.state, finalCandidate, profile);
  assert.equal(second.state.stage, 'final');
  assert.equal(second.vibrate, true);
});

test('isNearPrev: 넓힌 범위 밖이면 같은 객체로 보지 않는다', () => {
  const prev = [{ x: 0.4, y: 0.5, width: 0.1, height: 0.2 }];
  assert.equal(isNearPrev({ x: 0.54, y: 0.5, width: 0.1, height: 0.2 }, prev), true);
  assert.equal(isNearPrev({ x: 0.56, y: 0.5, width: 0.1, height: 0.2 }, prev), false);
});

test('ROI 밖 후보는 다음 프레임 확정에 쓰이지 않는다', () => {
  const profile = sensitivityProfileFor(false);
  const outside = [{ class: 'person', confidence: 0.5, box: { x: 0.0, y: 0.1, width: 0.05, height: 0.1 } }];
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, outside, profile);
  assert.deepEqual(first.state.prevBoxes, []);
  assert.equal(reduceVisionFrame(first.state, personFinalMid, profile).state.stage, 'advance');
});

// 주행 영상에서 화면 거의 전체를 덮는 중간 신뢰도 박스가 빈 도로에 경고를 띄웠다(ml/eval_video.py).
test('화면 폭 85% 이상인 박스는 즉시 기준 미만이면 연속으로 잡혀도 무시한다', () => {
  const profile = sensitivityProfileFor(false);
  const giant = [{ class: 'vehicle', confidence: 0.5, box: { x: 0.05, y: 0.3, width: 0.9, height: 0.7 } }];
  const first = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, giant, profile);
  assert.deepEqual(first.state.prevBoxes, []);
  const second = reduceVisionFrame(first.state, giant, profile);
  assert.equal(second.state.stage, 'advance');
  assert.equal(second.vibrate, false);
});

test('화면을 크게 덮어도 즉시 기준 이상이면(바로 앞에 붙은 차) 경고한다', () => {
  const close = [{ class: 'vehicle', confidence: 0.9, box: { x: 0.05, y: 0.3, width: 0.9, height: 0.7 } }];
  const r = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, close, sensitivityProfileFor(false));
  assert.equal(r.state.stage, 'final');
  assert.equal(r.vibrate, true);
});
