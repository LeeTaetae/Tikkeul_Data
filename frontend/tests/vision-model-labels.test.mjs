// 모델 출력 라벨(car 등 ultralytics 클래스명)과 앱의 HazardClass('vehicle' 등) 변환. 신뢰 경계에서
// 알 수 없는 라벨은 조용히 버린다(리뷰 finding 3 — 매핑 없이 넘기면 confidenceByClass['car']가
// undefined라 모든 차량이 통과 못 하고, CLASS_ICON[...]이 undefined라 배너가 죽을 수 있었다).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromModelDetections, toModelLabelConfidence } from '../src/lib/vision/modelLabels.ts';
import { DEFAULT_SENSITIVITY } from '../src/lib/vision/sensitivityProfile.ts';

test('모델의 car 라벨은 confidence 맵에서도 그대로 쓴다(HazardClass는 vehicle)', () => {
  const m = toModelLabelConfidence(DEFAULT_SENSITIVITY.confidenceByClass);
  assert.equal(m.car, DEFAULT_SENSITIVITY.confidenceByClass.vehicle);
  assert.equal(m.person, DEFAULT_SENSITIVITY.confidenceByClass.person);
});

test('모델이 돌려준 car 라벨은 HazardClass vehicle로 변환된다', () => {
  const raw = [{ class: 'car', confidence: 0.9, box: { x: 0, y: 0, width: 0.1, height: 0.1 } }];
  const detections = fromModelDetections(raw);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].class, 'vehicle');
});

test('알 수 없는 라벨은 조용히 버려지고(throw 없이) 나머지는 그대로 남는다', () => {
  const raw = [
    { class: 'truck', confidence: 0.9, box: { x: 0, y: 0, width: 0.1, height: 0.1 } }, // 모델에 없는 라벨
    { class: 'person', confidence: 0.8, box: { x: 0, y: 0, width: 0.1, height: 0.1 } },
  ];
  const detections = fromModelDetections(raw);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].class, 'person');
});
