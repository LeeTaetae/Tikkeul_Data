// onGuidance 진단(개발 빌드 전용)의 테스트: 기본 OFF·운영 차단, 6000점 잘림 감지, 좌표 비저장(요약)·허용 필드만 저장(좌표 수준),
// 기존 제품 구독(useNativeHazardRail 이 쓰는 onNativeGuidanceFeed)에 영향이 없는지.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import {
  MAX_LOCATION_EVENTS, MAX_ROUTE_EVENTS, SDK_ROUTE_POINT_CAP, createGuidanceCapture, summarizeRouteEvent,
} from '../src/lib/navigation/guidanceCapture.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const LNG0 = 127.09876;
const LAT0 = 37.51234;

/** 동쪽으로 stepM 간격으로 n 개 점을 가진 route 이벤트(SDK 형식). count 를 따로 줄 수 있다. */
function routeEvent(n, { count = n, stepM = 40, reason = 'started', keys = ['x', 'y'] } = {}) {
  const dLng = stepM / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
  const points = Array.from({ length: n }, (_, i) => ({ x: LNG0 + i * dLng, y: LAT0 }));
  return { kind: 'route', reason, count, keys, points };
}
const locationEvent = (i, extra = {}) => ({ kind: 'location', lat: LAT0 + i * 1e-5, lng: LNG0, speedKmh: 80, angle: 90, hdop: 1.2, posTrust: true, valid: true, ...extra });
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };

function harness({ allowed = true } = {}) {
  const calls = { subscribe: 0, unsubscribe: 0 };
  let listener = null;
  const subscribe = (l) => { calls.subscribe++; listener = l; return () => { calls.unsubscribe++; listener = null; }; };
  let t = 1_000_000;
  const logs = [];
  const capture = createGuidanceCapture({ allowed, now: () => (t += 1000), log: (...a) => logs.push(a.join(' ')) }, subscribe);
  return { capture, calls, logs, emit: (ev) => listener?.(ev), hasListener: () => listener !== null };
}

test('summarizeRouteEvent: 모두 실린 경로는 잘림 없음, 앱 파서가 받아들이고 길이·간격을 센다', () => {
  const s = summarizeRouteEvent(routeEvent(1000, { stepM: 40 }), 0);
  assert.equal(s.truncated, false);
  assert.equal(s.cause, 'none');
  assert.equal(s.shortfall, 0);
  assert.equal(s.appWouldUseRoute, true);
  assert.ok(Math.abs(s.lengthM - 39_960) < 400, `길이 ${s.lengthM}`);
  assert.ok(Math.abs(s.avgSpacingM - 40) <= 1);
});

test('6000점 잘림 감지: count 가 실린 점보다 크고 실린 점이 상한이면 truncated=true, 빠진 점 수와 전체 길이 추정', () => {
  const s = summarizeRouteEvent(routeEvent(SDK_ROUTE_POINT_CAP, { count: 7500, stepM: 40 }), 0);
  assert.equal(s.truncated, true);
  assert.equal(s.cause, 'cap');
  assert.equal(s.count, 7500);
  assert.equal(s.delivered, 6000);
  assert.equal(s.shortfall, 1500);
  assert.ok(s.estimatedFullLengthM > s.lengthM);
  assert.ok(Math.abs(s.estimatedFullLengthM - 7500 * 40) < 4000); // 균등 간격 가정이므로 대략 일치
  assert.equal(s.appWouldUseRoute, true); // 앱은 잘린 경로를 그대로 받아들인다 = 문제가 눈에 안 띈다
});

test('상한 아래에서 점이 빠진 경우는 잘림(cap)이 아니라 invalid_points, count 가 없으면 unknown', () => {
  const a = summarizeRouteEvent(routeEvent(90, { count: 100 }), 0);
  assert.deepEqual([a.truncated, a.cause, a.shortfall], [false, 'invalid_points', 10]);
  const ev = routeEvent(50); delete ev.count;
  const b = summarizeRouteEvent(ev, 0);
  assert.deepEqual([b.cause, b.count, b.truncated], ['unknown', null, false]);
});

