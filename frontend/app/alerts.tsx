import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CategoryMenu } from '../src/components/CategoryMenu';
import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Screen } from '../src/components/Screen';
import { StatusBanner } from '../src/components/StatusBanner';
import { SAMPLE_ALERTS, type AlertKind } from '../src/data/sample';
import { colors, radius, space } from '../src/theme';

type Filter = 'all' | AlertKind;
const FILTERS: Filter[] = ['all', 'zone', 'jam', 'work', 'block'];

const KIND_COLOR: Record<AlertKind, string> = {
  zone: colors.zone,
  jam: colors.danger,
  work: colors.info,
  block: colors.ink,
};

export default function AlertsScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const items = SAMPLE_ALERTS.filter((a) => filter === 'all' || a.kind === filter);
  const filterLabel = (f: Filter) => (f === 'all' ? t('alerts.filterAll') : t(`alerts.${f}`));

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {t('alerts.title')}
        </Text>
        <LanguageSwitcher />
        <CategoryMenu />
      </View>

      <StatusBanner />

      <View style={styles.filters} accessibilityRole="radiogroup">
        {FILTERS.map((f) => {
          const selected = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{filterLabel(f)}</Text>
            </Pressable>
          );
        })}
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty}>{t('alerts.empty')}</Text>
      ) : (
        items.map((a) => (
          <View key={a.id} style={styles.item}>
            <View style={[styles.stripe, { backgroundColor: KIND_COLOR[a.kind] }]} />
            <View style={styles.itemBody}>
              <Text style={styles.itemKind}>
                {t(`alerts.${a.kind}`)} · {t('alerts.caution')}
              </Text>
              <Text style={styles.itemPlace}>{a.place}</Text>
            </View>
            <Text style={styles.itemDistance}>
              {a.distanceM >= 1000 ? `${(a.distanceM / 1000).toFixed(1)}km` : `${a.distanceM}m`}
            </Text>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // zIndex: 펼친 카테고리 메뉴가 아래 콘텐츠에 가려지지 않게 헤더를 위로 올린다(웹 View 는 기본 zIndex 0).
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, zIndex: 10 },
  title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: colors.ink },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  chipTextSelected: { color: colors.surface },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  stripe: { alignSelf: 'stretch', width: 8 },
  itemBody: { flex: 1, paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2 },
  itemKind: { fontSize: 13, fontWeight: '700', color: colors.muted },
  itemPlace: { fontSize: 16, fontWeight: '700', color: colors.ink },
  itemDistance: { fontSize: 15, fontWeight: '700', color: colors.ink, paddingRight: space.lg },
  empty: { fontSize: 15, color: colors.muted },
});
