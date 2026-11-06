import type { WeatherWarning } from './safety';

// Native car SDK owns speech. Publish intent only until its priority arbiter is connected.
export interface WeatherSpeechEvent { warning:WeatherWarning; text:string; language:string }
const listeners=new Set<(event:WeatherSpeechEvent)=>void>();
export function onWeatherSpeechEvent(listener:(event:WeatherSpeechEvent)=>void) {
  listeners.add(listener);return ()=>{listeners.delete(listener);};
}
export function publishWeatherSpeechEvent(event:WeatherSpeechEvent) {
  for(const listener of listeners)listener(event);
}
