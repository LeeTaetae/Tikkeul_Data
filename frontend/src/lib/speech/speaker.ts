// 앱 전체가 쓰는 TTS 재생 관리자. expo-speech 를 연결하고, 앱 언어(i18next)가 바뀌면 곧바로 따라간다.
// 음성 재생은 반드시 여기를 거친다(Speech.speak 를 화면·훅에서 직접 부르지 않는다): 언어 매핑·음성 선택·변경 시 예약 취소를 한곳에서 맡기 위해서다.
import { Alert, Linking, Platform } from 'react-native';
import * as Speech from 'expo-speech';

import i18n from '../../i18n';
import { createSpeaker, type SpeechDebugEvent } from './speakerCore';
import { PREFERRED_WEB_VOICES, type SpeechLanguage } from './speechLocale';

// 대상 언어 음성이 기기에 없을 때: 한국어로 대신 읽지 않고, 화면 안내는 그대로 두고 한 번만 알린다. 음성 설정(TTS)으로 바로 갈 수 있다.
function showMissingVoiceNotice(language: SpeechLanguage): void {
  const name = i18n.t(`speech.languageName.${language}`);
  Alert.alert(i18n.t('speech.missingVoice.title', { language: name }), i18n.t('speech.missingVoice.body', { language: name }), [
    {
      text: i18n.t('speech.missingVoice.settings'),
      onPress: () => {
        Linking.sendIntent('com.android.settings.TTS_SETTINGS').catch(() => void Linking.openSettings());
      },
    },
    { text: i18n.t('speech.missingVoice.ok'), style: 'cancel' },
  ]);
}

// 개발 모드 진단: 음성 안내 한 건이 어디서 어떻게 처리됐는지(요청 → 건너뜀/speak 호출 → 시작/종료/중단/오류 → 취소 사유)를 남긴다.
// Metro 터미널·`adb logcat *:S ReactNativeJS:V` 에서 "[tts]" 로 찾는다. 문장·언어·음성 이름만 담고 위치·계정·API 키는 담지 않는다.
// 최근 기록은 메모리에 80건까지 두고 ttsDebugLog() 로 읽는다. 배포 빌드(__DEV__ 가 false)에서는 아무것도 하지 않는다.
const DEBUG_LIMIT = 80;
const debugLog: SpeechDebugEvent[] = [];

export function ttsDebug(event: SpeechDebugEvent): void {
  if (!__DEV__) return;
  debugLog.push(event);
  if (debugLog.length > DEBUG_LIMIT) debugLog.shift();
  console.log('[tts]', JSON.stringify(event));
}

/** 최근 음성 안내 진단 기록(개발 모드만 채워진다). */
export const ttsDebugLog = (): readonly SpeechDebugEvent[] => debugLog;

export const speaker = createSpeaker({
  engine: Speech,
  platform: Platform.OS,
  preferredWebVoices: PREFERRED_WEB_VOICES,
  onUnsupported: showMissingVoiceNotice,
  onEvent: __DEV__ ? ttsDebug : undefined,
});

void speaker.changeLanguage(i18n.language);
i18n.on('languageChanged', (language) => {
  void speaker.changeLanguage(language);
});
