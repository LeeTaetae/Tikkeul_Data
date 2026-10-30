import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { X } from 'lucide-react-native';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';

import { localizeAlert } from '../../lib/localizeAlert';
import { resolveVoiceId } from '../../lib/speechVoice';
import { formatTimeKst } from '../../lib/time';
import type { HazardStage, HazardWarning } from '../../lib/useHazardWarning';
import { MAX_CONTENT_WIDTH, colors, radius, shadow, space } from '../../theme';
import { Icon } from '../ui/Icon';
import { TYPE_STYLE, TypeIcon } from './AlertCard';

// 거리 단계 알약. 중립색만 쓰고, 가까울수록 테두리 → 채움으로 진해진다. 단계는 알약의 글자("주의"·"접근 경고"·"최종 경고")로도 전달한다.
// 위험의 심각도는 유형 색 띠·아이콘·심각도 배지가 맡는다. 거리와 심각도를 같은 색으로 섞어 과장하지 않는다.
const STAGE_PILL: Record<Exclude<HazardStage, 'advance'>, { bg: string; fg: string; border: string }> = {
  caution: { bg: colors.surface, fg: colors.ink, border: colors.muted },
  approach: { bg: colors.surface, fg: colors.ink, border: colors.ink },
  final: { bg: colors.ink, fg: colors.surface, border: colors.ink },
};

// TTS 음성 언어. i18n 언어 코드(ko/en/zh) → Speech locale.
const SPEECH_LOCALE: Record<string, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };

// 좁은 화면에서 마지막 두 단어를 붙여, 글자 하나만 다음 줄로 떨어지지 않게 한다.
const keepTail = (s: string) => s.replace(/ (\S+) (\S+)$/, ' $1 $2');

function CloseButton({ color, label, onPress }: { color: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.close}>
      <Icon icon={X} size={22} color={color} strokeWidth={2.6} />
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
  // 하단 시트 등 아래에 떠 있는 것의 높이. 경고가 그 위에 올라앉아 가리지 않게 한다.
  bottomOffset?: number;
  // 경고 카드가 실제로 차지하는 높이. 상세 보기를 펴면 커지므로, 부모가 그 위쪽 여유를 계산할 때 쓴다.
  onHeightChange?: (height: number) => void;
}

// 지도 위 하단에 뜨는 위험 경고. 단계에 따라 모양이 다르다.
// - advance(500m 보다 먼 경로 사전 알림): 작은 흰 카드. 정보 전달용이라 색 띠를 쓰지 않는다.
// - caution·approach·final(500·300·100m): 유형 색 띠 팝업.
// 둘 다 "상세 보기"로 같은 자리에서 펼친다. 부모가 위험구간·단계마다 key 를 주면 새 경고는 접힌 채로 시작한다.
export function NavigationHazardAlert({ warning, onClose, bottomOffset = 0, onHeightChange }: Props) {
  const { t, i18n } = useTranslation();
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const { alert, message, stage } = warning;
  const text = localizeAlert(alert, i18n.language);
  // 띠 색은 유형 토큰(hazardTone.strong). 모두 흰 글자 대비 4.5:1 이상이라 글자는 흰색이다.
  const band = { bg: TYPE_STYLE[alert.type].strong, fg: colors.surface };
  const reportHeight = (e: { nativeEvent: { layout: { height: number } } }) =>
    onHeightChange?.(Math.round(e.nativeEvent.layout.height));
  const messageText = keepTail(t(message.key, message.params));

  // 부모가 위험구간·단계마다 key 를 줘서 이 컴포넌트는 새 경고마다 새로 마운트된다.
  // 그래서 마운트 시 한 번만 읽으면 경고 단계가 바뀔 때마다(500m → 300m → 100m) 다시 읽힌다.
  useEffect(() => {
    let cancelled = false;
    const locale = SPEECH_LOCALE[i18n.language] ?? SPEECH_LOCALE.ko;
    resolveVoiceId(locale).then((voice) => {
      if (!cancelled) Speech.speak(messageText, { language: locale, voice });
    });
    return () => {
      cancelled = true;
      Speech.stop();
    };
  }, []);

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
      {/* 보호구역처럼 등록 현황 데이터는 갱신 시각이 없다(updatedAt === ''). AlertCard.tsx 와 같은 기준. */}
      {alert.updatedAt !== '' && <Text style={styles.time}>{t('common.updatedAt', { time: formatTimeKst(alert.updatedAt) })}</Text>}
    </ScrollView>
  );

  if (stage === 'advance') {
    const s = TYPE_STYLE[alert.type];
    return (
      <View style={[styles.layer, { paddingBottom: space.lg + bottomOffset }]}>
        <View style={styles.advance} accessibilityLiveRegion="polite" onLayout={reportHeight}>
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
              aria-expanded={expanded}
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
    <View style={[styles.layer, { paddingBottom: space.lg + bottomOffset }]}>
      <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="assertive" onLayout={reportHeight}>
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
              aria-expanded={expanded}
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
  // zIndex: 하단 시트(BottomSheet, zIndex 2)보다 위에 둔다. 위치는 bottomOffset 으로 시트 위에 올려놓아서
  // 경고가 시트를 가리지도, 시트에 가리지도 않는다. 안전 경고라 메뉴·검색 오버레이보다도 위에 둔다.
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
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
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  advanceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  advanceTile: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  advanceMessage: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: '800', color: colors.ink },
  textButton: { minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center' },
  textButtonText: { fontSize: 14, fontWeight: '700', color: colors.brand },

  // 근접 경고(색 띠 팝업)
  card: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
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
