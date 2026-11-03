// 한 프레임 처리의 순수 부분: threshold 통과 필터 → 가장 심한 단계 판정 → 진동 여부.
// 모델 recall(~0.57)로 단발성 미탐지가 흔하다 — 단계는 오르는 건 즉시, 내리는 건 N프레임 연속 확인 후 반영해서
// final→advance→final 같은 깜빡임 재진동을 막는다(리뷰 finding 2).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INITIAL_VISION_FRAME_STATE, reduceVisionFrame, STAGE_DROP_HOLD_FRAMES } from '../src/lib/vision/useVisionHazardWarning.ts';
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
