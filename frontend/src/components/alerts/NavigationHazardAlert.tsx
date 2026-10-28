import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { localizeAlert } from '../../lib/localizeAlert';
import { formatTimeKst } from '../../lib/time';
import type { HazardStage, HazardWarning } from '../../lib/useHazardWarning';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../../theme';
import type { AlertType } from '../../types/alert';
import { TYPE_STYLE, TypeIcon } from './AlertCard';

// 근접 경고 상단 띠 색. 주황·노랑 위에서는 흰 글자 대비가 모자라 어두운 글자를 쓴다.
const BAND: Record<AlertType, { bg: string; fg: string }> = {
  accident: { bg: colors.danger, fg: colors.surface },
  construction: { bg: '#E8820C', fg: colors.ink },
  congestion: { bg: colors.zone, fg: colors.ink },
};

// 단계 알약. 가까울수록 진하게 해서 색 말고 글자로도 구분된다.
const STAGE_PILL: Record<Exclude<HazardStage, 'advance'>, { bg: string; fg: string; border: string }> = {
  caution: { bg: colors.surface, fg: colors.ink, border: colors.ink },
  approach: { bg: colors.ink, fg: colors.surface, border: colors.ink },
  final: { bg: colors.danger, fg: colors.surface, border: colors.danger },
};

// 좁은 화면에서 마지막 두 단어를 붙여, 글자 하나만 다음 줄로 떨어지지 않게 한다.
const keepTail = (s: string) => s.replace(/ (\S+) (\S+)$/, ' $1 $2');

function CloseButton({ color, label, onPress }: { color: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.close}>
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path d="M6 6 L18 18 M18 6 L6 18" stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </Svg>
    </Pressable>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function SampleTag({ label }: { label: string }) {
  return (
    <View style={styles.sampleTag}>
      <Text style={styles.sampleText}>{label}</Text>
    </View>
  );
}

interface Props {
  warning: HazardWarning;
  onClose: () => void;
}

// 지도 위 하단에 뜨는 위험 경고. 단계에 따라 모양이 다르다.
// - advance(500m 보다 먼 경로 사전 알림): 작은 흰 카드. 정보 전달용이라 색 띠를 쓰지 않는다.
// - caution·approach·final(500·300·100m): 유형 색 띠 팝업.
// 둘 다 "상세 보기"로 같은 자리에서 펼친다. 부모가 위험구간·단계마다 key 를 주면 새 경고는 접힌 채로 시작한다.
export function NavigationHazardAlert({ warning, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const { alert, message, stage } = warning;
  const text = localizeAlert(alert, i18n.language);
  const band = BAND[alert.type];
  const messageText = keepTail(t(message.key, message.params));

  const details = (
    <ScrollView style={{ maxHeight: height * 0.35 }} contentContainerStyle={styles.details}>
      <Field label={t('hazard.location')}>
        <Text style={styles.value}>{text.location}</Text>
      </Field>
      <Field label={t('hazard.type')}>
        <View style={styles.typeRow}>
          <Text style={styles.value}>{t(`alerts.type.${alert.type}`)}</Text>
          <View style={[styles.badge, { backgroundColor: band.bg }]}>
            <Text style={[styles.badgeText, { color: band.fg }]}>{t(`alerts.severity.${alert.severity}`)}</Text>
          </View>
        </View>
      </Field>
      <Field label={t('hazard.description')}>
        <Text style={styles.value}>{text.description}</Text>
      </Field>
      <Text style={styles.time}>{t('common.updatedAt', { time: formatTimeKst(alert.updatedAt) })}</Text>
    </ScrollView>
  );

  if (stage === 'advance') {
    const s = TYPE_STYLE[alert.type];
    return (
      <View style={styles.layer}>
        <View style={styles.advance} accessibilityLiveRegion="polite">
          <View style={styles.advanceRow}>
            <View style={[styles.advanceTile, { backgroundColor: s.tint }]}>
              <TypeIcon type={alert.type} color={s.accent} />
            </View>
            <Text style={styles.advanceMessage}>{messageText}</Text>
            <CloseButton color={colors.muted} label={t('hazard.close')} onPress={onClose} />
          </View>

          {expanded && details}

          <View style={styles.actions}>
            {alert.isSample ? <SampleTag label={t('alerts.sample')} /> : <View />}
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={styles.textButton}
            >
              <Text style={styles.textButtonText}>{expanded ? t('hazard.collapse') : t('hazard.detail')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const pill = STAGE_PILL[stage];
  return (
    <View style={styles.layer}>
      <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <View style={[styles.band, { backgroundColor: band.bg }]}>
          <TypeIcon type={alert.type} color={band.fg} />
          <Text style={[styles.message, { color: band.fg }]}>{messageText}</Text>
          <CloseButton color={band.fg} label={t('hazard.close')} onPress={onClose} />
        </View>

        <View style={styles.body}>
          {expanded ? (
            details
          ) : (
            <Text style={styles.desc} numberOfLines={1}>
              {text.description}
            </Text>
          )}

          <View style={styles.actions}>
            <View style={styles.tags}>
              <View style={[styles.stagePill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
                <Text style={[styles.stageText, { color: pill.fg }]}>{t(`hazard.stage.${stage}`)}</Text>
              </View>
              {alert.isSample && <SampleTag label={t('alerts.sample')} />}
            </View>
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={({ pressed }) => [styles.detail, pressed && styles.detailPressed]}
            >
              <Text style={styles.detailText}>{expanded ? t('hazard.collapse') : t('hazard.detail')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 빈 곳은 터치를 지도로 통과시킨다. 하단 탭 바는 Tabs 가 따로 차지하므로 바닥 여백만 둔다.
  // zIndex 는 홈의 상단 오버레이와 같다. 부모가 이 컴포넌트를 오버레이보다 먼저 그려야 메뉴가 팝업 위로 뜬다.
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    pointerEvents: 'box-none',
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // 사전 알림(작은 흰 카드)
  advance: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: space.sm,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.xs,
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    boxShadow: '0 2px 12px rgba(23, 32, 42, 0.18)',
  },
  advanceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  advanceTile: { width: 40, height: 40, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
  advanceMessage: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: '800', color: colors.ink },
  textButton: { minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center' },
  textButtonText: { fontSize: 14, fontWeight: '700', color: colors.brand },

  // 근접 경고(색 띠 팝업)
  card: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    boxShadow: '0 4px 18px rgba(23, 32, 42, 0.28)',
  },
  band: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.xs },
  message: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 26, fontWeight: '800', paddingVertical: space.sm },
  body: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.sm },
  desc: { fontSize: 15, lineHeight: 22, color: colors.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  stagePill: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: 1 },
  stageText: { fontSize: 12, fontWeight: '800' },
  detail: {
    minHeight: 44,
    paddingHorizontal: space.xl,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailPressed: { opacity: 0.85 },
  detailText: { fontSize: 16, fontWeight: '700', color: colors.surface },

  // 공통: 펼친 상세와 하단 줄
  details: { gap: space.md },
  field: { gap: 2 },
  label: { fontSize: 12, fontWeight: '700', color: colors.muted },
  value: { fontSize: 16, lineHeight: 23, color: colors.ink },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  time: { fontSize: 13, color: colors.muted },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  sampleTag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  sampleText: { fontSize: 12, fontWeight: '700', color: colors.muted },
});
