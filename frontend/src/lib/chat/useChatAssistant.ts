import { useCallback, useState } from 'react';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { getCurrentLocation } from '../location/getCurrentLocation';
import { resolveVoiceId } from '../speechVoice';
import { chatApi } from './api';
import { buildRequestBody, type ChatTurn } from './conversation';

// i18n 언어 코드(ko/en/zh) → 음성 인식·TTS locale. useAnnounceOnApproach.ts 의 같은 매핑과 별개로 둔다 - 공유 모듈이 아니다.
const SPEECH_LOCALE: Record<string, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };

export function useChatAssistant() {
  const { i18n } = useTranslation();
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);

  const locale = SPEECH_LOCALE[i18n.language] ?? SPEECH_LOCALE.ko;

  const send = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { role: 'user', text }]);
      setSending(true);
      try {
        const origin = await getCurrentLocation();
        const body = buildRequestBody(text, messages, origin);
        const { reply } = await chatApi.send(body);
        setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
        resolveVoiceId(locale).then((voice) => Speech.speak(reply, { language: locale, voice }));
      } finally {
        setSending(false);
      }
    },
    [messages, locale],
  );

  const startListening = useCallback(async () => {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) return;
    ExpoSpeechRecognitionModule.start({ lang: locale, interimResults: false, continuous: false });
  }, [locale]);

  const stopListening = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) send(transcript);
  });

  return { messages, sending, listening, send, startListening, stopListening };
}
