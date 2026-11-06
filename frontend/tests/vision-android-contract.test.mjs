// Android 비전 탐지 모듈이 iOS 와 같은 JS 계약을 지키는지 확인한다.
//  - iOS 계약의 기준은 modules/vision-detector/ios/VisionDetectorModule.swift 소스다(읽기만 한다).
//  - Android 계약은 Kotlin 단위 테스트가 쓰는 같은 픽스처(vision-contract.json)로 고정되어 있다.
// 실기기 동작은 검증하지 않는다. 여기서는 키·좌표계·임계값·모듈 등록·수명 주기 안전장치를 소스/픽스처 수준에서 본다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { fromModelDetections } from '../src/lib/vision/modelLabels.ts';
import { DEFAULT_SENSITIVITY, PROTECTION_ZONE_SENSITIVITY } from '../src/lib/vision/sensitivityProfile.ts';
import { INITIAL_VISION_FRAME_STATE, reduceVisionFrame } from '../src/lib/vision/useVisionHazardWarning.ts';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const MOD = 'modules/vision-detector/';
const swift = read(`${MOD}ios/VisionDetectorModule.swift`);
const kotlinDir = `${MOD}android/src/main/java/com/tikkeuldata/vision/`;
const kotlin = (name) => read(`${kotlinDir}${name}`);
const fixture = JSON.parse(read(`${MOD}android/src/test/resources/vision-contract.json`));
const keysIn = (text) => [...text.matchAll(/"(\w+)"\s*:/g)].map((m) => m[1]);

// ---- 1. 이벤트 키: Swift 소스 ↔ Android 픽스처 ----
test('onDetections 이벤트 키가 iOS(Swift 소스)와 Android 계약 픽스처에서 같다', () => {
  const eventBlock = swift.match(/self\?\.onDetections\(\[([\s\S]*?)\]\)/)[1];
  assert.deepEqual(new Set(keysIn(eventBlock)), new Set(fixture.contract.eventKeys));
  assert.deepEqual(new Set(Object.keys(fixture.event)), new Set(fixture.contract.eventKeys));
});

test('탐지 항목·상자 키가 iOS(Swift 소스)와 Android 픽스처에서 같다', () => {
  const block = swift.match(/let detections = observations\.compactMap[\s\S]*?DispatchQueue\.main\.async/)[0];
  const all = new Set(keysIn(block));
  assert.deepEqual(all, new Set([...fixture.contract.detectionKeys, ...fixture.contract.boxKeys]));
  const d = fixture.event.detections[0];
  assert.deepEqual(new Set(Object.keys(d)), new Set(fixture.contract.detectionKeys));
  assert.deepEqual(new Set(Object.keys(d.box)), new Set(fixture.contract.boxKeys));
});

test('네이티브 fallback은 서로 같고 앱의 최신 10/15fps 정책이 prop으로 전달된다', () => {
  const k = kotlin('VisionDetectorModule.kt');
  assert.match(swift, /Name\("VisionDetector"\)/);
  assert.match(k, /Name\("VisionDetector"\)/);
  assert.match(swift, /Events\("onDetections", "onError", "onPortalFrame"\)/);
  assert.match(k, /Events\("onDetections", "onError", "onPortalFrame"\)/);
  assert.match(swift, /Prop\("targetFps"\)/);
  assert.match(k, /Prop\("targetFps"\)/);
  assert.match(swift, /var targetFps: Double = 5/);
  assert.match(kotlin('VisionContract.kt'), /DEFAULT_TARGET_FPS = 5\.0/);
  assert.equal(fixture.contract.defaultTargetFps, 5); // native fallback only; all app call sites pass targetFps
  assert.equal(DEFAULT_SENSITIVITY.targetFps, 10);
  assert.equal(PROTECTION_ZONE_SENSITIVITY.targetFps, 15);
  assert.match(swift, /"message":/); // onError 도 {message} 한 키
  assert.match(kotlin('VisionContract.kt'), /mapOf\("message" to message\)/);
});

test('Android 뷰는 onDetections/onError 를 EventDispatcher 로 보내고 좌표계 주석이 iOS 와 같다(좌상단 원점, 세로 프레임)', () => {
  const view = kotlin('VisionDetectorView.kt');
  assert.match(view, /onDetections by EventDispatcher<Map<String, Any>>\(\)/);
  assert.match(view, /onError by EventDispatcher<Map<String, String>>\(\)/);
  assert.match(kotlin('VisionContract.kt'), /업라이트\(세로 보기\) 프레임 기준 0~1, 원점은 좌상단/);
  assert.match(swift, /Detection\.box 는 top-left/);
});

