import '../src/i18n';

import { House, Map as MapIcon, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/ui/Icon';
import { colors } from '../src/theme';

const tabIcon =
  (glyph: LucideIcon) =>
  ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Icon icon={glyph} size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
  );

const TAB_BAR_HEIGHT = 60;

export default function RootLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // 활성 탭만 브랜드 퍼플, 나머지는 중립 회색. 배경은 흰색.
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        // 아이콘 24 + 라벨이 잘리지 않도록 높이를 직접 정한다. 하단 Safe Area 는 여백으로 더해 터치 영역(60px)을 지킨다.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: tabIcon(House) }} />
      <Tabs.Screen name="map" options={{ title: t('tabs.map'), tabBarIcon: tabIcon(MapIcon) }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabs.alerts'), tabBarIcon: tabIcon(TriangleAlert) }} />
      {/* 길안내 화면: 홈에서 안내를 시작할 때만 들어간다. 탭 항목은 숨기고(href: null 은 주소로 직접 열리지 않는다), 이 화면에서는 지도를 가리지 않게 탭 막대도 숨긴다. */}
      <Tabs.Screen name="navigation" options={{ tabBarItemStyle: { display: 'none' }, tabBarStyle: { display: 'none' } }} />
    </Tabs>
  );
}
