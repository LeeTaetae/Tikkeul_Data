// 전방 비전 탐지: ROI(위험구간) 포함 판정과 박스 크기 기반 단계 판정.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BOX_HEIGHT_RATIO,
  DEFAULT_ROI,
  isInRoi,
  mostSevereStage,
  stageOfDetection,
} from '../src/lib/vision/visionHazardStage.ts';

test('ROI 사다리꼴 안쪽 바닥-중앙점은 true, 화면 가장자리는 false', () => {
  const inside = { x: 0.45, y: 0.85, width: 0.1, height: 0.1 }; // 바닥-중앙 (0.5, 0.95)
  const outsideEdge = { x: 0.0, y: 0.05, width: 0.05, height: 0.05 }; // 화면 위쪽 가장자리, ROI 밖
  assert.equal(isInRoi(inside, DEFAULT_ROI), true);
  assert.equal(isInRoi(outsideEdge, DEFAULT_ROI), false);
});

test('ROI 밖 탐지는 advance', () => {
  const d = { class: 'person', confidence: 0.9, box: { x: 0.0, y: 0.1, width: 0.1, height: 0.1 } };
  assert.equal(stageOfDetection(d), 'advance');
});

test('box height가 approach 임계값과 같으면 approach, 그보다 1 작으면 caution', () => {
  const base = { class: 'vehicle', confidence: 0.9, box: { x: 0.4, y: 0.8, width: 0.2, height: BOX_HEIGHT_RATIO.approach } };
  assert.equal(stageOfDetection(base), 'approach');
  assert.equal(stageOfDetection({ ...base, box: { ...base.box, height: BOX_HEIGHT_RATIO.approach - 0.01 } }), 'caution');
});

test('box height가 final 임계값과 같거나 크면 final', () => {
  const base = { class: 'vehicle', confidence: 0.9, box: { x: 0.4, y: 0.5, width: 0.2, height: BOX_HEIGHT_RATIO.final } };
  assert.equal(stageOfDetection(base), 'final');
  assert.equal(stageOfDetection({ ...base, box: { ...base.box, height: BOX_HEIGHT_RATIO.final + 0.05 } }), 'final');
});

test('final과 caution이 섞이면 final', () => {
  assert.equal(mostSevereStage(['caution', 'final', 'approach']), 'final');
});

test('빈 배열은 advance', () => {
  assert.equal(mostSevereStage([]), 'advance');
});

test('박스가 화면 바닥을 넘어서도(가장 가까운 경우) ROI 밖으로 취급하지 않는다', () => {
  // 범퍼 바로 앞 객체는 y+height > 1.0이 될 수 있다(부동소수점 오차·클리핑 안 된 박스) — 리뷰 finding 4.
  const d = { class: 'person', confidence: 0.9, box: { x: 0.45, y: 0.9, width: 0.1, height: 0.5 } };
  assert.equal(isInRoi(d.box, DEFAULT_ROI), true);
  assert.equal(stageOfDetection(d), 'final');
});

test('옆 차선·인도(화면 가장자리 아래쪽)의 가까운 객체는 ROI 밖이다', () => {
  // 주행 영상에서 주차된 차·인도 보행자가 바닥 폭 90% ROI에 걸려 경고가 떴다(ml/eval_video.py).
  const parkedRight = { x: 0.8, y: 0.5, width: 0.2, height: 0.4 }; // 바닥-중앙 (0.9, 0.9)
  const sidewalkLeft = { x: 0.05, y: 0.6, width: 0.1, height: 0.3 }; // 바닥-중앙 (0.1, 0.9)
  assert.equal(isInRoi(parkedRight, DEFAULT_ROI), false);
  assert.equal(isInRoi(sidewalkLeft, DEFAULT_ROI), false);
});
