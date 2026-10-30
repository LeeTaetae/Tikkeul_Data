import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatDistance } from '../../lib/distance';
import type { RailItem } from '../../lib/hazardRail';
import { colors, radius, shadow, space } from '../../theme';
import { TYPE_STYLE, TypeIcon } from '../alerts/AlertCard';
import { HazardDetail } from './HazardDetail';

/** 레일 한 칸의 높이(아이콘 48 + 거리 글자 + 보조 글자 + 간격). 화면이 들어갈 개수를 계산할 때 쓴다 */
export const RAIL_ITEM_HEIGHT = 84;
/** +N 표시의 높이 */
export const RAIL_OVERFLOW_HEIGHT = 36;

interface ButtonProps {
  item: RailItem;
  selected: boolean;
  onPress: () => void;
}

// 위험 한 칸. 색만으로 구분하지 않는다:
//  확정(strong)  : 진한 색 채움 + "!" 표시 — 엔진이 P0·P1 로 본 확정 위험만
//  확정(normal)  : 연한 색 + 실선 테두리
//  미확인(neutral): 회색 + 점선 테두리 + "?" 표시 + "미확인" 글자. 경고 애니메이션·긴급 강조 없음
function RailButton({ item, selected, onPress }: ButtonProps) {
  const { t } = useTranslation();
  const tone = TYPE_STYLE[item.type];
  const { emphasis } = item;
  const tile =
    emphasis === 'strong'
      ? { backgroundColor: tone.strong, borderColor: tone.strong }
      : emphasis === 'normal'
        ? { backgroundColor: tone.tint, borderColor: tone.accent }
        : { backgroundColor: colors.line, borderColor: colors.muted, borderStyle: 'dashed' as const };
  const iconColor = emphasis === 'strong' ? colors.surface : emphasis === 'normal' ? tone.accent : colors.muted;
  const tags = [item.isSample ? t('nav.rail.tag.sample') : null, item.matchClass === 'probable' ? t('nav.rail.tag.probable') : null].filter(Boolean).join('·');
  const distance = formatDistance(item.distanceM);
  const status = t(item.matchClass === 'confirmed' ? 'nav.rail.class.confirmed' : 'nav.rail.class.probable');
  const label = `${t('nav.rail.open', { type: t(`alerts.type.${item.type}`), distance, status })}${item.isSample ? `, ${t('nav.rail.tag.sample')}` : ''}`;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} aria-pressed={selected} style={({ pressed }) => [styles.item, pressed && styles.pressed]}>
      <View style={[styles.tile, tile, selected && styles.selected]}>
        <TypeIcon type={item.type} color={iconColor} />
        {emphasis !== 'normal' && (
          <View style={[styles.badge, { backgroundColor: emphasis === 'strong' ? colors.ink : colors.muted }]}>
            <Text style={styles.badgeText}>{emphasis === 'strong' ? '!' : '?'}</Text>
          </View>
        )}
      </View>
      <View style={styles.caption}>
        <Text style={styles.distance}>{distance}</Text>
      </View>
      {tags !== '' && <Text style={styles.tag}>{tags}</Text>}
    </Pressable>
  );
}

interface Props {
  items: RailItem[];
  /** 레일에 못 보인 위험 수(+N) */
  overflow: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

// 지도 왼쪽 위험 아이콘 세로 레일. 아이콘을 누르면 오른쪽에 간단한 상세가 열린다. 순서·강조는 우선순위 엔진 결과를 그대로 따른다.
export function HazardRail({ items, overflow, selectedKey, onSelect }: Props) {
  const { t } = useTranslation();
  const selected = items.find((i) => i.key === selectedKey) ?? null;
  if (items.length === 0 && overflow === 0) return null;
  return (
    <View style={styles.row}>
      <View style={styles.rail} accessibilityLabel={t('nav.rail.label')}>
        {items.map((item) => (
          <RailButton key={item.key} item={item} selected={item.key === selectedKey} onPress={() => onSelect(item.key === selectedKey ? null : item.key)} />
        ))}
        {overflow > 0 && (
          <View style={styles.more} accessibilityLabel={t('nav.rail.more', { n: overflow })}>
            <Text style={styles.moreText}>+{overflow}</Text>
          </View>
        )}
      </View>
      {selected && <HazardDetail item={selected} onClose={() => onSelect(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, pointerEvents: 'box-none' },
  rail: { width: 60, alignItems: 'center', pointerEvents: 'box-none' },
  item: { width: 60, minHeight: RAIL_ITEM_HEIGHT, alignItems: 'center', gap: 2 },
  pressed: { opacity: 0.85 },
  tile: { width: 48, height: 48, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.card },
  selected: { boxShadow: `0 0 0 3px ${colors.brand}` },
  badge: { position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface },
  badgeText: { fontSize: 11, lineHeight: 13, fontWeight: '800', color: colors.surface },
  // 지도 위에서도 읽히도록 흰 알약 위에 글자를 둔다
  caption: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1, boxShadow: shadow.card },
  distance: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: colors.ink },
  tag: { fontSize: 10, lineHeight: 14, fontWeight: '700', color: colors.ink, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 4, overflow: 'hidden', textAlign: 'center' },
  more: { minWidth: 44, minHeight: 32, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm, marginTop: 2, boxShadow: shadow.card },
  moreText: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: colors.surface },
});
