import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from './Screen';
import { Card } from './ui/Card';
import { useAuth } from '../lib/auth/AuthContext';
import { favoritesApi, type FavoritePlace } from '../lib/favorites/api';
import { getCurrentLocation } from '../lib/location/getCurrentLocation';
import { loadRecents, type RecentDestination } from '../lib/recents';
import { tripsApi, type FrequentDestination, type RecentDestination as TripRecentDestination } from '../lib/trips/api';
import { setPendingSearch } from '../lib/navigation/pendingSearch';
import { fetchDurationMinutes, type DurationMode } from '../lib/routeDuration';
import type { RoutePoint } from '../map/types';
import { colors, radius, shadow, space } from '../theme';

function formatDuration(minutes: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return t('map.minutes', { n: rounded });
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? t('map.hours', { n: hours }) : t('map.hoursMinutes', { h: hours, m: rest });
}

// 도착지까지 걸리는 시간(대중교통 또는 네비게이션)을 구한다. 즐겨찾기 줄·자주·최근 카드가 같이 쓴다.
function useDurationMinutes(origin: RoutePoint | null, point: RoutePoint, mode: DurationMode) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    setLoading(true);
    fetchDurationMinutes(origin, point, mode)
      .then((value) => {
        if (!cancelled) setMinutes(value);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [origin, point, mode]);

  return { minutes, loading };
}

// 즐겨찾기 한 줄: 이름과 걸리는 시간만 보여준다.
function DestinationRow({
  label,
  point,
  origin,
  mode,
  onPress,
}: {
  label: string;
  point: RoutePoint;
  origin: RoutePoint | null;
  mode: DurationMode;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { minutes, loading } = useDurationMinutes(origin, point, mode);

  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      {loading ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : minutes === null ? (
        <Text style={styles.rowTimeMuted}>—</Text>
      ) : (
        <Text style={styles.rowTime}>{formatDuration(minutes, t)}</Text>
      )}
    </Pressable>
  );
}

// 자주·최근 간 곳 카드(3열 그리드). 이름 위에 TOP 순위(있으면), 이름 아래에 검색 당시 주소, 맨 아래 걸리는 시간.
function PlaceCard({
  label,
  address,
  point,
  origin,
  mode,
  rank,
  onPress,
}: {
  label: string;
  address?: string;
  point: RoutePoint;
  origin: RoutePoint | null;
  mode: DurationMode;
  rank?: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { minutes, loading } = useDurationMinutes(origin, point, mode);

  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      {rank !== undefined && <Text style={styles.cardRank}>{t('transitTab.topRank', { n: rank })}</Text>}
      <Text style={styles.cardLabel} numberOfLines={2}>
        {label}
      </Text>
      {address ? (
        <Text style={styles.cardAddress} numberOfLines={1}>
          {address}
        </Text>
      ) : null}
      <View style={styles.cardTimeRow}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : minutes === null ? (
          <Text style={styles.cardTimeMuted}>—</Text>
        ) : (
          <Text style={styles.cardTime}>{formatDuration(minutes, t)}</Text>
        )}
      </View>
    </Pressable>
  );
}

interface Props {
  mode: DurationMode;
  titleKey: string;
}

