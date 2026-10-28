import '../src/i18n';

import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { colors } from '../src/theme';

export default function RootLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'beside-icon',
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: '700',
          textAlign: 'center',
          marginStart: 0,
          marginEnd: 0,
        },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center'
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="map" options={{ title: t('tabs.map') }} />
      <Tabs.Screen name="alerts" options={{ title: t('tabs.alerts') }} />
    </Tabs>
  );
}