test('앱이 버리는 경로(한 점이라도 잘못됨)는 appWouldUseRoute=false 이고 길이를 만들지 않는다', () => {
  const ev = routeEvent(100);
  ev.points[40] = { x: 'bad', y: 1 };
  const s = summarizeRouteEvent(ev, 0);
  assert.equal(s.appWouldUseRoute, false);
  assert.equal(s.lengthM, null);
});

test('요약에는 좌표 값이 없다', () => {
  const s = summarizeRouteEvent(routeEvent(500), 0);
  const json = JSON.stringify(s);
  assert.ok(!json.includes('37.51'), json);
  assert.ok(!json.includes('127.09'), json);
});

test('기본은 OFF: 켜기 전에는 구독도 기록도 없다(기존 동작과 같음)', () => {
  const h = harness();
  assert.equal(h.capture.status().level, 'off');
  assert.equal(h.calls.subscribe, 0);
  h.emit(routeEvent(10)); // 구독이 없으므로 도달할 수 없다
  h.capture.record(routeEvent(10)); // 직접 불러도 OFF 면 무시
  h.capture.record(locationEvent(1));
  const s = h.capture.status();
  assert.deepEqual([s.routeEvents, s.locationEvents, s.holdsCoordinates], [0, 0, false]);
});

test('운영 빌드(allowed=false): 켜기 거부, 구독 없음, 기록 없음', () => {
  const h = harness({ allowed: false });
  assert.equal(h.capture.setLevel('summary'), false);
  assert.equal(h.capture.setLevel('coordinates'), false);
  assert.equal(h.calls.subscribe, 0);
  h.capture.record(routeEvent(10));
  h.capture.record(locationEvent(1));
  const s = h.capture.status();
  assert.deepEqual([s.level, s.allowed, s.routeEvents, s.locationEvents, s.holdsCoordinates], ['off', false, 0, 0, false]);
  assert.equal(h.capture.setLevel('off'), true); // 끄기는 항상 가능
});

test('요약 수준: 통계만 모으고 좌표는 저장·출력(로그·export)하지 않는다', () => {
  const h = harness();
  assert.equal(h.capture.setLevel('summary'), true);
  assert.equal(h.calls.subscribe, 1);
  h.emit(routeEvent(SDK_ROUTE_POINT_CAP, { count: 6400 }));
  for (let i = 0; i < 5; i++) h.emit(locationEvent(i, i === 3 ? { valid: false } : {}));
  const s = h.capture.status();
  assert.equal(s.routeEvents, 1);
  assert.equal(s.routes[0].truncated, true);
  assert.deepEqual([s.location.total, s.location.valid, s.location.invalid], [5, 4, 1]);
  assert.equal(s.holdsCoordinates, false);
  const out = [h.capture.exportText(), ...h.logs, JSON.stringify(s)].join('\n');
  assert.ok(!out.includes('37.51'), '위도가 출력에 있다');
  assert.ok(!out.includes('127.09'), '경도가 출력에 있다');
  assert.ok(h.logs.some((l) => l.includes('truncated=true') && l.includes('delivered=6000') && l.includes('count=6400')));
  assert.equal(JSON.parse(h.capture.exportText()).coordinates, false);
});

