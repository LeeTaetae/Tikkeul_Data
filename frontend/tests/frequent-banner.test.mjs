import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_FREQUENT_VISITS, pickFrequentDestination } from '../src/lib/trips/frequentBanner.ts';

const dest = (visit_count) => ({ label: '회사', lat: 1, lon: 2, address_text: '', last_used_at: '', visit_count });

test('방문 횟수가 5 미만이면 null', () => {
  assert.equal(pickFrequentDestination([dest(4)]), null);
});

test('방문 횟수가 정확히 5면 그 목적지를 돌려준다(경계값 포함)', () => {
  assert.equal(pickFrequentDestination([dest(5)])?.visit_count, 5);
});

test('목적지가 없으면(빈 배열) null', () => {
  assert.equal(pickFrequentDestination([]), null);
});

test('MIN_FREQUENT_VISITS는 5다', () => {
  assert.equal(MIN_FREQUENT_VISITS, 5);
});