// 대중교통·네비게이션 탭의 공통 화면: 즐겨찾기가 맨 위, 그 아래 자주 간 곳 TOP3, 그 아래 최근 간 곳(최신순)이 이어진다.
export function RouteTimeListScreen({ mode, titleKey }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { status, token } = useAuth();
  const [favorites, setFavorites] = useState<FavoritePlace[] | null>(null);
  const [recents, setRecents] = useState<RecentDestination[]>([]);
  const [origin, setOrigin] = useState<RoutePoint | null>(null);
  const [frequent, setFrequent] = useState<FrequentDestination[] | null>(null);
  const [tripRecents, setTripRecents] = useState<TripRecentDestination[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      setRecents(loadRecents());
      getCurrentLocation().then(setOrigin);
    }, []),
  );

  useEffect(() => {
    if (status !== 'authenticated' || !token) {
      setFavorites(null);
      setFrequent(null);
      setTripRecents(null);
      return;
    }
    favoritesApi.list(token).then(setFavorites).catch(() => setFavorites(null));
    // 최근 30일(백엔드 기본값) 안에서 가장 많이 간 곳 TOP 3, 그 밑에 최근 간 순서. 전체 이력을 다 불러오지 않는다.
    tripsApi.frequent(token).then(setFrequent).catch(() => setFrequent(null));
    tripsApi.recent(token).then(setTripRecents).catch(() => setTripRecents(null));
  }, [status, token]);

  const goToRoute = (point: RoutePoint, label: string) => {
    setPendingSearch({ point, label, mode });
    router.push('/');
  };

  const hasFavorites = favorites && favorites.length > 0;
  const hasFrequent = frequent && frequent.length > 0;
  // 로그인 상태면 서버의 실제 방문 이력(최근 N일)을 쓰고, 비로그인이면 기기에 남은 로컬 최근 검색을 쓴다.
  const usingTripRecents = status === 'authenticated' && tripRecents !== null;
  const recentItems = usingTripRecents ? tripRecents! : recents;
  const hasRecents = recentItems.length > 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t(titleKey)}</Text>
        {hasFavorites && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t('transitTab.favoriteRoutes')}</Text>
            {favorites!.map((f) => (
              <DestinationRow
                key={f.id}
                label={f.label}
                point={{ lat: f.lat, lng: f.lon }}
                origin={origin}
                mode={mode}
                onPress={() => goToRoute({ lat: f.lat, lng: f.lon }, f.label)}
              />
            ))}
          </Card>
        )}
        {hasFrequent && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t('transitTab.frequentDestinations')}</Text>
            <View style={styles.cardGrid}>
              {frequent!.map((f, i) => (
                <PlaceCard
                  key={`${f.label}-${f.lat}-${f.lon}`}
                  label={f.label}
                  address={f.address_text || undefined}
                  point={{ lat: f.lat, lng: f.lon }}
                  origin={origin}
                  mode={mode}
                  rank={i + 1}
                  onPress={() => goToRoute({ lat: f.lat, lng: f.lon }, f.label)}
                />
              ))}
            </View>
          </Card>
        )}
        {hasRecents && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t('transitTab.recentDestinations')}</Text>
            <View style={styles.cardGrid}>
              {usingTripRecents
                ? tripRecents!.map((r) => (
                    <PlaceCard
                      key={`${r.label}-${r.lat}-${r.lon}`}
                      label={r.label}
                      address={r.address_text || undefined}
                      point={{ lat: r.lat, lng: r.lon }}
                      origin={origin}
                      mode={mode}
                      onPress={() => goToRoute({ lat: r.lat, lng: r.lon }, r.label)}
                    />
                  ))
                : recents.map((r) => (
                    <PlaceCard
                      key={r.label}
                      label={r.label}
                      point={r.point}
                      origin={origin}
                      mode={mode}
                      onPress={() => goToRoute(r.point, r.label)}
                    />
                  ))}
            </View>
          </Card>
        )}
        {!hasFavorites && !hasFrequent && !hasRecents && <Text style={styles.empty}>{t('transitTab.empty')}</Text>}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink },
  section: { padding: space.md, gap: space.xs, boxShadow: shadow.float, borderRadius: radius.lg },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.muted, marginBottom: space.xs },
  row: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xs },
  rowLabel: { flex: 1, minWidth: 0, fontSize: 16, color: colors.ink, marginRight: space.sm },
  rowTime: { fontSize: 15, fontWeight: '700', color: colors.brand },
  rowTimeMuted: { fontSize: 15, color: colors.muted },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: {
    width: '31%',
    minHeight: 96,
    borderRadius: radius.md,
    borderColor: colors.line,
    borderWidth: 1,
    backgroundColor: colors.paper,
    padding: space.sm,
    gap: 2,
  },
  cardRank: { fontSize: 11, fontWeight: '800', color: colors.brand },
  cardLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  cardAddress: { fontSize: 11, color: colors.muted },
  cardTimeRow: { marginTop: 'auto', alignItems: 'flex-start' },
  cardTime: { fontSize: 13, fontWeight: '700', color: colors.brand },
  cardTimeMuted: { fontSize: 13, color: colors.muted },
  empty: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: space.xl },
});
