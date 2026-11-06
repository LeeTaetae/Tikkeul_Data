import { useNativeHazardRail } from '../../lib/navigation/useNativeHazardRail';
import { WeatherSafetyBanner } from '../alerts/WeatherSafetyBanner';
import { setNativeWeatherSafetyBanner } from '../../native/kakaoNavigation';
import { publishWeatherSpeechEvent } from '../../lib/weather/speechEvents';
import type { GpsFix } from '../../lib/tunnel/approach';

/** 카카오 SDK 주행 화면 위험 레일을 구동하는 보이지 않는 컴포넌트. 화면이 사라지면 오버레이를 비운다 */
export function NativeHazardRailBridge({fallbackFix=null}:{fallbackFix?:GpsFix|null}={}) {
  const feed=useNativeHazardRail();
  return <WeatherSafetyBanner active={feed.weatherRoute!==null} cameraActive route={feed.weatherRoute}
    fix={feed.weatherFix??fallbackFix} positionTrusted={feed.weatherFix?feed.positionTrusted:false} progressM={feed.weatherFix?feed.weatherProgressM:null} blocked={feed.weatherBlocked}
    nativeOwnedSpeech onWarning={setNativeWeatherSafetyBanner} onSpeechEvent={publishWeatherSpeechEvent} />;
}
