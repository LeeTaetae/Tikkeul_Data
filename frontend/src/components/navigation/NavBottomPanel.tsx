import { useState } from 'react';
import { Menu, X } from 'lucide-react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatDistance } from '../../lib/distance';
import { durationLabel } from '../../lib/navigation/guidanceDisplay';
import { formatTimeKst } from '../../lib/time';
import { colors, radius, shadow, space } from '../../theme';

interface Props {
  /** 남은 거리(m). 아직 모르면 null */
  remainingM: number | null;
  destinationLabel?: string;
  /** 남은 시간(분, 올림)과 예상 도착 시각(ms). 소요시간 정보가 없으면 null */
  etaMinutes: number | null;
  arrivalAtMs: number | null;
  /** 0~1 */
  fraction: number;
  arrived: boolean;
  /** 위험 정보 조회가 실패(failed)했거나 일부만 됐을(partial) 때. 경고가 빠졌을 수 있다는 안내다 */
  hazardNotice: 'failed' | 'partial' | null;
  /** 낮은 화면(세로 700px 미만·가로 화면)용: 여백과 글자를 줄여 지도를 더 보여준다. 터치 영역(44px 이상)은 그대로 둔다 */
  compact?: boolean;
  onEnd: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
}

// 하단 길안내 정보: 남은 거리·예상 소요·도착 예정과 안내 종료. ETA 는 경로 소요시간을 남은 거리 비율로 나눈 근사값이라
// 실시간 교통을 반영하지 않는다("교통 상황 미반영"을 항상 함께 보여준다).
export function NavBottomPanel({ destinationLabel, remainingM, etaMinutes, arrivalAtMs, fraction, arrived, hazardNotice, compact = false, onEnd, onLayout }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const duration = etaMinutes === null ? null : durationLabel(etaMinutes);
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);

  return (
    <View style={[styles.panel, compact && styles.panelCompact]} onLayout={onLayout}>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={t('nav.progress', { percent })}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
      >
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>

      {hazardNotice && !arrived && <Text style={styles.warn}>{t(hazardNotice === 'failed' ? 'nav.hazardDataFailed' : 'nav.hazardDataPartial')}</Text>}

      {arrived ? (
        <Text style={styles.arrived} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {t('nav.arrived')}
        </Text>
      ) : (
        <View>
          <View style={styles.summaryRow}>
            <View style={styles.summary}>
              {!!destinationLabel && <Text style={styles.destination} numberOfLines={1}>{destinationLabel}</Text>}
              <View style={styles.stats}>
                <Text style={styles.arrivalTime} numberOfLines={1} adjustsFontSizeToFit>
                  {arrivalAtMs === null ? '—' : formatTimeKst(new Date(arrivalAtMs).toISOString())}
                </Text>
                <Text style={styles.distance} numberOfLines={1}>
                  {remainingM === null ? '—' : formatDistance(remainingM)}
                </Text>
              </View>
              <Text style={styles.statLabel}>{t('nav.statArrival')} · {duration ? t(duration.key, duration.params) : '—'}</Text>
            </View>
            <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={t('nav.end')} accessibilityState={{ expanded }} style={styles.menu}>
              {expanded ? <X size={27} color={colors.ink} /> : <Menu size={27} color={colors.ink} />}
            </Pressable>
          </View>
          <Text style={[styles.caption, compact && styles.captionCompact]}>{t('nav.noTraffic')}</Text>
        </View>
      )}

      {(expanded || arrived) && <Pressable
        onPress={onEnd}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, compact && styles.buttonCompact, arrived ? styles.buttonDone : styles.buttonEnd, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>{t(arrived ? 'nav.done' : 'nav.end')}</Text>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summary: { flex: 1, minWidth: 0, gap: 2 },
  destination: { fontSize: 15, color: colors.ink, fontWeight: '600' },
  arrivalTime: { fontSize: 32, lineHeight: 40, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  distance: { fontSize: 23, fontWeight: '700', color: colors.ink },
  menu: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  panel: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, boxShadow: shadow.sheet },
  panelCompact: { gap: space.xs, padding: space.md },
  statValueCompact: { fontSize: 18, lineHeight: 22 },
  captionCompact: { marginTop: 0, fontSize: 11, lineHeight: 14 },
  buttonCompact: { minHeight: 44 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.brand },
  stats: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22, lineHeight: 28, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.muted },
  caption: { marginTop: space.xs, textAlign: 'center', fontSize: 12, lineHeight: 16, color: colors.muted },
  warn: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.dangerInk },
  arrived: { fontSize: 20, lineHeight: 28, fontWeight: '800', color: colors.guide, textAlign: 'center' },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  buttonEnd: { backgroundColor: colors.dangerStrong },
  buttonDone: { backgroundColor: colors.brand },
  buttonText: { fontSize: 16, fontWeight: '700', color: colors.surface },
  pressed: { opacity: 0.85 },
});
