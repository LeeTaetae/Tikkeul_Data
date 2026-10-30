import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radius, shadow, space } from '../../theme';

interface Props {
  /** 현재 속도(km/h). 아직 모르면 null */
  speedKmh: number | null;
  /** 어린이보호구역 근처일 때 알려줄 구역 안 제한속도(km/h). 근처가 아니면 null 이라 안내를 보이지 않는다 */
  cautionKmh: number | null;
  compact?: boolean;
}

// 차량 길안내의 속도 표시. 현재 속도는 흰 네모의 큰 숫자다.
// 보호구역 안내는 노란 "주의" 상자다. 도로 제한속도 표지(빨간 테두리 원)처럼 보이게 만들지 않는다:
// 보호구역은 지점 좌표만 알고 실제 시작·끝은 몰라서, 지금 그 구간 안이라고 단정할 수 없기 때문이다.
export function SpeedBadge({ speedKmh, cautionKmh, compact = false }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      {cautionKmh !== null && (
        <View style={styles.caution} accessibilityRole="text" accessibilityLabel={t('nav.zoneCautionAria', { limit: cautionKmh })}>
          <Text style={[styles.cautionTitle, compact && styles.cautionTextCompact]}>{t('nav.zoneNearby')}</Text>
          <Text style={[styles.cautionBody, compact && styles.cautionTextCompact]}>{t('nav.zoneCaution', { limit: cautionKmh })}</Text>
        </View>
      )}
      <View
        style={[styles.box, compact && styles.boxCompact]}
        accessibilityRole="text"
        accessibilityLabel={speedKmh === null ? t('nav.speedUnknown') : t('nav.currentSpeed', { speed: speedKmh })}
      >
        <Text style={[styles.value, compact && styles.valueCompact]}>{speedKmh ?? '–'}</Text>
        <Text style={styles.unit}>km/h</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 터치는 아래 지도로 통과시킨다.
  wrap: { alignItems: 'flex-end', gap: space.sm, pointerEvents: 'none' },
  caution: { alignItems: 'center', paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: colors.zone, boxShadow: shadow.float },
  cautionTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800', color: colors.zoneInk },
  cautionBody: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: colors.zoneInk },
  cautionTextCompact: { fontSize: 11, lineHeight: 14 },
  box: { minWidth: 64, alignItems: 'center', paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: colors.surface, boxShadow: shadow.float },
  boxCompact: { minWidth: 56 },
  value: { fontSize: 26, lineHeight: 30, fontWeight: '800', color: colors.ink },
  valueCompact: { fontSize: 22, lineHeight: 26 },
  unit: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: colors.muted },
});
