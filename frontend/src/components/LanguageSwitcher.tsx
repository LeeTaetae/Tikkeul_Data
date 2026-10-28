import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LANGUAGES, type Language } from '../i18n';
import { colors, radius, space } from '../theme';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('lang.label')}>
      {LANGUAGES.map((lng: Language) => {
        const selected = i18n.language === lng;
        return (
          <Pressable
            key={lng}
            onPress={() => i18n.changeLanguage(lng)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.item, selected && styles.itemSelected]}
          >
            <Text style={[styles.text, selected && styles.textSelected]}>{t(`lang.${lng}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: 3,
  },
  item: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill },
  itemSelected: { backgroundColor: colors.ink },
  text: { fontSize: 13, fontWeight: '600', color: colors.muted },
  textSelected: { color: colors.surface },
});