// ---- 2. 의미: 픽스처 이벤트를 JS 위험 판단(기존 로직 그대로)에 넣는다 ----
test('모델 라벨은 car → vehicle 로만 바뀐다(JS 변환 재사용) - 5개 라벨이 모두 앱 클래스로 간다', () => {
  const raw = fixture.contract.labels.map((l) => ({ class: l, confidence: 0.9, box: { x: 0, y: 0, width: 0.1, height: 0.1 } }));
  const mapped = fromModelDetections(raw).map((d) => d.class).sort();
  assert.deepEqual(mapped, ['animal', 'kickboard', 'motorcycle', 'person', 'vehicle']);
});

test('픽스처 이벤트는 최신 후보 0.4/즉시 0.6 정책을 거쳐 사람 경고로 이어진다', () => {
  const detections = fromModelDetections(fixture.event.detections);
  assert.equal(detections.length, 2);
  const r = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, detections, DEFAULT_SENSITIVITY);
  assert.equal(r.state.topClass, 'person');   // car(0.3)는 후보 0.4 미만이라 걸러진다
  assert.equal(r.state.stage, 'approach');    // 박스 높이 0.30 (0.18 이상 0.32 미만), 하단 중앙 ROI 안
  assert.equal(r.vibrate, false);             // 진동은 final 에 막 들어온 순간에만(visionAlertTrigger.ts) - approach 는 배너만
  // 같은 사람이 더 가까워져(높이 0.4) final 이 되면 그 순간 한 번 진동한다. 이 단계는 JS 로직이며 네이티브와 무관하다.
  const closer = fromModelDetections([{ ...fixture.event.detections[0], box: { x: 0.35, y: 0.5, width: 0.3, height: 0.4 } }]);
  const next = reduceVisionFrame(r.state, closer, DEFAULT_SENSITIVITY);
  assert.deepEqual([next.state.stage, next.vibrate], ['final', true]);
});

test('보호구역 person 0.25: 낮은 신뢰도 사람이 JS 까지 오려면 네이티브 하한이 0.25 이하여야 한다', () => {
  const lowPerson = [{ class: 'person', confidence: 0.3, box: { x: 0.4, y: 0.35, width: 0.2, height: 0.3 } }];
  const zone = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, fromModelDetections(lowPerson), PROTECTION_ZONE_SENSITIVITY);
  const normal = reduceVisionFrame(INITIAL_VISION_FRAME_STATE, fromModelDetections(lowPerson), DEFAULT_SENSITIVITY);
  assert.equal(zone.state.stage, 'advance'); // low-confidence detections require two consecutive frames
  const confirmed=reduceVisionFrame(zone.state,fromModelDetections(lowPerson),PROTECTION_ZONE_SENSITIVITY);
  assert.equal(confirmed.state.stage, 'approach');
  assert.equal(normal.state.stage, 'advance');
  const floor = Number(kotlin('VisionContract.kt').match(/CONFIDENCE_FLOOR = ([\d.]+)f/)[1]);
  const lowest = Math.min(...Object.values(DEFAULT_SENSITIVITY.confidenceByClass), ...Object.values(PROTECTION_ZONE_SENSITIVITY.confidenceByClass));
  assert.ok(floor <= lowest, `네이티브 하한 ${floor} 가 JS 최저 임계값 ${lowest} 보다 높다`);
  assert.equal(fixture.contract.confidenceFloor, floor);
});

test('팀 최신 후보 0.4·즉시 0.6·보호구역 person 0.25 임계값을 유지한다', () => {
  for (const v of Object.values(DEFAULT_SENSITIVITY.confidenceByClass)) assert.equal(v, 0.4);
  assert.equal(DEFAULT_SENSITIVITY.instantConfidence,0.6);
  assert.equal(PROTECTION_ZONE_SENSITIVITY.instantConfidence,0.6);
  assert.equal(PROTECTION_ZONE_SENSITIVITY.confidenceByClass.person, 0.25);
  for (const c of ['kickboard', 'motorcycle', 'vehicle', 'animal']) assert.equal(PROTECTION_ZONE_SENSITIVITY.confidenceByClass[c], 0.4);
});