test('좌표 수준: 소수 5자리로 보관하고 허용 목록 필드만 export 한다(키·토큰 같은 필드는 버린다)', () => {
  const h = harness();
  h.capture.setLevel('coordinates');
  h.emit(routeEvent(20, { count: 20 }));
  h.emit(locationEvent(1, { token: 'SECRET-TOKEN', apiKey: 'SECRET-KEY', authorization: 'Bearer x', session: 'abc', distFromS: 1234.6, extra: { nested: 1 } }));
  const text = h.capture.exportText();
  assert.ok(!/SECRET|Bearer|abc|nested|apiKey|token|authorization/.test(text), text.slice(0, 300));
  const lines = text.split('\n').map((l) => JSON.parse(l));
  const route = lines.find((l) => l.kind === 'route');
  const loc = lines.find((l) => l.kind === 'location');
  assert.equal(route.points.length, 20);
  assert.deepEqual(route.keys, ['x', 'y']);
  assert.equal(route.count, 20);
  for (const [x, y] of route.points) assert.ok(String(x).split('.')[1].length <= 5 && String(y).split('.')[1].length <= 5);
  assert.deepEqual(Object.keys(loc).sort(), ['angle', 'distFromS', 'hdop', 'kind', 'lat', 'lng', 'posTrust', 'speedKmh', 't', 'valid']); // 허용 목록 밖 필드(token 등)는 없다
  assert.equal(loc.distFromS, 1235);
  assert.equal(h.capture.status().holdsCoordinates, true);
});

test('좌표 수준의 잘린 경로: export 의 count 는 SDK 전체 수, points 는 실린 6000개 → 재생기가 잘림을 감지한다', () => {
  const h = harness();
  h.capture.setLevel('coordinates');
  h.emit(routeEvent(SDK_ROUTE_POINT_CAP, { count: 7000 }));
  const route = JSON.parse(h.capture.exportText().split('\n')[0]);
  assert.equal(route.count, 7000);
  assert.equal(route.points.length, 6000);
});

test('앱이 버리는 경로의 점은 좌표 수준에서도 보관하지 않는다', () => {
  const h = harness();
  h.capture.setLevel('coordinates');
  const ev = routeEvent(30); ev.points[5] = { x: 'bad', y: 'bad' };
  h.emit(ev);
  assert.equal(h.capture.status().routes[0].appWouldUseRoute, false);
  assert.ok(!h.capture.exportText().includes('"points"'));
});

test('메모리 상한: 경로 이벤트는 최근 3개, 위치는 3600개만 유지하고 버린 수를 센다', () => {
  const h = harness();
  h.capture.setLevel('coordinates');
  for (let i = 0; i < MAX_ROUTE_EVENTS + 2; i++) h.emit(routeEvent(10, { reason: `r${i}` }));
  for (let i = 0; i < MAX_LOCATION_EVENTS + 25; i++) h.emit(locationEvent(i));
  const s = h.capture.status();
  assert.equal(s.routes.length, MAX_ROUTE_EVENTS);
  assert.equal(s.droppedRoutes, 2);
  assert.equal(s.droppedLocations, 25);
  const lines = h.capture.exportText().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.kind === 'route').length, MAX_ROUTE_EVENTS);
  assert.equal(lines.filter((l) => l.kind === 'location').length, MAX_LOCATION_EVENTS);
});

test('clear: 좌표를 지우고 export 는 좌표 없는 요약이 된다. 끄면 구독이 끊기고, 수준을 바꾸면 이전 좌표도 버린다', () => {
  const h = harness();
  h.capture.setLevel('coordinates');
  h.emit(routeEvent(10)); h.emit(locationEvent(1));
  assert.equal(h.capture.status().holdsCoordinates, true);
  h.capture.clear();
  assert.equal(h.capture.status().holdsCoordinates, false);
  assert.equal(JSON.parse(h.capture.exportText()).coordinates, false);
  assert.equal(h.capture.status().level, 'coordinates'); // 삭제해도 켜짐 상태는 그대로

  h.emit(locationEvent(2));
  h.capture.setLevel('summary'); // 수준 변경 = 새 세션
  assert.equal(h.capture.status().holdsCoordinates, false);
  assert.equal(h.calls.unsubscribe, 1);
  h.capture.setLevel('off');
  assert.equal(h.hasListener(), false);
  assert.equal(h.calls.unsubscribe, 2);
});

