import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SAMPLE_UPDATED_AT } from '../data/sample';
import { formatTimeKst } from '../lib/time';
import { useOnline } from '../lib/useOnline';
import { colors, radius, shadow, space } from '../theme';

// 갱신 시각은 항상 표시하고, 오프라인이면 장애 안내를 함께 보여준다. (F-07)
// 지도 위에 떠서도 읽히도록 흰 카드에 그림자를 둔다.
export function StatusBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <View style={[styles.box, !online && styles.boxOffline]} accessibilityRole={online ? undefined : 'alert'}>
      <Text style={[styles.main, !online && styles.mainOffline]}>
        {online ? t('common.sample') : t('common.offline')}
        {'  ·  '}
        {t('common.updatedAt', { time: formatTimeKst(SAMPLE_UPDATED_AT) })}
      </Text>
      {!online && <Text style={styles.hint}>{t('common.offlineHint')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    boxShadow: shadow.float,
  },
  boxOffline: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1 },
  main: { fontSize: 13, color: colors.muted },
  mainOffline: { color: colors.dangerInk, fontWeight: '700' },
  hint: { fontSize: 13, color: colors.ink, marginTop: 2 },
});
