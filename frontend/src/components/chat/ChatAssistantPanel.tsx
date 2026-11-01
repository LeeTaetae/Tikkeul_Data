import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Mic, Send, Sparkles, X } from 'lucide-react-native';

import { useChatAssistant } from '../../lib/chat/useChatAssistant';
import { colors, radius, space } from '../../theme';
import { Chip } from '../ui/Chip';
import { RoundButton } from '../ui/RoundButton';
import { SearchBar } from '../ui/SearchBar';

interface Props {
  onClose: () => void;
}

// 제안 질문 3개는 실제 챗봇 툴(nearby_incidents·nearby_caution_zones·nearby_protection_zones)과 일반 질문
// 한 가지를 하나씩 맞춰 골랐다 - 빈 화면에서 바로 눌러 보면 챗봇이 뭘 할 수 있는지 알 수 있다.
const SUGGESTION_KEYS = ['chat.suggestion1', 'chat.suggestion2', 'chat.suggestion3'] as const;

// 홈 화면 챗봇 버튼을 누르면 뜨는 패널. windowHeight/bottomInset 은 index.tsx 가 BottomSheet 에 이미 넘기므로
// 이 컴포넌트는 BottomSheet 안쪽 내용만 맡는다(시트 자체는 index.tsx 가 렌더링한다).
export function ChatAssistantPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const { messages, sending, listening, send, startListening, stopListening } = useChatAssistant();
  const [text, setText] = useState('');

  const onSend = (value: string) => {
    if (!value.trim()) return;
    send(value.trim());
    setText('');
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <View style={styles.badge}>
            <Sparkles size={20} color={colors.brand} strokeWidth={2} />
          </View>
          <Text style={styles.title}>{t('chat.title')}</Text>
        </View>
        <RoundButton icon={X} label={t('chat.closeLabel')} variant="soft" size={44} onPress={onClose} />
      </View>

      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('chat.emptyTitle')}</Text>
          <View style={styles.suggestions}>
            {SUGGESTION_KEYS.map((key) => (
              <Chip key={key} label={t(key)} onPress={() => onSend(t(key))} />
            ))}
          </View>
        </View>
      ) : (
        <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
          {messages.map((turn, i) => (
            <View key={i} style={[styles.bubble, turn.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
              <Text style={turn.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant}>{turn.text}</Text>
            </View>
          ))}
          {sending && (
            <View style={[styles.bubble, styles.bubbleAssistant]}>
              <Text style={styles.bubbleTextAssistant}>{t('chat.sending')}</Text>
            </View>
          )}
          {listening && <Text style={styles.status}>{t('chat.listening')}</Text>}
        </ScrollView>
      )}

      <SearchBar
        accessibilityLabel={t('chat.placeholder')}
        placeholder={t('chat.placeholder')}
        leadingIcon={Sparkles}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSend(text)}
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
            <RoundButton icon={Send} label={t('chat.send')} variant="brand" size={44} onPress={() => onSend(text)} />
          </View>
        }
      />
      <Text style={styles.disclaimer}>{t('chat.disclaimer')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  empty: { gap: space.md, paddingVertical: space.sm },
  emptyTitle: { fontSize: 15, color: colors.muted },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  messages: { maxHeight: 280 },
  messagesContent: { gap: space.sm, paddingVertical: space.xs },
  bubble: { maxWidth: '85%', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: space.xs },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderBottomLeftRadius: space.xs },
  bubbleTextUser: { color: colors.surface, fontSize: 15 },
  bubbleTextAssistant: { color: colors.ink, fontSize: 15 },
  status: { color: colors.muted, fontSize: 13 },
  trailing: { flexDirection: 'row', gap: space.xs },
  disclaimer: { fontSize: 11, color: colors.muted, textAlign: 'center' },
});