test('기록기는 예외를 밖으로 던지지 않고 입력 이벤트를 바꾸지 않는다', () => {
  const h = harness();
  h.capture.setLevel('coordinates');
  const bomb = { kind: 'route', get points() { throw new Error('boom'); } };
  assert.doesNotThrow(() => h.emit(bomb));
  assert.equal(h.capture.status().recorderErrors, 1);
  const ev = deepFreeze(routeEvent(30));
  const loc = deepFreeze(locationEvent(1));
  assert.doesNotThrow(() => { h.emit(ev); h.emit(loc); });
  assert.equal(h.capture.status().recorderErrors, 1); // 얼려진 이벤트로도 오류가 없다 = 입력을 바꾸지 않는다
  assert.doesNotThrow(() => h.emit({ kind: 'something-else', a: 1 }));
  assert.doesNotThrow(() => h.emit({}));
});

// ---- GPS 매칭 · 진행 방향 진단 ----
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
/** 경로(동쪽 직선) 위 distM 지점의 위치 이벤트. northM 만큼 북쪽으로 벗어날 수 있다. angle 은 북=0 시계방향(동쪽=90). */
const locAt = (distM, { northM = 0, angle = 90, speedKmh = 80, valid = true } = {}) => ({
  kind: 'location', lat: LAT0 + northM / 111_320, lng: LNG0 + distM / M_PER_DEG_LNG, speedKmh, angle, hdop: 1, posTrust: true, valid,
});
const started = (level = 'summary', route = routeEvent(1000, { stepM: 40 })) => {
  const h = harness();
  h.capture.setLevel(level);
  h.emit(route);
  return h;
};

test('매칭: 경로 위를 달리는 위치는 모두 경로에 맞고 진행 거리는 늘어나며 방향 반대는 없다', () => {
  const h = started();
  for (let i = 0; i < 100; i++) h.emit(locAt(i * 22, { northM: (i % 3) - 1 }));
  const m = h.capture.status().match;
  assert.equal(m.evaluated, 100);
  assert.equal(m.matched, 100);
  assert.equal(m.offRoute, 0);
  assert.ok(m.lateralMaxM <= 1.5, `최대 횡거리 ${m.lateralMaxM}`);
  assert.equal(m.backwardJumps, 0);
  assert.deepEqual([m.headingOpposite, m.headingEvaluated], [0, 100]);
  assert.ok(Math.abs(m.lastAlongM - 99 * 22) <= 2);
  assert.ok(Math.abs(m.routeLengthM - 999 * 40) <= 400);
});

test('매칭: 경로에서 벗어난 위치·반대 방향·되돌아감·경로 전 수신을 구분해 센다', () => {
  const h = harness();
  h.capture.setLevel('summary');
  h.emit(locAt(100)); // 경로 이벤트 전
  assert.equal(h.capture.status().match.noRoute, 1);
  h.emit(routeEvent(1000, { stepM: 40 }));
  h.emit(locAt(5000)); // 정상
  h.emit(locAt(5100, { northM: 200 })); // 200m 벗어남
  h.emit(locAt(5200, { angle: 270 })); // 서쪽으로 가는 중(경로는 동쪽)
  h.emit(locAt(5300, { angle: 270, speedKmh: 3 })); // 느리면 방향을 판단하지 않는다
  h.emit(locAt(1000)); // 4km 뒤로 되돌아감
  h.emit(locAt(1100, { valid: false })); // 무효 위치는 판정하지 않는다
  const m = h.capture.status().match;
  assert.equal(m.evaluated, 5);
  assert.equal(m.offRoute, 1);
  assert.ok(m.lateralMaxM >= 190 && m.lateralMaxM <= 210);
  assert.deepEqual([m.headingOpposite, m.headingEvaluated], [1, 3]);
  assert.equal(m.backwardJumps, 1);
});

test('매칭: 재탐색(경로 변경)은 진행 기준을 새로 잡아 되돌아감으로 세지 않고 경로 변경 횟수만 센다', () => {
  const h = started();
  h.emit(locAt(8000));
  h.emit(routeEvent(500, { stepM: 40, reason: 'changed' }));
  h.emit(locAt(300));
  const m = h.capture.status().match;
  assert.equal(m.routeChanges, 1);
  assert.equal(m.backwardJumps, 0);
  assert.ok(Math.abs(m.routeLengthM - 499 * 40) <= 200);
});

