import { weatherWarningText, type WeatherWarning } from './safety';

/** Captures text and locale together; an old async attempt cannot consume a new one. */
export function createWeatherSpeechQueue() {
  let revision=0;
  let pending:{warning:WeatherWarning;language:string;text:string;revision:number}|null=null;
  return {
    clear(){revision++;pending=null;},
    offer(warning:WeatherWarning,language:string){
      if(pending?.warning.id===warning.id&&pending.language===language)return;
      pending={warning,language,text:weatherWarningText(warning,language),revision:++revision};
    },
    peek:()=>pending,
    current(ticket:NonNullable<typeof pending>){return pending?.revision===ticket.revision;},
    complete(ticket:NonNullable<typeof pending>){if(pending?.revision===ticket.revision)pending=null;},
  };
}
