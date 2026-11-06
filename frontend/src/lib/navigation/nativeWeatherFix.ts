import type { GpsFix } from '../tunnel/approach';
import { parseNativeLocation } from './nativeGuidanceFeed';

export const GPS_FRESHNESS={maxAgeMs:15_000,futureToleranceMs:5000};
export function validMeasurementTime(value:unknown,now:number):value is number {
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&
    now-value<=GPS_FRESHNESS.maxAgeMs&&value-now<=GPS_FRESHNESS.futureToleranceMs;
}
export interface NativeWeatherFix {
  fix:GpsFix;progressM:number|null;positionTrusted:boolean;
}
export function createNativeWeatherFixGate() {
  let last:NativeWeatherFix|null=null;
  return {reset(){last=null;},accept(event:Record<string,unknown>,now:number):
    {kind:'accepted';value:NativeWeatherFix}|{kind:'duplicate'}|{kind:'rejected'} {
    const position=parseNativeLocation(event);
    if(!position||!validMeasurementTime(event.timestampMs,now))return {kind:'rejected'};
    if(last && event.timestampMs<=last.fix.timestampMs) {
      if(event.timestampMs===last.fix.timestampMs&&position.lat===last.fix.lat&&position.lng===last.fix.lng)
        return {kind:'duplicate'};
      return {kind:'rejected'};
    }
    const progressM=typeof event.distFromS==='number'&&Number.isFinite(event.distFromS)&&event.distFromS>=0?event.distFromS:null;
    last={fix:{lat:position.lat,lng:position.lng,accuracyM:position.accuracyM,timestampMs:event.timestampMs},progressM,positionTrusted:event.posTrust===true};
    return {kind:'accepted',value:last};
  }};
}
