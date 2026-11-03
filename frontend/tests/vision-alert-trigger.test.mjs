// 진동은 단계 상승(edge)에만 울린다. 같은 단계 유지·하락은 울리지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldVibrate } from '../src/lib/vision/visionAlertTrigger.ts';

test('단계가 올라가면(advance→caution) 진동한다', () => {
  assert.equal(shouldVibrate('advance', 'caution'), true);
});

test('같은 단계에 머물면 진동하지 않는다', () => {
  assert.equal(shouldVibrate('approach', 'approach'), false);
});

test('단계가 내려가면 진동하지 않는다', () => {
  assert.equal(shouldVibrate('final', 'caution'), false);
});

test('final에서 벗어났다가(advance) 다시 caution으로 들어오면 재진동한다', () => {
  assert.equal(shouldVibrate('final', 'advance'), false); // 벗어나는 순간은 진동 없음
  assert.equal(shouldVibrate('advance', 'caution'), true); // 재진입은 다시 진동
});
