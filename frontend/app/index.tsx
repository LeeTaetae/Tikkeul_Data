import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Bus, Crosshair, Footprints, MapPin, Search, TrainFront, X, type LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { NavigationHazardAlert } from '../src/components/alerts/NavigationHazardAlert';
import { Logo } from '../src/components/Logo';
import { Card } from '../src/components/ui/Card';
import { BottomSheet } from '../src/components/ui/BottomSheet';
import { Chip } from '../src/components/ui/Chip';
import { RoundButton } from '../src/components/ui/RoundButton';
import { ScreenHeader } from '../src/components/ui/ScreenHeader';
import { SearchBar } from '../src/components/ui/SearchBar';
import { HazardSimulator, useHazardSimulation } from '../src/dev/HazardSimulator';
import { guidanceTargetOf, setGuidanceRequest } from '../src/lib/navigation/guidanceSession';
import type { NavRoute } from '../src/lib/navigation/guidanceEngine';
import { useRouteHazardWarning } from '../src/lib/navigation/useRouteHazardWarning';
import { projectOntoRoute, type Route } from '../src/lib/routeHazards';
import { useHazardWarning } from '../src/lib/useHazardWarning';
import { useKeyboardHeight } from '../src/lib/useKeyboardHeight';
import { pickUrgentWarning } from '../src/lib/urgentWarning';
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
import { Icon } from '../src/components/ui/Icon';
import { MAX_CONTENT_WIDTH, colors, radius, shadow, space } from '../src/theme';

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
const COMPACT_WIDTH = 360;
const RECENTS_MAX_HEIGHT = 280;
const RECENTS_MIN_HEIGHT = 120;
// 하단 탭 바 높이(60) + 여유. 최근 검색 패널이 탭 바 밑으로 파고들지 않게 뺀다.
const TAB_BAR_ALLOWANCE = 76;
// 위험 경고 카드 높이의 기본값. 카드가 처음 그려져 실제 높이를 알려 주기(onHeightChange) 전까지만 쓴다.
const HAZARD_ALERT_FALLBACK_HEIGHT = 190;
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
  return vehicleType.includes('직행') || vehicleType.includes('급행') ? colors.dangerStrong : colors.guide;
}