test('매칭: 6000점으로 잘린 경로의 뒤쪽 위치는 경로 밖으로 판정된다(잘림이 실제 알림 누락으로 이어지는 증거)', () => {
  const h = started('summary', routeEvent(SDK_ROUTE_POINT_CAP, { count: 7000, stepM: 40 }));
  const covered = (SDK_ROUTE_POINT_CAP - 1) * 40;
  h.emit(locAt(covered - 500));
  h.emit(locAt(covered + 1000)); // 잘린 구간(앱은 이 위치를 경로에 맞출 수 없다)
  const s = h.capture.status();
  assert.equal(s.routes[0].truncated, true);
  assert.equal(s.match.matched, 1);
  assert.equal(s.match.offRoute, 1);
});

test('매칭: 앱이 버리는 경로면 매칭할 경로가 없어 이후 위치는 경로 전 수신으로 센다', () => {
  const bad = routeEvent(100);
  bad.points[3] = { x: 'bad', y: 'bad' };
  const h = started('summary', bad);
  h.emit(locAt(100));
  const m = h.capture.status().match;
  assert.deepEqual([m.evaluated, m.noRoute, m.routeLengthM], [0, 1, null]);
});

test('매칭: 요약 수준에서도 좌표는 저장·출력되지 않고, 끄면 작업용 경로가 버려진다', () => {
  const h = started();
  for (let i = 0; i < 20; i++) h.emit(locAt(i * 30));
  const out = [h.capture.exportText(), JSON.stringify(h.capture.status()), ...h.logs].join('\n');
  assert.ok(!out.includes('37.51') && !out.includes('127.09'), out.slice(0, 200));
  assert.equal(JSON.parse(h.capture.exportText()).match.matched, 20);
  const before = h.capture.status().match.evaluated;
  h.capture.setLevel('off');
  h.capture.record(locAt(900)); // OFF 에서는 기록하지 않는다
  assert.equal(h.capture.status().match.evaluated, before);
  h.capture.setLevel('summary'); // 다시 켜면 새 세션 = 이전 경로·통계 없음
  h.emit(locAt(100));
  assert.deepEqual([h.capture.status().match.evaluated, h.capture.status().match.noRoute], [0, 1]);
});

