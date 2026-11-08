import { projectRouteCandidates, type Route } from '../routeHazards';
import type { GpsFix } from '../tunnel/approach';
import type { TunnelIndex } from '../tunnel/dataset';
import { angleDiffDeg, bearingDeg, haversineM } from '../tunnel/geo';
import type { PortalObservation } from '../vision/portalObservations';
import type { VerifiedBridge } from './safety';
import { validMeasurementTime } from '../navigation/nativeWeatherFix';

export const FACILITY_MATCH_POLICY={rangeM:500,rangeReleaseM:540,nearM:100,passMarginM:20,
  maxLateralM:30,midpointChordRatio:.06,midpointMaxM:120,routeLateralM:40,headingToleranceDeg:60,headingMaxAgeMs:10_000,
  minimumMotionM:12,ambiguityMarginM:8,cameraMaxAgeMs:1500,cameraGpsMaxSkewMs:3000};

export interface FacilityApproach {
  id:string;facilityId:string;kind:'bridge'|'tunnel_entry'|'tunnel_exit';name:string;
  distanceM:number;stage:500|100;inside:boolean;geometryOnly:true;
}
export interface FacilityMatch {
  approach:FacilityApproach|null;gpsUsable:boolean;
  direction:'aligned'|'opposed'|'unknown';ambiguous:boolean;
  gpsTimestampMs:number|null;
}
export interface PortalAssociation {
  status:'none'|'camera_only'|'gps_only'|'facility_association';
  observation:PortalObservation|null;facilityId:string|null;
  // No calibration/projection is available: never identify or rank an individual portal.
  preferredCandidateIndex:null;individualPortalMatch:'unconfirmed';
}
type Span={id:string;occurrence:string;name:string;bridge:boolean;entry:number;exit:number;fit:number;
  a:{lat:number;lng:number};b:{lat:number;lng:number}};

export function associatePortalObservation(observation:PortalObservation|null,match:FacilityMatch,now:number):PortalAssociation {
  const validCandidates=observation?.candidates.filter(c=>Number.isFinite(c.score)&&c.score>=0&&c.score<=1&&c.method==='brightness_shape_heuristic'&&
    [c.box.x,c.box.y,c.box.width,c.box.height].every(Number.isFinite)&&c.box.x>=0&&c.box.y>=0&&c.box.width>0&&c.box.height>0&&c.box.x+c.box.width<=1.000001&&c.box.y+c.box.height<=1.000001)??[];
  const fresh=observation && now-observation.detectedAtMs>=0 && now-observation.detectedAtMs<=FACILITY_MATCH_POLICY.cameraMaxAgeMs &&
    validCandidates.length>0 ? {...observation,candidates:validCandidates}:null;
  const tunnel=match.approach?.kind==='tunnel_entry'||match.approach?.kind==='tunnel_exit'?match.approach:null;
  const associated=!!fresh && !!tunnel && tunnel.kind==='tunnel_entry' && match.gpsUsable && match.direction==='aligned' && !match.ambiguous &&
    match.gpsTimestampMs!==null&&Math.abs(fresh.detectedAtMs-match.gpsTimestampMs)<=FACILITY_MATCH_POLICY.cameraGpsMaxSkewMs;
  return {status:associated?'facility_association':fresh?'camera_only':tunnel?'gps_only':'none',
    observation:fresh,facilityId:tunnel?.facilityId??null,preferredCandidateIndex:null,individualPortalMatch:'unconfirmed'};
}

