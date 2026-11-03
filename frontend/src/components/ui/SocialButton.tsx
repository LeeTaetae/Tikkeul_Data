import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ColorValue } from 'react-native';
import type { ReactNode } from 'react';

import { radius, space } from '../../theme';

interface Props {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  backgroundColor: ColorValue;
  textColor: ColorValue;
  borderColor?: ColorValue;
}

// PrimaryButton과 달리 브랜드사 로그인 버튼 가이드(구글/카카오)는 색이 고정이라 테마 brand 색을 안 쓴다.
export function SocialButton({ icon, label, onPress, disabled, loading, backgroundColor, textColor, borderColor }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderColor: borderColor ?? backgroundColor },
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.label, { color: textColor }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  label: { fontSize: 16, fontWeight: '800' },
});
