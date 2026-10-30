import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeNavigationRequest } from '../src/lib/navigation/nativeNavigationRequest.ts';

const request = {
  origin: { lat: 37.5665, lng: 126.978 },
  destination: { lat: 37.5701, lng: 126.9769 },
  destinationLabel: '  목적지  ',
  mode: 'driving',
  style: 'recommended',
};

test('native SDK receives WGS84 coordinates with latitude and longitude kept in order', () => {
  const options = nativeNavigationRequest(request);
  assert.equal(options.originLatitude, request.origin.lat);
  assert.equal(options.originLongitude, request.origin.lng);
  assert.equal(options.destinationLatitude, request.destination.lat);
  assert.equal(options.destinationLongitude, request.destination.lng);
  assert.equal(options.destinationLabel, '목적지');
});

test('all supported driving preferences reach the native engine unchanged', () => {
  for (const style of ['recommended', 'shortest', 'major_road', 'toll_free', 'avoid_school_zone']) {
    assert.equal(nativeNavigationRequest({ ...request, style }).routeStyle, style);
  }
});

test('unsupported modes, options, and invalid coordinates are rejected before SDK launch', () => {
  assert.throws(() => nativeNavigationRequest({ ...request, mode: 'walking' }), { code: 'UNSUPPORTED_MODE' });
  assert.throws(() => nativeNavigationRequest({ ...request, style: 'unknown' }), { code: 'INVALID_REQUEST' });
  for (const point of [{ lat: NaN, lng: 127 }, { lat: 37, lng: Infinity }, { lat: 91, lng: 127 }, { lat: 37, lng: -181 }]) {
    assert.throws(() => nativeNavigationRequest({ ...request, origin: point }), { code: 'INVALID_REQUEST' });
    assert.throws(() => nativeNavigationRequest({ ...request, destination: point }), { code: 'INVALID_REQUEST' });
  }
});

test('native destination labels are bounded without putting coordinates into route URLs', () => {
  const result = nativeNavigationRequest({ ...request, destinationLabel: '목'.repeat(400) });
  assert.equal(result.destinationLabel.length, 256);
  assert.equal('url' in result, false);
});