// ---- 3. 모듈 등록 · 매니페스트 · 모델 취급 ----
test('expo-module.config.json: iOS 항목은 그대로이고 Android 모듈 클래스가 실제 Kotlin 클래스와 맞는다', () => {
  const cfg = JSON.parse(read(`${MOD}expo-module.config.json`));
  assert.deepEqual(cfg.platforms.sort(), ['android', 'apple']);
  assert.deepEqual(cfg.apple, { modules: ['VisionDetectorModule'] });
  assert.deepEqual(cfg.android, { modules: ['com.tikkeuldata.vision.VisionDetectorModule'] });
  const k = kotlin('VisionDetectorModule.kt');
  assert.match(k, /^package com\.tikkeuldata\.vision$/m);
  assert.match(k, /class VisionDetectorModule : Module\(\)/);
});

test('JS 래퍼: iOS 분기는 그대로, Android 는 네이티브 모듈이 있는 빌드에서만 뷰를 만든다', () => {
  const wrapper = read('src/native/visionDetectorView.tsx');
  assert.match(wrapper, /Platform\.OS === 'ios'/);
  assert.match(wrapper, /Platform\.OS === 'android' && requireOptionalNativeModule\('VisionDetector'\) != null/);
  assert.match(wrapper, /requireNativeViewManager<VisionDetectorViewProps>\('VisionDetector'\)/);
  assert.match(wrapper, /if \(!NativeView\) return null;/);
});

