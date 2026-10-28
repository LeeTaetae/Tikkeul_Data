import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radius, space } from '../../theme';
import type { AlertType } from '../../types/alert';

export type AlertFilterValue = 'all' | AlertType;
const FILTERS: AlertFilterValue[] = ['all', 'accident', 'construction', 'congestion'];

interface AlertFilterProps {
  value: AlertFilterValue;
  onChange: (value: AlertFilterValue) => void;
}

export function AlertFilter({ value, onChange }: AlertFilterProps) {
  const { t } = useTranslation();
  const label = (f: AlertFilterValue) => (f === 'all' ? t('alerts.filterAll') : t(`alerts.type.${f}`));

  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {FILTERS.map((f) => {
        const selected = value === f;
        return (
          <Pressable
            key={f}
            onPress={() => onChange(f)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label(f)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
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
});
