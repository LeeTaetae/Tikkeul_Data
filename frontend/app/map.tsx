import { Crosshair } from 'lucide-react-native';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { StatusBanner } from '../src/components/StatusBanner';
import { HeaderTitle } from '../src/components/ui/HeaderTitle';
import { RoundButton } from '../src/components/ui/RoundButton';
import { ScreenHeader } from '../src/components/ui/ScreenHeader';
import { KakaoMap } from '../src/map/KakaoMap';
import type { KakaoMapHandle } from '../src/map/types';
import { MAX_CONTENT_WIDTH, colors, space } from '../src/theme';

// 길찾기(출발·도착·경로 선택·안내)는 홈 화면에서 한다. 여기는 지도를 화면 가득 보여주는 화면이다.
// 지도는 전체 화면, 그 위에 헤더와 "데이터 갱신 시각 + 현재 위치 버튼" 한 줄만 띄운다. 빈 곳은 터치를 지도로 통과시킨다.
export default function MapScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<KakaoMapHandle>(null);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} />
      </View>

      <View style={[styles.overlay, { paddingTop: insets.top + space.md }]}>
        <View style={styles.column}>
          <ScreenHeader title={<HeaderTitle>{t('map.title')}</HeaderTitle>} />
          <View style={styles.statusRow}>
            <View style={styles.status}>
              <StatusBanner />
            </View>
            <RoundButton icon={Crosshair} label={t('map.myLocation')} onPress={() => mapRef.current?.moveToMyLocation()} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  // zIndex: 카카오 지도 내부 요소가 오버레이를 덮지 않도록 층을 나눈다(웹).
  mapLayer: { ...StyleSheet.absoluteFill, zIndex: 0 },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    alignItems: 'center',
    paddingHorizontal: space.lg,
    pointerEvents: 'box-none',
  },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space.md, pointerEvents: 'box-none' },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, pointerEvents: 'box-none' },
  status: { flex: 1, minWidth: 0 },
});
