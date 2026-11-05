import { Briefcase, ChevronDown, ChevronUp, Heart, House, MapPin, Trash2, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '../src/components/Screen';
import { Card } from '../src/components/ui/Card';
import { Chip } from '../src/components/ui/Chip';
import { Icon } from '../src/components/ui/Icon';
import { PrimaryButton } from '../src/components/ui/PrimaryButton';
import { RoundButton } from '../src/components/ui/RoundButton';
import { TextField } from '../src/components/ui/TextField';
import { ApiClientError } from '../src/lib/api/client';
import { useAuth } from '../src/lib/auth/AuthContext';
import { favoritesApi, type FavoriteKind, type FavoritePlace } from '../src/lib/favorites/api';
import { getCurrentLocation } from '../src/lib/location/getCurrentLocation';
import { searchPlaces, type PlaceSearchResult } from '../src/lib/places/search';
import type { RoutePoint } from '../src/map/types';
import { colors, radius, shadow, space } from '../src/theme';

const KIND_ICON: Record<FavoriteKind, LucideIcon> = { home: House, work: Briefcase, custom: MapPin };
const KIND_ORDER: Record<FavoriteKind, number> = { home: 0, work: 1, custom: 2 };

export default function FavoritesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { status, token } = useAuth();

  const [items, setItems] = useState<FavoritePlace[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // 카테고리 그룹은 기본 접힘(100개짜리 카테고리가 화면을 다 덮지 않게) - 이 Set 에 들어있으면 "펴짐".
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  // 비로그인 상태로 들어오면(메뉴에서 직접 주소 입력 등) 로그인 화면으로 보내고, 성공하면 여기로 돌아온다.
  useEffect(() => {
    if (status === 'guest') router.replace({ pathname: '/login', params: { redirect: '/favorites' } });
  }, [status, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const list = await favoritesApi.list(token, { lang: i18n.language });
      setItems([...list].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token, i18n.language]);

  useEffect(() => {
    load();
  }, [load]);

  // custom + category 가 있는 항목만 카테고리별로 묶고, 나머지(home/work/카테고리 없는 custom)는 평평하게 보여준다.
  const flatItems = useMemo(() => items?.filter((i) => !(i.kind === 'custom' && i.category)) ?? [], [items]);
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, FavoritePlace[]> = {};
    for (const item of items ?? []) {
      if (item.kind === 'custom' && item.category) {
        (groups[item.category] ??= []).push(item);
      }
    }
    return groups;
  }, [items]);

  const onDelete = async (id: number) => {
    if (!token) return;
    setItems((prev) => prev?.filter((p) => p.id !== id) ?? prev);
    try {
      await favoritesApi.remove(id, token);
    } catch {
      await load(); // 삭제 실패 - 지웠던 항목을 서버 상태로 되돌린다
    }
  };

  // 바로 턴바이턴으로 들어가지 않고, 홈 화면(지도)으로 이동해 기존 "주변 장소 선택"처럼 경로 선택 단계를 먼저 거치게 한다.
  const onStart = (item: FavoritePlace) => {
    router.push({ pathname: '/', params: { favLat: String(item.lat), favLng: String(item.lon), favLabel: item.label } });
  };

  if (status !== 'authenticated' || !token) return null; // guest 는 위 effect 가 로그인으로 보낸다

  return (
    <Screen>
      <View style={styles.topRow}>
        <Text style={styles.title}>{t('favorites.title')}</Text>
        <RoundButton
          icon={X}
          label={t('common.close')}
          variant="soft"
          onPress={() => router.replace((redirect as never) ?? '/')}
        />
      </View>

      {loadError && <Text style={styles.loadError}>{t('favorites.loadFailed')}</Text>}

      {items === null && !loadError ? (
        <ActivityIndicator color={colors.brand} style={styles.spinner} />
      ) : items && items.length === 0 ? (
        <View style={styles.empty}>
          <Icon icon={Heart} size={36} color={colors.line} />
          <Text style={styles.emptyTitle}>{t('favorites.empty')}</Text>
          <Text style={styles.emptyHint}>{t('favorites.emptyHint')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {flatItems.map((item) => (
            <FavoriteRow key={item.id} item={item} onPress={() => onStart(item)} onDelete={() => onDelete(item.id)} />
          ))}
          {Object.entries(groupedByCategory).map(([category, group]) => {
            const expanded = expandedCategories.has(category);
            return (
              <View key={category} style={styles.group}>
                <View style={styles.groupHeaderRow}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/', params: { favoriteCategory: category } })}
                    style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.groupHeaderText}>{category}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => toggleCategory(category)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={category}
                    hitSlop={8}
                    style={styles.groupChevron}
                  >
                    <Icon icon={expanded ? ChevronUp : ChevronDown} size={20} color={colors.muted} />
                  </Pressable>
                </View>
                {expanded &&
                  group.map((item) => (
                    <FavoriteRow key={item.id} item={item} onPress={() => onStart(item)} onDelete={() => onDelete(item.id)} />
                  ))}
              </View>
            );
          })}
        </View>
      )}

      <AddFavoriteCard
        token={token}
        existingKinds={new Set(items?.map((i) => i.kind))}
        existingCategories={Object.keys(groupedByCategory)}
        onAdded={load}
      />
    </Screen>
  );
}