test('화면은 진단 로직을 값으로 import 하지 않는다(운영 번들에 들어가지 않게 타입만 import)', () => {
  const screen = source('app/guidance-capture.tsx');
  const valueImports = [...screen.matchAll(/^import\s+(?!type\b)[^;]*from\s+'\.\.\/src\/(?:lib|native)[^']*';/gm)];
  assert.deepEqual(valueImports.map((m) => m[0]), []);
});

// ---- 기존 동작 보호(소스 수준 + 실제 어댑터 수준) ----

function nativeAdapter(nativeModule) {
  const exports = {};
  const code = ts.transpileModule(source('src/native/kakaoNavigation.native.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, __DEV__: false,
    require(name) {
      if (name === 'expo-modules-core') return { requireOptionalNativeModule: () => nativeModule };
      if (name === './navigationTypes') return { CAR_ICONS: ['default'] };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports;
}

test('진단 OFF 이면 제품 구독은 그대로 1개, 진단을 켜도 제품 리스너가 받는 이벤트는 같고 변경되지 않는다', () => {
  const listeners = [];
  let addCalls = 0;
  const nativeModule = { addListener(channel, cb) { assert.equal(channel, 'onGuidance'); addCalls++; listeners.push(cb); return { remove() { listeners.splice(listeners.indexOf(cb), 1); } }; } };
  const api = nativeAdapter(nativeModule);
  const deliver = (ev) => [...listeners].forEach((cb) => cb(ev));

  const productSeen = [];
  api.onNativeGuidanceFeed((ev) => productSeen.push(ev)); // useNativeHazardRail 과 같은 호출
  assert.equal(addCalls, 1);

  const capture = createGuidanceCapture({ allowed: true, now: Date.now }, api.onNativeGuidanceFeed);
  assert.equal(addCalls, 1, '진단을 만들기만 해서는 구독이 늘지 않는다');
  const events = [deepFreeze(routeEvent(50)), deepFreeze(locationEvent(1)), deepFreeze(locationEvent(2))];
  events.forEach(deliver);
  assert.equal(productSeen.length, 3);

  capture.setLevel('summary');
  assert.equal(addCalls, 2);
  const before = productSeen.length;
  events.forEach(deliver);
  assert.equal(productSeen.length - before, 3); // 제품 리스너는 진단과 상관없이 같은 이벤트를 그대로 받는다
  assert.deepEqual(productSeen.slice(before), events);
  assert.equal(capture.status().routeEvents, 1);

  capture.setLevel('off');
  assert.equal(listeners.length, 1); // 진단 리스너만 제거되고 제품 리스너는 남는다
});

test('기존 파일은 진단 모듈을 import 하지 않는다(경로 안내·TTS·위험 알림·객체 탐지 코드는 그대로)', () => {
  for (const file of [
    'src/lib/navigation/useNativeHazardRail.ts', 'src/lib/navigation/nativeGuidanceFeed.ts', 'src/native/kakaoNavigation.native.ts', 'src/native/kakaoNavigation.ts',
    'src/screens/NativeNavigationScreen.tsx', 'src/components/navigation/NativeHazardRailBridge.tsx', 'src/lib/speech/speaker.ts', 'src/lib/speech/speakerCore.ts',
    'src/components/vision/VisionHazardController.tsx', 'src/native/visionDetectorView.tsx', 'src/native/visionDetector.native.ts',
  ]) {
    assert.ok(!/guidanceCapture|guidance-capture/.test(source(file)), `${file} 이 진단 모듈을 참조한다`);
  }
});

test('진단 파일에는 네트워크·저장소·키 접근이 없다(메모리 전용)', () => {
  for (const file of ['src/lib/navigation/guidanceCapture.ts', 'src/dev/guidanceCapture.ts', 'app/guidance-capture.tsx']) {
    const text = source(file).replace(/\/\/.*$/gm, ''); // 주석 제외
    for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'API_BASE_URL', 'SecureStore', 'AsyncStorage', 'FileSystem', 'process.env', 'Linking']) {
      assert.ok(!text.includes(banned), `${file} 에 ${banned}`);
    }
  }
});

test('운영 빌드 차단: 화면은 __DEV__ 일 때만 개발 모듈을 require 하고, 연결부는 allowed 에 __DEV__ 를 넘긴다', () => {
  const screen = source('app/guidance-capture.tsx');
  assert.match(screen, /__DEV__\s*\?\s*require\('\.\.\/src\/dev\/guidanceCapture'\)\s*:\s*null/);
  assert.match(screen, /if \(!dev\) return null/);
  const index = source('app/index.tsx');
  assert.match(index, /__DEV__ && \(\s*(?:\/\/[^\n]*\n\s*)?<Pressable onPress=\{\(\) => router\.push\('\/guidance-capture' as never\)\}/);
  assert.match(source('app/_layout.tsx'), /name="guidance-capture" options=\{hiddenScreen\}/);

  for (const dev of [true, false]) {
    let seen = null;
    const code = ts.transpileModule(source('src/dev/guidanceCapture.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
      exports, __DEV__: dev, console, Date,
      require(name) {
        if (name === '../lib/navigation/guidanceCapture') return { createGuidanceCapture: (options) => { seen = options; return {}; } };
        if (name === '../native/kakaoNavigation') return { onNativeGuidanceFeed: () => () => {} };
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    assert.equal(seen.allowed, dev);
  }
});
