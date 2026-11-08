import type { Route } from '../routeHazards';
import type { TunnelIndex } from '../tunnel/dataset';
import type { GpsFix } from '../tunnel/approach';
import { parseRoadWeather, type PtyKind } from '../tunnel/weather';
import { createFacilityMatcher,associatePortalObservation,type FacilityMatch,type PortalAssociation } from './facilityAssociation';
import type { PortalObservation } from '../vision/portalObservations';

// Demonstration settings, NOT official heavy-rain/snow warning thresholds.
export const WEATHER_SAFETY_POLICY = {
  heavyRainMmH: 10, heavySnowWaterMmH: 1, freezingTempC: 3,
  observationMaxAgeMs: 60*60_000, forecastHorizonMs: 60*60_000,
  gpsMaxAgeMs: 15_000, routeLateralM: 40, pollMs: 60_000,
};
export interface Quantity { lower: number|null; upper: number|null; category: string; unit: string }
export interface ForecastPoint { issued_at:string; valid_at:string; temp_c:number|null; pty:PtyKind; rain:Quantity; snow:Quantity }
export interface WeatherComponent<T> { status:'available'|'stale'|'unavailable'; data:T|null; error_code?:string|null }
export interface SafetyWeather {
  observation:WeatherComponent<unknown>;
  ultra_forecast:WeatherComponent<ForecastPoint[]>;
  village_forecast:WeatherComponent<ForecastPoint[]>;
}
export interface VerifiedBridge {
  id:string; name:string; a:{lat:number;lng:number}; b:{lat:number;lng:number};
  source:string; endpointsVerified:true;
}
export type WarningKind='camera'|'slip'|'ice'|'unavailable'|'facility';
export interface WeatherWarning { id:string; kind:WarningKind; facility:'bridge'|'tunnel_entry'|'tunnel_exit'|null; stage:500|100|null; forecast:boolean;inside?:boolean }
export interface WeatherSafetyResult { warning:WeatherWarning|null; speechEvents:WeatherWarning[]; weatherStatus:'available'|'forecast'|'unavailable'; gpsUsable:boolean;
  facilityMatch:FacilityMatch;portalAssociation:PortalAssociation;cameraDegraded:boolean;observationKnown:boolean }
const snowLike=(pty:PtyKind)=>['snow','rain_snow','drizzle_snow','snow_flurry'].includes(pty);
const rainLike=(pty:PtyKind)=>['rain','shower','drizzle'].includes(pty);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const positive=(q:Quantity|undefined)=>!!q && ((finite(q.lower)&&q.lower>0)||(finite(q.upper)&&q.upper>0));

export function weatherConditions(data:SafetyWeather|null,now:number) {
  let current:{temp:number|null;wet:boolean;snow:boolean;heavy:boolean;forecast:boolean}|null=null;
  if(data?.observation?.status==='available') {
    const o=parseRoadWeather(data.observation.data);
    if(o && now-Date.parse(o.observedAt)<=WEATHER_SAFETY_POLICY.observationMaxAgeMs && now-Date.parse(o.observedAt)>=-600_000 && o.pty!=='unknown' && !o.missing.includes('PTY')) {
      const q=(data.observation.data as {rain?:Quantity}).rain;
      const snow=snowLike(o.pty),wet=rainLike(o.pty)||snow||(o.rainMm1h??0)>0||positive(q);
      const minimum=q?.lower??o.rainMm1h??0;
      current={temp:o.tempC,wet,snow,forecast:false,heavy:minimum>=(snow?WEATHER_SAFETY_POLICY.heavySnowWaterMmH:WEATHER_SAFETY_POLICY.heavyRainMmH)};
    }
  }
  const points:ForecastPoint[]=[];
  for(const [part,maxAge] of [[data?.ultra_forecast,3*3600_000],[data?.village_forecast,6*3600_000]] as const) {
    if(part?.status!=='available'||!Array.isArray(part.data))continue;
    for(const p of part.data) {
      const ahead=Date.parse(p.valid_at)-now,age=now-Date.parse(p.issued_at);
      if(ahead>=0&&ahead<=WEATHER_SAFETY_POLICY.forecastHorizonMs&&age>=0&&age<=maxAge&&p.pty!=='unknown')points.push(p);
    }
  }
  const forecasts=points.map(p=>({temp:finite(p.temp_c)?p.temp_c:null,wet:rainLike(p.pty)||snowLike(p.pty)||positive(p.rain)||positive(p.snow),
    snow:snowLike(p.pty)||positive(p.snow),heavy:false,forecast:true}));
  // Current wet conditions take precedence; a near-term wet forecast is separately marked.
  const road=current?.wet?current:forecasts.find(p=>p.wet)??current??forecasts[0]??null;
  return {current,road,status:current?'available' as const:road?'forecast' as const:'unavailable' as const};
}

