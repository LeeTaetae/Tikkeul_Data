import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radius, space } from '../../theme';

// 공공 API 가 준 한국어 원문 문구라는 표시. 한국어가 아닌 화면에서만 보여, 번역된 정보처럼 읽히지 않게 한다.
export function OriginalTag() {
  const { t, i18n } = useTranslation();
  if (i18n.language === 'ko') return null;
  return (
    <View style={styles.tag}>
      <Text style={styles.text}>{t('traffic.originalKo')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  text: { fontSize: 12, fontWeight: '700', color: colors.muted },
});
