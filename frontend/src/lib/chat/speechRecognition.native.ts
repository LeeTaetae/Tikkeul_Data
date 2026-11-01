import { useEffect } from 'react';
import { requireOptionalNativeModule } from 'expo-modules-core';

// expo-speech-recognition 의 자체 export(ExpoSpeechRecognitionModule, useSpeechRecognitionEvent)는 import 되는
// 순간 requireNativeModule(...)을 호출해, 이 네이티브 모듈이 아직 안 들어간 빌드(= expo prebuild 로 새로
// 다시 만들기 전의 기존 개발 빌드)에서는 즉시 throw 해서 홈 화면이 바로 에러로 떨어진다(앱을 열자마자 죽는
// 게 아니라 RN 에러 화면이 뜬다). requireOptionalNativeModule 은 없으면 null 을 주므로, 그 경우 빈 동작으로
// 대신하고(마이크 버튼을 눌러도 아무 일도 안 일어남), 새 네이티브 빌드가 들어오면 자동으로 실제 모듈을 쓴다.
interface NativeSpeechModule {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  start(options: { lang: string; interimResults: boolean; continuous: boolean }): void;
  stop(): void;
  addListener(eventName: string, listener: (event: any) => void): { remove(): void };
}

const native = requireOptionalNativeModule<NativeSpeechModule>('ExpoSpeechRecognition');

export const ExpoSpeechRecognitionModule: Pick<NativeSpeechModule, 'requestPermissionsAsync' | 'start' | 'stop'> = native ?? {
  requestPermissionsAsync: async () => ({ granted: false }),
  start: () => {},
  stop: () => {},
};

export function useSpeechRecognitionEvent(eventName: string, listener: (event: any) => void) {
  useEffect(() => {
    if (!native) return;
    const subscription = native.addListener(eventName, listener);
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName, listener]);
}
