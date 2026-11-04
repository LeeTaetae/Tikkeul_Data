// 진동은 단계 상승(edge)에만 울린다. 같은 단계 유지·하락은 울리지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldVibrate } from '../src/lib/vision/visionAlertTrigger.ts';

test('final로 막 진입하면 진동한다', () => {
  assert.equal(shouldVibrate('approach', 'final'), true);
});

test('final이 아닌 단계로 올라가면 진동하지 않는다(advance→caution)', () => {
  assert.equal(shouldVibrate('advance', 'caution'), false);
});

test('같은 단계에 머물면 진동하지 않는다(final 유지 포함)', () => {
  assert.equal(shouldVibrate('approach', 'approach'), false);
  assert.equal(shouldVibrate('final', 'final'), false);
});

test('단계가 내려가면 진동하지 않는다', () => {
  assert.equal(shouldVibrate('final', 'caution'), false);
});

test('final에서 벗어났다가(advance) 다시 final로 들어오면 재진동한다', () => {
  assert.equal(shouldVibrate('final', 'advance'), false); // 벗어나는 순간은 진동 없음
  assert.equal(shouldVibrate('advance', 'final'), true); // 재진입은 다시 진동
});
