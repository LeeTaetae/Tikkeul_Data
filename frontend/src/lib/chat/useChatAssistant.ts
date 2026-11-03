import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentLocation } from '../location/getCurrentLocation';
import { speaker } from '../speech/speaker';
import { speechLocaleOf } from '../speech/speechLocale';
import { chatApi } from './api';
import { buildRequestBody, type ChatTurn } from './conversation';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from './speechRecognition';

export function useChatAssistant() {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);

  const locale = speechLocaleOf(i18n.language); // 음성 인식 locale. 답변 읽기는 speaker 가 같은 규칙으로 맡는다.

  const send = useCallback(
    async (text: string) => {
      setMessages((prev) => [...prev, { role: 'user', text }]);
      setSending(true);
      try {
        const origin = await getCurrentLocation();
        const body = buildRequestBody(text, messages, origin);
        const { reply } = await chatApi.send(body);
        setMessages((prev) => [...prev, { role: 'assistant', text: reply }]);
        void speaker.speak(reply, i18n.language, { source: 'chat' });
      } catch {
        setMessages((prev) => [...prev, { role: 'assistant', text: t('chat.error') }]);
      } finally {
        setSending(false);
      }
    },
    [messages, i18n.language, t],
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
