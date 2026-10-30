import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '../../theme';

interface Props {
  children: ReactNode;
  // 있으면 눌러서 쓰는 카드가 된다(버튼 역할 + 눌림 표시).
  onPress?: () => void;
  accessibilityLabel?: string;
  // 눌러서 펼치는 카드면 펼침 상태를 스크린리더에 알린다.
  expanded?: boolean;
  style?: StyleProp<ViewStyle>;
}

// 흰 카드. 라운드 20 · 부드러운 그림자 · 안쪽 여백 16.
export function Card({ children, onPress, accessibilityLabel, expanded, style }: Props) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-expanded={expanded}
      style={({ pressed }) => [styles.card, styles.pressable, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadow.card,
  },
  pressable: { minHeight: 44 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
