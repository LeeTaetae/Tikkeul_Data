import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Screen } from '../src/components/Screen';
import { StatusBanner } from '../src/components/StatusBanner';
import { SAMPLE_ROUTES } from '../src/data/sample';
import { colors, radius, space } from '../src/theme';

const ROUTE_LABEL = { fast: 'map.routeFast', free: 'map.routeFree', safe: 'map.routeSafe' } as const;

export default function MapScreen() {
  const { t } = useTranslation();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searched, setSearched] = useState(false);

  const onSearch = () => setSearched(to.trim().length > 0);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {t('map.title')}
        </Text>
        <LanguageSwitcher />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>{t('map.from')}</Text>
        <TextInput
          style={styles.input}
          value={from}
          onChangeText={setFrom}
          accessibilityLabel={t('map.from')}
          placeholder={t('map.fromPlaceholder')}
          placeholderTextColor={colors.muted}
        />
        <Text style={styles.label}>{t('map.to')}</Text>
        <TextInput
          style={styles.input}
          value={to}
          onChangeText={setTo}
          accessibilityLabel={t('map.to')}
          placeholder={t('map.toPlaceholder')}
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          onSubmitEditing={onSearch}
        />
        <Pressable style={styles.button} onPress={onSearch} accessibilityRole="button">
          <Text style={styles.buttonText}>{t('map.search')}</Text>
        </Pressable>
      </View>

      {/* 지도 SDK 도입 전 자리표시. 경로 모양만 그린 그림이다. */}
      <View style={styles.map} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.seg, { left: '12%', top: '68%', width: '38%', height: 6 }]} />
        <View style={[styles.seg, { left: '47%', top: '32%', width: 6, height: '40%' }]} />
        <View style={[styles.seg, { left: '47%', top: '32%', width: '38%', height: 6 }]} />
        <View style={[styles.pin, { left: '9%', top: '62%', backgroundColor: colors.guide }]} />
        <View style={[styles.pin, { left: '82%', top: '26%', backgroundColor: colors.info }]} />
        <View style={[styles.pin, { left: '44%', top: '50%', backgroundColor: colors.zone }]} />
      </View>
      <Text style={styles.notice}>{t('map.mapNotice')}</Text>

      <Text style={styles.section}>{t('map.routes')}</Text>
      {searched ? (
        SAMPLE_ROUTES.map((r) => (
          <View key={r.id} style={styles.route}>
            <View style={styles.routeMain}>
              <Text style={styles.routeName}>{t(ROUTE_LABEL[r.id])}</Text>
              <Text style={styles.routeMeta}>
                {t('map.km', { n: r.km })}
              </Text>
            </View>
            <View style={styles.routeSide}>
              <Text style={styles.routeTime}>{t('map.minutes', { n: r.minutes })}</Text>
              <Text style={[styles.routeRisk, r.riskCount === 0 && styles.routeRiskNone]}>
                {r.riskCount === 0 ? t('map.noRisks') : t('map.risks', { n: r.riskCount })}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.empty}>{t('map.empty')}</Text>
      )}

      <StatusBanner />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: colors.ink },
  form: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  label: { fontSize: 14, fontWeight: '700', color: colors.ink },
  input: {
    minHeight: 48,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  button: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: space.xs },
  buttonText: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  map: {
    height: 180,
    backgroundColor: '#E4E7E1',
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  seg: { position: 'absolute', backgroundColor: colors.ink, borderRadius: 3 },
  pin: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderColor: colors.ink, borderWidth: 3 },
  notice: { fontSize: 13, color: colors.muted },
  section: { fontSize: 18, fontWeight: '800', color: colors.ink },
  route: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  routeMain: { flex: 1, gap: 2 },
  routeName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  routeMeta: { fontSize: 14, color: colors.muted },
  routeSide: { alignItems: 'flex-end', gap: 2 },
  routeTime: { fontSize: 20, fontWeight: '800', color: colors.ink },
  routeRisk: { fontSize: 13, fontWeight: '700', color: colors.danger },
  routeRiskNone: { color: colors.guide },
  empty: { fontSize: 15, color: colors.muted },
});
