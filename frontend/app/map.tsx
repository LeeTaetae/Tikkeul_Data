import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CategoryMenu } from '../src/components/CategoryMenu';
import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Screen } from '../src/components/Screen';
import { StatusBanner } from '../src/components/StatusBanner';
import { KakaoMap } from '../src/map/KakaoMap';
import { colors, radius, space } from '../src/theme';

// 길찾기(출발·도착·경로 선택·안내)는 홈 화면에서 한다. 여기는 지도만 보여주는 화면이다.
export default function MapScreen() {
  const { t } = useTranslation();

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {t('map.title')}
        </Text>
        <LanguageSwitcher />
        <CategoryMenu />
      </View>

      <View style={styles.map}>
        <KakaoMap />
      </View>

      <StatusBanner />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, zIndex: 10 },
  title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: colors.ink },
  map: {
    flex: 1,
    minHeight: 320,
    backgroundColor: '#E4E7E1',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
});