function legIcon(step: TransitStep): LucideIcon {
  if (step.type === 'WALKING') return Footprints;
  if (step.type === 'SUBWAY') return TrainFront;
  return Bus;
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

// 검색 실행 버튼. 좁은 화면에서는 아이콘만 보이고, 이름은 접근성 라벨로 남는다.
function SearchAction({ label, compact, onPress }: { label: string; compact: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.searchAction, compact && styles.searchActionCompact]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {compact ? (
        <Icon icon={Search} size={20} color={colors.surface} />
      ) : (
        <Text style={styles.searchActionText} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// 전체 화면 지도 위에 검색창·결과를 겹쳐 놓는다. 길찾기는 전부 이 화면에서 끝난다.
export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // 좁은 화면(320px 등)에서는 검색 버튼을 글자 대신 아이콘으로 줄여 입력창 폭을 지킨다.
  const compactSearch = windowWidth < COMPACT_WIDTH;
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
  // 안내가 (재)시작될 때마다 늘어난다. useHazardWarning 의 routeKey 로 써서, 재탐색 시 이력을 새로 시작한다.
  const [routeSeq, setRouteSeq] = useState(0);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [searched, setSearched] = useState(false);
  // 마지막 경로 검색에 쓴 출발지·도착지. 길안내 시작 때 같은 조건으로 안내용 경로(guides 포함)를 다시 받는 데 쓴다.
  const lastSearchRef = useRef<{ origin: RoutePoint; destination: RoutePoint; label: string } | null>(null);
  // 처음엔 "검색" 한 칸만 보이다가, 경로검색 버튼을 누르거나 그 칸을 건드리면 출발/도착 두 칸으로 바뀐다.
  const [plannerOpen, setPlannerOpen] = useState(false);
  // 최근 검색 패널이 키보드·하단 탭 아래로 내려가지 않게 남는 높이를 계산한다.
  const keyboardHeight = useKeyboardHeight();
  const [recentsTop, setRecentsTop] = useState(0);
  // 현재 떠 있는 하단 시트의 높이. 위험 경고가 시트 위로 올라앉게 하는 데 쓴다.
  const [sheetHeight, setSheetHeight] = useState(0);
  // 위험 경고 카드의 실제 높이. 상세 보기를 펴면 커지므로 그때마다 새로 받는다.
  const [alertHeight, setAlertHeight] = useState(HAZARD_ALERT_FALLBACK_HEIGHT);

  // 어린이보호구역: 실제 안내 경로에 실제 보호구역 데이터를 매칭해 접근 경고를 띄운다. 조회·매칭·단계 경고는
  // 길안내 화면과 같은 훅(useRouteHazardWarning)을 쓴다. 경로가 지나는 시군구를 표본 조회한다(경로 시작점 하나만 보지 않는다).
  // activeRoute 가 바뀔 때만(안내 시작·종료·재탐색) 새로 만든다. 위치 폴링용 투영(projectOntoRoute)에도 쓴다.
  const schoolZoneRoute: Route | null = useMemo(
    () => (activeRoute ? { id: String(routeSeq), points: activeRoute.path.map((p) => ({ latitude: p.lat, longitude: p.lng })) } : null),
    [activeRoute, routeSeq],
  );
  const homeNavRoute: NavRoute | null = useMemo(
    () => (activeRoute ? { id: String(routeSeq), source: 'api', mode: 'driving', path: activeRoute.path } : null),
    [activeRoute, routeSeq],
  );

  // shortcut: 연속 위치추적(watchPosition) 대신 5초 간격으로 현재 위치를 다시 읽는다. 실제 내비게이션
  // GPS 추적이 생기면(sim 주석 참고) 그 값을 함께 쓰도록 바꾼다.
  const [liveProgressM, setLiveProgressM] = useState(0);
  useEffect(() => {
    if (!schoolZoneRoute) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    let cancelled = false;
    const tick = () => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          if (cancelled) return;
          const p = projectOntoRoute(schoolZoneRoute, { latitude: coords.latitude, longitude: coords.longitude });
          if (p) setLiveProgressM(p.offsetM);
        },
        () => {},
        { maximumAge: 10000, timeout: 8000 },
      );
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [schoolZoneRoute]);

  // 홈의 안내 상태(자전거·대중교통)는 보호구역만 쓴다. 사고·공사·정체(자동차용 돌발정보)는 조회하지 않는다(includeIncidents: false).
  const schoolZoneWarning = useRouteHazardWarning({ route: homeNavRoute, progressM: liveProgressM, active: !!homeNavRoute, includeIncidents: false });

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
    lastSearchRef.current = { origin, destination: destinationPoint, label };
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
    // 자동차·도보는 별도 길안내 화면이 GPS 를 맡는다. 홈의 안내 상태(위치 폴링·위험 경고)는 꺼서 위치 추적기가 둘이 되지 않게 한다.
    // 자전거·대중교통은 실시간 길안내를 지원하지 않아 기존처럼 홈에서 안내 상태만 보여준다.
    const target = guidanceTargetOf(route.style);
    const search = lastSearchRef.current;
    if (target && search) {
      setActiveRoute(null);
      setGuidanceRequest({ origin: search.origin, destination: search.destination, mode: target.mode, style: target.style, destinationLabel: search.label });
      router.push('/navigation');
      return;
    }
    setActiveRoute(route);
    setRouteSeq((n) => n + 1);
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

  // 위험 경고: 시트가 있으면 그 높이만큼 위로 올린다. 시트를 크게 펼쳐도 경고 카드(닫기 버튼 포함)가 화면 위로 잘리지 않게
  // 카드 높이만큼의 여유는 남긴다. 그 경우 경고는 시트의 맨 윗부분(손잡이)만 덮고 안쪽 내용은 가리지 않는다.
  const urgent = pickUrgentWarning(warning, schoolZoneWarning.warning);
  // 경고가 떠 있을 때 그 카드(+위아래 여백)가 차지하는 높이. 시트·최근 검색 패널은 이만큼을 비워 둔다.
  const alertReserve = urgent ? alertHeight + space.lg + space.sm : 0;
  const maxSheetHeightWithAlert = Math.max(0, windowHeight - TAB_BAR_ALLOWANCE - alertReserve - insets.top);
  const hasSheet = !!(pickedPoint || activeRoute || liveLoading || routeStyles || transitResult || searched);
  const hazardOffset = hasSheet
    ? Math.min(sheetHeight, maxSheetHeightWithAlert)
    : 0;
  const sheetProps = {
    maxExpandedHeight: urgent ? maxSheetHeightWithAlert : undefined, windowHeight, bottomInset: insets.bottom, onHeightChange: setSheetHeight };
  const inRouteView = searched || routeStyles !== null || transitResult !== null || activeRoute !== null;
  const showPlanner = plannerOpen || inRouteView;
  const originLabel = originAddress ?? (manualOrigin ? t('map.pickedLocation') : originText || t('map.myLocation'));
  const destinationLabel = destinationAddress ?? (destination || t('map.pickedLocation'));
  const recentsMaxHeight = Math.min(
    RECENTS_MAX_HEIGHT,
    Math.max(RECENTS_MIN_HEIGHT, windowHeight - recentsTop - keyboardHeight - TAB_BAR_ALLOWANCE - alertReserve),
  );
  const showRecents = destinationFocused && !inRouteView && (recents.length > 0 || recentRoutes.length > 0);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} onMapClick={onMapClick} />
      </View>

      {/* 위험 경고는 상단 오버레이(메뉴·시뮬레이터)보다 먼저 그려 그 아래에 깔린다. */}
      {/* 두 경고가 동시에 오면 더 급한 하나만 보여준다(예전엔 둘이 같은 자리에 겹쳐 뒤쪽이 가려졌다). 시트가 있으면 그 위에 올려놓는다. */}
      {urgent && (
        <NavigationHazardAlert
          key={`${urgent.alert.id}:${urgent.stage}`}
          warning={urgent}
          bottomOffset={hazardOffset}
          onHeightChange={setAlertHeight}
          onClose={urgent === warning ? dismiss : schoolZoneWarning.dismiss}
        />
      )}

      {/* 빈 곳은 터치를 지도로 통과시킨다(box-none). 안 하면 지도 드래그가 막힌다. */}
      <View style={[styles.overlay, { paddingTop: insets.top + space.md }]}>
        <View style={styles.column}>
          <ScreenHeader title={<Logo />} />
          {showPlanner ? (
            // 출발/도착 두 줄 — 출발은 기본값 "내 위치"(지도에서 고르면 그 라벨), 도착은 검색 중엔 입력창, 경로가 잡히면 텍스트+닫기로 바뀐다.
            // 출발은 동그라미, 도착은 핀 모양으로 구분한다(색만으로 구분하지 않는다).
            <Card style={styles.planner}>
              <View style={styles.plannerRow}>
                <View style={styles.plannerMarker}>
                  <View style={styles.originDot} />
                </View>
                {inRouteView ? (
                  <Text style={[styles.plannerText, styles.plannerFlex]} numberOfLines={1}>
                    {originLabel}
                  </Text>
                ) : (
                  <TextInput
                    style={[styles.plannerText, styles.plannerInput]}
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
              <View style={styles.plannerDivider} />
              <View style={styles.plannerRow}>
                <View style={styles.plannerMarker}>
                  <Icon icon={MapPin} size={20} color={colors.dangerStrong} />
                </View>
                {inRouteView ? (
                  <>
                    <Text style={[styles.plannerText, styles.plannerFlex]} numberOfLines={1}>
                      {destinationLabel}
                    </Text>
                    <RoundButton icon={X} label={t('map.cancel')} variant="soft" size={44} onPress={onResetSearch} />
                  </>
                ) : (
                  <>
                    <TextInput
                      ref={destinationInputRef}
                      style={[styles.plannerText, styles.plannerInput]}
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
                    <SearchAction label={t('map.search')} compact={compactSearch} onPress={onSearch} />
                  </>
                )}
              </View>
              {inRouteView && (
                <>
                  <View style={styles.plannerDivider} />
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.modeRow}
                    accessibilityRole="tablist"
                  >
                    {MODES.map((m) => (
                      <Chip key={m} label={t(MODE_LABEL[m])} selected={mode === m} onPress={() => onChangeMode(m)} />
                    ))}
                  </ScrollView>
                </>
              )}
            </Card>
          ) : (
            // 처음엔 "검색" 한 칸 + 경로검색 버튼만 보여준다. 누르면 출발/도착 두 칸으로 바뀐다.
            <SearchBar
              accessibilityLabel={t('map.searchPlaceholder')}
              placeholder={t('map.searchPlaceholder')}
              value={destination}
              onChangeText={onChangeDestination}
              returnKeyType="search"
              onFocus={() => setPlannerOpen(true)}
              onSubmitEditing={() => setPlannerOpen(true)}
              trailing={<SearchAction label={t('map.search')} compact={compactSearch} onPress={() => setPlannerOpen(true)} />}
            />
          )}
          {showRecents && (
            <ScrollView
              style={[styles.recentsPanel, { maxHeight: recentsMaxHeight }]}
              contentContainerStyle={styles.recentsPanelContent}
              onLayout={(e) => setRecentsTop(insets.top + space.md + e.nativeEvent.layout.y)}
              keyboardShouldPersistTaps="handled"
            >
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
          <View style={styles.fabWrap}>
            <RoundButton icon={Crosshair} label={t('map.myLocation')} onPress={() => mapRef.current?.moveToMyLocation()} />
          </View>
          {__DEV__ && <HazardSimulator sim={sim} />}
        </View>
      </View>

      {/* 하단 패널 6곳. 고정 4곳(지점 선택·탐색 중·경로 카드·안내 문구)은 draggable={false}, 드래그 2곳(안내 중·대중교통)은 기본값.
          key 는 패널 종류가 바뀔 때 접힘 상태를 새로 시작하게 한다(예전엔 컴포넌트 종류가 달라 자연히 새로 시작했다). */}
      {pickedPoint ? (
        <BottomSheet key="pick" draggable={false} {...sheetProps}>
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
        </BottomSheet>
      ) : activeRoute ? (
        <BottomSheet key="guide" {...sheetProps}>
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
        </BottomSheet>
      ) : liveLoading ? (
        <BottomSheet key="loading" draggable={false} {...sheetProps}>
          <Text style={styles.notice}>{t('map.liveLoading')}</Text>
        </BottomSheet>
      ) : routeStyles ? (
        <BottomSheet key="styles" draggable={false} {...sheetProps}>
          <RouteStylePager
            routes={routeStyles}
            styleLabel={STYLE_LABEL}
            onStart={onStartGuidance}
            onPreview={(route) => mapRef.current?.showRoute(route.path)}
            t={t}
          />
        </BottomSheet>
      ) : transitResult ? (
        <BottomSheet key="transit" {...sheetProps}>
          <TransitRouteList
            result={transitResult}
            category={transitCategory}
            onChangeCategory={setTransitCategory}
            onPreview={(option) => mapRef.current?.showRoute(option.path)}
            onStart={(option) => onStartGuidance(toStyledRoute(option))}
            t={t}
          />
        </BottomSheet>
      ) : searched ? (
        <BottomSheet key="notice" draggable={false} {...sheetProps}>
          <Text style={styles.notice}>{t(liveError ? 'map.liveError' : 'map.demoHint')}</Text>
        </BottomSheet>
      ) : null}
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.transitTabs}>
        {(Object.keys(TRANSIT_CATEGORY_LABEL) as TransitCategory[]).map((c) => (
          <Chip
            key={c}
            label={`${t(TRANSIT_CATEGORY_LABEL[c])} ${counts[c]}`}
            selected={category === c}
            onPress={() => onChangeCategory(c)}
          />
        ))}
      </ScrollView>
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
                        <Text
                          style={[styles.segmentChipText, step.type === 'WALKING' && styles.segmentChipTextDark]}
                          numberOfLines={1}
                        >
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
                          <Icon icon={legIcon(step)} size={16} color={colors.surface} />
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
  // 출발/도착 두 줄 카드
  planner: { paddingVertical: space.xs, paddingHorizontal: space.md },
  plannerRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  plannerMarker: { width: 24, alignItems: 'center', justifyContent: 'center' },
  originDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.guide,
    backgroundColor: colors.surface,
  },
  plannerDivider: { height: 1, marginLeft: 32, backgroundColor: colors.line },
  plannerText: { fontSize: 16, color: colors.ink },
  plannerFlex: { flex: 1, minWidth: 0 },
  plannerInput: { flex: 1, minWidth: 0, minHeight: 44, outlineColor: colors.brand },
  searchAction: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchActionCompact: { width: 44, paddingHorizontal: 0 },
  searchActionText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  fabWrap: { alignSelf: 'flex-end' },
  notice: { fontSize: 14, lineHeight: 20, color: colors.muted },
  pickActions: { flexDirection: 'row', gap: space.sm },
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
  startButton: { minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
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
  stopButton: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stopButtonText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  instructions: { gap: space.xs },
  instructionsTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: space.xs },
  instructionStep: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  instructionCount: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  modeRow: { gap: space.sm, paddingVertical: space.sm },
  transitList: { gap: space.sm },
  transitTabs: { gap: space.sm, paddingVertical: space.xs },
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
  segmentChipTextDark: { color: colors.ink },
  legList: { gap: space.sm },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  legIconBadge: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  legMain: { flex: 1, gap: 1 },
  legVehicle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  legStop: { fontSize: 12, color: colors.muted },
  legDuration: { fontSize: 12, color: colors.muted },
  recentsPanel: { backgroundColor: colors.surface, borderRadius: radius.lg, boxShadow: shadow.float },
  recentsPanelContent: { padding: space.md, gap: space.xs },
  recentsTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: space.xs },
  recentItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs },
  recentItemText: { fontSize: 15, color: colors.ink },
});
