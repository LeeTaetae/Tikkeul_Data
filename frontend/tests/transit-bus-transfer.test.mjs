// 대중교통 버스 환승 색: 검색 카드와 지도 경로선이 같은 색 결정 함수를 쓰고, 버스→버스 환승이 지도에서 다른 색으로 그려지는지.
// 구간 구성과 인덱스는 실제 API 응답(2026-11, 부천역 남부광장 → 역삼세무서)과 같다:
//   옵션 A: 31·31-3(일반, TAGO 확정) → 도보 → 3200(직행, 미확정)   path 581점, 시작 인덱스 0 / 150 / 154
//   옵션 B: 015(마을, 미확정) → 도보 → 3200(직행, 미확정)          path 643점, 시작 인덱스 0 / 206 / 210
// 좌표는 실제 응답 대신 같은 개수의 점을 동쪽으로 늘어놓은 것이다(색·인덱스 계산에는 좌표 값이 쓰이지 않고, 구간 경계 간격만 본다).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import {
  DEFAULT_BUS_COLOR,
  EXPRESS_BUS_COLOR,
  OFFICIAL_BUS_COLORS,
  REGULAR_BUS_COLOR,
  SEOUL_BUS_COLORS,
  WALK_COLOR,
  buildRouteSegments,
  busLegColor,
} from '../src/lib/navigation/transitColors.ts';
import { kakaoMapHtml } from '../src/map/kakaoMapHtml.ts';
import { parseTransitVehicle } from '../src/map/parseTransitVehicle.ts';

const line = (n) => Array.from({ length: n }, (_, i) => ({ lat: 37.48 + i * 0.00002, lng: 126.78 + i * 0.00008 }));
// 서버 응답(JSON)의 vehicle 모양 -> 앱이 쓰는 모양(parseTransitVehicle)
const server = (name, type, extra = {}) => parseTransitVehicle({ name, type, ...extra });
const confirmedGyeonggi = (name) => server(name, '일반', { route_id: 'GGB224000004', operator_region: 'gyeonggi', route_class: '일반버스', match_confidence: 'high' });

const optionA = {
  path: line(581),
  steps: [
    { type: 'BUS', vehicles: [confirmedGyeonggi('31'), confirmedGyeonggi('31-3')], pathStartIndex: 0 },
    { type: 'WALKING', vehicles: [], pathStartIndex: 150 },
    { type: 'BUS', vehicles: [server('3200', '직행')], pathStartIndex: 154 },
  ],
};
const optionB = {
  path: line(643),
  steps: [
    { type: 'BUS', vehicles: [server('015', '마을')], pathStartIndex: 0 },
    { type: 'WALKING', vehicles: [], pathStartIndex: 206 },
    { type: 'BUS', vehicles: [server('3200', '직행')], pathStartIndex: 210 },
  ],
};

test('일반 31/31-3 → 직행 3200 환승: 두 버스가 서로 다른 색, 도보는 회색 점선, 구간 인덱스가 실제 좌표 배열과 맞는다', () => {
  const segments = buildRouteSegments(optionA);
  assert.deepEqual(segments.map((s) => [s.kind, s.color, s.dashed, s.path.length]), [
    ['bus', REGULAR_BUS_COLOR, false, 151], // 0..150 (다음 구간 첫 점까지 이어 그린다)
    ['walk', WALK_COLOR, true, 5], // 150..154
    ['bus', EXPRESS_BUS_COLOR, false, 427], // 154..580
  ]);
  assert.notEqual(segments[0].color, segments[2].color);
  assert.equal(segments[0].path[0], optionA.path[0]);
  assert.equal(segments[2].path.at(-1), optionA.path.at(-1));
});

test('마을 015 → 직행 3200 환승도 서로 다른 색이다', () => {
  const segments = buildRouteSegments(optionB);
  assert.deepEqual(segments.map((s) => [s.kind, s.color, s.dashed, s.path.length]), [
    ['bus', REGULAR_BUS_COLOR, false, 207],
    ['walk', WALK_COLOR, true, 5],
    ['bus', EXPRESS_BUS_COLOR, false, 433],
  ]);
});

test('검색 카드는 구간마다 busLegColor 를 쓰고, 그 값이 지도 구간선의 색과 같다', () => {
  for (const option of [optionA, optionB]) {
    const segments = buildRouteSegments(option);
    const busSteps = option.steps.filter((s) => s.type === 'BUS');
    const busSegments = segments.filter((s) => s.kind === 'bus');
    assert.equal(busSteps.length, busSegments.length);
    busSteps.forEach((step, i) => assert.equal(busLegColor(step.vehicles).color, busSegments[i].color));
  }
});

