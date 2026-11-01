import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Mic, Send, X } from 'lucide-react-native';

import { useChatAssistant } from '../../lib/chat/useChatAssistant';
import { colors, radius, space } from '../../theme';
import { RoundButton } from '../ui/RoundButton';
import { SearchBar } from '../ui/SearchBar';

interface Props {
  onClose: () => void;
}

// 홈 화면 챗봇 버튼을 누르면 뜨는 패널. windowHeight/bottomInset 은 index.tsx 가 BottomSheet 에 이미 넘기므로
// 이 컴포넌트는 BottomSheet 안쪽 내용만 맡는다(시트 자체는 index.tsx 가 렌더링한다).
export function ChatAssistantPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const { messages, sending, listening, send, startListening, stopListening } = useChatAssistant();
  const [text, setText] = useState('');

  const onSend = () => {
    if (!text.trim()) return;
    send(text.trim());
    setText('');
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('chat.title')}</Text>
        <RoundButton icon={X} label={t('chat.closeLabel')} variant="soft" size={44} onPress={onClose} />
      </View>
      <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {messages.map((turn, i) => (
          <View key={i} style={[styles.bubble, turn.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
            <Text style={turn.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant}>{turn.text}</Text>
          </View>
        ))}
        {sending && <Text style={styles.status}>{t('chat.sending')}</Text>}
        {listening && <Text style={styles.status}>{t('chat.listening')}</Text>}
      </ScrollView>
      <SearchBar
        accessibilityLabel={t('chat.placeholder')}
        placeholder={t('chat.placeholder')}
        value={text}
        onChangeText={setText}
        onSubmitEditing={onSend}
        returnKeyType="send"
        trailing={
          <View style={styles.trailing}>
            <RoundButton
              icon={Mic}
              label={t('chat.mic')}
              variant={listening ? 'brand' : 'soft'}
              size={44}
              onPress={listening ? stopListening : startListening}
            />
            <RoundButton icon={Send} label={t('chat.send')} size={44} onPress={onSend} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  messages: { maxHeight: 280 },
  messagesContent: { gap: space.sm, paddingVertical: space.xs },
  bubble: { maxWidth: '85%', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.brand },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft },
  bubbleTextUser: { color: colors.surface, fontSize: 15 },
  bubbleTextAssistant: { color: colors.ink, fontSize: 15 },
  status: { color: colors.muted, fontSize: 13 },
  trailing: { flexDirection: 'row', gap: space.xs },
});
