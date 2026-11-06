import { facilityAssociationText } from './facilityAssociation';
import { weatherWarningText, type WeatherSafetyResult } from './safety';

/** Risk first, compact context second. Native views wrap and scroll without truncation. */
export function weatherBannerText(result:WeatherSafetyResult|null,language:string):string|null {
  if(!result)return null;
  const {warning,facilityMatch,portalAssociation}=result;
  const association=facilityAssociationText(facilityMatch,portalAssociation,language);
  const f=facilityMatch.approach;
  const lines:string[]=[];
  if(warning&&warning.kind!=='facility')lines.push(weatherWarningText(warning,language,!association));
  if(result.cameraDegraded&&warning?.kind!=='camera')lines.push(weatherWarningText({id:'camera',kind:'camera',facility:null,stage:null,forecast:false},language));
  if(association)lines.push(`${association}${f?` · ${Math.round(f.distanceM)}m`:''}`);
  if(warning?.kind==='facility'&&result.weatherStatus==='unavailable')lines.push(weatherWarningText({id:'unknown',kind:'unavailable',facility:null,stage:null,forecast:false},language));
  const en=language.startsWith('en'),zh=language.startsWith('zh');
  const notes:string[]=[];
  if(!result.observationKnown&&result.weatherStatus==='forecast')notes.push(en?'Observation unknown; forecast-based':zh?'观测未确认；预报提示':'관측 미확인 · 예보 기준');
  if(portalAssociation.status==='facility_association')notes.push(en?'Individual portal unconfirmed':zh?'具体洞口未确认':'개별 포털 미확인');
  else if(f)notes.push(en?'Estimated facility location':zh?'设施位置为估计':'시설 위치 추정');
  if(notes.length)lines.push(notes.join(' · '));
  return lines.length?lines.join('\n'):null;
}
