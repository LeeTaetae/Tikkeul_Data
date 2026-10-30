import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { describeHazard, type RailItem } from '../../lib/hazardRail';
import { formatDistance } from '../../lib/distance';
import { localizeAlert } from '../../lib/localizeAlert';
import { formatDateTimeKst } from '../../lib/time';
import type { MatchReason } from '../../lib/routeHazards';
import { colors, radius, shadow, space } from '../../theme';
import { TYPE_STYLE, TypeIcon } from '../alerts/AlertCard';
import { RoundButton } from '../ui/RoundButton';

// 방향을 확인하지 못한 이유 — 나머지 이유는 "경로 관련성 미확인"으로 묶는다
const DIRECTION_REASONS: MatchReason[] = ['directionUnknown', 'singleDirectionUnverified'];
const REASONS_WITH_TEXT: MatchReason[] = ['directionUnknown', 'singleDirectionUnverified', 'lateralUncertain', 'staleData', 'freshnessUnknown', 'positionUncertain', 'walkingNotConfirmable'];

function Row({ label, children }: { label: string; children: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{children}</Text>
    </View>
  );
}

interface Props {
  item: RailItem;
  onClose: () => void;
}

// 위험 아이콘을 눌렀을 때 레일 옆에 뜨는 간단한 상세. 있는 정보만 보여주고, 없는 값은 지어내지 않는다.
export function HazardDetail({ item, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const detail = describeHazard(item);
  const style = TYPE_STYLE[item.type];
  const text = localizeAlert(item.alert, i18n.language);
  const probable = item.matchClass === 'probable';
  const status = probable ? (detail.unverifiedReason && DIRECTION_REASONS.includes(detail.unverifiedReason) ? t('nav.rail.unverified.direction') : t('nav.rail.unverified.route')) : t('nav.rail.class.confirmed');
  const reasonKnown = detail.unverifiedReason !== null && REASONS_WITH_TEXT.includes(detail.unverifiedReason);

  return (
    <View style={styles.panel} accessibilityRole="summary">
      <View style={styles.header}>
        <View style={[styles.tile, { backgroundColor: style.tint }]}>
          <TypeIcon type={item.type} color={style.accent} />
        </View>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {t(`alerts.type.${item.type}`)}
          </Text>
          <View style={[styles.chip, probable ? styles.chipProbable : styles.chipConfirmed]}>
            <Text style={[styles.chipText, probable ? styles.chipTextProbable : styles.chipTextConfirmed]}>{status}</Text>
          </View>
        </View>
        <RoundButton icon={X} label={t('nav.rail.close')} variant="soft" size={44} onPress={onClose} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Row label={t('nav.rail.distanceLabel')}>{t('nav.rail.ahead', { distance: formatDistance(item.distanceM) })}</Row>
        <Row label={t('nav.rail.locationLabel')}>{text.location || t('alerts.unknownPlace')}</Row>
        <Row label={t('nav.rail.priorityLabel')}>{t(`nav.rail.priority.${item.priority}`)}</Row>
        {detail.source === 'its' && (
          <Row label={t('nav.rail.updatedLabel')}>{detail.startedIso ? t('alerts.startedAt', { time: formatDateTimeKst(detail.startedIso) }) : t('nav.rail.noStarted')}</Row>
        )}
        <Row label={t('nav.rail.sourceLabel')}>{t(`nav.rail.source.${detail.source}`)}</Row>
        {probable && reasonKnown && detail.unverifiedReason && <Text style={styles.reason}>{t(`nav.rail.reason.${detail.unverifiedReason}`)}</Text>}
        {detail.notes.map((note) => (
          <Text key={note} style={[styles.note, note === 'unverified' && styles.noteUnverified]}>
            {t(`nav.rail.note.${note}`)}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minWidth: 0, maxWidth: 360, borderRadius: radius.lg, backgroundColor: colors.surface, boxShadow: shadow.float, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs },
  tile: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '800', color: colors.ink },
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 1, borderWidth: 1 },
  chipConfirmed: { backgroundColor: colors.surface, borderColor: colors.guide },
  chipProbable: { backgroundColor: colors.line, borderColor: colors.muted, borderStyle: 'dashed' },
  chipText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  chipTextConfirmed: { color: colors.guide },
  chipTextProbable: { color: colors.ink },
  scroll: { maxHeight: 260 },
  body: { gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md },
  row: { gap: 1 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: colors.muted },
  value: { fontSize: 15, lineHeight: 21, color: colors.ink },
  reason: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.ink },
  note: { fontSize: 13, lineHeight: 18, color: colors.muted },
  noteUnverified: { color: colors.ink },
});
