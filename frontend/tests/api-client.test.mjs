// API 클라이언트: 요청 조립, 시간 초과, 오류 분류. Node 내장 테스트 러너(node --test, Node 22.18+)로 실행한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiClientError, buildQuery, classifyHttpError, createApiClient, isAbortError } from '../src/lib/api/client.ts';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const clientWith = (fetchImpl, extra = {}) => createApiClient({ baseUrl: 'http://api.test/', fetchImpl, ...extra });
const rejectsWith = async (promise, kind) => {
  await assert.rejects(promise, (e) => e instanceof ApiClientError && e.kind === kind, `kind=${kind} 이어야 한다`);
};

test('요청 URL: 기본 주소 끝 슬래시 정리, undefined 파라미터 제외, 값 인코딩', async () => {
  let url = '';
  const client = clientWith(async (u) => ((url = u), json({ ok: true })));
  await client.get('/api/traffic/predictions', { section_id: '10', include_geometry: undefined, forecast_for: '2026-10-28T16:00:00+09:00', flag: false });
  assert.equal(url, 'http://api.test/api/traffic/predictions?section_id=10&forecast_for=2026-10-28T16%3A00%3A00%2B09%3A00&flag=false');
  assert.equal(buildQuery({}), '');
});

test('성공 응답은 본문을 그대로 돌려준다', async () => {
  const body = { meta: { stale: false }, items: [] };
  assert.deepEqual(await clientWith(async () => json(body)).get('/x'), body);
});

test('API 주소가 비어 있으면 config 오류', async () => {
  await rejectsWith(createApiClient({ baseUrl: '', fetchImpl: async () => json({}) }).get('/x'), 'config');
});

for (const [status, code, kind] of [
  [502, 'UPSTREAM_AUTH', 'auth'],
  [503, 'NOT_CONFIGURED', 'notConfigured'],
  [503, 'UPSTREAM_RATE_LIMIT', 'rateLimit'],
  [504, 'UPSTREAM_TIMEOUT', 'timeout'],
  [503, 'UPSTREAM_UNAVAILABLE', 'server'],
  [502, 'UPSTREAM_BAD_REQUEST', 'server'],
  [502, 'UPSTREAM_BAD_RESPONSE', 'server'],
  [502, 'UPSTREAM_ERROR', 'server'],
  [500, 'SOMETHING_NEW', 'server'],
]) {
  test(`백엔드 오류 ${code} → ${kind}`, async () => {
    const client = clientWith(async () => json({ error: { code, message: '...' } }, status));
    await assert.rejects(client.get('/x'), (e) => e instanceof ApiClientError && e.kind === kind && e.code === code && e.status === status);
  });
}

test('입력 검증 오류(422)는 invalid, 본문이 JSON 이 아닌 서버 오류는 server', async () => {
  await rejectsWith(clientWith(async () => json({ detail: [{ msg: 'bad' }] }, 422)).get('/x'), 'invalid');
  await rejectsWith(clientWith(async () => new Response('<html>Bad Gateway</html>', { status: 502 })).get('/x'), 'server');
  await rejectsWith(clientWith(async () => new Response('not json', { status: 200 })).get('/x'), 'server');
  assert.equal(classifyHttpError(404, null).kind, 'server');
});

test('연결 실패는 network', async () => {
  await rejectsWith(clientWith(async () => Promise.reject(new TypeError('Failed to fetch'))).get('/x'), 'network');
});

test('앱 쪽 시간 초과는 timeout', async () => {
  const hang = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await rejectsWith(clientWith(hang, { timeoutMs: 20 }).get('/x'), 'timeout');
});

test('호출한 쪽이 취소하면 오류로 분류하지 않고 AbortError 를 그대로 던진다', async () => {
  const hang = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const controller = new AbortController();
  const pending = clientWith(hang).get('/x', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => isAbortError(e) && !(e instanceof ApiClientError));
});

test('오류 메시지와 이름에 요청 URL(좌표)이 들어가지 않는다', async () => {
  const client = clientWith(async () => Promise.reject(new TypeError('fetch failed http://api.test/x?min_lon=126.9')));
  await assert.rejects(client.get('/x', { min_lon: 126.9 }), (e) => !String(e.message).includes('126.9') && !String(e.stack).includes('min_lon'));
});

test('post: JSON 본문을 보내고 Content-Type 을 붙인다', async () => {
  let seen = null;
  const client = clientWith(async (url, init) => ((seen = init), json({ ok: true })));
  await client.post('/api/auth/signup', { email: 'a@b.com' });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers['Content-Type'], 'application/json');
  assert.equal(seen.body, JSON.stringify({ email: 'a@b.com' }));
});

