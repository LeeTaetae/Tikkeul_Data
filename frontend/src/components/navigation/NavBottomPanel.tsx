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
export function NavBottomPanel({ remainingM, etaMinutes, arrivalAtMs, fraction, arrived, hazardNotice, compact = false, onEnd, onLayout }: Props) {
  const { t } = useTranslation();
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
          <View style={styles.stats}>
            <Stat compact={compact} label={t('nav.statRemaining')} value={remainingM === null ? '—' : formatDistance(remainingM)} />
            <Stat compact={compact} label={t('nav.statDuration')} value={duration ? t(duration.key, duration.params) : '—'} />
            <Stat compact={compact} label={t('nav.statArrival')} value={arrivalAtMs === null ? '—' : formatTimeKst(new Date(arrivalAtMs).toISOString())} />
          </View>
          <Text style={[styles.caption, compact && styles.captionCompact]}>{t('nav.noTraffic')}</Text>
        </View>
      )}

      <Pressable
        onPress={onEnd}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, compact && styles.buttonCompact, arrived ? styles.buttonDone : styles.buttonEnd, pressed && styles.pressed]}
      >
        <Text style={styles.buttonText}>{t(arrived ? 'nav.done' : 'nav.end')}</Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value, compact }: { label: string; value: string; compact: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, compact && styles.statValueCompact]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, boxShadow: shadow.sheet },
  panelCompact: { gap: space.xs, padding: space.md },
  statValueCompact: { fontSize: 18, lineHeight: 22 },
  captionCompact: { marginTop: 0, fontSize: 11, lineHeight: 14 },
  buttonCompact: { minHeight: 44 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.brand },
  stats: { flexDirection: 'row', gap: space.sm },
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
