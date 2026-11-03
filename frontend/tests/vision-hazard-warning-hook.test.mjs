// 한 프레임 처리의 순수 부분: threshold 통과 필터 → 가장 심한 단계 판정 → 진동 여부.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reduceVisionFrame } from '../src/lib/vision/useVisionHazardWarning.ts';
import { sensitivityProfileFor } from '../src/lib/vision/sensitivityProfile.ts';

test('여러 탐지 중 threshold를 넘은 것만 보고, 가장 심한 단계로 올라가면 진동한다', () => {
  const profile = sensitivityProfileFor(false);
  const detections = [
    { class: 'animal', confidence: 0.1, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }, // threshold 미달 → 제외
    { class: 'person', confidence: 0.9, box: { x: 0.45, y: 0.5, width: 0.1, height: 0.4 } }, // final
  ];
  const r = reduceVisionFrame('advance', detections, profile);
  assert.equal(r.stage, 'final');
  assert.equal(r.vibrate, true);
  assert.equal(r.topClass, 'person');
});

test('아무 탐지도 threshold를 못 넘으면 advance로 내려가고 진동하지 않는다', () => {
  const r = reduceVisionFrame('caution', [], sensitivityProfileFor(false));
  assert.equal(r.stage, 'advance');
  assert.equal(r.vibrate, false);
  assert.equal(r.topClass, null);
});
