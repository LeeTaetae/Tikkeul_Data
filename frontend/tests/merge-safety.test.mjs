import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_SENSITIVITY, sensitivityProfileFor } from '../src/lib/vision/sensitivityProfile.ts';
import { INITIAL_VISION_FRAME_STATE,reduceVisionFrame } from '../src/lib/vision/useVisionHazardWarning.ts';
import { DEFAULT_ROI } from '../src/lib/vision/visionHazardStage.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const count=(s,pattern)=>(s.match(pattern)||[]).length;

test('legacy vision-test redirects to the admin permission/focus gate without mounting a second camera',()=>{
  const legacy=read('app/vision-test.tsx'),admin=read('app/admin.tsx'),layout=read('app/_layout.tsx');
  assert.match(legacy,/<Redirect href="\/admin"/);assert.doesNotMatch(legacy,/VisionDetectorView|usePortalCandidates/);
  assert.match(admin,/authApi\.adminMe/);assert.match(admin,/focused && <VisionDebugPanel/);
  assert.equal(count(layout,/name="admin"/g),1);assert.equal(count(layout,/name="vision-test"/g),1);
  assert.match(read('app/index.tsx'),/authUser\?\.role === 'admin'/);
});

test('shared admin panel combines upstream confidence/FPS controls with local portal controls in one camera',()=>{
  const panel=read('src/components/vision/VisionDebugPanel.tsx');
  assert.equal(count(panel,/<VisionDetectorView\b/g),1);
  for(const text of ['isInstant(d, profile)','passesThreshold(d, profile)','targetFps={fps}','portalCandidatesEnabled={portalEnabled}',
    'onPortalFrame={portals.onPortalFrame}','frameStateRef.current=result.state','STAGE_RANK[result.state.stage]>STAGE_RANK[prev.stage]'])assert(panel.includes(text),text);
  assert.match(panel,/if \(!VISION_DETECTOR_AVAILABLE\)/);
});

test('production controller keeps current-state ref, speed-sensitive filtering, closed-banner policy and portal branch',()=>{
  const controller=read('src/components/vision/VisionHazardController.tsx');
  assert.equal(count(controller,/<VisionDetectorView\b/g),1);
  assert.match(controller,/sensitivityProfileFor\(inProtectionZone, speedKmh\)/);
  assert.match(controller,/const prev = frameStateRef.current/);
  assert.match(controller,/STAGE_RANK\[result.state.stage\] > STAGE_RANK\[prev.stage\]/);
  assert.match(controller,/onError=\{onError\}/);assert.match(controller,/onPortalFrame=\{portals.onPortalFrame\}/);
  assert.equal(count(controller,/speaker\.speak\(/g),1);
});

test('all guidance call sites keep one detector and weather branch with the required speed input',()=>{
  for(const path of ['app/navigation.tsx','src/screens/CyclingGuidanceScreen.tsx','src/screens/NativeNavigationScreen.tsx']){
    const source=read(path);
    assert.equal(count(source,/<VisionHazardController\b/g),1,path);
    assert.match(source,/<VisionHazardController[\s\S]*?speedKmh=/,path);
    if(!path.includes('NativeNavigation'))assert.equal(count(source,/<WeatherSafetyBanner\b/g),1,path);
    else assert.equal(count(source,/<NativeHazardRailBridge\b/g),1,path);
  }
  assert.match(read('src/components/navigation/NativeHazardRailBridge.tsx'),/nativeOwnedSpeech/);
  assert.match(read('app/navigation.tsx'),/enabled=\{focused && showSpeed\}/);
  assert.match(read('src/screens/NativeNavigationScreen.tsx'),/enabled=\{focused && navigating\}/);
});

test('latest two-frame/instant detection, ROI and oversized-box filtering are preserved',()=>{
  const d={class:'vehicle',confidence:.5,box:{x:.4,y:.4,width:.2,height:.4}};
  const first=reduceVisionFrame(INITIAL_VISION_FRAME_STATE,[d],DEFAULT_SENSITIVITY);
  assert.equal(first.state.stage,'advance');
  const second=reduceVisionFrame(first.state,[d],DEFAULT_SENSITIVITY);
  assert.equal(second.state.stage,'final');assert.equal(second.vibrate,true);
  assert.equal(reduceVisionFrame(second.state,[d],DEFAULT_SENSITIVITY).vibrate,false);
  assert.equal(reduceVisionFrame(INITIAL_VISION_FRAME_STATE,[{...d,confidence:.7}],DEFAULT_SENSITIVITY).state.stage,'final');
  for(const box of [{x:0,y:.4,width:.9,height:.4},{x:0,y:.4,width:.1,height:.4}]){
    let state=INITIAL_VISION_FRAME_STATE;
    for(let i=0;i<3;i++)state=reduceVisionFrame(state,[{...d,box}],DEFAULT_SENSITIVITY).state;
    assert.equal(state.stage,'advance');
  }
  assert.equal(DEFAULT_ROI.bottomHalfWidth,.25);assert.equal(DEFAULT_SENSITIVITY.targetFps,10);
  assert.equal(sensitivityProfileFor(true,20).confidenceByClass.vehicle,Infinity);
  assert.equal(sensitivityProfileFor(true,60).confidenceByClass.vehicle,.4);
});

test('iOS exposure improvement and local portal frame emission coexist exactly once',()=>{
  const swift=read('modules/vision-detector/ios/VisionDetectorModule.swift');
  assert.equal(count(swift,/Self\.limitExposure\(device\)/g),1);
  assert.equal(count(swift,/static func limitExposure/g),1);
  assert.equal(count(swift,/emitPortalFrame\(pixelBuffer, now: now\)/g),1);
  assert.match(swift,/activeMaxExposureDuration = clamped/);
});

test('resolved files have no conflict markers',()=>{
  for(const p of ['app/_layout.tsx','app/navigation.tsx','app/vision-test.tsx','src/components/vision/VisionHazardController.tsx','src/screens/CyclingGuidanceScreen.tsx'])
    assert.doesNotMatch(read(p),/^(<<<<<<<|=======|>>>>>>>)/m,p);
});