/** Route geometry is evidence of a facility corridor, not surveyed lane/portal identity. */
export function createFacilityMatcher() {
  let routeId:string|null=null;
  let lastFix:GpsFix|null=null;
  let motion:{heading:number;at:number}|null=null;
  let previousProgress:number|null=null;
  const passed=new Set<string>(),near=new Set<string>(),active=new Set<string>();
  function reset() {routeId=null;lastFix=null;motion=null;previousProgress=null;passed.clear();near.clear();active.clear();}
  return {reset,update(input:{route:Route|null;fix:GpsFix|null;now:number;tunnels:TunnelIndex;bridges?:readonly VerifiedBridge[];positionTrusted?:boolean;progressM?:number|null}):FacilityMatch {
    const {route,fix,now}=input,p=FACILITY_MATCH_POLICY;
    if(routeId!==(route?.id??null)){reset();routeId=route?.id??null;}
    const absent:FacilityMatch={approach:null,gpsUsable:false,direction:'unknown',ambiguous:false,gpsTimestampMs:null};
    if(!route||!fix||!Number.isFinite(fix.lat)||!Number.isFinite(fix.lng)||!validMeasurementTime(fix.timestampMs,now)||
      !((fix.accuracyM!==null&&fix.accuracyM>=0&&fix.accuracyM<=50)||(fix.accuracyM===null&&input.positionTrusted===true))) {
      lastFix=null;motion=null;previousProgress=null;return absent;
    }
    if(lastFix&&fix.timestampMs>lastFix.timestampMs&&fix.timestampMs-lastFix.timestampMs<=15_000&&
      haversineM(lastFix,fix)>=Math.max(p.minimumMotionM,2*Math.max(lastFix.accuracyM??0,fix.accuracyM??0))){
      motion={heading:bearingDeg(lastFix,fix),at:fix.timestampMs};lastFix=fix;
    } else if(!lastFix||fix.timestampMs-lastFix.timestampMs>15_000)lastFix=fix;
    const heading=motion&&now-motion.at<=p.headingMaxAgeMs?motion.heading:null;
    const projections=projectRouteCandidates(route,{latitude:fix.lat,longitude:fix.lng}).filter(v=>v.lateralM<=p.routeLateralM);
    const hint=typeof input.progressM==='number'&&Number.isFinite(input.progressM)&&input.progressM>=0?input.progressM:null;
    const aligned=heading===null?projections:projections.filter(v=>angleDiffDeg(heading,v.bearingDeg)<=p.headingToleranceDeg);
    // SDK progress is evidence only when it agrees with the measured location.
    // Never silently substitute a different leg for a contradictory SDK progress.
    const hinted=hint===null?aligned:aligned.filter(v=>Math.abs(v.offsetM-hint)<=60);
    const pool=hint===null&&previousProgress!==null?hinted.filter(v=>v.offsetM>=previousProgress!-30&&v.offsetM<=previousProgress!+500):hinted;
    const reference=hint??previousProgress;
    const sorted=[...pool].sort((a,b)=>reference===null?a.lateralM-b.lateralM:Math.abs(a.offsetM-reference)-Math.abs(b.offsetM-reference));
    const projection=sorted[0];
    if(!projection) {
      if(!projections.length){lastFix=null;motion=null;previousProgress=null;}
      return {...absent,gpsUsable:projections.length>0,direction:heading!==null&&aligned.length===0?'opposed':'unknown',gpsTimestampMs:fix.timestampMs};
    }
    if(reference===null&&sorted.some(v=>Math.abs(v.offsetM-projection.offsetM)>60&&Math.abs(v.lateralM-projection.lateralM)<p.ambiguityMarginM))
      return {...absent,gpsUsable:true,ambiguous:true,gpsTimestampMs:fix.timestampMs};
    previousProgress=projection.offsetM;
    const direction=heading===null?'unknown':angleDiffDeg(heading,projection.bearingDeg)<=p.headingToleranceDeg?'aligned':'opposed';
    if(direction==='opposed')return {...absent,gpsUsable:true,direction,gpsTimestampMs:fix.timestampMs};
    const spans:Span[]=[];
    const add=(id:string,name:string,a:Span['a'],b:Span['b'],bridge:boolean)=>{
      const candidates=(point:Span['a'])=>projectRouteCandidates(route,{latitude:point.lat,longitude:point.lng}).filter(v=>v.lateralM<=p.maxLateralM);
      for(const pa of candidates(a))for(const pb of candidates(b)) {
      const forward=pa.offsetM<pb.offsetM,first=forward?pa:pb,last=forward?pb:pa,start=forward?a:b,end=forward?b:a;
      const chord=haversineM(a,b),length=last.offsetM-first.offsetM;
      if(chord<5||length/chord<.7||length/chord>1.5||angleDiffDeg(first.bearingDeg,bearingDeg(start,end))>p.headingToleranceDeg||
        angleDiffDeg(last.bearingDeg,bearingDeg(start,end))>p.headingToleranceDeg)continue;
      // Check the corridor midpoint too: endpoint proximity alone can select a detour.
      // A curved tunnel's chord midpoint lies off the road by a fraction of the chord (Namsan 2: 50m on a 1.6km chord),
      // so the allowance grows with the chord instead of staying at the 30m endpoint limit.
      const midLimit=Math.min(FACILITY_MATCH_POLICY.midpointMaxM,Math.max(p.maxLateralM,chord*FACILITY_MATCH_POLICY.midpointChordRatio));
      const middle=projectRouteCandidates(route,{latitude:(a.lat+b.lat)/2,longitude:(a.lng+b.lng)/2})
        .filter(v=>v.lateralM<=midLimit).find(v=>v.offsetM>=first.offsetM&&v.offsetM<=last.offsetM);
      if(!middle)continue;
      spans.push({id,occurrence:`${id}@${Math.round(first.offsetM)}-${Math.round(last.offsetM)}`,name,bridge,a:start,b:end,entry:first.offsetM,exit:last.offsetM,fit:(pa.lateralM+pb.lateralM+middle.lateralM)/3});
      }
    };
    for(const f of input.tunnels.near(fix,1200))add(`tunnel:${f.id}`,f.name,f.a,f.b,false);
    for(const b of input.bridges??[])if(b.endpointsVerified&&b.source.trim()&&
      ([...active].some(key=>key.startsWith(`bridge:${b.id}@`))||Math.min(haversineM(fix,b.a),haversineM(fix,b.b))<=1200))add(`bridge:${b.id}`,b.name,b.a,b.b,true);
    const unique:Span[]=[];
    // Collapse duplicate IDs/near-identical endpoints without merging distinct parallel lanes.
    for(const span of spans.sort((a,b)=>a.fit-b.fit)){
      // One facility projected onto adjacent route vertices yields near-identical candidates (entries a few metres apart);
      // they are the same corridor, not parallel lanes, so only the best-fitting one is kept.
      if(unique.some(old=>old.bridge===span.bridge&&(
        (Math.abs(old.entry-span.entry)<5&&Math.abs(old.exit-span.exit)<5&&(old.id===span.id||(haversineM(old.a,span.a)<3&&haversineM(old.b,span.b)<3)))||
        (old.id===span.id&&Math.abs(old.entry-span.entry)<p.maxLateralM&&Math.abs(old.exit-span.exit)<p.maxLateralM))))continue;
      unique.push(span);
    }
    const ambiguous=new Set<string>();
    for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){
      const a=unique[i]!,b=unique[j]!;
      if(a.bridge!==b.bridge||Math.abs(a.entry-b.entry)>60||Math.abs(a.exit-b.exit)>100)continue;
      if(Math.abs(a.fit-b.fit)<p.ambiguityMarginM){ambiguous.add(a.occurrence);ambiguous.add(b.occurrence);}
      else ambiguous.add(a.fit>b.fit?a.occurrence:b.occurrence);
    }
    const choices:FacilityApproach[]=[];
    for(const span of unique){
      if(ambiguous.has(span.occurrence))continue;
      const entryKey=`${span.occurrence}:tunnel_entry`,exitKey=`${span.occurrence}:${span.bridge?'bridge':'tunnel_exit'}`;
      const offset=projection.offsetM;
      if(offset>span.entry+p.passMarginM)passed.add(entryKey);
      if(offset>span.exit+p.passMarginM){passed.add(exitKey);active.delete(span.occurrence);continue;}
      let kind:FacilityApproach['kind'],target:number,inside=false;
      if(span.bridge){kind='bridge';target=span.entry;inside=offset>=span.entry;}
      else if(!passed.has(entryKey)){kind='tunnel_entry';target=span.entry;}
      else {kind='tunnel_exit';target=span.exit;inside=true;}
      const key=`${span.occurrence}:${kind}`;
      if(passed.has(key))continue;
      const distance=inside&&span.bridge?0:Math.max(0,target-offset);
      const range=active.has(span.occurrence)?p.rangeReleaseM:p.rangeM;
      if(distance>range){active.delete(span.occurrence);continue;}
      active.add(span.occurrence);
      if(distance<=p.nearM)near.add(key);
      choices.push({id:key,facilityId:span.id,kind,name:span.name,distanceM:distance,stage:near.has(key)?100:500,inside,geometryOnly:true});
    }
    return {approach:choices.sort((a,b)=>a.distanceM-b.distanceM)[0]??null,gpsUsable:true,direction,gpsTimestampMs:fix.timestampMs,
      ambiguous:ambiguous.size>0 && choices.length===0};
  }};
}

