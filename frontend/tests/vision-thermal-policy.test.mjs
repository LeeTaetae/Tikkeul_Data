// 기기 발열 단계별 비전 추론 성능 정책.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { policyForThermalTier } from '../src/lib/vision/thermalPolicy.ts';

test('nominal/fair는 기본 fps 그대로, 오버레이 허용', () => {
  assert.deepEqual(policyForThermalTier('nominal', 10), { overlayAllowed: true, targetFps: 10, inferencePaused: false });
  assert.equal(policyForThermalTier('fair', 10).targetFps, 10);
  assert.equal(policyForThermalTier('fair', 10).overlayAllowed, true);
});

test('serious는 오버레이 금지, fps를 2 이하로 제한', () => {
  const p = policyForThermalTier('serious', 10);
  assert.equal(p.overlayAllowed, false);
  assert.equal(p.targetFps, 2);
  assert.equal(p.inferencePaused, false);
});

test('serious에서 기본 fps가 이미 2보다 작으면 그대로 둔다', () => {
  assert.equal(policyForThermalTier('serious', 1).targetFps, 1);
});

test('critical은 추론 자체를 멈춘다', () => {
  const p = policyForThermalTier('critical', 10);
  assert.equal(p.inferencePaused, true);
  assert.equal(p.targetFps, 0);
  assert.equal(p.overlayAllowed, false);
});