export function createWeatherSafetyTracker() {
  let routeId:string|null=null;
  const seen=new Set<string>();
  const matcher=createFacilityMatcher();
  return {
    reset(){routeId=null;seen.clear();matcher.reset();},
    update(input:{route:Route|null;fix:GpsFix|null;weather:SafetyWeather|null;now:number;cameraActive:boolean;blocked?:boolean;positionTrusted?:boolean;
      tunnels:TunnelIndex;bridges?:readonly VerifiedBridge[];portalObservation?:PortalObservation|null;progressM?:number|null}):WeatherSafetyResult {
      const {route,fix,now,weather}=input;
      if(routeId!==(route?.id??null)){routeId=route?.id??null;seen.clear();}
      const conditions=weatherConditions(weather,now);
      const facilityMatch=matcher.update(input),f=facilityMatch.approach;
      const portalAssociation=associatePortalObservation(input.cameraActive?input.portalObservation??null:null,facilityMatch,now);
      const road=conditions.road;
      const kind:WarningKind=road?.wet?(road.temp!==null&&road.temp<=WEATHER_SAFETY_POLICY.freezingTempC?'ice':'slip'):'facility';
      let warning:WeatherWarning|null=f?{id:`${f.id}:${f.stage}:${kind}`,kind,facility:f.kind,stage:f.stage,forecast:road?.forecast??false,inside:f.inside}:null;
      if(!warning&&input.cameraActive&&conditions.current?.heavy)warning={id:'camera-heavy-precipitation',kind:'camera',facility:null,stage:null,forecast:false};
      if(!warning&&!conditions.current)warning={id:'weather-unavailable',kind:'unavailable',facility:null,stage:null,forecast:conditions.status==='forecast'};
      const speechEvents:WeatherWarning[]=[];
      if(warning&&warning.facility&&!input.blocked&&!seen.has(warning.id)&&(warning.stage===500||warning.kind!=='facility')){
        // A first fix at 100m subsumes the skipped 500m stage.
        seen.add(warning.id);
        if(warning.stage===100)seen.add(warning.id.replace(':100:',':500:'));
        speechEvents.push(warning);
      }
      return {warning:input.blocked?null:warning,speechEvents,weatherStatus:conditions.status,gpsUsable:facilityMatch.gpsUsable,
        facilityMatch,portalAssociation,cameraDegraded:input.cameraActive&&!!conditions.current?.heavy,observationKnown:!!conditions.current};
    },
  };
}

const messages={
  ko:{camera:'강한 비나 눈으로 인해 카메라 객체 탐지 성능이 떨어질 수 있습니다. 주변 상황에 주의해 주세요.',unavailable:'날씨 확인 불가. 기상·노면 상태를 직접 확인해 주세요.',bridge:'전방 교량 구간입니다.',tunnel_entry:'전방 터널 구간입니다.',tunnel_exit:'전방 터널 출구 구간입니다.',slip:'노면이 미끄러울 수 있으니 감속하세요.',ice:'결빙 가능성에 주의하고 감속하세요.',tunnelIce:'결빙 가능성이 있습니다. 터널 안 노면이 미끄러울 수 있으니 서행하세요.',forecast:'강수 예보가 있습니다.'},
  en:{camera:'Heavy rain or snow may reduce camera detection performance. Watch your surroundings.',unavailable:'Weather unavailable. Check weather and road conditions.',bridge:'Bridge ahead.',tunnel_entry:'Tunnel entrance ahead.',tunnel_exit:'Tunnel exit ahead.',slip:'The road may be slippery. Slow down.',ice:'Possible icing. Slow down.',tunnelIce:'Possible icing. The road inside the tunnel may be slippery; slow down.',forecast:'Precipitation is forecast.'},
  zh:{camera:'强雨雪可能影响摄像头识别，请注意周围情况。',unavailable:'无法确认天气，请留意天气和路面。',bridge:'前方桥梁。',tunnel_entry:'前方隧道入口。',tunnel_exit:'前方隧道出口。',slip:'路面可能湿滑，请减速。',ice:'可能结冰，请减速。',tunnelIce:'可能结冰，隧道内路面可能湿滑，请减速。',forecast:'预报有降水。'},
};
export function weatherWarningText(w:WeatherWarning,language:string,includeFacility=true) {
  const m=messages[language.startsWith('zh')?'zh':language.startsWith('en')?'en':'ko'];
  if(w.kind==='camera'||w.kind==='unavailable')return m[w.kind];
  // Icing is only "possible" (weather observation, not a road-surface reading); inside a tunnel it gets its own wording.
  if(w.kind==='ice'&&(w.facility==='tunnel_entry'||w.facility==='tunnel_exit'))return `${w.forecast?m.forecast+' ':''}${m.tunnelIce}`;
  const label=w.facility==='bridge'&&w.inside?(language.startsWith('zh')?'正在通过桥梁路段。':language.startsWith('en')?'Crossing a bridge section.':'교량 구간 통과 중입니다.'):w.facility?m[w.facility]:'';
  if(w.kind==='facility')return label;
  return `${w.forecast?m.forecast+' ':''}${includeFacility&&label?label+' ':''}${m[w.kind]}`;
}
