// 보호구역 상황 적응형 민감도 프로파일.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SENSITIVITY,
  PROTECTION_ZONE_SENSITIVITY,
  passesThreshold,
  sensitivityProfileFor,
} from '../src/lib/vision/sensitivityProfile.ts';

test('보호구역이 아니면 기본 프로파일(모든 클래스 후보 0.4, 즉시 0.6, 10fps) - 속도는 영향 없음', () => {
  const p = sensitivityProfileFor(false, null);
  assert.equal(p.targetFps, 10);
  assert.equal(p.confidenceByClass.person, 0.4);
  assert.equal(p.confidenceByClass.vehicle, 0.4);
  assert.equal(p.instantConfidence, 0.6);
  assert.deepEqual(p, DEFAULT_SENSITIVITY);
  assert.deepEqual(sensitivityProfileFor(false, 50), DEFAULT_SENSITIVITY);
});

test('보호구역 + 저속(또는 속도 모름)이면 person 0.25, 차량 탐지는 꺼짐, 15fps', () => {
  const slow = sensitivityProfileFor(true, 10);
  assert.equal(slow.confidenceByClass.person, 0.25);
  assert.equal(slow.confidenceByClass.vehicle, Infinity);
  assert.equal(slow.targetFps, 15);

  const unknownSpeed = sensitivityProfileFor(true, null);
  assert.equal(unknownSpeed.confidenceByClass.vehicle, Infinity);
});

test('보호구역이라도 시속 50 이상이면 차량 탐지가 다시 켜진다', () => {
  const p = sensitivityProfileFor(true, 50);
  assert.equal(p.confidenceByClass.vehicle, 0.4);
  assert.equal(p.confidenceByClass.person, 0.25);
  assert.deepEqual(p, PROTECTION_ZONE_SENSITIVITY);
  assert.deepEqual(sensitivityProfileFor(true, 49.9).confidenceByClass.vehicle, Infinity);
});

test('confidence가 threshold와 정확히 같으면 통과한다(포함)', () => {
  const d = { class: 'person', confidence: 0.25, box: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  assert.equal(passesThreshold(d, PROTECTION_ZONE_SENSITIVITY), true);
  assert.equal(passesThreshold({ ...d, confidence: 0.24 }, PROTECTION_ZONE_SENSITIVITY), false);
});