test('매니페스트: 카메라 권한을 선언하고 카메라 없는 기기에서도 설치된다. 네트워크 권한은 없다', () => {
  const m = read(`${MOD}android/src/main/AndroidManifest.xml`);
  assert.match(m, /android\.permission\.CAMERA/);
  assert.match(m, /android\.hardware\.camera"\s+android:required="false"/);
  assert.ok(!/INTERNET/.test(m));
});

test('모델 파일은 Git 에 올리지 않는다: .gitignore 에 tflite 가 있고, 추적 가능한 위치에 tflite 가 없다', () => {
  const ignore = read(`${MOD}.gitignore`);
  assert.match(ignore, /android\/src\/main\/assets\/vision\/\*\.tflite/);
  assert.match(ignore, /android\/build\//);
  assert.match(ignore, /ios\/kickboard_v3\.mlpackage/); // 기존 항목 보존
  assert.match(ignore, /ios\/build\//);
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    if (n === 'build' || n === '.gradle') return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  // 모델 파일이 개발 PC 에 실제로 있어도 괜찮지만, 있다면 전부 Git 이 무시해야 한다(커밋 대상이 되면 안 된다).
  const found = walk(new URL(MOD, root).pathname.replace(/^\/(\w:)/, '$1')).filter((p) => /\.(tflite|mlpackage|pt|onnx)$/i.test(p));
  for (const file of found) {
    const r = spawnSync('git', ['check-ignore', '-q', file], { cwd: new URL('../', root).pathname.replace(/^\/(\w:)/, '$1') });
    assert.equal(r.status, 0, `${file} 이 Git 무시 대상이 아니다(커밋될 수 있다)`);
  }
});

test('루트 .gitignore: 비전 Android 소스는 추적되고(예외 규칙), 기존 iOS·카카오 예외 규칙은 그대로다', () => {
  const root = read('../.gitignore');
  assert.match(root, /^android\/$/m); // 기존 규칙 보존
  for (const line of [
    '!frontend/modules/kakao-navigation/android/', '!frontend/modules/kakao-navigation/android/**',
    '!frontend/modules/kakao-login/android/', '!frontend/modules/kakao-login/android/**',
    '!frontend/modules/vision-detector/ios/', '!frontend/modules/vision-detector/ios/**',
    '!frontend/modules/vision-detector/android/', '!frontend/modules/vision-detector/android/**',
  ]) assert.ok(root.split(/\r?\n/).includes(line), `루트 .gitignore 에 ${line} 가 없다`);
});

test('Android 모델 로더는 모델·라벨이 없으면 조용한 기본값 대신 명확한 오류를 낸다', () => {
  const engine = kotlin('YoloTfliteEngine.kt');
  assert.match(engine, /model file not found in app assets/);
  assert.match(engine, /labels file not found in app assets/);
  assert.match(engine, /FileChannel\.MapMode\.READ_ONLY/);              // 37MB 모델을 힙에 복사하지 않고 매핑/청크로 읽는다
  assert.ok(!/ASSET_MODEL\)\.use \{ it\.readBytes\(\) \}/.test(engine));
  assert.match(kotlin('VisionContract.kt'), /ASSET_MODEL = "vision\/kickboard_v3\.tflite"/);
  assert.match(kotlin('VisionContract.kt'), /ASSET_LABELS = "vision\/labels\.txt"/);
});

// ---- 4. 수명 주기 · 자원 · 격리 ----
test('수명 주기 안전장치(소스 수준): 프로세스 수명 바인딩, 분석기 해제, unbind, 프레임 close, 최신 프레임만 유지', () => {
  const v = kotlin('VisionDetectorView.kt');
  assert.match(v, /ProcessLifecycleOwner\.get\(\)/);
  assert.match(v, /clearAnalyzer\(\)/);
  assert.match(v, /cameraProvider\.unbind\(/);
  assert.match(v, /finally \{\s*image\.close\(\)/);
  assert.match(v, /STRATEGY_KEEP_ONLY_LATEST/);
  assert.match(v, /override fun onDetachedFromWindow\(\) \{\s*stop\(\)/);
  assert.match(v, /exec\.execute \{ eng\?\.close\(\) \}\s*\n\s*exec\.shutdown\(\)/);
  assert.match(v, /removeThermalStatusListener/);
  assert.match(kotlin('VisionDetectorModule.kt'), /OnViewDestroys \{ view: VisionDetectorView ->\s*view\.shutdown\(\)/);
  const engine = kotlin('YoloTfliteEngine.kt');
  assert.match(engine, /check\(plane\.pixelStride == 4\)/);          // RGBA 가정이 깨지면 조용히 틀리지 않고 오류
  assert.match(engine, /bytes\.remaining\(\) >= needed/);            // 마지막 행 패딩이 없는 짧은 버퍼 방어
  assert.match(engine, /paddedScratch = null/);                       // close 시 임시 버퍼 해제
  assert.match(engine, /interpreter\.close\(\)/);
  assert.match(engine, /inputBitmap\.recycle\(\)/);
});

test('Android 비전 코드에는 네트워크·저장소·키 접근이 없다(카메라 영상은 기기 밖으로 나가지 않는다)', () => {
  for (const f of ['VisionContract.kt', 'LetterboxGeometry.kt', 'YoloDecoder.kt', 'FpsGovernor.kt', 'YoloTfliteEngine.kt', 'VisionDetectorView.kt', 'VisionDetectorModule.kt']) {
    const text = kotlin(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['java.net.', 'HttpURLConnection', 'okhttp', 'URL(', 'Socket', 'FileOutputStream', 'openFileOutput', 'SharedPreferences', 'MediaStore', 'saveBitmap', 'compress(']) {
      assert.ok(!text.includes(banned), `${f} 에 ${banned}`);
    }
  }
});

test('Android 비전 모듈은 카카오 내비 모듈과 서로 참조하지 않고, 기존 Android 모듈 파일을 건드리지 않는다', () => {
  for (const f of readdirSync(new URL(kotlinDir, root))) assert.ok(!/kakao|knsdk/i.test(kotlin(f)), `${f} 이 카카오를 참조한다`);
  const nav = 'modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/';
  for (const f of readdirSync(new URL(nav, root))) {
    if (f.endsWith('.kt')) assert.ok(!/tikkeuldata\.vision|VisionDetector/.test(read(nav + f)), `${f} 이 비전 모듈을 참조한다`);
  }
  assert.ok(!/vision/i.test(read('modules/kakao-navigation/android/build.gradle')));
});

test('Android build.gradle 의존성: CameraX·LiteRT·lifecycle-process 버전이 고정되어 있다', () => {
  const g = read(`${MOD}android/build.gradle`);
  for (const dep of ['camera-core', 'camera-camera2', 'camera-lifecycle', 'camera-view']) assert.match(g, new RegExp(`androidx\\.camera:${dep}:1\\.5\\.3`));
  assert.match(g, /androidx\.lifecycle:lifecycle-process:2\.10\.0/);
  assert.match(g, /\[vision-detector\] WARNING/); // 모델 누락 경고(빌드는 막지 않는다)
  assert.match(g, /com\.google\.ai\.edge\.litert:litert:1\.4\.2/);
  assert.match(g, /minSdkVersion 26/);
  assert.ok(existsSync(new URL(`${MOD}android/consumer-rules.pro`, root)));
});
