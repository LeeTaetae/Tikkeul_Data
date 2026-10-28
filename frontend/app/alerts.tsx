import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AlertCard } from '../src/components/alerts/AlertCard';
import { AlertFilter, type AlertFilterValue } from '../src/components/alerts/AlertFilter';
import { CategoryMenu } from '../src/components/CategoryMenu';
import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Screen } from '../src/components/Screen';
import { StatusBanner } from '../src/components/StatusBanner';
import { MOCK_ALERTS } from '../src/data/mockAlert';
import { colors, space } from '../src/theme';

export default function AlertsScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<AlertFilterValue>('all');
  // 한 번에 하나만 펼친다. 같은 카드를 다시 누르면 접는다.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const items = MOCK_ALERTS.filter((a) => filter === 'all' || a.type === filter);

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

      <AlertFilter value={filter} onChange={setFilter} />

      {items.length === 0 ? (
        <Text style={styles.empty}>{t('alerts.empty')}</Text>
      ) : (
        items.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            expanded={expandedId === a.id}
            onPress={(alert) => setExpandedId((cur) => (cur === alert.id ? null : alert.id))}
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // zIndex: 펼친 카테고리 메뉴가 아래 콘텐츠에 가려지지 않게 헤더를 위로 올린다(웹 View 는 기본 zIndex 0).
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, zIndex: 10 },
  title: { flex: 1, minWidth: 0, fontSize: 20, fontWeight: '800', color: colors.ink },
  empty: { fontSize: 15, color: colors.muted },
});
