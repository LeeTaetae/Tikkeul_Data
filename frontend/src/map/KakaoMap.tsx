import { StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../theme';

export function KakaoMap() {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>모바일 지도는 준비 중입니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: 240,
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 15, color: colors.muted },
});
