import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LANGUAGES, type Language } from '../i18n';
import { colors, radius, space } from '../theme';

// 버튼에는 짧은 약어(KR | EN | CN)만 보여주고, 전체 이름은 접근성 라벨로 쓴다.
const SHORT_LABEL: Record<Language, string> = { ko: 'KR', en: 'EN', zh: 'CN' };

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('lang.label')}>
      {LANGUAGES.map((lng: Language, i) => {
        const selected = i18n.language === lng;
        return (
          <View key={lng} style={styles.cell}>
            {i > 0 && <Text style={styles.sep}>|</Text>}
            <Pressable
              onPress={() => i18n.changeLanguage(lng)}
              accessibilityRole="radio"
              accessibilityLabel={t(`lang.${lng}`)}
              accessibilityState={{ selected }}
              style={styles.item}
            >
              <Text style={[styles.text, selected && styles.textSelected]}>{SHORT_LABEL[lng]}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
  },
  cell: { flexDirection: 'row', alignItems: 'center' },
  sep: { fontSize: 12, color: colors.primary },
  item: {
    minWidth: 28,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: { fontSize: 12, fontWeight: '600', color: colors.primaryMuted },
  textSelected: { color: colors.brand, fontWeight: '800' },
});
