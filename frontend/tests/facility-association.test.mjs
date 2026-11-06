import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createWeatherSafetyTracker } from '../src/lib/weather/safety.ts';
import { facilityAssociationText } from '../src/lib/weather/facilityAssociation.ts';
import { getPortalObservation,publishPortalObservation,subscribePortalObservations } from '../src/lib/vision/portalObservations.ts';
import { parseTunnelDataset } from '../src/lib/tunnel/dataset.ts';
import { pt,tunnel } from './tunnel-fixtures.mjs';

const start=Date.parse('2026-11-06T17:00:00+09:00');
const empty=parseTunnelDataset([]).index,tunnels=parseTunnelDataset([tunnel('road-tunnel')]).index;
const route={id:'route-1',points:[pt(-1500),pt(1800)].map(p=>({latitude:p.lat,longitude:p.lng}))};
const missing={status:'unavailable',data:null};
const bridge={id:'b1',name:'mock bridge',source:'mock-only',endpointsVerified:true,a:pt(0),b:pt(200)};
function weather(pty='none',temp=10,rain=0){return {observation:{status:'available',data:{observed_at:new Date(start-5*60_000).toISOString(),pty,temp_c:temp,rain_mm_1h:rain,humidity_pct:80,missing:[]}},ultra_forecast:missing,village_forecast:missing};}
function camera(now=start,count=1){return {frame:{width:160,height:120},detectedAtMs:now,timeBasis:'js_detection',candidates:Array.from({length:count},(_,i)=>({box:{x:.15+i*.4,y:.4,width:.25,height:.3},score:.85-i*.1,method:'brightness_shape_heuristic'}))};}
function input(n=-400,opts={}){const now=opts.now??start;return {route,fix:{...pt(n),accuracyM:5,timestampMs:now},now,weather:weather(),cameraActive:true,tunnels,...opts};}

test('camera only, including unavailable GPS, keeps candidates and never claims a facility',()=>{
  for(const noGps of [{route:null,fix:null},{fix:null},{tunnels:empty}]){
    const r=createWeatherSafetyTracker().update(input(-400,{...noGps,portalObservation:camera()}));
    assert.equal(r.portalAssociation.status,'camera_only');assert.equal(r.portalAssociation.preferredCandidateIndex,null);
    assert.equal(r.portalAssociation.individualPortalMatch,'unconfirmed');assert.equal(r.portalAssociation.facilityId,null);
    assert.match(facilityAssociationText(r.facilityMatch,r.portalAssociation,'ko'),/터널 후보 감지.*시설 매칭 미확인/);
  }
});

test('GPS route-only tunnel approach is displayed even without precipitation',()=>{
  const r=createWeatherSafetyTracker().update(input());
  assert.equal(r.portalAssociation.status,'gps_only');assert.equal(r.warning.kind,'facility');
  assert.match(facilityAssociationText(r.facilityMatch,r.portalAssociation,'ko'),/전방 터널 구간/);
  assert(r.facilityMatch.approach.distanceM>350&&r.facilityMatch.approach.distanceM<450);
  assert.equal(r.facilityMatch.approach.geometryOnly,true);
});

test('camera and route associate only at facility level after measured forward GPS motion',()=>{
  const t=createWeatherSafetyTracker();
  t.update(input(-420));
  const r=t.update(input(-400,{now:start+1000,portalObservation:camera(start+1000)}));
  assert.equal(r.facilityMatch.direction,'aligned');assert.equal(r.portalAssociation.status,'facility_association');
  assert(r.portalAssociation.facilityId);assert.equal(r.portalAssociation.preferredCandidateIndex,null);
  assert.match(facilityAssociationText(r.facilityMatch,r.portalAssociation,'ko'),/경로상 터널 접근 중 · 카메라 후보 감지/);
});

