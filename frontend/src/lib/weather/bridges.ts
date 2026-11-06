import raw from '../../data/bridgeEndpoints.json';
import type { VerifiedBridge } from './safety';
import { haversineM } from '../tunnel/geo';

// Official registry coordinates + geometric validation, not a field survey.
// Records with a single point, zero coordinates or a large length mismatch were excluded.
export function loadWeatherBridges():readonly VerifiedBridge[] {
  return raw.bridges.filter(b=>{
    const valid=[b.a,b.b].every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=32.5&&p.lat<=39.5&&p.lng>=124&&p.lng<=132.5);
    const length=haversineM(b.a,b.b);
    return valid&&length>=10&&b.source===raw.source&&b.endpointsVerified===true;
  }) as VerifiedBridge[];
}
