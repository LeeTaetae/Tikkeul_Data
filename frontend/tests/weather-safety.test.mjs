import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createWeatherSafetyTracker,weatherConditions,weatherWarningText } from '../src/lib/weather/safety.ts';
import { parseTunnelDataset } from '../src/lib/tunnel/dataset.ts';
import { pt,tunnel } from './tunnel-fixtures.mjs';
import { onWeatherSpeechEvent,publishWeatherSpeechEvent } from '../src/lib/weather/speechEvents.ts';

const now=Date.parse('2026-11-06T12:20:00+09:00');
const empty=parseTunnelDataset([]).index;
const tunnels=parseTunnelDataset([tunnel('test')]).index;
const route={id:'r1',points:[pt(-1000),pt(1500)].map(p=>({latitude:p.lat,longitude:p.lng}))};
const bridge={id:'verified-test-bridge',name:'test only',a:pt(0),b:pt(200),source:'test-fixture-not-product-data',endpointsVerified:true};
const missing={status:'unavailable',data:null,error_code:'UPSTREAM_TIMEOUT'};
function weather(pty='none',temp=12,rain=0){return {observation:{status:'available',data:{observed_at:new Date(now-10*60_000).toISOString(),pty,temp_c:temp,rain_mm_1h:rain,humidity_pct:80,missing:[]}},ultra_forecast:missing,village_forecast:missing};}
function input(n=-400,options={}){return {route,fix:{...pt(n),accuracyM:5,timestampMs:now},weather:weather(),now,cameraActive:true,tunnels:empty,...options};}

test('clear weather and ordinary road produce no warning',()=>{
  assert.equal(createWeatherSafetyTracker().update(input()).warning,null);
  assert.equal(createWeatherSafetyTracker().update(input(-400,{weather:weather('rain',10,2)})).warning,null);
});
test('heavy rain with active camera warns about possible performance loss only',()=>{
  const t=createWeatherSafetyTracker();const i=input(-400,{weather:weather('rain',12,15)});
  const r=t.update(i);assert.equal(r.warning.kind,'camera');assert.equal(r.speechEvents.length,0);
  assert.equal(weatherWarningText(r.warning,'ko'),'강한 비나 눈으로 인해 카메라 객체 탐지 성능이 떨어질 수 있습니다. 주변 상황에 주의해 주세요.');
  assert.equal(t.update({...i,cameraActive:false}).warning,null);
});
test('rain near verified bridge warns slip; unknown bridges are not invented',()=>{
  const r=createWeatherSafetyTracker().update(input(-400,{weather:weather('rain',10,2),bridges:[bridge]}));
  assert.equal(r.warning.kind,'slip');assert.equal(r.warning.facility,'bridge');assert.equal(r.warning.stage,500);
  assert.equal(createWeatherSafetyTracker().update(input(-400,{weather:weather('rain',10,2),bridges:[{...bridge,source:''}]})).warning,null);
});
test('snow at tunnel entry gives possible ice only when cold; thawed snow warns slip',()=>{
  assert.equal(tunnels.facilities.length,1);
  const t=createWeatherSafetyTracker();
  const r=t.update(input(-400,{weather:weather('snow',-1,.5),tunnels}));
  assert.equal(r.warning.facility,'tunnel_entry');assert.equal(r.warning.kind,'ice');
  assert.equal(t.update(input(-400,{weather:weather('snow',8,.5),tunnels})).warning.kind,'slip');
});
test('below zero with precipitation on bridge warns possible ice, dry cold does not',()=>{
  const i=input(-90,{weather:weather('rain',-2,1),bridges:[bridge]});
  const r=createWeatherSafetyTracker().update(i);assert.equal(r.warning.kind,'ice');assert.equal(r.warning.stage,100);
  const dry=createWeatherSafetyTracker().update({...i,weather:weather('none',-5,0)});
  assert.equal(dry.warning.kind,'facility');assert.equal(dry.speechEvents.length,0);
});
test('API error and stale observation are unavailable, never a clear-weather verdict',()=>{
  const t=createWeatherSafetyTracker();
  assert.equal(t.update(input(-400,{weather:null})).warning.kind,'unavailable');
  const w=weather();w.observation.status='stale';
  assert.equal(t.update(input(-400,{weather:w})).weatherStatus,'unavailable');
});
test('repeated GPS emits once at 500m and once at 100m, then clears at passage',()=>{
  const t=createWeatherSafetyTracker(),opts={weather:weather('rain',-1,2),bridges:[bridge]};
  assert.equal(t.update(input(-400,opts)).speechEvents.length,1);
  assert.equal(t.update(input(-390,opts)).speechEvents.length,0);
  assert.equal(t.update(input(-90,opts)).speechEvents.length,1);
  assert.equal(t.update(input(-80,opts)).speechEvents.length,0);
  assert.equal(t.update(input(250,opts)).warning,null);
});
test('off-route or stale GPS clears facility warnings; rerouting resets stage history',()=>{
  const t=createWeatherSafetyTracker(),opts={weather:weather('rain',5,1),bridges:[bridge]};
  assert.equal(t.update(input(-400,opts)).speechEvents.length,1);
  assert.equal(t.update({...input(-400,opts),fix:{...pt(-400,300),accuracyM:5,timestampMs:now}}).warning,null);
  assert.equal(t.update({...input(-400,opts),fix:{...pt(-400),accuracyM:5,timestampMs:now-20_000}}).warning,null);
  assert.equal(t.update({...input(-400,opts),route:{...route,id:'rerouted'}}).speechEvents.length,1);
});
test('inside tunnel has no entry alert, but warns before exit and clears afterwards',()=>{
  const t=createWeatherSafetyTracker(),opts={weather:weather('snow',-2,.5),tunnels};
  assert.equal(t.update(input(100,opts)).warning,null);
  assert.equal(t.update(input(400,opts)).warning.facility,'tunnel_exit');
  assert.equal(t.update(input(720,opts)).warning.stage,100);
  assert.equal(t.update(input(850,opts)).warning,null);
});
test('higher-priority hazards suppress weather presentation and do not consume its stage',()=>{
  const t=createWeatherSafetyTracker(),i=input(-400,{weather:weather('rain',5,2),bridges:[bridge]});
  const blocked=t.update({...i,blocked:true});assert.equal(blocked.warning,null);assert.equal(blocked.speechEvents.length,0);
  assert.equal(t.update(i).speechEvents.length,1);
});
test('forecast stays labelled forecast, does not become current camera degradation evidence',()=>{
  const q={lower:1,upper:2,category:'range',unit:'mm/h'};
  const f={issued_at:new Date(now-3600_000).toISOString(),valid_at:new Date(now+20*60_000).toISOString(),pty:'snow',temp_c:-2,rain:q,snow:{...q,unit:'cm/h'}};
  const w={observation:missing,ultra_forecast:{status:'available',data:[f]},village_forecast:missing};
  assert.equal(weatherConditions(w,now).status,'forecast');
  const r=createWeatherSafetyTracker().update(input(-400,{weather:w,tunnels}));
  assert.equal(r.warning.forecast,true);assert.match(weatherWarningText(r.warning,'ko'),/예보/);
  assert.equal(createWeatherSafetyTracker().update(input(-400,{weather:w})).warning.kind,'unavailable');
});
test('ko/en/zh messages and separate native banner contract keep weather out of icon rail',()=>{
  const w={id:'x',kind:'ice',facility:'tunnel_exit',stage:100,forecast:false};
  assert.match(weatherWarningText(w,'ko'),/가능성/);assert.match(weatherWarningText(w,'en'),/Possible/);assert.match(weatherWarningText(w,'zh'),/可能/);
  for(const p of ['../src/components/alerts/WeatherSafetyBanner.tsx','../modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/WeatherSafetyOverlay.kt']){
    const s=readFileSync(new URL(p,import.meta.url),'utf8');assert.doesNotMatch(s,/setNativeHazardRail|HazardRail\.set/);
  }
});

