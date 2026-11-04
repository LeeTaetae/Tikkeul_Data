import '../src/i18n';

import { Bus, House, Navigation as NavigationIcon, Star, type LucideIcon } from 'lucide-react-native';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '../src/components/ui/Icon';
import { AuthProvider } from '../src/lib/auth/AuthContext';
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
  // 탭에 안 보이지만 눌러서 들어가는 화면들(길안내·로그인·가입·즐겨찾기)에 공통으로 쓴다.
  const hiddenScreen = { tabBarItemStyle: { display: 'none' as const }, tabBarStyle: { display: 'none' as const } };
  return (
    <AuthProvider>
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
        <Tabs.Screen name="transit" options={{ title: t('tabs.transit'), tabBarIcon: tabIcon(Bus) }} />
        <Tabs.Screen name="navigate" options={{ title: t('tabs.navigate'), tabBarIcon: tabIcon(NavigationIcon) }} />
        <Tabs.Screen name="favorites" options={{ title: t('tabs.saved'), tabBarIcon: tabIcon(Star) }} />
        {/* 길안내 화면: 홈에서 안내를 시작할 때만 들어간다. 탭 항목은 숨기고(href: null 은 주소로 직접 열리지 않는다), 이 화면에서는 지도를 가리지 않게 탭 막대도 숨긴다. */}
        {/* 아래 hiddenScreen 목록은 app/*.tsx 의 숨긴 화면들과 항상 같아야 한다 - Tabs 에 선언 안 된 라우트는
            expo-router 가 focusedIndex=-1 로 보고 홈 탭으로 되돌려버린다(선언 누락 = 그 화면으로 못 들어감). */}
        <Tabs.Screen name="navigation" options={hiddenScreen} />
        <Tabs.Screen name="login" options={hiddenScreen} />
        <Tabs.Screen name="admin" options={hiddenScreen} />
        <Tabs.Screen name="signup" options={hiddenScreen} />
        <Tabs.Screen name="forgot-password" options={hiddenScreen} />
        <Tabs.Screen name="map" options={hiddenScreen} />
        <Tabs.Screen name="alerts" options={hiddenScreen} />
        {/* 개발용 임시 테스트 화면(docs/ADR/0002). 캘리브레이션 끝나면 제거. */}
        <Tabs.Screen name="vision-test" options={hiddenScreen} />
      </Tabs>
    </AuthProvider>
  );
}
