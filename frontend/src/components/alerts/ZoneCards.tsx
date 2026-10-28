import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { colors, radius, space } from '../../theme';
import type { CautionZone, ProtectionZone } from '../../types/traffic';
import { OriginalTag } from './OriginalTag';

// 주의운전구간(파랑)과 보호구역(초록)은 사고·공사·정체(빨강·주황·노랑)와 색·아이콘을 분리한다.
const CAUTION = { tint: '#E8EEFC', accent: colors.info };
const PROTECTION = { tint: '#E3F4EE', accent: '#0B7A5A' };

function CautionIcon() {
  const p = { stroke: CAUTION.accent, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24">
      <Path d="M12 3 L21 12 L12 21 L3 12 Z" {...p} />
      <Path d="M12 8 V13" {...p} />
      <Circle cx={12} cy={16} r={0.6} {...p} />
    </Svg>
  );
}

function ShieldIcon() {
  const p = { stroke: PROTECTION.accent, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24">
      <Path d="M12 3 L19.5 6 V11.5 C19.5 16 16.5 19.5 12 21 C7.5 19.5 4.5 16 4.5 11.5 V6 Z" {...p} />
      <Path d="M9 12 L11 14 L15 10" {...p} />
    </Svg>
  );
}

function InfoCard({ tint, icon, title, tags, main, sub }: { tint: string; icon: ReactNode; title: string; tags?: ReactNode; main: string; sub?: string }) {
  return (
    <View style={styles.card}>
      <View style={[styles.tile, { backgroundColor: tint }]}>{icon}</View>
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
    </View>
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
      tint={CAUTION.tint}
      icon={<CautionIcon />}
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
      tint={PROTECTION.tint}
      icon={<ShieldIcon />}
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
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: 18,
    boxShadow: '0 2px 12px rgba(23, 32, 42, 0.08)',
  },
  tile: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.muted },
  main: { fontSize: 17, lineHeight: 24, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 14, lineHeight: 21, color: colors.muted },
  footer: { flexDirection: 'row', gap: space.sm },
  pill: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: space.sm, paddingVertical: 1 },
  pillMuted: { borderColor: colors.line },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.danger },
  pillTextMuted: { color: colors.muted },
});
