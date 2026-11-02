import test from 'node:test';
import assert from 'node:assert/strict';

import { toFallbackPopular } from '../src/lib/places/popularFallback.ts';

test('merges and sorts by distance, maps to FrequentDestination shape', () => {
  const restaurants = [{ name: '김밥천국', address: '서울시 종로구', distanceM: 300, point: { lat: 37.1, lng: 127.1 } }];
  const cafes = [{ name: '스타벅스', address: '서울시 종로구', distanceM: 100, point: { lat: 37.2, lng: 127.2 } }];
  const result = toFallbackPopular([...restaurants, ...cafes], 20);
  assert.equal(result.length, 2);
  assert.equal(result[0].label, '스타벅스');
  assert.equal(result[0].lat, 37.2);
  assert.equal(result[0].lon, 127.2);
  assert.equal(result[0].address_text, '서울시 종로구');
  assert.equal(result[1].label, '김밥천국');
});

test('limit 보다 많으면 상위 N개만 남긴다', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    name: `place-${i}`,
    address: 'addr',
    distanceM: i,
    point: { lat: 0, lng: 0 },
  }));
  const result = toFallbackPopular(many, 20);
  assert.equal(result.length, 20);
  assert.equal(result[0].label, 'place-0');
});

test('빈 배열을 넣으면 빈 배열을 돌려준다', () => {
  assert.deepEqual(toFallbackPopular([], 20), []);
});
