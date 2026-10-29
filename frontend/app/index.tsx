import type * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { NavigationHazardAlert } from '../src/components/alerts/NavigationHazardAlert';
import { CategoryMenu } from '../src/components/CategoryMenu';
import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Logo } from '../src/components/Logo';
import { HazardSimulator, useHazardSimulation } from '../src/dev/HazardSimulator';
import { useHazardWarning } from '../src/lib/useHazardWarning';
import { KakaoMap } from '../src/map/KakaoMap';
import { DEMO_ORIGIN, findDemoDestination } from '../src/map/demoDestinations';
import {
  fetchAddress,
  fetchModeRoute,
  fetchRouteStyles,
  fetchTransitRoutes,
  type RouteStyle,
  type StyledRoute,
  type TransitRouteOption,
  type TransitRoutesResult,
  type TransitStep,
  type TravelMode,
} from '../src/map/navigationApi';
import type { KakaoMapHandle, RoutePoint } from '../src/map/types';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../src/theme';

const STYLE_LABEL: Record<RouteStyle, string> = {
  recommended: 'map.styleRecommended',
  toll_free: 'map.styleTollFree',
  major_road: 'map.styleMajorRoad',
  shortest: 'map.styleShortest',
  avoid_school_zone: 'map.styleAvoidSchoolZone',
  walking: 'map.styleWalking',
  cycling: 'map.styleCycling',
  transit: 'map.styleTransit',
};

const MODE_LABEL: Record<TravelMode, string> = {
  driving: 'map.modeDriving',
  walking: 'map.modeWalking',
  cycling: 'map.modeCycling',
  transit: 'map.modeTransit',
};
const MODES: TravelMode[] = ['driving', 'walking', 'cycling', 'transit'];

type TransitCategory = 'all' | 'BUS' | 'SUBWAY' | 'BUS_AND_SUBWAY';
const TRANSIT_CATEGORY_LABEL: Record<TransitCategory, string> = {
  all: 'map.transitAll',
  BUS: 'map.transitBus',
  SUBWAY: 'map.transitSubway',
  BUS_AND_SUBWAY: 'map.transitBusAndSubway',
};

interface RecentDestination {
  label: string;
  point: RoutePoint;
}

const RECENTS_KEY = 'tikkeul:recentDestinations';
const MAX_RECENTS = 8;

