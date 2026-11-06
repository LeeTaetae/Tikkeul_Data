import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { weatherApi } from '../../lib/api/api';
import { loadBundledTunnels } from '../../lib/tunnel/bundled';
import { loadWeatherBridges } from '../../lib/weather/bridges';
import type { GpsFix } from '../../lib/tunnel/approach';
import type { Route } from '../../lib/routeHazards';
import { createWeatherSafetyTracker, WEATHER_SAFETY_POLICY, type SafetyWeather, type WeatherWarning, type WeatherSafetyResult } from '../../lib/weather/safety';
import { weatherBannerText } from '../../lib/weather/presentation';
import { getPortalObservation,subscribePortalObservations } from '../../lib/vision/portalObservations';
import { speaker, isSpeechBusy } from '../../lib/speech/speaker';
import { createWeatherSpeechQueue } from '../../lib/weather/speechQueue';
import { validMeasurementTime } from '../../lib/navigation/nativeWeatherFix';
import { colors, radius } from '../../theme';

export interface WeatherSafetyProps {
  active:boolean; cameraActive:boolean; route:Route|null; fix:GpsFix|null; blocked?:boolean;
  positionTrusted?:boolean;
  progressM?:number|null;
  nativeOwnedSpeech?:boolean;
  onWarning?:(text:string|null)=>void;
  onSpeechEvent?:(event:{warning:WeatherWarning;text:string;language:string})=>void;
}

export function WeatherSafetyBanner(props:WeatherSafetyProps) {
  const {i18n}=useTranslation();
  const tunnels=useMemo(()=>loadBundledTunnels().index,[]);
  const bridges=useMemo(loadWeatherBridges,[]);
  const tracker=useMemo(()=>createWeatherSafetyTracker(),[]);
  const [weather,setWeather]=useState<SafetyWeather|null>(null);
  const [tick,setTick]=useState(0);
  const [safetyResult,setSafetyResult]=useState<WeatherSafetyResult|null>(null);
  const portalObservation=useSyncExternalStore(subscribePortalObservations,getPortalObservation,()=>null);
  const warning=safetyResult?.warning??null;
  const current=useRef(props);current.current=props;
  const lastFetch=useRef(0),fetchPosition=useRef<{lat:number;lng:number}|null>(null);
  const generation=useRef(0);
  const inFlight=useRef<AbortController|null>(null);
  const queue=useRef(createWeatherSpeechQueue()).current;
  const language=i18n.language;
  const latestLanguage=useRef(language);latestLanguage.current=language;
  const speaking=useRef(false);
  const fixLat=props.fix?.lat,fixLng=props.fix?.lng;
  useEffect(()=>{const timer=setInterval(()=>setTick(v=>v+1),5000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    if(!props.active){tracker.reset();setWeather(null);setSafetyResult(null);lastFetch.current=0;queue.clear();return;}
    const fix=current.current.fix,now=Date.now();
    if(!fix||!validMeasurementTime(fix.timestampMs,now))return;
    const prev=fetchPosition.current;
    const moved=prev&&Math.hypot(fix.lat-prev.lat,fix.lng-prev.lng)>.02;
    if(now-lastFetch.current<WEATHER_SAFETY_POLICY.pollMs&&!moved)return;
    lastFetch.current=now;fetchPosition.current={lat:fix.lat,lng:fix.lng};
    // Never reuse weather from a different area while the new request is pending.
    if(moved)setWeather(null);
    const controller=new AbortController(),request=++generation.current;
    inFlight.current?.abort();inFlight.current=controller;
    weatherApi.safety(fix.lat,fix.lng,{signal:controller.signal}).then(data=>{
      if(request===generation.current&&!controller.signal.aborted)setWeather(data);
    }).catch(()=>{if(request===generation.current&&!controller.signal.aborted)setWeather(null);});
    // GPS updates do not abort the in-flight request; route/unmount invalidates it below.
  },[props.active,props.route?.id,fixLat,fixLng,tick,tracker]);
  useEffect(()=>()=>{generation.current++;queue.clear();lastFetch.current=0;inFlight.current?.abort();},[props.route?.id,props.active,queue]);
  useEffect(()=>{
    if(!props.active)return;
    const result=tracker.update({route:props.route,fix:props.fix,weather,now:Date.now(),cameraActive:props.cameraActive,blocked:props.blocked,positionTrusted:props.positionTrusted,progressM:props.progressM,tunnels,bridges,portalObservation});
    setSafetyResult(result);
    if(result.speechEvents.length)queue.offer(result.speechEvents[0]!,language);
    if(!props.blocked&&(!result.warning||queue.peek()?.warning.id!==result.warning.id))queue.clear();
    const pending=queue.peek();
    if(pending&&pending.language!==language)queue.offer(pending.warning,language);
    const next=queue.peek();
    if(!next||props.blocked||speaking.current)return;
    const {text}=next;
    if(props.nativeOwnedSpeech){props.onSpeechEvent?.({warning:next.warning,text,language:next.language});queue.complete(next);return;}
    speaking.current=true;
    const token=generation.current;
    const isCancelled=()=>token!==generation.current||latestLanguage.current!==next.language||!!current.current.blocked||!current.current.active||!queue.current(next);
    void isSpeechBusy().then(async busy=>{
      if(busy||isCancelled())return;
      const result=await speaker.speak(text,next.language,{source:'weather-safety',interrupt:false,
        beforeSpeak:async()=>!await isSpeechBusy()&&!isCancelled(),isCancelled});
      if(result==='spoken')queue.complete(next);
    }).catch(()=>{}).finally(()=>{speaking.current=false;});
  },[props.active,props.route,props.fix,props.progressM,props.cameraActive,props.blocked,props.positionTrusted,props.nativeOwnedSpeech,weather,tick,tunnels,bridges,tracker,language,portalObservation,queue]);
  const text=props.blocked?null:weatherBannerText(safetyResult,language);
  useEffect(()=>{props.onWarning?.(text);},[text,props.onWarning,props.fix?.timestampMs]);
  useEffect(()=>()=>{current.current.onWarning?.(null);},[]);
  if(!props.active||props.blocked||!text||props.onWarning)return null;
  return <View pointerEvents="none" accessibilityRole="alert" style={styles.banner}><Text style={styles.text}>{text}</Text></View>;
}

const styles=StyleSheet.create({
  banner:{position:'absolute',top:96,left:16,right:16,backgroundColor:colors.surface,borderColor:'#D58B00',borderWidth:2,borderRadius:radius.md,padding:12,zIndex:30},
  text:{color:colors.ink,fontSize:15,fontWeight:'700',lineHeight:22},
});
