import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ApiState } from '../../lib/api/useApi';
import { formatDateTimeKst } from '../../lib/time';
import { useOnline } from '../../lib/useOnline';
import { colors, dataKindTone, radius, space } from '../../theme';
import type { DataKind, ListResponse, Meta } from '../../types/traffic';

// 데이터 종류 배지. 색뿐 아니라 글자로도 실시간·예측·등록 현황을 구분한다.
const KIND_STYLE: Record<DataKind, { bg: string; fg: string }> = dataKindTone;

export function KindBadge({ kind }: { kind: DataKind }) {
  const { t } = useTranslation();
  const s = KIND_STYLE[kind];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{t(`traffic.kind.${kind}`)}</Text>
    </View>
  );
}

// 기준 시각(updated_at)이 있으면 그것을, 없으면 서버가 받아온 시각(fetched_at)을 보여준다.
// stale 이면 마지막 성공 시각과 함께 최신 정보가 아님을 알린다.
function MetaLine({ meta }: { meta: Meta }) {
  const { t } = useTranslation();
  const fetched = formatDateTimeKst(meta.fetched_at);
  return (
    <View style={styles.metaBox}>
      <Text style={styles.metaText}>
        {meta.updated_at ? t('common.updatedAt', { time: formatDateTimeKst(meta.updated_at) }) : t('traffic.fetchedAt', { time: fetched })}
      </Text>
      {meta.data_kind === 'forecast' && <Text style={styles.metaText}>{t('traffic.forecastNote')}</Text>}
      {meta.data_kind === 'registry' && <Text style={styles.metaText}>{t('traffic.registryNote')}</Text>}
      {meta.stale && (
        <Text style={styles.stale} accessibilityRole="alert">
          {t('traffic.stale', { time: fetched })}
        </Text>
      )}
    </View>
  );
}

export function OfflineNotice() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <Text style={styles.offlineMain}>{t('common.offline')}</Text>
      <Text style={styles.metaText}>{t('common.offlineHint')}</Text>
    </View>
  );
}

function ErrorBox({ kind, onRetry }: { kind: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorText}>{t(`traffic.error.${kind}`)}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
        <Text style={styles.retryText}>{t('traffic.retry')}</Text>
      </Pressable>
    </View>
  );
}

interface SectionProps<R extends ListResponse<unknown>> {
  title: string;
  /** 데이터가 오기 전에 보여줄 종류(응답이 오면 meta.data_kind 를 쓴다) */
  kind: DataKind;
  state: ApiState<R>;
  onRetry: () => void;
  /** 응답은 성공했지만 항목이 하나도 없을 때의 문구 */
  emptyText: string;
  children: (data: R) => ReactNode;
}

// 로딩 / 오류 / 빈 데이터 / 정상을 구분해 보여주는 정보 구역. 새로고침이 실패해도 마지막 데이터는 함께 보여준다.
export function TrafficSection<R extends ListResponse<unknown>>({ title, kind, state, onRetry, emptyText, children }: SectionProps<R>) {
  const { t } = useTranslation();
  const data = state.data;
  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <KindBadge kind={data ? data.meta.data_kind : kind} />
        {state.status === 'success' && state.refreshing && <ActivityIndicator size="small" color={colors.muted} />}
      </View>
      {data && <MetaLine meta={data.meta} />}

      {state.status === 'loading' && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.metaText}>{t('traffic.loading')}</Text>
        </View>
      )}
      {state.status === 'error' && <ErrorBox kind={state.error.kind} onRetry={onRetry} />}
      {data && (data.items.length === 0 ? <Text style={styles.empty}>{emptyText}</Text> : children(data))}
    </View>
  );
}

export function ShowMore({ remaining, onPress }: { remaining: number; onPress: () => void }) {
  const { t } = useTranslation();
  if (remaining <= 0) return null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
      <Text style={styles.moreText}>{t('traffic.showMore', { n: remaining })}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  metaBox: { gap: 2 },
  metaText: { fontSize: 13, color: colors.muted },
  stale: { fontSize: 13, fontWeight: '700', color: colors.dangerInk },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  empty: { fontSize: 15, color: colors.muted },
  error: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { fontSize: 14, lineHeight: 20, color: colors.dangerInk },
  retry: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.surface },
  pressed: { opacity: 0.85 },
  more: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  moreText: { fontSize: 14, fontWeight: '700', color: colors.brand },
  offline: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  offlineMain: { fontSize: 13, fontWeight: '700', color: colors.dangerInk },
});
