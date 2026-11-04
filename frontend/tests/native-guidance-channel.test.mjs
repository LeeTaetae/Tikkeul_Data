import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { parseNativeLocation, parseNativeRoute } from '../src/lib/navigation/nativeGuidanceFeed.ts';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const android = 'modules/kakao-navigation/android/src/';
const pkg = 'java/com/tikkeuldata/navigation/';

function adapter(nativeModule) {
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

test('Release JS subscribes to the product channel and consumes real route/location payloads', () => {
  let listener;
  let removed = false;
  const api = adapter({ addListener(channel, callback) {
    assert.equal(channel, 'onGuidance');
    listener = callback;
    return { remove() { removed = true; } };
  } });
  let position, route;
  const unsubscribe = api.onNativeGuidanceFeed((event) => {
    if (event.kind === 'location') position = parseNativeLocation(event);
    if (event.kind === 'route') route = parseNativeRoute(event.points, event.keys);
  });
  listener({ kind: 'route', keys: ['x', 'y'], points: [{ x: 127, y: 37.5 }, { x: 127.01, y: 37.51 }] });
  listener({ kind: 'location', lat: 37.5, lng: 127, speedKmh: 36, valid: true });
  assert.equal(route.length, 2);
  assert.equal(position.speedMps, 10);
  assert.equal(position.lng, 127);
  unsubscribe();
  assert.equal(removed, true);
});

test('older native modules safely support a missing event API', () => {
  assert.doesNotThrow(() => adapter(null).onNativeGuidanceFeed(() => {})());
  assert.doesNotThrow(() => adapter({}).onNativeGuidanceFeed(() => {})());
});

test('Android product SDK callbacks and emitter have no SpikeProbe or debug gate', () => {
  const feed = source(`${android}main/${pkg}GuidanceEventFeed.kt`);
  assert.doesNotMatch(feed, /SpikeProbe|NavigationDiagnostics|FLAG_DEBUGGABLE|BuildConfig\.DEBUG/);
  assert.match(feed, /NavigationSession\.guidance/);
  assert.match(feed, /convertKATECToWGS84/);
  const activity = source(`${android}main/${pkg}KakaoNavigationActivity.kt`);
  assert.match(activity, /GuidanceEventFeed\.emitLocation\(location\)/);
  assert.match(activity, /GuidanceEventFeed\.emitRoute\("started"/);
  assert.match(activity, /GuidanceEventFeed\.emitRoute\("changed:/);
  const module = source(`${android}main/${pkg}KakaoNavigationModule.kt`);
  assert.ok(module.indexOf('NavigationSession.guidance =') < module.indexOf('if (NavigationDiagnostics.enabled)'));
  assert.match(module, /sendEvent\("onGuidance", event\)/);
  assert.match(module, /runCatching \{ NavigationDiagnostics\.observe\(event\) \}/);
});

test('debug receivers, simulation and ACK implementation are excluded from Release sources', () => {
  assert.equal(existsSync(new URL(`../${android}main/${pkg}SpikeProbe.kt`, import.meta.url)), false);
  const debug = source(`${android}debug/${pkg}SpikeProbe.kt`);
  assert.match(debug, /fun observe/);
  assert.doesNotMatch(debug, /convertKATECToWGS84|routePolylineWGS84|fun emitLocation|fun emitRoute/);
  const release = source(`${android}release/${pkg}NavigationDiagnostics.kt`);
  assert.match(release, /const val enabled = false/);
  assert.doesNotMatch(release, /SpikeProbe|registerReceiver|sendEvent|sharedSimulGuidance/);
});

test('iOS exposes the same product channel and includes both icon/overlay implementations', () => {
  const module = source('modules/kakao-navigation/ios/KakaoNavigationModule.swift');
  assert.match(module, /Events\("onGuidance"\)/);
  assert.match(module, /sendEvent\("onGuidance", body\)/);
  assert.doesNotMatch(module, /onSpike|#if DEBUG/);
  for (const name of ['HazardRailIcons.h', 'HazardRailIcons.m', 'HazardRailOverlayView.h', 'HazardRailOverlayView.m']) {
    assert.ok(existsSync(new URL(`../modules/kakao-navigation/ios/${name}`, import.meta.url)));
  }
});
