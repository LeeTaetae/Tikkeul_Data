// 위치 → 조회 영역 계산, 권한·위치 실패 분류, 시군구 변환 실패 분류.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiClientError, classifyHttpError, createApiClient } from '../src/lib/api/client.ts';
import { classifyPermission, classifyPositionError, LOCATION_TIMEOUT_NAME } from '../src/lib/location/failure.ts';
import { areaFor, bboxAround, regionQueryFor, SEARCH_RADIUS_M } from '../src/lib/location/geo.ts';

const M_PER_DEG = 111320;
const approx = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);

test('조회 반경은 약 5km', () => assert.equal(SEARCH_RADIUS_M, 5000));

for (const lat of [0, 33.1, 37.5665, 38.6]) {
  test(`위도 ${lat}: 남북·동서 폭이 모두 약 10km (경도는 cos(위도) 보정)`, () => {
    const b = bboxAround({ latitude: lat, longitude: 127 });
    approx((b.maxLat - b.minLat) * M_PER_DEG, 10000, 5, '남북 폭(m)');
    approx((b.maxLon - b.minLon) * M_PER_DEG * Math.cos((lat * Math.PI) / 180), 10000, 5, '동서 폭(m)');
    assert.ok(b.maxLon - b.minLon < 0.3 && b.maxLat - b.minLat < 0.3, '백엔드 한도(한 변 0.3도) 이내');
  });
}

test('위도가 높을수록 같은 거리의 경도 폭이 넓다', () => {
  const lon = (lat) => { const b = bboxAround({ latitude: lat, longitude: 127 }); return b.maxLon - b.minLon; };
  assert.ok(lon(38) > lon(33));
});

test('같은 0.01도 격자 안의 위치는 같은 영역·같은 key (GPS 가 흔들려도 재조회하지 않는다)', () => {
  const a = areaFor({ latitude: 37.5601, longitude: 126.9801 });
  const b = areaFor({ latitude: 37.5649, longitude: 126.9849 });
  assert.equal(a.key, b.key);
  assert.deepEqual(a.bbox, b.bbox);
  assert.equal(a.key, '37.56,126.98');
});

test('격자 경계를 넘으면 영역이 바뀐다', () => {
  assert.notEqual(areaFor({ latitude: 37.5649, longitude: 126.98 }).key, areaFor({ latitude: 37.5651, longitude: 126.98 }).key);
});

test('영역 계산은 부동소수점 오차 없이 key 를 만든다', () => {
  for (const [lat, lon] of [[33.1, 126.27], [37.2425, 131.8696], [35.8, 129.2]]) {
    const k = areaFor({ latitude: lat, longitude: lon }).key;
    assert.match(k, /^\d{2}\.\d{2},\d{3}\.\d{2}$/);
  }
});

test('시군구 변환용 좌표는 소수 3자리로 반올림', () => {
  assert.deepEqual(regionQueryFor({ latitude: 37.566535, longitude: 126.977969 }), { key: '37.567,126.978', lat: 37.567, lon: 126.978 });
});

test('권한 분류: 허용 / 미정 / 거부 / 영구 거부', () => {
  assert.equal(classifyPermission({ status: 'granted', canAskAgain: true }), 'granted');
  assert.equal(classifyPermission({ status: 'undetermined', canAskAgain: true }), 'undetermined');
  assert.equal(classifyPermission({ status: 'denied', canAskAgain: true }), 'denied');
  assert.equal(classifyPermission({ status: 'denied', canAskAgain: false }), 'permanentlyDenied');
});

test('위치 조회 실패 분류: 웹 GeolocationPositionError 코드', () => {
  assert.equal(classifyPositionError({ code: 1, message: 'User denied Geolocation' }), 'denied');
  assert.equal(classifyPositionError({ code: 2, message: 'Position unavailable' }), 'unavailable');
  assert.equal(classifyPositionError({ code: 3, message: 'Timeout expired' }), 'timeout');
});

test('위치 조회 실패 분류: 직접 만든 시간 초과, 네이티브 문자열 코드, 알 수 없는 오류', () => {
  assert.equal(classifyPositionError(Object.assign(new Error('timeout'), { name: LOCATION_TIMEOUT_NAME })), 'timeout');
  assert.equal(classifyPositionError({ code: 'E_LOCATION_SERVICES_DISABLED', message: 'Location services are disabled' }), 'servicesDisabled');
  assert.equal(classifyPositionError({ code: 'E_LOCATION_SETTINGS_UNSATISFIED' }), 'servicesDisabled');
  assert.equal(classifyPositionError({ code: 'E_LOCATION_TIMEOUT' }), 'timeout');
  assert.equal(classifyPositionError(new Error('Not authorized to use location services')), 'servicesDisabled');
  assert.equal(classifyPositionError({ message: 'Permission denied' }), 'denied');
  assert.equal(classifyPositionError(new Error('???')), 'unavailable');
  assert.equal(classifyPositionError(undefined), 'unavailable');
});

test('시군구 변환 실패(REGION_NOT_FOUND)는 별도 종류로 구분한다', async () => {
  assert.equal(classifyHttpError(404, { error: { code: 'REGION_NOT_FOUND', message: '' } }).kind, 'regionNotFound');
  const client = createApiClient({ baseUrl: 'http://api.test', fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'REGION_NOT_FOUND', message: '' } }), { status: 404 }) });
  await assert.rejects(client.get('/api/geo/region', { lat: 35.67, lon: 139.65 }), (e) => e instanceof ApiClientError && e.kind === 'regionNotFound');
});

test('시군구 변환 요청 URL: 좌표 파라미터 이름', async () => {
  let url = '';
  const client = createApiClient({ baseUrl: 'http://api.test', fetchImpl: async (u) => ((url = u), new Response('{}')) });
  await client.get('/api/geo/region', { lat: 37.567, lon: 126.978 });
  assert.equal(url, 'http://api.test/api/geo/region?lat=37.567&lon=126.978');
});

test('국내 범위 판정: 본토·제주·울릉·독도는 안, 국외·(0,0)은 밖', async () => {
  const { isInKorea } = await import('../src/lib/location/geo.ts');
  for (const [lat, lon] of [[37.5665, 126.978], [33.4996, 126.5312], [37.4846, 130.9057], [37.2417, 131.8647], [35.1631, 129.1639], [33.1139, 126.2677]]) {
    assert.equal(isInKorea({ latitude: lat, longitude: lon }), true, `${lat},${lon}`);
  }
  for (const [lat, lon] of [[35.676, 139.65], [0, 0], [40.7, -74.0], [39.9, 116.4], [31.2, 121.5]]) {
    assert.equal(isInKorea({ latitude: lat, longitude: lon }), false, `${lat},${lon}`);
  }
});