test('버스→지하철, 지하철→버스: 지하철은 호선색, 버스는 같은 함수의 색이고 경계가 이어진다', () => {
  const path = line(300);
  const busThenSubway = buildRouteSegments({
    path,
    steps: [
      { type: 'BUS', vehicles: [server('3200', '직행')], pathStartIndex: 0 },
      { type: 'WALKING', vehicles: [], pathStartIndex: 100 },
      { type: 'SUBWAY', vehicles: [server('2호선', '일반')], pathStartIndex: 104 },
    ],
  });
  assert.deepEqual(busThenSubway.map((s) => [s.kind, s.color]), [['bus', EXPRESS_BUS_COLOR], ['walk', WALK_COLOR], ['subway', '#009D3E']]);
  const subwayThenBus = buildRouteSegments({
    path,
    steps: [
      { type: 'SUBWAY', vehicles: [server('9호선', '급행')], pathStartIndex: 0 },
      { type: 'WALKING', vehicles: [], pathStartIndex: 150 },
      { type: 'BUS', vehicles: [server('서초03', '마을')], pathStartIndex: 154 },
    ],
  });
  assert.deepEqual(subwayThenBus.map((s) => [s.kind, s.color]), [['subway', '#BDB092'], ['walk', WALK_COLOR], ['bus', REGULAR_BUS_COLOR]]);
  for (const segments of [busThenSubway, subwayThenBus]) for (let i = 0; i + 1 < segments.length; i++) assert.deepEqual(segments[i].path.at(-1), segments[i + 1].path[0]);
});

test('서울 공식 확정 버스는 공식 색이고, 같은 서울 마을버스는 기본 색, 환승하면 서로 다르다', () => {
  const seoul = (name, cls) => server(name, cls, { route_id: '1', operator_region: 'seoul', route_class: cls, match_confidence: 'high' });
  assert.equal(busLegColor([seoul('402', '간선')]).color, SEOUL_BUS_COLORS['간선'].color);
  assert.equal(busLegColor([seoul('402', '간선')]).basis, 'official');
  assert.equal(busLegColor([seoul('서초03', '마을')]).color, DEFAULT_BUS_COLOR);
  assert.notEqual(busLegColor([seoul('402', '간선')]).color, busLegColor([seoul('1120', '지선')]).color);
});

// ── Android WebView 가 실제로 실행하는 지도 코드에서 구간별로 그려지는지 ──

function bootMap() {
  const scripts = [...kakaoMapHtml('TEST').matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const lines = [];
  const el = () => ({ style: {}, appendChild() {}, addEventListener() {}, setAttribute() {}, innerHTML: '' });
  class Polyline {
    constructor(options) { this.options = options; this.map = options.map; lines.push(this); }
    setMap(map) { this.map = map; }
    setPath(path) { this.options.path = path; }
  }
  const kakao = {
    maps: {
      load: (cb) => cb(),
      LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
      LatLngBounds: class { extend() {} },
      Map: class { setBounds() {} panTo() {} setLevel() {} },
      CustomOverlay: class { setMap() {} setPosition() {} },
      Polyline,
      event: { addListener() {} },
    },
  };
  const window = { kakao, ReactNativeWebView: { postMessage() {} } };
  vm.runInNewContext(scripts[0], { window, document: { createElement: el, getElementById: el, querySelector: el }, kakao, JSON, Object, Array, Math });
  return { KMAP: window.KMAP, lines };
}

test('WebView: 환승 경로가 버스·도보·버스 3개 Polyline 으로, 다른 색과 점선으로 그려지고 전체를 덮는 단일 선이 없다', () => {
  for (const [option, counts] of [[optionA, [151, 5, 427]], [optionB, [207, 5, 433]]]) {
    const { KMAP, lines } = bootMap();
    KMAP.showRouteSegments(JSON.parse(JSON.stringify(buildRouteSegments(option))), { fit: true }); // RN → WebView 는 JSON 문자열
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => l.options.strokeColor), [REGULAR_BUS_COLOR, WALK_COLOR, EXPRESS_BUS_COLOR]);
    assert.deepEqual(lines.map((l) => l.options.strokeStyle), ['solid', 'dash', 'solid']);
    assert.deepEqual(lines.map((l) => l.options.path.length), counts);
    assert.ok(lines.every((l) => l.map !== null));
    // setRoutePath(주행 중 남은 경로 갱신)가 구간 선을 단일 선으로 덮어쓰지 않는다
    KMAP.setRoutePath(option.path);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => l.options.path.length), counts);
  }
});

