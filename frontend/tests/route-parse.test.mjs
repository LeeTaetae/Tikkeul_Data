// A단계 백엔드 확장(guides, include_guides, styles, Incident 추가 필드)을 프론트가 안전하게 읽는지 검증한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { incidentToAlert } from '../src/lib/api/convert.ts';
import { buildRouteBody, parseGuides, parseRoutes } from '../src/map/parseRoutes.ts';

const O = { lat: 37.5, lng: 127.0 };
const D = { lat: 37.51, lng: 127.01 };

const apiRoute = (extra = {}) => ({
  style: 'recommended',
  distance_km: 2.1,
  duration_min: 7,
  path: [O, D],
  instructions: ['직진'],
  ...extra,
});

test('guides 키가 없는 기존 응답은 예전과 똑같이 읽는다(guides 키도 만들지 않는다)', () => {
  const [route] = parseRoutes({ routes: [apiRoute()] });
  assert.deepEqual(route, { style: 'recommended', distanceKm: 2.1, durationMin: 7, path: [O, D], instructions: ['직진'] });
  assert.equal('guides' in route, false);
});

test('guides 를 camelCase 로 읽고, 응답에서 빠진 선택 필드는 만들어내지 않는다', () => {
  const [route] = parseRoutes({
    routes: [
      apiRoute({
        guides: [
          { index: 0, lat: 37.5, lng: 127.0, path_index: 0, point_type: 'S', description: '출발', name: '', next_road_name: '테헤란로', leg_distance_m: 120, leg_time_sec: 30, turn_type: 200 },
          { index: 3, lat: 37.505, lng: 127.005, path_index: 4 }, // turn_type·leg_*·문자열 필드 모두 없음
        ],
      }),
    ],
  });
  const [full, sparse] = route.guides;
  assert.deepEqual(full, { index: 0, lat: 37.5, lng: 127.0, pathIndex: 0, pointType: 'S', description: '출발', name: '', nextRoadName: '테헤란로', turnType: 200, legDistanceM: 120, legTimeSec: 30 });
  assert.deepEqual(sparse, { index: 3, lat: 37.505, lng: 127.005, pathIndex: 4, pointType: '', description: '', name: '', nextRoadName: '' });
  assert.equal('turnType' in sparse, false);
  assert.equal('legDistanceM' in sparse, false);
  assert.equal('legTimeSec' in sparse, false);
});

test('parseGuides: 배열이 아니면 undefined, 좌표·path_index 가 깨진 항목은 버리고 index 가 없으면 순서를 쓴다', () => {
  assert.equal(parseGuides(undefined), undefined);
  assert.equal(parseGuides(null), undefined);
  assert.equal(parseGuides({}), undefined);
  assert.deepEqual(parseGuides([]), []);
  const guides = parseGuides([
    { lat: '37.5', lng: 127, path_index: 0 }, // 문자열 좌표
    { lat: 37.5, lng: 127, path_index: -1 }, // 음수 path_index
    null,
    { lat: 37.5, lng: 127, path_index: 2, leg_distance_m: 'x', turn_type: null }, // 숫자가 아닌 선택 필드
  ]);
  assert.equal(guides.length, 1);
  assert.equal(guides[0].index, 3); // 원래 배열에서의 위치
  assert.equal('legDistanceM' in guides[0], false);
  assert.equal('turnType' in guides[0], false);
});

test('경로 목록이 비었거나 형식이 다르면 null (기존 동작)', () => {
  assert.equal(parseRoutes({ routes: [] }), null);
  assert.equal(parseRoutes({}), null);
  assert.equal(parseRoutes(null), null);
});

test('요청 본문: 옵션이 없으면 기존 본문과 똑같고, 안내 요청만 include_guides 를 넣는다', () => {
  assert.deepEqual(buildRouteBody(O, D), { origin: O, destination: D });
  assert.deepEqual(buildRouteBody(O, D, {}), { origin: O, destination: D });
  assert.deepEqual(buildRouteBody(O, D, { includeGuides: false }), { origin: O, destination: D });
  assert.deepEqual(buildRouteBody(O, D, { includeGuides: true }), { origin: O, destination: D, include_guides: true });
  assert.deepEqual(buildRouteBody(O, D, { includeGuides: true, styles: ['recommended'] }), {
    origin: O,
    destination: D,
    include_guides: true,
    styles: ['recommended'],
  });
  assert.deepEqual(buildRouteBody(O, D, { styles: [] }), { origin: O, destination: D }); // 빈 목록은 보내지 않는다(백엔드가 거부)
});

test('요청 본문: 도보 요청의 mode 는 그대로 유지된다', () => {
  assert.deepEqual(buildRouteBody(O, D, { includeGuides: true }, { mode: 'walking' }), { origin: O, destination: D, mode: 'walking', include_guides: true });
  assert.deepEqual(buildRouteBody(O, D, {}, { mode: 'walking' }), { origin: O, destination: D, mode: 'walking' });
});

// ───────────── Incident 추가 필드 ─────────────

const incident = (extra = {}) => ({
  id: 'i1',
  kind: 'accident',
  road_type: '',
  event_type: '사고',
  event_detail_type: '',
  road_name: '경부고속도로',
  road_no: '1',
  direction_text: '양방향',
  lanes_blocked: '1차로',
  message: '추돌 사고',
  link_id: '',
  location: { lat: 37.5, lon: 127.0 },
  started_at: '2026-10-29T10:00:00+09:00',
  ended_at: null,
  ...extra,
});

test('이전 응답(추가 필드 없음)의 변환 결과에는 새 키가 생기지 않는다', () => {
  const alert = incidentToAlert(incident(), '위치');
  for (const key of ['eventKey', 'revision', 'closure', 'directionScope']) assert.equal(key in alert, false, key);
});

test('event_key·closure·direction_scope 가 있으면 알림으로 옮기고, revision 은 옮기지 않는다', () => {
  const alert = incidentToAlert(incident({ event_key: 'ek1', revision: 'rv2', closure: 'partial', direction_scope: 'both', lanes_block_type: '차로부분통제' }), '위치');
  assert.equal(alert.eventKey, 'ek1');
  assert.equal('revision' in alert, false); // 사소한 변경에도 바뀌어 같은 위험을 반복 경고하게 만든다
  assert.equal(alert.closure, 'partial');
  assert.equal(alert.directionScope, 'both');
  assert.equal(alert.id, 'i1'); // 기존 id 는 그대로
});

test('빈 문자열 event_key 는 옮기지 않는다', () => {
  const alert = incidentToAlert(incident({ event_key: '', revision: '' }), '위치');
  assert.equal('eventKey' in alert, false);
  assert.equal('revision' in alert, false);
});