test('native car speech publishes intent only, subscriptions can be removed',()=>{
  const received=[];const unsubscribe=onWeatherSpeechEvent(event=>received.push(event));
  const event={warning:{id:'bridge:500',kind:'slip',facility:'bridge',stage:500,forecast:false},text:'Bridge ahead.',language:'en'};
  publishWeatherSpeechEvent(event);unsubscribe();publishWeatherSpeechEvent(event);
  assert.deepEqual(received,[event]);
});

test('real bundled bridge catalog has source provenance and distinct domestic endpoints',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../src/data/bridgeEndpoints.json',import.meta.url),'utf8'));
  assert.equal(catalog.source,'molit_bti_2025');assert.match(catalog.source_sha256,/^[a-f0-9]{64}$/);
  assert(catalog.bridges.length>0);const ids=new Set();
  for(const b of catalog.bridges){
    assert(!ids.has(b.id));ids.add(b.id);assert(b.endpointsVerified&&b.source===catalog.source);
    for(const p of [b.a,b.b])assert(p.lat>=32.5&&p.lat<=39.5&&p.lng>=124&&p.lng<=132.5);
    assert(b.a.lat!==b.b.lat||b.a.lng!==b.b.lng);
  }
});

test('native GPS without accuracy requires explicit SDK trust, and unknown precipitation is not clear',()=>{
  const i=input(-400,{weather:weather('rain',-2,2),bridges:[bridge]});
  i.fix.accuracyM=null;
  assert.equal(createWeatherSafetyTracker().update(i).warning,null);
  assert.equal(createWeatherSafetyTracker().update({...i,positionTrusted:true}).warning.kind,'ice');
  assert.equal(createWeatherSafetyTracker().update(input(-400,{weather:weather('unknown',10,null)})).warning.kind,'unavailable');
});