// shortcut: 브라우저 localStorage에만 저장(기기 로컬, 이 브라우저 안에서만 보임). 계정 동기화 없음.
function loadRecents(): RecentDestination[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(entry: RecentDestination): RecentDestination[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const next = [entry, ...loadRecents().filter((r) => r.label !== entry.label)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

interface RecentRoute {
  originLabel: string;
  destinationLabel: string;
  destinationPoint: RoutePoint;
  mode: TravelMode;
}

const RECENT_ROUTES_KEY = 'tikkeul:recentRoutes';
const MAX_RECENT_ROUTES = 5;

function loadRecentRoutes(): RecentRoute[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RECENT_ROUTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentRoute(entry: RecentRoute): RecentRoute[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const isSame = (r: RecentRoute) => r.destinationLabel === entry.destinationLabel && r.mode === entry.mode;
    const next = [entry, ...loadRecentRoutes().filter((r) => !isSame(r))].slice(0, MAX_RECENT_ROUTES);
    localStorage.setItem(RECENT_ROUTES_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

// 1시간 넘으면 "N시간 M분"으로, 안 넘으면 "N분"으로 — 298분 같은 숫자를 그대로 보여주지 않는다.
function formatDuration(totalMinutes: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const rounded = Math.round(totalMinutes);
  if (rounded < 60) return t('map.minutes', { n: rounded });
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes === 0 ? t('map.hours', { n: hours }) : t('map.hoursMinutes', { h: hours, m: minutes });
}

// 천 단위 콤마. Hermes의 Intl 지원이 기기마다 달라 toLocaleString 대신 직접 포맷한다.
function formatThousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 구간 색 — 지하철은 파랑, 버스는 직행/급행이면 빨강 그 외엔 초록(카카오맵 배색과 맞춤), 도보는 회색.
function legColor(step: TransitStep): string {
  if (step.type === 'WALKING') return colors.line;
  if (step.type === 'SUBWAY') return colors.info;
  const vehicleType = step.vehicles[0]?.type ?? '';
  return vehicleType.includes('직행') || vehicleType.includes('급행') ? colors.danger : colors.guide;
}

function legIcon(step: TransitStep): string {
  if (step.type === 'WALKING') return '🚶';
  if (step.type === 'SUBWAY') return '🚇';
  return '🚌';
}

// 같은 구간에 여러 번호(예: 지하철 호선 안내가 열차마다 반복)로 올 수 있어 중복 제거해서 보여준다.
function vehicleLabel(step: TransitStep): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const v of step.vehicles) {
    const label = v.type ? `${v.type} ${v.name}` : v.name;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels.join(', ');
}

// 대중교통 옵션 하나를 지도 그리기·안내시작(onStartGuidance)이 쓰는 공통 StyledRoute 모양으로 맞춘다.
function toStyledRoute(option: TransitRouteOption): StyledRoute {
  return {
    style: 'transit',
    distanceKm: option.distanceKm,
    durationMin: option.durationMin,
    path: option.path,
    instructions: option.instructions,
  };
}

// shortcut: 출발지는 항상 브라우저 GPS(실패 시 서울시청)로 고정한다. 출발지 직접 텍스트 입력(geocoding)은 없음 —
// 대신 지도를 클릭해서 출발지로 지정할 수 있다.
function getCurrentLocation(): Promise<RoutePoint> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(DEMO_ORIGIN);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => resolve(DEMO_ORIGIN),
      { timeout: 8000, maximumAge: 60000 },
    );
  });
}

// 전체 화면 지도 위에 검색창·결과를 겹쳐 놓는다. 길찾기는 전부 이 화면에서 끝난다.
export default function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const mapRef = useRef<KakaoMapHandle>(null);
  const destinationInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // 내비게이션 안내·GPS 가 생기기 전까지는 개발용 시뮬레이터가 안내 상태와 남은 거리를 대신한다.
  const sim = useHazardSimulation();
  const { warning, dismiss } = useHazardWarning({
    active: sim.active,
    routeKey: sim.routeKey,
    hazards: sim.hazards,
  });

  const [destination, setDestination] = useState('');
  const [destinationFocused, setDestinationFocused] = useState(false);
  const [originText, setOriginText] = useState('');
  const [recents, setRecents] = useState<RecentDestination[]>(() => loadRecents());
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>(() => loadRecentRoutes());
  const [mode, setMode] = useState<TravelMode>('driving');
  const [manualOrigin, setManualOrigin] = useState<RoutePoint | null>(null);
  const [manualDestination, setManualDestination] = useState<RoutePoint | null>(null);
  const [originAddress, setOriginAddress] = useState<string | null>(null);
  const [destinationAddress, setDestinationAddress] = useState<string | null>(null);
  const [pickedPoint, setPickedPoint] = useState<RoutePoint | null>(null);
  const [routeStyles, setRouteStyles] = useState<StyledRoute[] | null>(null);
  const [transitResult, setTransitResult] = useState<TransitRoutesResult | null>(null);
  const [transitCategory, setTransitCategory] = useState<TransitCategory>('all');
  const [activeRoute, setActiveRoute] = useState<StyledRoute | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [searched, setSearched] = useState(false);
  // 처음엔 "검색" 한 칸만 보이다가, 경로검색 버튼을 누르거나 그 칸을 건드리면 출발/도착 두 칸으로 바뀐다.
  const [plannerOpen, setPlannerOpen] = useState(false);

  const onChangeDestination = (text: string) => {
    setPlannerOpen(true);
    setDestination(text);
    setManualDestination(null);
  };

  // shortcut: 출발지도 도착지와 같은 방식(findDemoDestination, 데모 지점 4곳)으로만 텍스트 검색된다.
  const onChangeOrigin = (text: string) => {
    setOriginText(text);
    setManualOrigin(null);
  };

  // travelMode를 매개변수로 받는다 — setMode 직후 바로 호출될 수 있어서(모드 전환 시 재검색),
  // state를 읽으면 리렌더 전 값(stale closure)을 쓰게 될 수 있기 때문이다.
  const searchRoutes = async (
    destinationPoint: RoutePoint,
    label: string,
    travelMode: TravelMode,
  ): Promise<StyledRoute[] | null> => {
    setDestinationFocused(false);
    setSearched(true);
    setActiveRoute(null);
    setRouteStyles(null);
    mapRef.current?.clearRoute();
    setLiveLoading(true);
    setLiveError(false);
    setOriginAddress(null);
    setDestinationAddress(null);
    setTransitResult(null);
    setTransitCategory('all');
    const origin = manualOrigin ?? findDemoDestination(originText) ?? (await getCurrentLocation());
    if (travelMode === 'transit') {
      const [transit, originAddressValue, destinationAddressValue] = await Promise.all([
        fetchTransitRoutes(origin, destinationPoint),
        fetchAddress(origin),
        fetchAddress(destinationPoint),
      ]);
      setOriginAddress(originAddressValue);
      setDestinationAddress(destinationAddressValue);
      setLiveLoading(false);
      const originLabel =
        originAddressValue ?? (manualOrigin ? t('map.pickedLocation') : originText || t('map.myLocation'));
      const destinationLabel = destinationAddressValue ?? label;
      if (transit && transit.routes.length > 0) {
        setTransitResult(transit);
        mapRef.current?.showRoute(transit.routes[0].path);
        setRecents(saveRecent({ label: destinationLabel, point: destinationPoint }));
        setRecentRoutes(saveRecentRoute({ originLabel, destinationLabel, destinationPoint, mode: travelMode }));
        return transit.routes.map(toStyledRoute);
      }
      setLiveError(true);
      return null;
    }
    const [results, originAddressValue, destinationAddressValue] = await Promise.all([
      travelMode === 'driving'
        ? fetchRouteStyles(origin, destinationPoint)
        : fetchModeRoute(origin, destinationPoint, travelMode),
      fetchAddress(origin),
      fetchAddress(destinationPoint),
    ]);
    setOriginAddress(originAddressValue);
    setDestinationAddress(destinationAddressValue);
    setLiveLoading(false);
    const originLabel =
      originAddressValue ?? (manualOrigin ? t('map.pickedLocation') : originText || t('map.myLocation'));
    const destinationLabel = destinationAddressValue ?? label;
    if (results) {
      setRouteStyles(results);
      setRecents(saveRecent({ label: destinationLabel, point: destinationPoint }));
      setRecentRoutes(saveRecentRoute({ originLabel, destinationLabel, destinationPoint, mode: travelMode }));
      return results;
    }
    setRouteStyles(null);
    setLiveError(true);
    return null;
  };

  const onSearch = async () => {
    const destinationPoint = manualDestination ?? findDemoDestination(destination);
    if (!destinationPoint) {
      if (destination.trim().length === 0) {
        setDestinationFocused(true);
        return;
      }
      setSearched(true);
      setRouteStyles(null);
      setLiveError(false);
      return;
    }
    await searchRoutes(destinationPoint, destination.trim(), mode);
  };

  const onChangeMode = async (next: TravelMode) => {
    const wasGuiding = activeRoute !== null;
    setMode(next);
    const destinationPoint = manualDestination ?? findDemoDestination(destination);
    if (!destinationPoint) {
      setRouteStyles(null);
      setTransitResult(null);
      setActiveRoute(null);
      setSearched(false);
      mapRef.current?.clearRoute();
      return;
    }
    const results = await searchRoutes(destinationPoint, destination.trim() || t('map.pickedLocation'), next);
    if (wasGuiding && results) {
      onStartGuidance(results.find((r) => r.style === 'recommended') ?? results[0]);
    }
  };

  const onPickRecent = async (recent: RecentDestination) => {
    setDestination(recent.label);
    setManualDestination(recent.point);
    await searchRoutes(recent.point, recent.label, mode);
  };

  const onPickRecentRoute = async (route: RecentRoute) => {
    setMode(route.mode);
    setDestination(route.destinationLabel);
    setManualDestination(route.destinationPoint);
    await searchRoutes(route.destinationPoint, route.destinationLabel, route.mode);
  };

  const onResetSearch = () => {
    setDestination('');
    setOriginText('');
    setManualOrigin(null);
    setManualDestination(null);
    setOriginAddress(null);
    setDestinationAddress(null);
    setRouteStyles(null);
    setTransitResult(null);
    setActiveRoute(null);
    setSearched(false);
    setPlannerOpen(false);
    mapRef.current?.clearRoute();
  };

  const onStartGuidance = (route: StyledRoute) => {
    setActiveRoute(route);
    mapRef.current?.showRoute(route.path);
  };

  const onStopGuidance = () => {
    setActiveRoute(null);
    setRouteStyles(null);
    setTransitResult(null);
    setSearched(false);
    mapRef.current?.clearRoute();
  };

  const onMapClick = (point: RoutePoint) => setPickedPoint(point);

  // 지도에서 고른 위치를 출발지로만 지정한다 — 바로 안내를 시작하지 않고, 도착지를 마저 입력받는다.
  const onPickOrigin = () => {
    if (!pickedPoint) return;
    setManualOrigin(pickedPoint);
    setOriginText(t('map.pickedLocation'));
    setPickedPoint(null);
    setPlannerOpen(true);
    destinationInputRef.current?.focus();
  };

  // 지도에서 고른 위치를 도착지로 지정하고, 그 자리에서 바로 추천 경로로 안내를 시작한다.
  const onPickDestination = async () => {
    if (!pickedPoint) return;
    const destinationPoint = pickedPoint;
    const label = t('map.pickedLocation');
    setManualDestination(destinationPoint);
    setDestination(label);
    setPickedPoint(null);
    const results = await searchRoutes(destinationPoint, label, mode);
    const recommended = results?.find((r) => r.style === 'recommended') ?? results?.[0];
    if (recommended) onStartGuidance(recommended);
  };

  const bottomPadding = { paddingBottom: insets.bottom + space.md };
  const inRouteView = searched || routeStyles !== null || transitResult !== null || activeRoute !== null;
  const showPlanner = plannerOpen || inRouteView;
  const originLabel = originAddress ?? (manualOrigin ? t('map.pickedLocation') : originText || t('map.myLocation'));
  const destinationLabel = destinationAddress ?? (destination || t('map.pickedLocation'));
  const showRecents = destinationFocused && !inRouteView && (recents.length > 0 || recentRoutes.length > 0);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} onMapClick={onMapClick} />
      </View>

      {/* 위험 경고는 상단 오버레이(메뉴·시뮬레이터)보다 먼저 그려 그 아래에 깔린다. */}
      {warning && <NavigationHazardAlert key={`${warning.alert.id}:${warning.stage}`} warning={warning} onClose={dismiss} />}

      {/* 빈 곳은 터치를 지도로 통과시킨다(box-none). 안 하면 지도 드래그가 막힌다. */}
      <View style={[styles.overlay, { paddingTop: insets.top + space.md }]}>
        <View style={styles.column}>
          <View style={styles.header}>
            <Logo />
            <LanguageSwitcher />
            <CategoryMenu />
          </View>
          {showPlanner ? (
            // 출발/도착 두 줄 — 출발은 기본값 "내 위치"(지도에서 고르면 그 라벨), 도착은 검색 중엔 입력창, 경로가 잡히면 텍스트+✕로 바뀐다.
            <View style={styles.routeSummary}>
              <View style={styles.routeSummaryRow}>
                <View style={styles.routeSummaryDot} />
                {inRouteView ? (
                  <Text style={styles.routeSummaryText} numberOfLines={1}>
                    {originLabel}
                  </Text>
                ) : (
                  <TextInput
                    style={[styles.routeSummaryInput, styles.routeSummaryText]}
                    value={originText}
                    onChangeText={onChangeOrigin}
                    accessibilityLabel={t('map.myLocation')}
                    placeholder={t('map.myLocation')}
                    placeholderTextColor={colors.muted}
                    returnKeyType="next"
                    onSubmitEditing={() => destinationInputRef.current?.focus()}
                  />
                )}
              </View>
              <View style={styles.routeSummaryRow}>
                <View style={[styles.routeSummaryDot, styles.routeSummaryDotEnd]} />
                {inRouteView ? (
                  <>
                    <Text style={[styles.routeSummaryText, styles.routeSummaryTextFlex]} numberOfLines={1}>
                      {destinationLabel}
                    </Text>
                    <Pressable onPress={onResetSearch} accessibilityRole="button" accessibilityLabel={t('map.cancel')}>
                      <Text style={styles.routeSummaryClose}>✕</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <TextInput
                      ref={destinationInputRef}
                      style={styles.routeSummaryInput}
                      value={destination}
                      onChangeText={onChangeDestination}
                      onFocus={() => setDestinationFocused(true)}
                      onBlur={() => setTimeout(() => setDestinationFocused(false), 150)}
                      accessibilityLabel={t('map.to')}
                      placeholder={t('map.toPlaceholder')}
                      placeholderTextColor={colors.muted}
                      returnKeyType="search"
                      onSubmitEditing={onSearch}
                      autoFocus
                    />
                    <Pressable
                      style={styles.routeSummarySearchButton}
                      onPress={onSearch}
                      accessibilityRole="button"
                      accessibilityLabel={t('map.search')}
                    >
                      <Text style={styles.routeSummarySearchButtonText}>{t('map.search')}</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ) : (
            // 처음엔 "검색" 한 칸 + 경로검색 버튼만 보여준다. 누르면 출발/도착 두 칸으로 바뀐다.
            <View style={styles.searchRow}>
              <TextInput
                style={[styles.search, styles.searchInput]}
                value={destination}
                onChangeText={onChangeDestination}
                accessibilityLabel={t('map.searchPlaceholder')}
                placeholder={t('map.searchPlaceholder')}
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                onFocus={() => setPlannerOpen(true)}
                onSubmitEditing={() => setPlannerOpen(true)}
              />
              <Pressable
                style={styles.routeButton}
                onPress={() => setPlannerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={t('map.search')}
              >
                <Text style={styles.routeButtonText}>{t('map.search')}</Text>
              </Pressable>
            </View>
          )}
          {showRecents && (
            <ScrollView style={styles.recentsPanel} contentContainerStyle={styles.recentsPanelContent}>
              {recents.length > 0 && (
                <>
                  <Text style={styles.recentsTitle}>{t('map.recentDestinations')}</Text>
                  {recents.map((r) => (
                    <Pressable
                      key={r.label}
                      style={styles.recentItem}
                      onPress={() => onPickRecent(r)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.recentItemText} numberOfLines={1}>
                        {r.label}
                      </Text>
                    </Pressable>
                  ))}
                </>
              )}
              {recentRoutes.length > 0 && (
                <>
                  <Text style={styles.recentsTitle}>{t('map.recentRoutes')}</Text>
                  {recentRoutes.map((r, i) => (
                    <Pressable
                      key={`${r.mode}-${r.destinationLabel}-${i}`}
                      style={styles.recentItem}
                      onPress={() => onPickRecentRoute(r)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.recentItemText} numberOfLines={1}>
                        {t(MODE_LABEL[r.mode])} · {r.originLabel} → {r.destinationLabel}
                      </Text>
                    </Pressable>
                  ))}
                </>
              )}
            </ScrollView>
          )}
          {inRouteView && (
            <View style={styles.modeRow}>
              {MODES.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.modeButton, mode === m && styles.modeButtonActive]}
                  onPress={() => onChangeMode(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === m }}
                >
                  <Text style={[styles.modeButtonText, mode === m && styles.modeButtonTextActive]}>
                    {t(MODE_LABEL[m])}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            style={styles.fab}
            onPress={() => mapRef.current?.moveToMyLocation()}
            accessibilityRole="button"
            accessibilityLabel={t('map.myLocation')}
          >
            <Text style={styles.fabIcon}>◎</Text>
          </Pressable>
          {__DEV__ && <HazardSimulator sim={sim} />}
        </View>
      </View>

      {pickedPoint ? (
        <View style={[styles.bottomPanel, bottomPadding]}>
          <Text style={styles.notice}>{t('map.pickPrompt')}</Text>
          <View style={styles.pickActions}>
            <Pressable style={styles.pickButton} onPress={onPickOrigin} accessibilityRole="button">
              <Text style={styles.pickButtonText}>{t('map.setAsOrigin')}</Text>
            </Pressable>
            <Pressable style={styles.pickButton} onPress={onPickDestination} accessibilityRole="button">
              <Text style={styles.pickButtonText}>{t('map.setAsDestination')}</Text>
            </Pressable>
            <Pressable style={styles.pickCancel} onPress={() => setPickedPoint(null)} accessibilityRole="button">
              <Text style={styles.pickCancelText}>{t('map.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      ) : activeRoute ? (
        <DraggableSheet windowHeight={windowHeight} bottomPadding={bottomPadding.paddingBottom}>
          <View style={styles.activeBar}>
            <View style={styles.routeMain}>
              <Text style={styles.routeName}>
                {t(STYLE_LABEL[activeRoute.style])} · {t('map.guiding')}
              </Text>
              <Text style={styles.routeMeta}>
                {t('map.km', { n: Math.round(activeRoute.distanceKm * 10) / 10 })} ·{' '}
                {formatDuration(activeRoute.durationMin, t)}
              </Text>
            </View>
            <Pressable style={styles.stopButton} onPress={onStopGuidance} accessibilityRole="button">
              <Text style={styles.stopButtonText}>{t('map.stopGuidance')}</Text>
            </Pressable>
          </View>
          {activeRoute.instructions.length > 0 && (
            <View style={styles.instructions}>
              <Text style={styles.instructionsTitle}>{t('map.detailedRoute')}</Text>
              {activeRoute.instructions.map((step, i) => (
                <Text key={i} style={styles.instructionStep}>
                  {i + 1}. {step}
                </Text>
              ))}
            </View>
          )}
        </DraggableSheet>
      ) : liveLoading ? (
        <View style={[styles.bottomPanel, bottomPadding]}>
          <Text style={styles.notice}>{t('map.liveLoading')}</Text>
        </View>
      ) : routeStyles ? (
        <View style={[styles.bottomPanel, bottomPadding]}>
          <RouteStylePager
            routes={routeStyles}
            styleLabel={STYLE_LABEL}
            onStart={onStartGuidance}
            onPreview={(route) => mapRef.current?.showRoute(route.path)}
            t={t}
          />
        </View>
      ) : transitResult ? (
        <DraggableSheet windowHeight={windowHeight} bottomPadding={bottomPadding.paddingBottom}>
          <TransitRouteList
            result={transitResult}
            category={transitCategory}
            onChangeCategory={setTransitCategory}
            onPreview={(option) => mapRef.current?.showRoute(option.path)}
            onStart={(option) => onStartGuidance(toStyledRoute(option))}
            t={t}
          />
        </DraggableSheet>
      ) : searched ? (
        <View style={[styles.bottomPanel, bottomPadding]}>
          <Text style={styles.notice}>{t(liveError ? 'map.liveError' : 'map.demoHint')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const SHEET_COLLAPSED_HEIGHT = 180;

// 상세 경로 패널을 손잡이로 위/아래 드래그해서 접었다 펼쳤다 한다. 손잡이 영역에만 PanResponder를
// 붙여서 아래 ScrollView의 세로 스크롤과 충돌하지 않게 한다.
function DraggableSheet({
  windowHeight,
  bottomPadding,
  children,
}: {
  windowHeight: number;
  bottomPadding: number;
  children: React.ReactNode;
}) {
  const expandedHeight = Math.round(windowHeight * 0.75);
  const heightRef = useRef(SHEET_COLLAPSED_HEIGHT);
  const [height, setHeight] = useState(SHEET_COLLAPSED_HEIGHT);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        heightRef.current = height;
      },
      onPanResponderMove: (_, gesture) => {
        setHeight(Math.min(Math.max(heightRef.current - gesture.dy, SHEET_COLLAPSED_HEIGHT), expandedHeight));
      },
      onPanResponderRelease: (_, gesture) => {
        const mid = (SHEET_COLLAPSED_HEIGHT + expandedHeight) / 2;
        const next = heightRef.current - gesture.dy > mid ? expandedHeight : SHEET_COLLAPSED_HEIGHT;
        heightRef.current = next;
        setHeight(next);
      },
    }),
  ).current;

  return (
    <View style={[styles.bottomPanel, { height, maxHeight: height }]}>
      <View {...panResponder.panHandlers} style={styles.dragHandleArea}>
        <View style={styles.dragHandle} />
      </View>
      <ScrollView contentContainerStyle={[styles.bottomPanelContent, { paddingBottom: bottomPadding }]}>
        {children}
      </ScrollView>
    </View>
  );
}

// 네이버지도처럼 경로 카드(실시간 추천/무료/큰길우선/거리우선/위험구간회피, 또는 도보·자전거·대중교통 단일 결과)를
// 가로로 드래그해서 훑어본다. 카드 너비는 실제 레이아웃 폭에 맞춘다.
function RouteStylePager({
  routes,
  styleLabel,
  onStart,
  onPreview,
  t,
}: {
  routes: StyledRoute[];
  styleLabel: Record<RouteStyle, string>;
  onStart: (route: StyledRoute) => void;
  onPreview: (route: StyledRoute) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);

  // 카드가 뜨자마자, 그리고 가로로 넘길 때마다 그 경로를 바로 지도에 그려서 한눈에 비교할 수 있게 한다
  // (네이버지도·티맵처럼 고르기 전에 지도로 먼저 보여주는 것).
  useEffect(() => {
    if (routes.length > 0) {
      setIndex(0);
      onPreview(routes[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onScroll={(e) => {
          if (!width) return;
          const next = Math.min(Math.max(Math.round(e.nativeEvent.contentOffset.x / width), 0), routes.length - 1);
          if (next !== index) {
            setIndex(next);
            onPreview(routes[next]);
          }
        }}
      >
        {routes.map((r) => (
          <View key={r.style} style={[styles.styleCard, width ? { width } : undefined]}>
            <View style={styles.styleCardTop}>
              <View style={styles.routeMain}>
                <Text style={styles.routeName}>{t(styleLabel[r.style])}</Text>
                <Text style={styles.routeMeta}>{t('map.km', { n: Math.round(r.distanceKm * 10) / 10 })}</Text>
              </View>
              <View style={styles.routeSide}>
                <Text style={styles.routeTime}>{formatDuration(r.durationMin, t)}</Text>
              </View>
            </View>
            <Pressable style={styles.startButton} onPress={() => onStart(r)} accessibilityRole="button">
              <Text style={styles.startButtonText}>{t('map.startGuidance')}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      {routes.length > 1 && (
        <Text style={styles.instructionCount}>
          {index + 1} / {routes.length}
        </Text>
      )}
    </View>
  );
}

// 대중교통은 경로가 여러 개(버스/지하철/버스+지하철) 와서 카드 가로 넘기기 대신 카카오맵처럼
// 탭으로 종류를 고르고 세로로 스크롤하며 비교한다.
function TransitRouteList({
  result,
  category,
  onChangeCategory,
  onPreview,
  onStart,
  t,
}: {
  result: TransitRoutesResult;
  category: TransitCategory;
  onChangeCategory: (next: TransitCategory) => void;
  onPreview: (option: TransitRouteOption) => void;
  onStart: (option: TransitRouteOption) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const filtered = category === 'all' ? result.routes : result.routes.filter((r) => r.type === category);
  const counts: Record<TransitCategory, number> = {
    all: result.total,
    BUS: result.bus,
    SUBWAY: result.subway,
    BUS_AND_SUBWAY: result.busAndSubway,
  };

  // 탭을 바꾸거나 새 검색 결과가 오면 그 중 첫 번째 경로를 지도에 미리 보여준다.
  useEffect(() => {
    if (filtered.length > 0) onPreview(filtered[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, result]);

  return (
    <View style={styles.transitList}>
      <View style={styles.transitTabs}>
        {(Object.keys(TRANSIT_CATEGORY_LABEL) as TransitCategory[]).map((c) => (
          <Pressable
            key={c}
            style={[styles.transitTab, category === c && styles.transitTabActive]}
            onPress={() => onChangeCategory(c)}
            accessibilityRole="button"
            accessibilityState={{ selected: category === c }}
          >
            <Text style={[styles.transitTabText, category === c && styles.transitTabTextActive]}>
              {t(TRANSIT_CATEGORY_LABEL[c])} {counts[c]}
            </Text>
          </Pressable>
        ))}
      </View>
      {filtered.length === 0 ? (
        <Text style={styles.notice}>{t('map.transitEmpty')}</Text>
      ) : (
        filtered.map((option, i) => (
          <View key={i} style={styles.transitCard}>
            <Pressable onPress={() => onPreview(option)} accessibilityRole="button">
              <View style={styles.styleCardTop}>
                <View style={styles.routeMain}>
                  <Text style={styles.routeName}>{t(TRANSIT_CATEGORY_LABEL[option.type])}</Text>
                  <Text style={styles.routeMeta}>
                    {t('map.km', { n: Math.round(option.distanceKm * 10) / 10 })} ·{' '}
                    {option.transfers > 0
                      ? t('map.transfersCount', { n: option.transfers })
                      : t('map.transfersNone')}{' '}
                    · {t('map.won', { n: formatThousands(option.fare) })}
                  </Text>
                </View>
                <View style={styles.routeSide}>
                  <Text style={styles.routeTime}>{formatDuration(option.durationMin, t)}</Text>
                </View>
              </View>
              {option.steps.length > 0 && (
                <View style={styles.segmentBar}>
                  {option.steps.map((step, si) => (
                    <View
                      key={si}
                      style={[styles.segmentChip, { flex: Math.max(step.timeSec, 1), backgroundColor: legColor(step) }]}
                    >
                      {step.timeSec >= 60 && (
                        <Text style={styles.segmentChipText} numberOfLines={1}>
                          {t('map.minutes', { n: Math.round(step.timeSec / 60) })}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.legList}>
                {option.steps
                  .filter((step) => step.type !== 'WALKING')
                  .map((step, si) => {
                    const board = step.stops[0]?.name;
                    const alight = step.stops[step.stops.length - 1]?.name;
                    return (
                      <View key={si} style={styles.legRow}>
                        <View style={[styles.legIconBadge, { backgroundColor: legColor(step) }]}>
                          <Text style={styles.legIconText}>{legIcon(step)}</Text>
                        </View>
                        <View style={styles.legMain}>
                          <Text style={styles.legVehicle} numberOfLines={1}>
                            {vehicleLabel(step) || t(step.type === 'SUBWAY' ? 'map.styleTransit' : 'map.modeTransit')}
                          </Text>
                          <Text style={styles.legStop} numberOfLines={1}>
                            {board}
                            {alight && alight !== board ? ` → ${alight}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.legDuration}>
                          {t('map.minutes', { n: Math.round(step.timeSec / 60) })}
                        </Text>
                      </View>
                    );
                  })}
              </View>
            </Pressable>
            <Pressable style={styles.startButton} onPress={() => onStart(option)} accessibilityRole="button">
              <Text style={styles.startButtonText}>{t('map.startGuidance')}</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  // zIndex: 카카오 지도 내부 요소가 오버레이를 덮지 않도록 층을 나눈다(웹).
  mapLayer: { ...StyleSheet.absoluteFill, zIndex: 0 },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
    alignItems: 'center',
    paddingHorizontal: space.lg,
    pointerEvents: 'box-none',
  },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space.md, pointerEvents: 'box-none' },
  header: {
    // zIndex: 펼친 카테고리 메뉴가 검색창·버튼에 가려지지 않게 헤더를 위로 올린다.
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  searchRow: { flexDirection: 'row', gap: space.sm },
  search: {
    minHeight: 48,
    borderRadius: radius.md,
    borderColor: colors.line,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  searchInput: { flex: 1 },
  routeButton: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  routeButtonText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  fab: {
    alignSelf: 'flex-end',
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  fabIcon: { fontSize: 22, color: colors.ink },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '60%',
    zIndex: 2,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.16)',
  },
  bottomPanelContent: { padding: space.lg, gap: space.sm },
  notice: { fontSize: 13, color: colors.muted, padding: space.lg },
  pickActions: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
  pickButton: { flex: 1, minHeight: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  pickButtonText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  pickCancel: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pickCancelText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  routeMain: { flex: 1, gap: 2 },
  routeName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  routeMeta: { fontSize: 14, color: colors.muted },
  routeSide: { alignItems: 'flex-end', gap: 2 },
  routeTime: { fontSize: 20, fontWeight: '800', color: colors.ink },
  styleCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  styleCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  startButton: { minHeight: 40, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  startButtonText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  activeBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.brand,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  stopButton: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stopButtonText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  instructions: { gap: space.xs },
  instructionsTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: space.xs },
  instructionStep: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  instructionCount: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  modeRow: { flexDirection: 'row', gap: space.sm },
  modeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  modeButtonText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  modeButtonTextActive: { color: colors.surface },
  transitList: { gap: space.sm },
  transitTabs: { flexDirection: 'row', gap: space.xs },
  transitTab: {
    flex: 1,
    minHeight: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitTabActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  transitTabText: { fontSize: 12, fontWeight: '700', color: colors.ink },
  transitTabTextActive: { color: colors.surface },
  transitCard: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  segmentBar: { flexDirection: 'row', height: 22, borderRadius: radius.sm, overflow: 'hidden', gap: 1 },
  segmentChip: { alignItems: 'center', justifyContent: 'center' },
  segmentChipText: { fontSize: 10, fontWeight: '700', color: colors.surface },
  legList: { gap: space.sm },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  legIconBadge: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  legIconText: { fontSize: 14 },
  legMain: { flex: 1, gap: 1 },
  legVehicle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  legStop: { fontSize: 12, color: colors.muted },
  legDuration: { fontSize: 12, color: colors.muted },
  routeSummary: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderColor: colors.line,
    borderWidth: 1,
    padding: space.md,
    gap: space.xs,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  routeSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  routeSummaryDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.guide },
  routeSummaryDotEnd: { backgroundColor: colors.danger },
  routeSummaryText: { fontSize: 14, color: colors.ink },
  routeSummaryTextFlex: { flex: 1 },
  routeSummaryClose: { fontSize: 15, color: colors.muted, paddingHorizontal: space.xs },
  routeSummaryInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: space.xs },
  routeSummarySearchButton: {
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeSummarySearchButtonText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  recentsPanel: {
    maxHeight: 280,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderColor: colors.line,
    borderWidth: 1,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
  },
  recentsPanelContent: { padding: space.md, gap: space.xs },
  recentsTitle: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: space.xs },
  recentItem: { paddingVertical: space.sm },
  recentItemText: { fontSize: 14, color: colors.ink },
  dragHandleArea: { paddingVertical: space.sm, alignItems: 'center' },
  dragHandle: { width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.line },
});