function FavoriteRow({ item, onPress, onDelete }: { item: FavoritePlace; onPress: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <Card style={styles.confirmCard}>
        <Text style={styles.confirmText}>{t('favorites.deleteConfirmTitle')}</Text>
        <View style={styles.confirmActions}>
          <Pressable onPress={() => setConfirming(false)} style={styles.confirmCancel}>
            <Text style={styles.confirmCancelText}>{t('common.close')}</Text>
          </Pressable>
          <Pressable onPress={onDelete} style={styles.confirmDelete}>
            <Text style={styles.confirmDeleteText}>{t('favorites.delete')}</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.row}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={item.label} style={styles.rowMain}>
        <View style={[styles.rowIcon, item.kind === 'custom' ? styles.rowIconCustom : styles.rowIconMain]}>
          <Icon icon={KIND_ICON[item.kind]} size={20} color={item.kind === 'custom' ? colors.brand : colors.surface} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {item.label}
          </Text>
          {!!item.address_text && (
            <Text style={styles.rowAddress} numberOfLines={1}>
              {item.address_text}
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable
        onPress={() => setConfirming(true)}
        accessibilityRole="button"
        accessibilityLabel={t('favorites.delete')}
        hitSlop={8}
        style={styles.rowDelete}
      >
        <Icon icon={Trash2} size={18} color={colors.muted} />
      </Pressable>
    </Card>
  );
}

function AddFavoriteCard({
  token,
  existingKinds,
  existingCategories,
  onAdded,
}: {
  token: string;
  existingKinds: Set<FavoriteKind> | undefined;
  existingCategories: string[];
  onAdded: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FavoriteKind>('custom');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSearchResult[]>([]);
  const [picked, setPicked] = useState<RoutePoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 제안 선택·현재 위치 사용으로 query 를 바꿨을 때는 그 값으로 다시 검색하지 않는다 - 안 그러면
  // 검색 effect 가 300ms 뒤 재실행되어 방금 지운 제안 목록을 다시 채워버린다(코드 리뷰 finding).
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPlaces(query.trim(), undefined, i18n.language)
        .then((results) => {
          if (!cancelled) setSuggestions(results);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, i18n.language]);

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [styles.addRow, pressed && styles.pressed]} accessibilityRole="button">
        <Icon icon={MapPin} size={18} color={colors.brand} />
        <Text style={styles.addRowText}>{t('favorites.add')}</Text>
      </Pressable>
    );
  }

  const onPickSuggestion = (place: PlaceSearchResult) => {
    skipNextSearchRef.current = true;
    setPicked(place.point);
    setQuery(place.name);
    setSuggestions([]);
    if (!label.trim()) setLabel(place.name);
  };

  const onUseCurrentLocation = async () => {
    setLocating(true);
    try {
      const point = await getCurrentLocation();
      skipNextSearchRef.current = true;
      setPicked(point);
      setQuery(t('map.myLocation'));
      setSuggestions([]);
    } finally {
      setLocating(false);
    }
  };

  const onSave = async () => {
    if (!label.trim() || !picked) return;
    setSaving(true);
    setError(null);
    try {
      await favoritesApi.create({ kind, label: label.trim(), lat: picked.lat, lon: picked.lng, category: category.trim() || undefined }, token);
      setLabel('');
      setCategory('');
      setQuery('');
      setPicked(null);
      setKind('custom');
      setOpen(false);
      await onAdded();
    } catch (e) {
      setError(e instanceof ApiClientError && e.code === 'FAVORITE_KIND_TAKEN' ? t('favorites.kindTaken') : t('auth.genericError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={styles.addCard}>
      <View style={styles.addHeader}>
        <Text style={styles.addTitle}>{t('favorites.addCustom')}</Text>
        <RoundButton icon={X} label={t('common.close')} variant="soft" size={44} onPress={() => setOpen(false)} />
      </View>
      <View accessibilityRole="radiogroup" style={styles.kindRow}>
        <Chip role="radio" label={t('favorites.home')} icon={House} selected={kind === 'home'} onPress={() => setKind('home')} />
        <Chip role="radio" label={t('favorites.work')} icon={Briefcase} selected={kind === 'work'} onPress={() => setKind('work')} />
        <Chip role="radio" label={t('favorites.title')} icon={MapPin} selected={kind === 'custom'} onPress={() => setKind('custom')} />
      </View>
      {(kind === 'home' ? existingKinds?.has('home') : kind === 'work' ? existingKinds?.has('work') : false) && (
        <Text style={styles.kindTakenNotice}>{t('favorites.kindTaken')}</Text>
      )}
      <TextField
        label={t('favorites.locationSearch')}
        placeholder={t('favorites.locationSearchPlaceholder')}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPicked(null);
        }}
      />
      {suggestions.length > 0 && (
        <View style={styles.suggestionList}>
          {suggestions.map((p, i) => (
            <Pressable key={i} style={styles.suggestionRow} onPress={() => onPickSuggestion(p)} accessibilityRole="button">
              <Text style={styles.suggestionName} numberOfLines={1}>
                {p.name}
              </Text>
              <Text style={styles.suggestionAddress} numberOfLines={1}>
                {p.address}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable onPress={onUseCurrentLocation} style={({ pressed }) => [styles.currentLocationRow, pressed && styles.pressed]} accessibilityRole="button">
        {locating ? <ActivityIndicator size="small" color={colors.brand} /> : <Text style={styles.currentLocationHint}>📍 {t('favorites.useCurrentLocation')}</Text>}
      </Pressable>
      {picked && !suggestions.length && <Text style={styles.pickedNotice}>{t('favorites.locationPicked')}</Text>}
      <TextField label={t('favorites.label')} placeholder={t('favorites.labelPlaceholder')} value={label} onChangeText={setLabel} error={error ?? undefined} />
      {kind === 'custom' && existingCategories.length > 0 && (
        <View style={styles.categoryChipRow}>
          {existingCategories.map((name) => (
            <Chip key={name} label={name} selected={category === name} onPress={() => setCategory(name)} />
          ))}
        </View>
      )}
      {kind === 'custom' && (
        <TextField label={t('favorites.category')} placeholder={t('favorites.categoryPlaceholder')} value={category} onChangeText={setCategory} />
      )}
      <PrimaryButton label={t('favorites.save')} onPress={onSave} disabled={!label.trim() || !picked || saving} loading={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: '800', color: colors.ink },
  loadError: { fontSize: 14, color: colors.dangerInk, textAlign: 'center' },
  spinner: { paddingVertical: space.xl },
  empty: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  emptyHint: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  list: { gap: space.sm },
  group: { gap: space.sm },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  groupHeader: { flex: 1, paddingVertical: space.xs, paddingHorizontal: space.xs },
  groupHeaderText: { fontSize: 14, fontWeight: '800', color: colors.brand },
  groupChevron: { padding: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minWidth: 0 },
  rowIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rowIconMain: { backgroundColor: colors.brand },
  rowIconCustom: { backgroundColor: colors.primarySoft },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  rowAddress: { fontSize: 13, color: colors.muted },
  rowDelete: { padding: space.xs },
  confirmCard: { gap: space.md },
  confirmText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  confirmActions: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' },
  confirmCancel: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md },
  confirmCancelText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  confirmDelete: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  confirmDeleteText: { fontSize: 14, fontWeight: '800', color: colors.dangerInk },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 52,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
  },
  pressed: { opacity: 0.7 },
  addRowText: { fontSize: 15, fontWeight: '800', color: colors.brand },
  addCard: { gap: space.md, boxShadow: shadow.float },
  addHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  categoryChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kindTakenNotice: { fontSize: 13, color: colors.dangerInk, fontWeight: '600' },
  currentLocationRow: { minHeight: 36, justifyContent: 'center' },
  currentLocationHint: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  suggestionList: { gap: 2 },
  suggestionRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs, borderRadius: radius.sm, backgroundColor: colors.paper },
  suggestionName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  suggestionAddress: { fontSize: 12, color: colors.muted },
  pickedNotice: { fontSize: 12, color: colors.muted },
});
