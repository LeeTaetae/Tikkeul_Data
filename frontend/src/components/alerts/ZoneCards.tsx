import { CircleAlert, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, hazardTone, radius, space } from '../../theme';
import type { CautionZone, ProtectionZone } from '../../types/traffic';
import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { OriginalTag } from './OriginalTag';

// 주의운전구간(파랑)과 보호구역(초록)은 사고·공사·정체와 색·아이콘을 분리한다. 색은 hazardTone 토큰이다.
const CAUTION = { tone: hazardTone.caution, icon: CircleAlert };
const PROTECTION = { tone: hazardTone.school_zone, icon: ShieldCheck };

function InfoCard({
  tone,
  icon,
  title,
  tags,
  main,
  sub,
}: {
  tone: { tint: string; accent: string };
  icon: LucideIcon;
  title: string;
  tags?: ReactNode;
  main: string;
  sub?: string;
}) {
  return (
    <Card style={styles.card}>
      <View style={[styles.tile, { backgroundColor: tone.tint }]}>
        <Icon icon={icon} size={28} color={tone.accent} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {tags}
        </View>
        <Text style={styles.main}>{main}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
        <View style={styles.footer}>
          <OriginalTag />
        </View>
      </View>
    </Card>
  );
}

function Pill({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <View style={[styles.pill, muted && styles.pillMuted]}>
      <Text style={[styles.pillText, muted && styles.pillTextMuted]}>{text}</Text>
    </View>
  );
}

export function CautionZoneCard({ zone }: { zone: CautionZone }) {
  const { t } = useTranslation();
  // 노선명·방향은 공공 API 원문 그대로다. 방향 문구는 진행 방향 판정에 쓰지 않는다.
  const sub = [
    zone.start.route_name || zone.notice?.route_name || '',
    zone.start.route_no ? t('traffic.routeNo', { no: zone.start.route_no }) : '',
    zone.start.direction_text,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <InfoCard
      tone={CAUTION.tone}
      icon={CAUTION.icon}
      title={t(`traffic.cautionKind.${zone.kind}`)}
      main={zone.message || zone.outbrk_type}
      sub={sub}
    />
  );
}

export function ProtectionZoneCard({ zone }: { zone: ProtectionZone }) {
  const { t } = useTranslation();
  return (
    <InfoCard
      tone={PROTECTION.tone}
      icon={PROTECTION.icon}
      title={t(`traffic.zoneType.${zone.zone_type}`)}
      tags={
        <>
          <Pill text={t(`traffic.assignment.${zone.assignment === 'priority' || zone.assignment === 'designated' ? zone.assignment : 'unknown'}`)} muted />
          {!zone.in_use && <Pill text={t('traffic.inactive')} />}
        </>
      }
      main={zone.name}
      sub={zone.road_address || zone.lot_address}
    />
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.muted },
  main: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 14, lineHeight: 21, color: colors.muted },
  footer: { flexDirection: 'row', gap: space.sm },
  pill: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: space.sm, paddingVertical: 1 },
  pillMuted: { borderColor: colors.line },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.dangerStrong },
  pillTextMuted: { color: colors.muted },
});
