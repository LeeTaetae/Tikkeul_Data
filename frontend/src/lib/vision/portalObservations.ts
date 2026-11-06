import type { PortalCandidate, PortalFrame } from './portalCandidates';

export interface PortalObservation {
  frame: Pick<PortalFrame,'width'|'height'>;
  candidates: readonly PortalCandidate[];
  detectedAtMs: number;
  timeBasis: 'js_detection';
}

// Ephemeral on-device observations only; never persist frames or reinterpret scores as confidence.
let owner: symbol|null=null;
let latest: PortalObservation|null=null;
const listeners=new Set<()=>void>();
export const getPortalObservation=()=>latest;
export function subscribePortalObservations(listener:()=>void) {
  listeners.add(listener);return ()=>{listeners.delete(listener);};
}
export function publishPortalObservation(source:symbol,value:PortalObservation|null) {
  if(value===null && owner!==source)return;
  owner=value?source:null;latest=value;
  for(const listener of listeners)listener();
}
