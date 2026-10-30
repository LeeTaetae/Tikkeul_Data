import { StyleSheet, Text } from 'react-native';

import { colors } from '../../theme';

// FloatingHeader 의 제목 자리에 넣는 화면 제목. 긴 번역은 한 줄로 줄여 맞춘다.
export function HeaderTitle({ children }: { children: string }) {
  return (
    <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: colors.ink },
});
