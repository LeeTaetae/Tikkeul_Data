import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { space } from '../../theme';
import type { AlertType } from '../../types/alert';
import { Chip } from '../ui/Chip';
import { TYPE_ICON } from './AlertCard';

export type AlertFilterValue = 'all' | AlertType;
const FILTERS: AlertFilterValue[] = ['all', 'accident', 'construction', 'congestion'];

interface AlertFilterProps {
  value: AlertFilterValue;
  onChange: (value: AlertFilterValue) => void;
}

// 유형 필터. 카드의 아이콘과 같은 아이콘을 칩 앞에 붙여 유형을 글자·모양으로 함께 구분한다.
export function AlertFilter({ value, onChange }: AlertFilterProps) {
  const { t } = useTranslation();
  const label = (f: AlertFilterValue) => (f === 'all' ? t('alerts.filterAll') : t(`alerts.type.${f}`));

  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {FILTERS.map((f) => (
        <Chip
          key={f}
          role="radio"
          label={label(f)}
          selected={value === f}
          icon={f === 'all' ? undefined : TYPE_ICON[f]}
          onPress={() => onChange(f)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
