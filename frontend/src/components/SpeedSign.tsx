import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

// 제한속도 표지판 모양(빨간 테두리 원 + 숫자).
export function SpeedSign({ limit, size = 64 }: { limit: number; size?: number }) {
  return (
    <View
      accessibilityLabel={`${limit} km/h`}
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2, borderWidth: size * 0.12 },
      ]}
    >
      <Text style={[styles.num, { fontSize: size * 0.42 }]}>{limit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: { fontWeight: '800', color: colors.ink },
});
