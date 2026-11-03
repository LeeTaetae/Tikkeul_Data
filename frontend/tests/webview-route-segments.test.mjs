// Android(모바일 WebView)가 실제로 실행하는 지도 HTML(kakaoMapHtml.ts)의 경로선 코드를 가짜 Kakao SDK 로 실행해서,
// showTransitRoute 가 만든 구간 선이 구간마다 Polyline 으로 그려지고, 다른 경로 그리기와 섞이지 않는지 확인한다.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';

import { kakaoMapHtml } from '../src/map/kakaoMapHtml.ts';
import { buildRouteSegments, WALK_COLOR } from '../src/lib/navigation/transitColors.ts';

// WebView 안의 <script> 코드(SDK 를 불러오는 첫 script 는 제외)를 꺼내 가짜 SDK 위에서 실행한다.
function bootMap() {
  const html = kakaoMapHtml('TEST');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  const lines = [];
  const maps = [];
  const messages = [];
  const el = () => ({ style: {}, appendChild() {}, addEventListener() {}, setAttribute() {}, innerHTML: '' });
  class Polyline {
    constructor(options) { this.options = options; this.map = options.map; lines.push(this); }
    setMap(map) { this.map = map; }
    setPath(path) { this.options.path = path; }
  }
  const kakao = {
    maps: {
      load: (cb) => cb(),
      LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } getLat() { return this.lat; } getLng() { return this.lng; } },
      LatLngBounds: class { constructor() { this.points = []; } extend(p) { this.points.push(p); } },
      Map: class { constructor() { this.bounds = null; maps.push(this); } setBounds(b) { this.bounds = b; } panTo() {} setLevel() {} },
      CustomOverlay: class { constructor() {} setMap() {} setPosition() {} },
      Polyline,
      event: { addListener() {} },
    },
  };
  const window = { kakao, ReactNativeWebView: { postMessage: (m) => messages.push(JSON.parse(m)) } };
  const document = { createElement: el, getElementById: el, querySelector: el };
  vm.runInNewContext(scripts[0], { window, document, kakao, JSON, Object, Array, Math });
  assert.deepEqual(messages.at(-1), { type: 'ready' });
  return { KMAP: window.KMAP, lines, maps };
}

const P = (i) => ({ lat: 37.5, lng: 127 + i * 0.001 });
const path = [P(0), P(1), P(2), P(2), P(3), P(3), P(4), P(5)];
const option = {
  path,
  steps: [
    { type: 'SUBWAY', vehicles: [{ name: '2호선', type: '일반' }], pathStartIndex: 0 },
    { type: 'WALKING', vehicles: [], pathStartIndex: 3 },
    { type: 'SUBWAY', vehicles: [{ name: '3호선', type: '일반' }], pathStartIndex: 5 },
  ],
};

test('구간별로 Polyline 이 하나씩 만들어지고 색·점선이 구간 계산 결과와 같다', () => {
  const { KMAP, lines } = bootMap();
  const segments = buildRouteSegments(option);
  KMAP.showRouteSegments(JSON.parse(JSON.stringify(segments)), {}); // RN → WebView 는 JSON 으로 전달된다
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.options.strokeColor), ['#009D3E', WALK_COLOR, '#EF7C1C']);
  assert.deepEqual(lines.map((l) => l.options.strokeStyle), ['solid', 'dash', 'solid']);
  assert.ok(lines.every((l) => l.map !== null));
});

test('다시 그리면 이전 구간 선은 지도에서 제거된다', () => {
  const { KMAP, lines } = bootMap();
  const segments = JSON.parse(JSON.stringify(buildRouteSegments(option)));
  KMAP.showRouteSegments(segments, {});
  const first = [...lines];
  KMAP.showRouteSegments(segments.slice(0, 1), {});
  assert.ok(first.every((l) => l.map === null)); // 이전 선 전부 제거
  assert.equal(lines.length, first.length + 1);
});

test('단색 showRoute 로 바꾸면 구간 선이 지워지고, clearRoute 도 구간 선을 지운다', () => {
  const { KMAP, lines } = bootMap();
  KMAP.showRouteSegments(JSON.parse(JSON.stringify(buildRouteSegments(option))), {});
  const colored = [...lines];
  KMAP.showRoute(path, { fit: true });
  assert.ok(colored.every((l) => l.map === null)); // 단색이 구간 선 위에 겹치지 않는다
  assert.equal(lines.at(-1).options.strokeColor, '#5B5BD6'); // 폴백(옛 서버)일 때의 보라 단색
  KMAP.showRouteSegments(JSON.parse(JSON.stringify(buildRouteSegments(option))), {});
  const again = lines.slice(-3);
  KMAP.clearRoute();
  assert.ok(again.every((l) => l.map === null));
});

test('구간 선을 그리면 지도 범위(fit)가 모든 구간의 점을 포함하고, fit:false 면 범위를 바꾸지 않는다', () => {
  const segments = JSON.parse(JSON.stringify(buildRouteSegments(option)));
  const fit = bootMap();
  fit.KMAP.showRouteSegments(segments, {});
  const uniquePoints = new Set(segments.flatMap((s) => s.path).map((p) => `${p.lat},${p.lng}`));
  assert.equal(new Set(fit.maps[0].bounds.points.map((p) => `${p.lat},${p.lng}`)).size, uniquePoints.size);
  const noFit = bootMap();
  noFit.KMAP.showRouteSegments(segments, { fit: false });
  assert.equal(noFit.maps[0].bounds, null);
});