// authApi.loginGoogle 은 이 경로/바디 모양으로 요청을 조립한다(client.ts 가 실제로 보내는 것을 확인한다).
// src/lib/auth/api.ts 는 config.ts 를 거쳐 react-native 를 import 해서 plain Node 에선 직접 import 할 수 없다(기존 authApi 함수들도 동일한 제약으로 미테스트).
test('loginGoogle 요청 조립: POST /api/auth/social/google 에 { id_token } 바디', async () => {
  let seenUrl = null;
  let seenInit = null;
  const client = clientWith(async (url, init) => ((seenUrl = url), (seenInit = init), json({ ok: true })));
  await client.post('/api/auth/social/google', { id_token: 'fake-id-token' });
  assert.equal(seenUrl, 'http://api.test/api/auth/social/google');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.body, JSON.stringify({ id_token: 'fake-id-token' }));
});

// authApi.loginKakao 도 동일한 제약(react-native 의존)으로 client.ts 조립 결과만 검증한다.
test('loginKakao 요청 조립: POST /api/auth/social/kakao 에 { access_token } 바디', async () => {
  let seenUrl = null;
  let seenInit = null;
  const client = clientWith(async (url, init) => ((seenUrl = url), (seenInit = init), json({ ok: true })));
  await client.post('/api/auth/social/kakao', { access_token: 'fake-access-token' });
  assert.equal(seenUrl, 'http://api.test/api/auth/social/kakao');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.body, JSON.stringify({ access_token: 'fake-access-token' }));
});

// authApi.sendPasswordResetCode/verifyPasswordResetCode/resetPassword 도 동일한 제약(react-native 의존)으로 client.ts 조립 결과만 검증한다.
test('sendPasswordResetCode 요청 조립: POST /api/auth/password-reset/send-code 에 { email } 바디', async () => {
  let seenUrl = null;
  let seenInit = null;
  const client = clientWith(async (url, init) => ((seenUrl = url), (seenInit = init), json({ sent: true, challenge: null, social_only: false })));
  await client.post('/api/auth/password-reset/send-code', { email: 'a@b.com' });
  assert.equal(seenUrl, 'http://api.test/api/auth/password-reset/send-code');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.body, JSON.stringify({ email: 'a@b.com' }));
});

test('verifyPasswordResetCode 요청 조립: POST /api/auth/password-reset/verify-code 에 { email, code, challenge } 바디', async () => {
  let seenUrl = null;
  let seenInit = null;
  const client = clientWith(async (url, init) => ((seenUrl = url), (seenInit = init), json({ verified: true, token: 'tok' })));
  await client.post('/api/auth/password-reset/verify-code', { email: 'a@b.com', code: '123456', challenge: 'ch' });
  assert.equal(seenUrl, 'http://api.test/api/auth/password-reset/verify-code');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.body, JSON.stringify({ email: 'a@b.com', code: '123456', challenge: 'ch' }));
});

test('resetPassword 요청 조립: POST /api/auth/password-reset 에 { token, new_password } 바디', async () => {
  let seenUrl = null;
  let seenInit = null;
  const client = clientWith(async (url, init) => ((seenUrl = url), (seenInit = init), json({ id: 1 })));
  await client.post('/api/auth/password-reset', { token: 'tok', new_password: 'newpassword1' });
  assert.equal(seenUrl, 'http://api.test/api/auth/password-reset');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.body, JSON.stringify({ token: 'tok', new_password: 'newpassword1' }));
});

test('token 옵션을 주면 Authorization 헤더가 붙는다', async () => {
  let seen = null;
  const client = clientWith(async (url, init) => ((seen = init), json({ ok: true })));
  await client.get('/api/auth/me', {}, { token: 'abc123' });
  assert.equal(seen.headers.Authorization, 'Bearer abc123');
});

test('token 을 안 주면 Authorization 헤더가 없다', async () => {
  let seen = null;
  const client = clientWith(async (url, init) => ((seen = init), json({ ok: true })));
  await client.get('/x');
  assert.ok(!('Authorization' in seen.headers));
});

test('204 No Content 는 본문을 읽지 않고 undefined 를 돌려준다', async () => {
  const client = clientWith(async () => new Response(null, { status: 204 }));
  assert.equal(await client.del('/api/favorites/1'), undefined);
});

test('204 가 아닌데 실패면(401 등) 평소대로 오류 코드로 분류한다', async () => {
  const client = clientWith(async () => json({ error: { code: 'UNAUTHORIZED', message: '...' } }, 401));
  await rejectsWith(client.del('/api/favorites/1'), 'unauthorized');
});

test('patch: JSON 본문을 보낸다', async () => {
  let seen = null;
  const client = clientWith(async (url, init) => ((seen = init), json({ ok: true })));
  await client.patch('/api/favorites/1', { label: '새이름' });
  assert.equal(seen.method, 'PATCH');
  assert.equal(seen.body, JSON.stringify({ label: '새이름' }));
});
