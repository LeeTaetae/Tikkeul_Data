import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { localizeAlert } from '../../lib/localizeAlert';
import { formatDateTimeKst, formatTimeKst } from '../../lib/time';
import { colors, radius, space } from '../../theme';
import type { AlertType, RoadAlert } from '../../types/alert';
import { OriginalTag } from './OriginalTag';

// 유형별 색. tint=아이콘 타일 배경, accent=아이콘 선, strong=배지 배경(흰 글자 대비 4.5:1 이상)
export const TYPE_STYLE: Record<AlertType, { tint: string; accent: string; strong: string }> = {
  accident: { tint: '#FDECEA', accent: '#E5483A', strong: '#B42318' },
  construction: { tint: '#FFF1DF', accent: '#E8820C', strong: '#A24A00' },
  congestion: { tint: '#FFF7D6', accent: '#E0A800', strong: '#6B4E00' },
  school_zone: { tint: '#E3F4EE', accent: '#0B7A5A', strong: '#0B7A5A' },
};

export function TypeIcon({ type, color }: { type: AlertType; color: string }) {
  const p = { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24">
      {type === 'accident' && (
        // 경고 삼각형 + 느낌표
        <>
          <Path d="M12 3.5 L21.5 20 H2.5 Z" {...p} />
          <Path d="M12 9.5 V14" {...p} />
          <Circle cx={12} cy={17} r={0.6} {...p} />
        </>
      )}
      {type === 'construction' && (
        // 라바콘
        <>
          <Path d="M10 4 H14 L18 19 H6 Z" {...p} />
          <Path d="M8.2 12 H15.8" {...p} />
          <Path d="M3.5 20.5 H20.5" {...p} />
        </>
      )}
      {type === 'congestion' && (
        // 차량 정면
        <>
          <Rect x={3} y={11} width={18} height={6.5} rx={2} {...p} />
          <Path d="M6 11 L8 6.5 H16 L18 11" {...p} />
          <Path d="M6.5 14.2 H8.5 M15.5 14.2 H17.5" {...p} />
          <Path d="M6 17.5 V20 M18 17.5 V20" {...p} />
        </>
      )}
      {type === 'school_zone' && (
        // 보호 방패
        <>
          <Path d="M12 3 L19.5 6 V11.5 C19.5 16 16.5 19.5 12 21 C7.5 19.5 4.5 16 4.5 11.5 V6 Z" {...p} />
          <Path d="M9 12 L11 14 L15 10" {...p} />
        </>
      )}
    </Svg>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" style={up ? styles.chevronUp : undefined}>
      <Path
        d="M6 9 L12 15 L18 9"
        stroke={colors.muted}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
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
    <Pressable
      onPress={() => onPress?.(alert)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
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
            <Chevron up={expanded} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    minHeight: 88,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: 18,
    boxShadow: '0 2px 12px rgba(23, 32, 42, 0.08)',
  },
  cardPressed: { backgroundColor: '#F8F8F6', transform: [{ scale: 0.98 }] },
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
  chevronUp: { transform: [{ rotate: '180deg' }] },
});
