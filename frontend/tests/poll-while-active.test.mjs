// 백그라운드 polling 중단: 앱이 active 일 때만 주기 호출하고, 복귀 시 한 번 바로 호출한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pollWhileActive } from '../src/lib/api/pollWhileActive.ts';

function fakeAppState(initial) {
  const listeners = new Set();
  return {
    currentState: initial,
    addEventListener(_type, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(next) {
      this.currentState = next;
      listeners.forEach((l) => l(next));
    },
    listenerCount: () => listeners.size,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('active 인 동안 주기적으로 호출하고, cleanup 하면 멈춘다', async () => {
  const app = fakeAppState('active');
  let ticks = 0;
  const stop = pollWhileActive(() => ticks++, 20, app);
  await sleep(110);
  assert.ok(ticks >= 3, `ticks=${ticks}`);
  stop();
  const after = ticks;
  await sleep(60);
  assert.equal(ticks, after);
  assert.equal(app.listenerCount(), 0);
});

test('백그라운드로 가면 호출을 멈추고, 돌아오면 한 번 바로 호출한 뒤 이어간다', async () => {
  const app = fakeAppState('active');
  let ticks = 0;
  const stop = pollWhileActive(() => ticks++, 20, app);
  app.emit('background');
  const paused = ticks;
  await sleep(100);
  assert.equal(ticks, paused, '백그라운드에서는 호출하지 않는다');
  app.emit('active');
  assert.equal(ticks, paused + 1, '복귀하면 바로 한 번 호출한다');
  await sleep(70);
  assert.ok(ticks >= paused + 3);
  stop();
});

test('처음부터 background 면 호출하지 않고, active 가 되면 시작한다', async () => {
  const app = fakeAppState('background');
  let ticks = 0;
  const stop = pollWhileActive(() => ticks++, 20, app);
  await sleep(70);
  assert.equal(ticks, 0);
  app.emit('active');
  assert.equal(ticks, 1);
  stop();
});

test('active 가 반복해서 와도 타이머가 겹치지 않는다', async () => {
  const app = fakeAppState('active');
  let ticks = 0;
  const stop = pollWhileActive(() => ticks++, 50, app);
  app.emit('active');
  app.emit('active');
  assert.equal(ticks, 0, '이미 돌고 있으면 복귀 호출을 하지 않는다');
  await sleep(120);
  assert.ok(ticks <= 3, `타이머가 겹치면 훨씬 많아진다: ticks=${ticks}`);
  stop();
});
