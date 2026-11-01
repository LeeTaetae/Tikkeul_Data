import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequestBody, trimHistory } from '../src/lib/chat/conversation.ts';

test('trimHistory는 최근 N개만 남긴다', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `${i}` }));
  const trimmed = trimHistory(history, 6);
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[0].text, '4');
  assert.equal(trimmed[5].text, '9');
});

test('buildRequestBody는 위치가 있으면 lat/lon을 포함한다', () => {
  const body = buildRequestBody('질문', [], { lat: 37.5, lng: 127.0 });
  assert.deepEqual(body, { message: '질문', history: [], lat: 37.5, lon: 127.0 });
});

test('buildRequestBody는 위치가 없으면 lat/lon을 생략한다', () => {
  const body = buildRequestBody('질문', [], null);
  assert.deepEqual(body, { message: '질문', history: [] });
});
