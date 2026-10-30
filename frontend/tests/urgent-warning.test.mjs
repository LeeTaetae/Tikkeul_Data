// 경고가 동시에 둘 올라올 때 어느 쪽을 보여줄지 정하는 우선순위 검증.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pickUrgentWarning } from '../src/lib/urgentWarning.ts';

const warn = (id, stage, distanceM) => ({ alert: { id }, stage, distanceM, message: { key: 'x', params: { distance: '' } } });

test('경고가 하나뿐이면 그대로 돌려준다', () => {
  const a = warn('a', 'caution', 400);
  assert.equal(pickUrgentWarning(a, null), a);
  assert.equal(pickUrgentWarning(null, a), a);
  assert.equal(pickUrgentWarning(null, null), null);
});

test('더 가까운 단계가 우선이다 (final > approach > caution > advance)', () => {
  const stages = ['advance', 'caution', 'approach', 'final'];
  for (let i = 0; i < stages.length; i++) {
    for (let j = 0; j < stages.length; j++) {
      if (i === j) continue;
      const a = warn('a', stages[i], 100);
      const b = warn('b', stages[j], 100);
      assert.equal(pickUrgentWarning(a, b), i > j ? a : b, `${stages[i]} vs ${stages[j]}`);
    }
  }
});

test('단계가 같으면 더 가까운 위험구간이 우선이다', () => {
  const near = warn('near', 'approach', 120);
  const far = warn('far', 'approach', 280);
  assert.equal(pickUrgentWarning(far, near), near);
  assert.equal(pickUrgentWarning(near, far), near);
});

test('단계와 거리가 모두 같으면 첫 번째가 우선이다', () => {
  const a = warn('a', 'final', 50);
  const b = warn('b', 'final', 50);
  assert.equal(pickUrgentWarning(a, b), a);
});