// 검색 카드(app/index.tsx)가 자기만의 버스 색 규칙을 다시 갖지 않고 busLegColor 를 쓰는지 소스로 확인한다(React Native 화면은 Node 로 실행할 수 없다).
import fs from 'node:fs';

test('검색 카드의 버스 색은 busLegColor 를 거치고, 카드에 직행/급행 색 규칙이 따로 없다', () => {
  const source = fs.readFileSync(new URL('../app/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ busLegColor \} from '\.\.\/src\/lib\/navigation\/transitColors'/);
  assert.match(source, /return busLegColor\(step\.vehicles\)\.color;/);
  assert.equal(/includes\('직행'\)|includes\('급행'\)/.test(source), false);
});

// ── 광역버스: 공식 노선 유형(공식 색)과 표시용 라벨(빨강)을 구별한다 ──

const gwangyeok = (region, cls, type = '광역') => server('9300', type, { route_id: 'R', operator_region: region, route_class: cls, match_confidence: 'high' });

test('광역버스: 공식 확정이면 서울·인천 공식 색(basis=official), 확정하지 못했으면 표시용 빨강(basis=category)', () => {
  const seoul = busLegColor([gwangyeok('seoul', '광역')]);
  assert.deepEqual([seoul.color, seoul.basis], [SEOUL_BUS_COLORS['광역'].color, 'official']);
  const incheon = busLegColor([gwangyeok('incheon', '광역버스')]);
  assert.deepEqual([incheon.color, incheon.basis], [OFFICIAL_BUS_COLORS.incheon['광역버스'].color, 'official']);
  const unverified = busLegColor([server('9300', '광역')]);
  assert.deepEqual([unverified.color, unverified.basis, unverified.labelSource], [EXPRESS_BUS_COLOR, 'category', 'kakao-label']);
  // 공식 HEX 와 표시용 HEX 는 다른 값이다: 색만 보고 공식 여부를 헷갈리지 않는다
  assert.notEqual(seoul.color, EXPRESS_BUS_COLOR);
  assert.notEqual(incheon.color, EXPRESS_BUS_COLOR);
});

test('경기 공식 유형 이름이 광역급행·직행좌석이면 표시용 빨강이고 글자의 출처는 공식 유형 이름이다. 일반버스는 초록', () => {
  const express = busLegColor([gwangyeok('gyeonggi', '광역급행버스', '광역')]);
  assert.deepEqual([express.color, express.basis, express.labelSource], [EXPRESS_BUS_COLOR, 'category', 'official-class']);
  const direct = busLegColor([gwangyeok('gyeonggi', '직행좌석버스', '일반')]); // 카카오 라벨이 '일반'이어도 공식 유형 이름이 우선
  assert.equal(direct.color, EXPRESS_BUS_COLOR);
  const regular = busLegColor([gwangyeok('gyeonggi', '일반버스', '광역')]); // 카카오 라벨이 '광역'이어도 공식 유형 이름이 우선
  assert.deepEqual([regular.color, regular.labelSource], [REGULAR_BUS_COLOR, 'official-class']);
});

test('옵션 13(88 일반 확정 → 9300 광역 미확정): 두 버스가 서로 다른 색이고 카드와 지도가 같다', () => {
  const option = {
    path: line(528),
    steps: [
      { type: 'BUS', vehicles: [confirmedGyeonggi('88')], pathStartIndex: 0 },
      { type: 'BUS', vehicles: [server('9300', '광역')], pathStartIndex: 50 },
    ],
  };
  const segments = buildRouteSegments(option);
  assert.deepEqual(segments.map((s) => s.color), [REGULAR_BUS_COLOR, EXPRESS_BUS_COLOR]);
  option.steps.forEach((step, i) => assert.equal(busLegColor(step.vehicles).color, segments[i].color));
});

test('광역과 일반이 한 구간에 섞이면 기본 색이다', () => {
  assert.equal(busLegColor([server('9300', '광역'), server('88', '일반')]).color, DEFAULT_BUS_COLOR);
});
