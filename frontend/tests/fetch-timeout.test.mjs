// fetchWithTimeout: 응답이 없는 서버 때문에 화면이 무기한 로딩에 머물지 않는지 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchWithTimeout } from '../src/lib/api/fetchTimeout.ts';

// 취소 신호가 오면 AbortError 로 끝나는, 응답이 오지 않는 서버
const hangingFetch = (_url, init) =>
  new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

test('응답이 없으면 제한 시간 뒤 AbortError 로 끝난다', async () => {
  const started = Date.now();
  await assert.rejects(fetchWithTimeout('http://api.test/x', {}, 50, hangingFetch), (e) => e.name === 'AbortError');
  assert.ok(Date.now() - started < 1000);
});

test('제한 시간 안에 응답하면 그대로 돌려주고 요청 옵션을 유지한다', async () => {
  let seen;
  const fakeFetch = async (url, init) => ((seen = { url, init }), new Response('{"ok":true}', { status: 200 }));
  const res = await fetchWithTimeout('http://api.test/x', { method: 'POST', body: '{}' }, 1000, fakeFetch);
  assert.equal(res.status, 200);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.body, '{}');
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('서버 오류 응답(5xx)은 예외가 아니라 Response 로 돌려준다(호출 쪽이 res.ok 로 판단)', async () => {
  const res = await fetchWithTimeout('http://api.test/x', {}, 1000, async () => new Response('x', { status: 504 }));
  assert.equal(res.ok, false);
});
