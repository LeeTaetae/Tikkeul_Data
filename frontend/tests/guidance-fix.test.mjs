// 자동차 안내 출발점 검증: 오래되거나 부정확하거나 깨진 좌표로는 안내를 시작하지 않는다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GUIDANCE_FIX_MAX_ACCURACY_M, GUIDANCE_FIX_MAX_AGE_MS, checkGuidanceFix } from '../src/lib/location/guidanceFix.ts';

const now = 1_800_000_000_000;
const fix = { lat: 37.6468, lng: 126.8338, accuracy: 8, timestamp: now - 1_000 };

test('a fresh, precise fix is accepted as the guidance start', () => {
  assert.equal(checkGuidanceFix(fix, now), null);
  assert.equal(checkGuidanceFix({ ...fix, accuracy: GUIDANCE_FIX_MAX_ACCURACY_M, timestamp: now - GUIDANCE_FIX_MAX_AGE_MS }, now), null);
});

test('old fixes are rejected as stale', () => {
  assert.equal(checkGuidanceFix({ ...fix, timestamp: now - GUIDANCE_FIX_MAX_AGE_MS - 1 }, now), 'stale');
});

test('network-level or unknown accuracy is rejected as inaccurate', () => {
  assert.equal(checkGuidanceFix({ ...fix, accuracy: 100 }, now), 'inaccurate');
  assert.equal(checkGuidanceFix({ ...fix, accuracy: null }, now), 'inaccurate');
  assert.equal(checkGuidanceFix({ ...fix, accuracy: NaN }, now), 'inaccurate');
});

test('broken coordinates or timestamps are rejected as invalid', () => {
  for (const bad of [{ lat: NaN }, { lng: Infinity }, { lat: 91 }, { lng: -181 }, { timestamp: NaN }]) {
    assert.equal(checkGuidanceFix({ ...fix, ...bad }, now), 'invalid');
  }
});