test('GPS direction alone without calibrated image coordinates cannot pick either of two portals',()=>{
  const t=createWeatherSafetyTracker();t.update(input(-420));
  const observation=camera(start+1000,2),r=t.update(input(-400,{now:start+1000,portalObservation:observation}));
  assert.equal(r.portalAssociation.status,'facility_association');assert.equal(r.portalAssociation.observation.candidates.length,2);
  assert.deepEqual(r.portalAssociation.observation.candidates,observation.candidates);
  assert.equal(r.portalAssociation.preferredCandidateIndex,null);
});

test('camera false positive with no route tunnel stays camera-only and makes no facility TTS',()=>{
  const r=createWeatherSafetyTracker().update(input(-400,{tunnels:empty,portalObservation:camera()}));
  assert.equal(r.portalAssociation.status,'camera_only');assert.equal(r.warning,null);assert.deepEqual(r.speechEvents,[]);
});

test('stationary, stale or temporally mismatched evidence cannot establish a camera/GPS association',()=>{
  const t=createWeatherSafetyTracker();
  assert.equal(t.update(input(-400,{portalObservation:camera()})).portalAssociation.status,'camera_only');
  t.update(input(-420,{now:start+1000}));
  const old=camera(start-5000);
  assert.equal(t.update(input(-400,{now:start+2000,portalObservation:old})).portalAssociation.status,'gps_only');
  const skew=t.update(input(-400,{now:start+7000,fix:{...pt(-400),accuracyM:5,timestampMs:start+2000},portalObservation:camera(start+7000)}));
  assert.equal(skew.portalAssociation.status,'camera_only');
});

test('reverse GPS travel and off-route bridges are excluded',()=>{
  const t=createWeatherSafetyTracker();t.update(input(-390,{tunnels:empty,bridges:[bridge]}));
  const reversed=t.update(input(-420,{now:start+1000,tunnels:empty,bridges:[bridge],weather:weather('rain',-1,2)}));
  assert.equal(reversed.facilityMatch.direction,'opposed');assert.equal(reversed.warning,null);
  const outside={...bridge,id:'outside',a:pt(0,100),b:pt(200,100)};
  assert.equal(createWeatherSafetyTracker().update(input(-400,{tunnels:empty,bridges:[outside],weather:weather('rain',10,2)})).warning,null);
});

test('duplicate bridge records deduplicate; ambiguous parallel lanes are not arbitrarily chosen',()=>{
  const t=createWeatherSafetyTracker(),opts={tunnels:empty,bridges:[bridge,{...bridge,id:'duplicate'}],weather:weather('rain',5,2)};
  assert.equal(t.update(input(-400,opts)).speechEvents.length,1);assert.equal(t.update(input(-390,opts)).speechEvents.length,0);
  const parallel={...bridge,id:'parallel',a:pt(0,8),b:pt(200,8)};
  const fix={...pt(-400,4),accuracyM:5,timestampMs:start};
  const ambiguousRoute={...route,points:[pt(-1500,4),pt(1800,4)].map(p=>({latitude:p.lat,longitude:p.lng}))};
  const r=createWeatherSafetyTracker().update(input(-400,{...opts,fix,route:ambiguousRoute,bridges:[bridge,parallel]}));
  assert.equal(r.facilityMatch.ambiguous,true);assert.equal(r.warning,null);
});

test('rain entry, snowy exit and cold wet bridge retain weather-only possible-risk wording',()=>{
  const entry=createWeatherSafetyTracker().update(input(-400,{weather:weather('rain',8,2)}));
  assert.equal(entry.warning.kind,'slip');assert.equal(entry.warning.facility,'tunnel_entry');
  const exit=createWeatherSafetyTracker().update(input(400,{weather:weather('snow',-2,.5)}));
  assert.equal(exit.warning.kind,'ice');assert.equal(exit.warning.facility,'tunnel_exit');
  const b=createWeatherSafetyTracker().update(input(-400,{tunnels:empty,bridges:[bridge],weather:weather('rain',0,2)}));
  assert.equal(b.warning.kind,'ice');assert.equal(b.warning.facility,'bridge');
});

