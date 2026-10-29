import { useImperativeHandle } from 'react';
import type { Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import type { KakaoMapHandle, RoutePoint } from './types';

// 모바일(WebView) 지도는 다음 단계에서 구현한다. 웹은 KakaoMap.web.tsx 를 쓴다.
export function KakaoMap({ ref }: { ref?: Ref<KakaoMapHandle>; onMapClick?: (point: RoutePoint) => void }) {
  useImperativeHandle(ref, () => ({
    moveToMyLocation: () => {},
    showRoute: () => {},
    clearRoute: () => {},
  }));

  return (
    <View style={styles.box}>
      <Text style={styles.text}>모바일 지도는 준비 중입니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 15, color: colors.muted },
});
