import { Car, ChevronDown, ChevronUp, Construction, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import type { ColorValue } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { localizeAlert } from '../../lib/localizeAlert';
import { formatDateTimeKst, formatTimeKst } from '../../lib/time';
import { colors, hazardTone, radius, space } from '../../theme';
import type { AlertType, RoadAlert } from '../../types/alert';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { OriginalTag } from './OriginalTag';

// 유형별 색(디자인 토큰 hazardTone). tint=아이콘 타일 배경, accent=아이콘 선, strong=배지 배경(흰 글자 대비 4.5:1 이상)
export const TYPE_STYLE: Record<AlertType, { tint: string; accent: string; strong: string }> = hazardTone;

// 유형은 색뿐 아니라 아이콘 모양과 글자로도 구분한다.
export const TYPE_ICON: Record<AlertType, LucideIcon> = {
  accident: TriangleAlert,
  construction: Construction,
  congestion: Car,
  school_zone: ShieldCheck,
};

export function TypeIcon({ type, color }: { type: AlertType; color: ColorValue }) {
  return <Icon icon={TYPE_ICON[type]} size={28} color={color} />;
}

interface AlertCardProps {
  alert: RoadAlert;
  /** 펼침 여부는 화면이 제어한다. */
  expanded?: boolean;
  /** 카드 선택. 지금은 펼침 토글에 쓰고, 추후 상세 화면·지도 이동에도 같은 콜백을 쓴다. */
  onPress?: (alert: RoadAlert) => void;
}

export function AlertCard({ alert, expanded = false, onPress }: AlertCardProps) {
  const { t, i18n } = useTranslation();
  const s = TYPE_STYLE[alert.type];
  const text = localizeAlert(alert, i18n.language);
  const lines = expanded ? undefined : 2;
  // 번역이 없는 실제 데이터(공공 API 한국어 원문)는 한국어가 아닌 화면에서 '한국어 원문'으로 표시한다.
  const isOriginal = !alert.isSample && !alert.translations;
  const timeText =
    alert.timeKind === 'started'
      ? t('alerts.startedAt', { time: formatDateTimeKst(alert.updatedAt) })
      : t('common.updatedAt', { time: formatTimeKst(alert.updatedAt) });

  return (
    <Card onPress={() => onPress?.(alert)} expanded={expanded} style={styles.card}>
      <View style={[styles.tile, { backgroundColor: s.tint }]}>
        <TypeIcon type={alert.type} color={s.accent} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.type}>{t(`alerts.type.${alert.type}`)}</Text>
          <View style={[styles.badge, { backgroundColor: s.strong }]}>
            <Text style={styles.badgeText}>{t(`alerts.severity.${alert.severity}`)}</Text>
          </View>
        </View>

        <Text style={styles.location} numberOfLines={lines}>
          {text.location}
        </Text>
        <Text style={styles.description} numberOfLines={lines}>
          {text.description}
        </Text>

        <View style={styles.footer}>
          <View style={styles.meta}>
            {alert.isSample && (
              <View style={styles.sampleTag}>
                <Text style={styles.sampleText}>{t('alerts.sample')}</Text>
              </View>
            )}
            {isOriginal && <OriginalTag />}
            {alert.updatedAt !== '' && <Text style={styles.time}>{timeText}</Text>}
          </View>
          <View style={styles.more}>
            <Text style={styles.moreText}>{expanded ? t('alerts.collapse') : t('alerts.detail')}</Text>
            <Icon icon={expanded ? ChevronUp : ChevronDown} size={16} color={colors.brand} strokeWidth={2.4} />
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: 88 },
  tile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  type: { fontSize: 14, fontWeight: '700', color: colors.muted },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '800', color: colors.surface },
  location: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: colors.ink },
  description: { fontSize: 14, lineHeight: 21, color: colors.muted },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.md,
    rowGap: space.xs,
    marginTop: space.sm,
  },
  // 좁은 화면에서 태그와 시각이 카드 밖으로 넘치지 않게 줄바꿈한다.
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, flexShrink: 1, minWidth: 0 },
  sampleTag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  sampleText: { fontSize: 12, fontWeight: '700', color: colors.muted },
  time: { fontSize: 12, color: colors.muted },
  more: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  moreText: { fontSize: 13, fontWeight: '700', color: colors.brand },
});