test('500m/100m hysteresis and pass margin prevent repeated TTS or reappearing facility risk',()=>{
  const t=createWeatherSafetyTracker(),opts={tunnels:empty,bridges:[bridge],weather:weather('rain',5,2)};
  assert.equal(t.update(input(-495,opts)).speechEvents.length,1);
  assert.equal(t.update(input(-501,opts)).warning.stage,500);
  assert.equal(t.update(input(-96,opts)).speechEvents.length,1);
  assert.equal(t.update(input(-103,opts)).warning.stage,100);
  assert.equal(t.update(input(-103,opts)).speechEvents.length,0);
  assert(t.update(input(205,opts)).warning); // held until safely past the exit
  assert.equal(t.update(input(230,opts)).warning,null);
  assert.equal(t.update(input(195,opts)).warning,null); // GPS bounce must not resurrect it
  const rerouted=t.update(input(-400,{...opts,route:{...route,id:'rerouted'}}));
  assert.equal(rerouted.warning.stage,500);assert.equal(rerouted.speechEvents.length,1);
});

test('lost GPS clears facility association, API failure stays unknown, priority hazards suppress weather',()=>{
  const t=createWeatherSafetyTracker();t.update(input());
  const lost=t.update(input(-400,{now:start+20_000,fix:{...pt(-400),accuracyM:5,timestampMs:start},portalObservation:camera(start+20_000),weather:null}));
  assert.equal(lost.portalAssociation.status,'camera_only');assert.equal(lost.facilityMatch.approach,null);
  assert.equal(lost.weatherStatus,'unavailable');assert.equal(lost.warning.kind,'unavailable');
  const opts={weather:weather('rain',5,2),blocked:true};
  assert.equal(t.update(input(-400,opts)).speechEvents.length,0);
  assert.equal(t.update(input(-400,{...opts,blocked:false})).speechEvents.length,1);
});

test('strong precipitation warning remains available alongside a facility hazard',()=>{
  const r=createWeatherSafetyTracker().update(input(-400,{weather:weather('rain',8,15)}));
  assert.equal(r.warning.kind,'slip');assert.equal(r.cameraDegraded,true);
});

test('a known inaccurate GPS fix is not promoted by an SDK trust flag',()=>{
  const r=createWeatherSafetyTracker().update(input(-400,{fix:{...pt(-400),accuracyM:100,timestampMs:start},positionTrusted:true,portalObservation:camera()}));
  assert.equal(r.facilityMatch.gpsUsable,false);assert.equal(r.portalAssociation.status,'camera_only');
});

test('ephemeral observation store preserves all candidate metadata and owner-safe cleanup',()=>{
  const a=Symbol('a'),b=Symbol('b');let count=0;const unsubscribe=subscribePortalObservations(()=>count++);
  const value=camera(start,2);publishPortalObservation(a,value);assert.deepEqual(getPortalObservation(),value);
  publishPortalObservation(b,camera(start+1000));publishPortalObservation(a,null);
  assert.equal(getPortalObservation().detectedAtMs,start+1000);
  publishPortalObservation(b,null);assert.equal(getPortalObservation(),null);unsubscribe();assert.equal(count,3);
});

test('native car still publishes speech intent only and JS speech keeps non-interrupting arbitration',()=>{
  const banner=readFileSync(new URL('../src/components/alerts/WeatherSafetyBanner.tsx',import.meta.url),'utf8');
  assert(banner.indexOf('if(props.nativeOwnedSpeech)')<banner.indexOf('void isSpeechBusy()'));
  assert.match(banner,/onSpeechEvent\?\.\(/);assert.match(banner,/interrupt:false/);
  const bridgeSource=readFileSync(new URL('../src/components/navigation/NativeHazardRailBridge.tsx',import.meta.url),'utf8');
  assert.match(bridgeSource,/nativeOwnedSpeech/);
});
