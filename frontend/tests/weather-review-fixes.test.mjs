import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createNativeWeatherFixGate, validMeasurementTime } from '../src/lib/navigation/nativeWeatherFix.ts';
import { createWeatherSafetyTracker,weatherWarningText } from '../src/lib/weather/safety.ts';
import { createWeatherSpeechQueue } from '../src/lib/weather/speechQueue.ts';
import { weatherBannerText } from '../src/lib/weather/presentation.ts';
import { createSpeaker } from '../src/lib/speech/speakerCore.ts';
import { parseTunnelDataset } from '../src/lib/tunnel/dataset.ts';
import { pt } from './tunnel-fixtures.mjs';

const now=Date.parse('2026-11-06T10:00:00Z');
const event={...pt(580),valid:true,posTrust:true,timestampMs:now-1000,distFromS:1420};
const empty=parseTunnelDataset([]).index;
const route={id:'round-trip',points:[pt(0),pt(1000),pt(-500)].map(p=>({latitude:p.lat,longitude:p.lng}))};
const bridge={id:'return-bridge',name:'Mock bridge',a:pt(0),b:pt(200),source:'mock',endpointsVerified:true};
const missing={status:'unavailable',data:null};
const weather={observation:{status:'available',data:{observed_at:new Date(now).toISOString(),pty:'rain',temp_c:-1,rain_mm_1h:12,humidity_pct:80,missing:[]}},ultra_forecast:missing,village_forecast:missing};
const input=(north,extra={})=>({route,fix:{...pt(north),accuracyM:5,timestampMs:now},now,tunnels:empty,bridges:[bridge],weather,cameraActive:true,...extra});
const warning={id:'b:500:ice',kind:'ice',facility:'bridge',stage:500,forecast:false};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('native weather GPS retains SDK measurement time and validated SDK progress',()=>{
  const r=createNativeWeatherFixGate().accept(event,now);
  assert.equal(r.kind,'accepted');assert.equal(r.value.fix.timestampMs,now-1000);
  assert.equal(r.value.progressM,1420);assert.equal(r.value.positionTrusted,true);
});
test('missing, stale, future, malformed and second-based timestamps are rejected',()=>{
  for(const timestampMs of [undefined,null,NaN,Infinity,'1762500000000',0,-1,now-15001,now+5001,now/1000,now+.5]){
    assert.equal(createNativeWeatherFixGate().accept({...event,timestampMs},now).kind,'rejected');
    assert.equal(validMeasurementTime(timestampMs,now),false);
  }
  assert(validMeasurementTime(now-15000,now));assert(validMeasurementTime(now+5000,now));
});
test('repeated GPS does not refresh measurement time; expiry and out-of-order fixes fail closed',()=>{
  const gate=createNativeWeatherFixGate();gate.accept(event,now);
  assert.equal(gate.accept(event,now+1000).kind,'duplicate');
  assert.equal(gate.accept({...event,timestampMs:now-2000},now).kind,'rejected');
  assert.equal(gate.accept({...event,lat:event.lat+.001},now).kind,'rejected');
  assert.equal(gate.accept(event,now+15000).kind,'rejected');
  gate.reset();assert.equal(gate.accept({...event,timestampMs:now-2000},now).kind,'accepted');
});
test('invalid location or unknown distFromS cannot masquerade as reliable progress',()=>{
  assert.equal(createNativeWeatherFixGate().accept({...event,valid:false},now).kind,'rejected');
  for(const distFromS of [-1,NaN,Infinity,undefined])assert.equal(createNativeWeatherFixGate().accept({...event,distFromS},now).value.progressM,null);
});
test('return-leg bridge about 380m ahead is found using SDK progress, not the first geometric projection',()=>{
  const r=createWeatherSafetyTracker().update(input(580,{progressM:1420}));
  assert.equal(r.warning.kind,'ice');assert.equal(r.warning.facility,'bridge');
  assert(Math.abs(r.facilityMatch.approach.distanceM-380)<3);
  assert.match(r.warning.id,/@/);assert.equal(r.speechEvents.length,1);
});
test('overlap without progress or measured direction is unconfirmed; reverse motion resolves return leg',()=>{
  const tracker=createWeatherSafetyTracker();
  const first=tracker.update(input(600));assert.equal(first.warning.kind,'camera');assert(first.facilityMatch.ambiguous);
  const next=tracker.update(input(580,{now:now+1000,fix:{...pt(580),accuracyM:5,timestampMs:now+1000}}));
  assert.equal(next.facilityMatch.direction,'aligned');assert.equal(next.warning.facility,'bridge');
  assert(Math.abs(next.facilityMatch.approach.distanceM-380)<3);
});
test('passed outbound occurrence cannot suppress the return occurrence and each stage deduplicates',()=>{
  const tracker=createWeatherSafetyTracker();
  assert.equal(tracker.update(input(100,{progressM:100})).warning.facility,'bridge');
  const r=tracker.update(input(580,{now:now+20000,fix:{...pt(580),accuracyM:5,timestampMs:now+20000},progressM:1420}));
  assert.equal(r.warning.facility,'bridge');assert.equal(r.speechEvents.length,1);
  assert.equal(tracker.update(input(580,{now:now+20000,fix:{...pt(580),accuracyM:5,timestampMs:now+20000},progressM:1420})).speechEvents.length,0);
  const passed=tracker.update(input(-30,{now:now+40000,fix:{...pt(-30),accuracyM:5,timestampMs:now+40000},progressM:2030}));
  assert.equal(passed.facilityMatch.approach,null);
});
test('contradictory progress and off-route fixes cannot select a remote route leg',()=>{
  const tracker=createWeatherSafetyTracker();
  assert.equal(tracker.update(input(580,{progressM:100})).facilityMatch.approach,null);
  assert.equal(tracker.update(input(580,{fix:{...pt(580,100),accuracyM:5,timestampMs:now},progressM:1420})).facilityMatch.approach,null);
});
test('reroute resets occurrence and GPS direction history',()=>{
  const tracker=createWeatherSafetyTracker();tracker.update(input(580,{progressM:1420}));
  const r=tracker.update(input(580,{route:{...route,id:'rerouted'},progressM:1420}));
  assert.equal(r.speechEvents.length,1);assert.equal(r.facilityMatch.direction,'unknown');
});
test('ko → en → zh cancels previous pending tickets and keeps language/text paired',async()=>{
  const queue=createWeatherSpeechQueue(),sent=[];
  const waits=[];
  for(const language of ['ko','en','zh']){
    queue.offer(warning,language);const ticket=queue.peek();const ready=deferred();
    waits.push({ready,task:ready.promise.then(()=>{if(queue.current(ticket))sent.push(ticket);})});
    assert.equal(ticket.text,weatherWarningText(warning,language));
  }
  for(const w of waits){w.ready.resolve();await w.task;}
  assert.equal(sent.length,1);assert.equal(sent[0].language,'zh');assert.match(sent[0].text,/结冰/);
  queue.complete(sent[0]);assert.equal(queue.peek(),null);
});
test('old completion cannot consume a new language ticket; route cleanup invalidates pending speech',()=>{
  const queue=createWeatherSpeechQueue();queue.offer(warning,'ko');const old=queue.peek();
  queue.offer(warning,'en');queue.complete(old);assert.equal(queue.peek().language,'en');
  queue.clear();assert.equal(queue.current(old),false);assert.equal(queue.peek(),null);
});
function fakeSpeaker(){const calls=[];return {calls,speaker:createSpeaker({platform:'ios',engine:{speak:(text,options)=>calls.push({text,...options}),stop(){},getAvailableVoicesAsync:async()=>[]}})};}
test('busy navigation prevents low-priority weather dispatch without stopping navigation',async()=>{
  const {speaker,calls}=fakeSpeaker();
  assert.equal(await speaker.speak('Navigation turn','en'), 'spoken');
  assert.equal(await speaker.speak(warning.id,'en',{source:'weather-safety',interrupt:false,beforeSpeak:async()=>false}), 'stale');
  assert.equal(calls.length,1);
});
test('navigation requested during weather admission wins even before native speech reports busy',async()=>{
  const {speaker,calls}=fakeSpeaker(),wait=deferred();
  const weatherTask=speaker.speak('Possible icing','en',{beforeSpeak:()=>wait.promise,interrupt:false});
  await Promise.resolve();
  await speaker.speak('Turn right','en');wait.resolve(true);
  assert.equal(await weatherTask,'stale');assert.equal(calls.length,1);assert.equal(calls[0].text,'Turn right');
});
test('language changes during async admission cancel old speech; latest translated warning dispatches',async()=>{
  const {speaker,calls}=fakeSpeaker(),queue=createWeatherSpeechQueue(),wait=deferred();
  await speaker.changeLanguage('ko');queue.offer(warning,'ko');const ticket=queue.peek();
  const old=speaker.speak(ticket.text,ticket.language,{beforeSpeak:()=>wait.promise,isCancelled:()=>!queue.current(ticket)});
  await speaker.changeLanguage('en');queue.offer(warning,'en');
  await speaker.changeLanguage('zh');queue.offer(warning,'zh');wait.resolve(true);
  assert.equal(await old,'stale');const latest=queue.peek();
  assert.equal(await speaker.speak(latest.text,latest.language,{beforeSpeak:async()=>true}),'spoken');
  assert.equal(calls.length,1);assert.equal(calls[0].language,'zh-CN');assert.equal(calls[0].text,weatherWarningText(warning,'zh'));
});
test('banner puts icing and camera risks before facility details in all three languages',()=>{
  const r=createWeatherSafetyTracker().update(input(580,{progressM:1420}));
  for(const lang of ['ko','en','zh']){
    const text=weatherBannerText(r,lang),lines=text.split('\n');
    assert.equal(lines[0],weatherWarningText(r.warning,lang,false));
    assert.equal(lines[1],weatherWarningText({kind:'camera'},lang));
    assert.match(lines[2],/380|379/);assert(lines.length<=4);
  }
});
test('native banners allow wrapped text with bounded scroll area; SDK GPS is never receipt-stamped',()=>{
  const android=readFileSync(new URL('../modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/WeatherSafetyOverlay.kt',import.meta.url),'utf8');
  const ios=readFileSync(new URL('../modules/kakao-navigation/ios/KakaoNavigationController.m',import.meta.url),'utf8');
  const feed=readFileSync(new URL('../modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/GuidanceEventFeed.kt',import.meta.url),'utf8');
  assert.doesNotMatch(android,/maxLines\s*=\s*4|take\(500\)/);assert.match(android,/ScrollView/);assert.match(android,/0\.30f/);
  assert.match(ios,/numberOfLines = 0/);assert.match(ios,/contentLayoutGuide/);assert.match(ios,/multiplier:0\.30/);
  assert.match(feed,/origin.timestamp.timeInMillis/);assert.match(ios,/@"timestampMs": \[NSNull null\]/);
});
