import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

// 웹(브라우저)에서 영어 TTS가 OS 장난 음성(Albert, Bubbles 등 macOS 기본 설치 보이스)으로 뽑히는 경우가
// 있어, 있으면 더 자연스러운 음성을 명시적으로 고른다. iOS/Android는 원래도 장난 음성을 안 섞어 써서
// 영향 없다 - 웹에서만 적용한다.
const PREFERRED_WEB_VOICE_NAME: Partial<Record<string, string>> = { 'en-US': 'Samantha' };

let voicesPromise: Promise<Speech.Voice[]> | null = null;

// 선호 음성이 이 기기에 없으면 undefined 를 돌려준다(지정 안 함) - expo-speech 웹 구현은 못 찾은 voice
// 식별자를 주면 voices[0](언어 무관 아무 음성)으로 떨어지는 버그가 있어, 없을 땐 아예 안 넘기는 게 더 안전하다.
export async function resolveVoiceId(language: string): Promise<string | undefined> {
  if (Platform.OS !== 'web') return undefined;
  const preferredName = PREFERRED_WEB_VOICE_NAME[language];
  if (!preferredName) return undefined;
  voicesPromise ??= Speech.getAvailableVoicesAsync();
  const voices = await voicesPromise;
  return voices.find((v) => v.name === preferredName && v.language === language)?.identifier;
}