export function facilityAssociationText(match:FacilityMatch,association:PortalAssociation,language:string):string|null {
  const lang=language.startsWith('zh')?'zh':language.startsWith('en')?'en':'ko';
  const texts={
    ko:{camera:'터널 후보 감지',gps:'전방 터널 구간',both:'경로상 터널 접근 중 · 카메라 후보 감지',bridge:'전방 교량 구간',unknown:'시설 매칭 미확인',inside:'교량 구간 통과 중',exit:'전방 터널 출구 구간'},
    en:{camera:'Tunnel candidate detected',gps:'Tunnel section ahead',both:'Approaching a tunnel on route · camera candidate detected',bridge:'Bridge section ahead',unknown:'Facility association unconfirmed',inside:'Crossing a bridge section',exit:'Tunnel exit section ahead'},
    zh:{camera:'检测到隧道候选',gps:'前方隧道路段',both:'接近路线上的隧道 · 检测到摄像头候选',bridge:'前方桥梁路段',unknown:'设施关联未确认',inside:'正在通过桥梁路段',exit:'前方隧道出口路段'},
  }[lang];
  if(association.status==='facility_association')return texts.both;
  const f=match.approach;
  const facility=f?(f.kind==='bridge'?(f.inside?texts.inside:texts.bridge):f.kind==='tunnel_exit'?texts.exit:texts.gps):null;
  if(association.status==='camera_only')return `${facility?facility+' · ':''}${texts.camera} · ${texts.unknown}`;
  return facility;
}
