import { useState } from 'react';
import { Bus, Check, ChevronDown, ChevronUp, Footprints, TrainFront, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { stopStatusOf, type LegKind, type StopMark, type StopMarks } from '../../lib/navigation/rideGuidance';
import { colors, radius, shadow, space } from '../../theme';
import { Icon } from '../ui/Icon';

export const LEG_ICON: Record<LegKind, LucideIcon> = { walk: Footprints, bus: Bus, subway: TrainFront };

interface ActionCardProps {
  kind: LegKind;
  /** "3 / 7 단계" 같은 진행 표시 */
  stepLabel: string;
  title: string;
  /** GPS 근처 힌트·직선 거리처럼 제목 아래에 덧붙이는 한 줄 */
  detail?: string | null;
  /** 사용자가 직접 누르는 확인 버튼(도착·탑승·하차). 끝났으면 없다 */
  primaryLabel?: string;
  onPrimary?: () => void;
  undoLabel?: string;
  onUndo?: () => void;
}

// 대중교통 길안내 상단 카드: 지금 해야 할 일 하나와 그것을 확인하는 버튼. 탑승·하차는 GPS 가 아니라 이 버튼으로 확정한다.
export function TransitActionCard({ kind, stepLabel, title, detail, primaryLabel, onPrimary, undoLabel, onUndo }: ActionCardProps) {
  return (
    <View style={styles.card} accessibilityRole="header" accessibilityLabel={`${stepLabel}, ${title}`}>
      <View style={styles.headRow}>
        <View style={styles.iconTile}>
          <Icon icon={LEG_ICON[kind]} size={30} color={colors.surface} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.step}>{stepLabel}</Text>
          <Text style={styles.title} numberOfLines={3}>
            {title}
          </Text>
        </View>
      </View>
      {!!detail && <Text style={styles.detail}>{detail}</Text>}
      {(primaryLabel || undoLabel) && (
        <View style={styles.buttons}>
          {primaryLabel && onPrimary && (
            <Pressable onPress={onPrimary} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
              <Text style={styles.primaryText}>{primaryLabel}</Text>
            </Pressable>
          )}
          {undoLabel && onUndo && (
            <Pressable onPress={onUndo} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryText}>{undoLabel}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export interface LegItem {
  key: string;
  kind: LegKind;
  title: string;
  detail: string;
  meta: string;
  state: 'done' | 'current' | 'upcoming';
  stateLabel: string;
  /** 0~1. 지금 구간일 때만 진행 막대를 보인다 */
  fraction: number;
  /** 버스·지하철 구간만: API 가 준 정거장 이름(승차 → 중간 → 하차). 도보 구간은 없어서 펼쳐지지 않는다 */
  stops?: string[];
  /** 공식 좌표가 확인된 정거장이 둘 이상이라 현재 정거장을 자동으로 표시할 수 있다 */
  autoStops?: boolean;
}

interface TimelineProps {
  stops: string[];
  mark: StopMark | undefined;
  /** 이 구간에서 GPS 로 현재 정거장을 찾는 중이다(탑승 단계) */
  tracking: boolean;
  autoStops: boolean;
  /** 버스면 "정류장" 문구를 쓴다 */
  kind: LegKind;
}

// 승차역·중간 정거장·하차역 타임라인. 점과 선은 글자 높이에 맞춰 늘어나서(고정 높이 없음) 글자를 키워도 어긋나지 않는다.
// 현재 정거장은 GPS 가 자동으로 정한다(터치로 바꿀 수 없다): 지나간 정거장은 회색, 현재는 분홍, 앞은 기존 색. 승차·하차 표시는 그대로 둔다.
// 지금 그 정거장 반경 안이면 채운 분홍 점 + "현재 역 인근", GPS 가 끊겼거나 정거장 사이면 속이 빈 분홍 점 + "마지막 확인 위치"로 구분한다.
function StopTimeline({ stops, mark, tracking, autoStops, kind }: TimelineProps) {
  const { t } = useTranslation();
  if (stops.length < 2) return <Text style={styles.noStops}>{t('ride.noStops')}</Text>;
  const note = !autoStops ? 'ride.noStopCoords' : mark ? (kind === 'bus' ? 'ride.stopHintBus' : 'ride.stopHint') : tracking ? 'ride.stopLocating' : 'ride.stopIdle';
  return (
    <View style={styles.timeline}>
      <Text style={styles.stopHint} accessibilityLiveRegion="polite">
        {t(note)}
      </Text>
      {stops.map((name, i) => {
        const first = i === 0;
        const last = i === stops.length - 1;
        const edge = first || last;
        const status = stopStatusOf(i, mark);
        const current = status === 'current';
        const passed = status === 'passed';
        const live = current && mark?.near === true;
        const nearKey = kind === 'bus' ? 'ride.stopBadge.nearBus' : 'ride.stopBadge.near';
        return (
          <View key={`${i}-${name}`} style={styles.stopRow} accessible accessibilityLabel={`${name}${current ? `, ${t(live ? nearKey : 'ride.stopBadge.last')}` : ''}`}>
            <View style={styles.rail}>
              <View style={[styles.railLine, first && styles.railHidden]} />
              <View style={[styles.dot, passed && styles.dotPassed, edge && styles.dotEdge, current && (live ? styles.dotCurrent : styles.dotLast)]} />
              <View style={[styles.railLine, last && styles.railHidden]} />
            </View>
            <Text style={[styles.stopName, passed && styles.stopNamePassed, edge && styles.stopNameEdge, current && styles.stopNameCurrent]}>{name}</Text>
            <View style={styles.stopTags}>
              {current && <Text style={[styles.currentBadge, !live && styles.lastBadge]}>{t(live ? nearKey : 'ride.stopBadge.last')}</Text>}
              {edge && <Text style={styles.stopTag}>{t(first ? 'ride.tag.board' : 'ride.tag.alight')}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

interface ListProps {
  items: LegItem[];
  /** 구간 키(LegItem.key)별 현재 정거장 표시. 화면이 GPS 로 판정해서 넘긴다 */
  marks: StopMarks;
  /** 지금 GPS 로 현재 정거장을 찾고 있는 구간의 키 */
  trackingKey: string | null;
}

// 구간별 안내 카드 목록. 지나온 구간은 흐리게, 지금 구간은 강조해서 보인다.
// 버스·지하철 카드를 누르면 정거장 목록이 펼쳐지고, 한 번에 하나만 펼쳐진다. 목록은 시트의 스크롤에 맡긴다(안쪽 스크롤을 따로 두지 않는다).
export function TransitLegList({ items, marks, trackingKey }: ListProps) {
  const { t } = useTranslation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  return (
    <View style={styles.list}>
      {items.map((item) => {
        const current = item.state === 'current';
        const expandable = item.stops !== undefined;
        const expanded = expandable && expandedKey === item.key;
        const body = (
          <>
            <View style={[styles.legIcon, current && styles.legIconCurrent]}>
              <Icon icon={item.state === 'done' ? Check : LEG_ICON[item.kind]} size={18} color={current ? colors.surface : colors.muted} />
            </View>
            <View style={styles.legTexts}>
              <Text style={styles.legTitle}>{item.title}</Text>
              {!!item.detail && <Text style={styles.legDetail}>{item.detail}</Text>}
              <Text style={styles.legMeta}>{item.meta}</Text>
              {current && (
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(Math.min(1, Math.max(0, item.fraction)) * 100)}%` }]} />
                </View>
              )}
            </View>
            <View style={styles.legSide}>
              {!!item.stateLabel && <Text style={[styles.legState, current && styles.legStateCurrent]}>{item.stateLabel}</Text>}
              {expandable && <Icon icon={expanded ? ChevronUp : ChevronDown} size={20} color={colors.muted} />}
            </View>
          </>
        );
        const label = `${item.stateLabel}, ${item.title}, ${item.detail}, ${item.meta}`;
        return (
          <View key={item.key} style={[styles.leg, current && styles.legCurrent, item.state === 'done' && styles.legDone]}>
            {expandable ? (
              <Pressable
                onPress={() => setExpandedKey(expanded ? null : item.key)}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${t(expanded ? 'ride.collapseStops' : 'ride.expandStops')}`}
                accessibilityState={{ expanded }}
                style={({ pressed }) => [styles.legHead, pressed && styles.pressed]}
              >
                {body}
              </Pressable>
            ) : (
              <View style={styles.legHead} accessibilityLabel={label}>
                {body}
              </View>
            )}
            {expanded && item.stops && <StopTimeline stops={item.stops} mark={marks[item.key]} tracking={trackingKey === item.key} autoStops={item.autoStops === true} kind={item.kind} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: '#0866FF', boxShadow: shadow.float },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconTile: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  step: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '800', color: colors.surface },
  detail: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.surface },
  buttons: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  primary: { flex: 1, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  primaryText: { fontSize: 16, fontWeight: '800', color: '#0866FF' },
  secondary: { minHeight: 48, minWidth: 88, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  secondaryText: { fontSize: 14, fontWeight: '700', color: colors.surface },
  pressed: { opacity: 0.85 },
  list: { gap: space.sm },
  leg: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' },
  // 카드 머리 줄 전체가 터치 영역이다(최소 56). 글자가 커지면 줄 높이가 늘어난다.
  legHead: { minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md },
  legSide: { alignItems: 'flex-end', gap: space.xs },
  legCurrent: { borderColor: colors.brand, backgroundColor: colors.primarySoft },
  legDone: { opacity: 0.55 },
  legIcon: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  legIconCurrent: { backgroundColor: colors.brand },
  legTexts: { flex: 1, minWidth: 0, gap: 2 },
  legTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: colors.ink },
  legDetail: { fontSize: 13, lineHeight: 18, color: colors.muted },
  legMeta: { fontSize: 12, lineHeight: 16, color: colors.muted },
  legState: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: colors.muted },
  legStateCurrent: { color: colors.brand },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden', marginTop: space.xs },
  fill: { height: 4, backgroundColor: colors.brand },
  timeline: { paddingHorizontal: space.md, paddingBottom: space.md },
  stopRow: { minHeight: 44, flexDirection: 'row', alignItems: 'stretch', gap: space.md },
  rail: { width: 32, alignItems: 'center' },
  railLine: { flex: 1, width: 2, minHeight: 6, backgroundColor: colors.line },
  railHidden: { backgroundColor: 'transparent' },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.muted },
  dotEdge: { width: 14, height: 14, backgroundColor: colors.brand },
  dotPassed: { backgroundColor: colors.stopPassed },
  dotCurrent: { width: 16, height: 16, backgroundColor: colors.stopCurrent },
  // 마지막으로 확인된 위치: 속이 빈 분홍 고리(지금 이 정거장에 있다고 확정하지 않는다)
  dotLast: { width: 16, height: 16, backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.stopCurrent },
  stopName: { flex: 1, minWidth: 0, paddingVertical: space.xs, fontSize: 14, lineHeight: 20, color: colors.ink },
  stopNamePassed: { color: colors.muted },
  stopNameEdge: { fontWeight: '800' },
  stopNameCurrent: { color: colors.stopCurrent, fontWeight: '800' },
  stopTags: { alignSelf: 'center', alignItems: 'flex-end', gap: space.xs, flexShrink: 0 },
  currentBadge: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.stopCurrentSoft, borderWidth: 1, borderColor: colors.stopCurrent, fontSize: 12, lineHeight: 16, fontWeight: '800', color: colors.stopCurrent },
  lastBadge: { backgroundColor: colors.surface },
  stopHint: { paddingBottom: space.xs, fontSize: 12, lineHeight: 16, color: colors.muted },
  stopTag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.primarySoft, fontSize: 12, lineHeight: 16, fontWeight: '700', color: colors.brand },
  noStops: { paddingHorizontal: space.md, paddingBottom: space.md, fontSize: 13, lineHeight: 18, color: colors.muted },
});
