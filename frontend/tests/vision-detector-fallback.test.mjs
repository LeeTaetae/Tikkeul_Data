// 네이티브 비전 탐지 모듈이 없는 빌드(브라우저 등)에서의 기본 동작.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectFrame, isVisionDetectorAvailable } from '../src/native/visionDetector.ts';
import { DEFAULT_SENSITIVITY } from '../src/lib/vision/sensitivityProfile.ts';

test('네이티브 모듈이 없으면 이용 불가로 보고한다', () => {
  assert.equal(isVisionDetectorAvailable(), false);
});

test('네이티브 모듈이 없으면 detectFrame은 빈 배열을 돌려준다', async () => {
  const result = await detectFrame({}, DEFAULT_SENSITIVITY);
  assert.deepEqual(result, []);
});
