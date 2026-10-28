import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../theme';

const ACCENT = 'Data';

// 워드마크 로고: 앞부분은 진한 남색, 끝의 "Data"만 보라색. 언어별 title 을 그대로 쓴다.
export function Logo() {
  const { t } = useTranslation();
  const name = t('home.title');
  const hasAccent = name.endsWith(ACCENT);
  return (
    <Text
      style={styles.logo}
      accessibilityRole="header"
      accessibilityLabel={name}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {hasAccent ? name.slice(0, -ACCENT.length) : name}
      {hasAccent && <Text style={styles.accent}>{ACCENT}</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  logo: { flex: 1, minWidth: 0, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  accent: { color: colors.brand },
});
