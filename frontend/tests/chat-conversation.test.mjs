import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRequestBody, trimHistory } from '../src/lib/chat/conversation.ts';
import { DEMO_ORIGIN } from '../src/map/demoDestinations.ts';

test('trimHistory는 최근 N개만 남긴다', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `${i}` }));
  const trimmed = trimHistory(history, 6);
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[0].text, '4');
  assert.equal(trimmed[5].text, '9');
});

test('buildRequestBody는 위치가 있으면 lat/lon을 포함한다', () => {
  const body = buildRequestBody('질문', [], { lat: 37.5, lng: 127.0 }, 'ko');
  assert.deepEqual(body, { message: '질문', history: [], lat: 37.5, lon: 127.0, language: 'ko' });
});

test('buildRequestBody는 위치가 없으면 lat/lon을 생략한다', () => {
  const body = buildRequestBody('질문', [], null, 'ko');
  assert.deepEqual(body, { message: '질문', history: [], language: 'ko' });
});

test('buildRequestBody는 GPS 폴백(서울시청)을 실제 위치로 보내지 않는다', () => {
  const body = buildRequestBody('질문', [], DEMO_ORIGIN, 'ko');
  assert.deepEqual(body, { message: '질문', history: [], language: 'ko' });
});

test('buildRequestBody는 현재 i18n 언어를 그대로 담는다', () => {
  const body = buildRequestBody('question', [], null, 'en');
  assert.equal(body.language, 'en');
});
