import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, space } from '../../theme';

interface Props {
  message: string;
  /** warn: 사용자가 알아야 하는 문제(권한·신호·이탈). info: 진행 상황 */
  tone: 'info' | 'warn';
  actionLabel?: string;
  onAction?: () => void;
}

// GPS·재탐색 상태 띠. 문제가 있을 때만 뜬다(정상 추적 중에는 보이지 않는다).
export function NavStatus({ message, tone, actionLabel, onAction }: Props) {
  const warn = tone === 'warn';
  return (
    <View style={[styles.box, warn && styles.boxWarn]} accessibilityRole={warn ? 'alert' : undefined} accessibilityLiveRegion="polite">
      <Text style={[styles.text, warn && styles.textWarn]}>{message}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, boxShadow: shadow.card },
  boxWarn: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.danger },
  text: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: colors.ink },
  textWarn: { color: colors.dangerInk },
  action: { minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  pressed: { opacity: 0.85 },
});
