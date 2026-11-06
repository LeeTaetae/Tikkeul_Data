// 보호구역 상황 적응형 민감도 프로파일.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SENSITIVITY,
  PROTECTION_ZONE_SENSITIVITY,
  passesThreshold,
  sensitivityProfileFor,
} from '../src/lib/vision/sensitivityProfile.ts';

test('보호구역이 아니면 기본 프로파일(모든 클래스 후보 0.4, 즉시 0.6, 10fps)', () => {
  const p = sensitivityProfileFor(false);
  assert.equal(p.targetFps, 10);
  assert.equal(p.confidenceByClass.person, 0.4);
  assert.equal(p.instantConfidence, 0.6);
  assert.deepEqual(p, DEFAULT_SENSITIVITY);
});

test('보호구역이면 person 후보만 0.25, 나머지는 그대로, 15fps', () => {
  const p = sensitivityProfileFor(true);
  assert.equal(p.confidenceByClass.person, 0.25);
  assert.equal(p.confidenceByClass.vehicle, 0.4);
  assert.equal(p.instantConfidence, 0.6);
  assert.equal(p.targetFps, 15);
  assert.deepEqual(p, PROTECTION_ZONE_SENSITIVITY);
});

test('confidence가 threshold와 정확히 같으면 통과한다(포함)', () => {
  const d = { class: 'person', confidence: 0.25, box: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  assert.equal(passesThreshold(d, PROTECTION_ZONE_SENSITIVITY), true);
  assert.equal(passesThreshold({ ...d, confidence: 0.24 }, PROTECTION_ZONE_SENSITIVITY), false);
});
