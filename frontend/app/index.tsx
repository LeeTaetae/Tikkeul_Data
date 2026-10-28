import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { CategoryMenu } from '../src/components/CategoryMenu';
import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Logo } from '../src/components/Logo';
import { KakaoMap } from '../src/map/KakaoMap';
import type { KakaoMapHandle } from '../src/map/types';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../src/theme';

// 전체 화면 지도 위에 검색창·버튼을 겹쳐 놓는다. 탭 바 위쪽 영역만 이 화면이 차지한다.
export default function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<KakaoMapHandle>(null);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} />
      </View>

      {/* 빈 곳은 터치를 지도로 통과시킨다(box-none). 안 하면 지도 드래그가 막힌다. */}
      <View style={[styles.overlay, { paddingTop: insets.top + space.md }]}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Logo />
            <LanguageSwitcher />
            <CategoryMenu />
          </View>
          <TextInput
            style={styles.search}
            accessibilityLabel={t('map.to')}
            placeholder={t('map.toPlaceholder')}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
          />
          <Pressable
            style={styles.fab}
            onPress={() => mapRef.current?.moveToMyLocation()}
            accessibilityRole="button"
            accessibilityLabel={t('map.myLocation')}
          >
            <Text style={styles.fabIcon}>◎</Text>
          </Pressable>
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
  header: {
    // zIndex: 펼친 카테고리 메뉴가 검색창·버튼에 가려지지 않게 헤더를 위로 올린다.
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  search: {
    minHeight: 48,
    borderRadius: radius.md,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  fab: {
    alignSelf: 'flex-end',
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  fabIcon: { fontSize: 22, color: colors.ink },
});
