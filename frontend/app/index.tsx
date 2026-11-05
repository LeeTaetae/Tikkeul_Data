import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Bus,
  CalendarDays,
  Coffee,
  Compass,
  Crosshair,
  Footprints,
  MapPin,
  MessageCircle,
  Music,
  Search,
  Share2,
  Star,
  TrainFront,
  TrendingUp,
  Utensils,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { NavigationHazardAlert } from '../src/components/alerts/NavigationHazardAlert';
import { ChatAssistantPanel } from '../src/components/chat/ChatAssistantPanel';
import { FrequentDestinationBanner } from '../src/components/FrequentDestinationBanner';
import { Logo } from '../src/components/Logo';
import { Card } from '../src/components/ui/Card';
import { BottomSheet } from '../src/components/ui/BottomSheet';
import { CategoryChip } from '../src/components/ui/CategoryChip';
import { Chip } from '../src/components/ui/Chip';
import { RoundButton } from '../src/components/ui/RoundButton';
import { ScreenHeader } from '../src/components/ui/ScreenHeader';
import { SearchBar } from '../src/components/ui/SearchBar';
import { useHazardSimulation } from '../src/dev/HazardSimulator';
import { clearGuidanceRequest, clearRideRequest, guidanceTargetOf, setGuidanceRequest, setRideRequest } from '../src/lib/navigation/guidanceSession';
import type { NavRoute } from '../src/lib/navigation/guidanceEngine';
import { useRouteHazardWarning } from '../src/lib/navigation/useRouteHazardWarning';
import { useRouteSpeedBumps } from '../src/lib/navigation/useRouteSpeedBumps';
import { projectOntoRoute, type Route } from '../src/lib/routeHazards';
import { dedupeInstructions, formatInstructionText } from '../src/lib/routeInstructions';
import { useHazardWarning } from '../src/lib/useHazardWarning';
import { useKeyboardHeight } from '../src/lib/useKeyboardHeight';
import { useSpeedBumpSpeech } from '../src/lib/useSpeedBumpSpeech';
import { useSpeedingWarning } from '../src/lib/useSpeedingWarning';
import { useTurnInstructionSpeech } from '../src/lib/useTurnInstructionSpeech';
import { pickUrgentWarning } from '../src/lib/urgentWarning';
import { KakaoMap } from '../src/map/KakaoMap';
import { busLegColor } from '../src/lib/navigation/transitColors';
import { showTransitRoute } from '../src/map/showTransitRoute';
import { findDemoDestination } from '../src/map/demoDestinations';
import { getCurrentLocation } from '../src/lib/location/getCurrentLocation';
import { NEARBY_CATEGORIES, fetchNearbyPlaces, fetchPlaceAt, type NearbyPlace, type PlaceAtPoint, type PlaceCategory } from '../src/lib/places/api';
import { favoritesApi, type FavoritePlace } from '../src/lib/favorites/api';
import { searchPlaces, type PlaceSearchResult } from '../src/lib/places/search';
import { loadRecentRoutes, loadRecents, saveRecent, saveRecentRoute, type RecentDestination, type RecentRoute } from '../src/lib/recents';
import { useAuth } from '../src/lib/auth/AuthContext';
import { tripsApi, type FrequentDestination } from '../src/lib/trips/api';
import { pickFrequentDestination } from '../src/lib/trips/frequentBanner';
import { toFallbackPopular } from '../src/lib/places/popularFallback';
import { PLACEHOLDER_TRENDS, type TrendCategory } from '../src/lib/trends/placeholderTrends';
import { clearPendingSearch, getPendingSearch } from '../src/lib/navigation/pendingSearch';
import {
  fetchAddress,
  fetchBestRoute,
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

const TREND_ICON: Record<TrendCategory, LucideIcon> = {
  event: CalendarDays,
  restaurant: Utensils,
  cafe: Coffee,
  performance: Music,
};

type TransitCategory = 'all' | 'BUS' | 'SUBWAY' | 'BUS_AND_SUBWAY';
const TRANSIT_CATEGORY_LABEL: Record<TransitCategory, string> = {
  all: 'map.transitAll',
  BUS: 'map.transitBus',
  SUBWAY: 'map.transitSubway',
  BUS_AND_SUBWAY: 'map.transitBusAndSubway',
};

const COMPACT_WIDTH = 360;
const RECENTS_MAX_HEIGHT = 280;
const RECENTS_MIN_HEIGHT = 120;
// 하단 탭 바 높이(60) + 여유. 최근 검색 패널이 탭 바 밑으로 파고들지 않게 뺀다.
const TAB_BAR_ALLOWANCE = 76;
// 위험 경고 카드 높이의 기본값. 카드가 처음 그려져 실제 높이를 알려 주기(onHeightChange) 전까지만 쓴다.
const HAZARD_ALERT_FALLBACK_HEIGHT = 190;

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

// 장소 이름에 흔한 단어가 있으면 그에 맞는 한 줄 설명을, 없으면 무난한 기본 문구를 돌려준다.
// 실제 방문 기록에는 설명이 따로 없어서(이름·주소·방문횟수뿐) 이름만 보고 짐작하는 수준이다 - 틀릴 수 있다.
const PLACE_DESCRIPTION_RULES: { pattern: RegExp; text: string }[] = [
  { pattern: /공원|동산|수목원|정원/, text: '여유롭게 쉴 수 있는 공원' },
  { pattern: /카페|커피|로스터리/, text: '커피 한 잔 하기 좋은 카페' },
  { pattern: /도서관|책방|서점/, text: '조용히 책 읽기 좋은 곳' },
  { pattern: /영화관|시네마|CGV|메가박스|롯데시네마/, text: '영화 보기 좋은 곳' },
  { pattern: /박물관|미술관|전시|아트/, text: '구경하기 좋은 전시 공간' },
  { pattern: /백화점|마트|쇼핑|몰/, text: '쇼핑하기 좋은 곳' },
  { pattern: /체육관|운동장|헬스|스포츠/, text: '몸을 움직이기 좋은 곳' },
  { pattern: /식당|맛집|김밥|분식|고기|국밥|치킨|버거|떡볶이|식탁/, text: '한 끼 든든하게 먹기 좋은 곳' },
  { pattern: /역$|터미널|공항/, text: '오가는 사람이 많은 교통 요지' },
];

function describePlace(name: string): string {
  return PLACE_DESCRIPTION_RULES.find((rule) => rule.pattern.test(name))?.text ?? '방문자들이 많이 찾는 곳';
}

// 구간 색 — 지하철은 파랑, 도보는 회색. 버스는 지도 경로선과 같은 busLegColor 를 써서 카드와 지도의 색이 항상 같다.
function legColor(step: TransitStep): string {
  if (step.type === 'WALKING') return colors.line;
  if (step.type === 'SUBWAY') return colors.info;
  return busLegColor(step.vehicles).color;
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
    instructions: option.instructions.map((text) => ({ text, point: null })),
  };
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
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { favoriteCategory, favLat, favLng, favLabel } = useLocalSearchParams<{
    favoriteCategory?: string;
    favLat?: string;
    favLng?: string;
    favLabel?: string;
  }>();
  const { status: authStatus, token: authToken } = useAuth();
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
  // 자주 가는 목적지 안내 배너. 앱 세션(이 화면 마운트)당 1회만 조회 - 로그인 전엔 authToken이 null이라
  // 로그인 완료 시점에 다시 시도하도록 의존성에 authStatus/authToken을 둔다.
  const [frequentDestination, setFrequentDestination] = useState<FrequentDestination | null>(null);
  useEffect(() => {
    if (authStatus !== 'authenticated' || !authToken) {
      setFrequentDestination(null); // 로그아웃하면 이전 계정의 목적지가 남아있지 않게 지운다
      return;
    }
    let cancelled = false;
    tripsApi
      .frequent(authToken, { limit: 1, lang: i18n.language })
      .then((destinations) => {
        if (!cancelled) setFrequentDestination(pickFrequentDestination(destinations));
      })
      .catch(() => {}); // 실패해도 배너만 안 뜨면 된다 - 홈 화면 자체를 막지 않는다
    return () => {
      cancelled = true; // 응답이 늦게 와서 로그아웃·계정 전환 이후에 도착하면 반영하지 않는다
    };
  }, [authStatus, authToken]);
  const [manualOrigin, setManualOrigin] = useState<RoutePoint | null>(null);
  const [manualDestination, setManualDestination] = useState<RoutePoint | null>(null);
  const [originAddress, setOriginAddress] = useState<string | null>(null);
  const [destinationAddress, setDestinationAddress] = useState<string | null>(null);
  const [pickedPoint, setPickedPoint] = useState<RoutePoint | null>(null);
  const [pickedPlace, setPickedPlace] = useState<PlaceAtPoint | null>(null);
  const [pickedFavorited, setPickedFavorited] = useState(false);
  const [routeStyles, setRouteStyles] = useState<StyledRoute[] | null>(null);
  const [transitResult, setTransitResult] = useState<TransitRoutesResult | null>(null);
  const [transitCategory, setTransitCategory] = useState<TransitCategory>('all');
  const [activeRoute, setActiveRoute] = useState<StyledRoute | null>(null);
  // 안내가 (재)시작될 때마다 늘어난다. useHazardWarning 의 routeKey 로 써서, 재탐색 시 이력을 새로 시작한다.
  const [routeSeq, setRouteSeq] = useState(0);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(false);
  const [searched, setSearched] = useState(false);
  // 목적지는 찾았지만(=searched) 경로 계산 자체가 실패한 경우. true면 오류를 닫아도 "목적지 없음" 안내 대신
  // 모드탭이 있는 검색 화면을 그대로 유지해, 다른 이동수단으로 바로 재시도할 수 있게 한다.
  const [routeFetchFailed, setRouteFetchFailed] = useState(false);
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

  // 챗봇 패널 열림 여부. nearbyCategory/pickedPoint 와 같은 시트 자리를 쓰므로 동시에 하나만 연다.
  const [chatOpen, setChatOpen] = useState(false);

  // 검색창 밑 카테고리 버튼(음식점·카페 등)으로 내 주변 장소를 본다.
  const [nearbyCategory, setNearbyCategory] = useState<PlaceCategory | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[] | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState(false);

  // 즐겨찾기 카테고리 바텀시트(홈화면). nearbyCategory 와 서로 배타적이어야 한다(한쪽을 열 때 다른 쪽을 닫는다).
  const [favoriteCategoryView, setFavoriteCategoryView] = useState<string | null>(null);
  const [favoriteCategoryPlaces, setFavoriteCategoryPlaces] = useState<FavoritePlace[] | null>(null);

  // 홈 화면 기본 패널: 내 주변에서 전체 유저가 많이 간 곳(로그인 불필요, 집계만). 다른 시트가 없을 때만 보인다.
  const [popularPlaces, setPopularPlaces] = useState<FrequentDestination[] | null>(null);
  const [popularTab, setPopularTab] = useState<'nearby' | 'trending'>('nearby');
  useEffect(() => {
    getCurrentLocation()
      .then(async (point) => {
        const popular = await tripsApi.popular({ lat: point.lat, lng: point.lng, limit: 20, lang: i18n.language });
        if (popular.length > 0) return popular;
        // 트립 데이터가 없는 콜드스타트 동네: 카카오 주변 음식점·카페로 대체.
        const [restaurants, cafes] = await Promise.all([
          fetchNearbyPlaces('restaurant', point, 1000, i18n.language).catch(() => []),
          fetchNearbyPlaces('cafe', point, 1000, i18n.language).catch(() => []),
        ]);
        return toFallbackPopular([...restaurants, ...cafes], 20);
      })
      .then(setPopularPlaces)
      .catch(() => setPopularPlaces(null));
  }, [i18n.language]);

  // 즐겨찾기 화면의 카테고리 그룹 헤더를 탭해 들어오면(favoriteCategory 파라미터), 그 카테고리의 즐겨찾기들을 지도에 점으로 찍는다.
  useEffect(() => {
    if (!favoriteCategory || !authToken) return;
    // 내 주변 카테고리 시트가 열려 있으면 먼저 닫아야 onPlaceClick 이 엉뚱한 nearbyPlaces 인덱스로 안내를 시작하지 않는다.
    closeNearby();
    favoritesApi
      .list(authToken, { lang: i18n.language })
      .then((list) => {
        const filtered = list.filter((f) => f.category === favoriteCategory);
        setFavoriteCategoryPlaces(filtered);
        setFavoriteCategoryView(favoriteCategory);
        mapRef.current?.showPlaces(filtered.map((f) => ({ point: { lat: f.lat, lng: f.lon }, label: f.label })), colors.brand);
        // 같은 카테고리를 다시 탭해도 effect 가 재실행되도록 파라미터를 비운다.
        router.setParams({ favoriteCategory: undefined });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoriteCategory, authToken]);

  // 즐겨찾기 화면에서 집/회사/카테고리 안 즐겨찾기 하나를 눌러 들어오면(favLat/favLng/favLabel 파라미터),
  // 바로 턴바이턴으로 들어가지 않고 기존 "주변 장소 선택" 과 동일하게 경로 선택 단계(searchRoutes → routeStyles)를 거친다.
  useEffect(() => {
    if (!favLat || !favLng || !favLabel) return;
    closeNearby();
    closeFavoriteCategoryView();
    searchRoutes({ lat: Number(favLat), lng: Number(favLng) }, favLabel, mode);
    // 같은 즐겨찾기를 다시 눌러도 effect 가 재실행되도록 파라미터를 비운다.
    router.setParams({ favLat: undefined, favLng: undefined, favLabel: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favLat, favLng, favLabel]);

  // 도착지 입력창에 2글자 이상 치면 실제 장소 검색(자동완성)을 보여준다. 데모 목적지 4곳만 되던 한계를 없앤다.
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSearchResult[]>([]);
  // 빈 목록이 "찾는 중"인지 "결과 없음"인지 구분하려고 따로 둔다.
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  useEffect(() => {
    if (!destinationFocused || destination.trim().length < 2) {
      setDestinationSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    const timer = setTimeout(() => {
      searchPlaces(destination.trim(), undefined, i18n.language)
        .then((results) => {
          if (!cancelled) setDestinationSuggestions(results);
        })
        .catch(() => {
          if (!cancelled) setDestinationSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestionsLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [destination, destinationFocused, i18n.language]);

  // 어린이보호구역: 실제 안내 경로에 실제 보호구역 데이터를 매칭해 접근 경고를 띄운다. 조회·매칭·단계 경고는
  // 길안내 화면과 같은 훅(useRouteHazardWarning)을 쓴다. 경로가 지나는 시군구를 표본 조회한다(경로 시작점 하나만 보지 않는다).
  // activeRoute 가 바뀔 때만(안내 시작·종료·재탐색) 새로 만든다. 위치 폴링용 투영(projectOntoRoute)에도 쓴다.
  // 상세 경로 화면 표시용: 턴 설명 뒤에 같은 구간을 또 요약하는 중복 줄을 빼고, 거리를 km 단위로 다듬는다.
  // TTS(useTurnInstructionSpeech)는 원문 그대로 읽어야 해서 activeRoute.instructions 를 따로 그대로 쓴다.
  const displayInstructions = useMemo(
    () => (activeRoute ? dedupeInstructions(activeRoute.instructions).map((i) => formatInstructionText(i.text)) : []),
    [activeRoute],
  );
  const schoolZoneRoute: Route | null = useMemo(
    () => (activeRoute ? { id: String(routeSeq), points: activeRoute.path.map((p) => ({ latitude: p.lat, longitude: p.lng })) } : null),
    [activeRoute, routeSeq],
  );
  const homeNavRoute: NavRoute | null = useMemo(
    () => (activeRoute ? { id: String(routeSeq), source: 'api', mode: 'driving', path: activeRoute.path } : null),
    [activeRoute, routeSeq],
  );

  // 과속방지턱: 경로 전체를 덮는 영역으로 한 번만 조회한다(조회·중복 제거는 길안내 화면과 같은 훅).
  const speedBumpPoints = useRouteSpeedBumps(activeRoute?.path ?? null);

  // shortcut: 연속 위치추적(watchPosition) 대신 5초 간격으로 현재 위치를 다시 읽는다. 실제 내비게이션
  // GPS 추적이 생기면(sim 주석 참고) 그 값을 함께 쓰도록 바꾼다.
  const [liveProgressM, setLiveProgressM] = useState(0);
  // coords.speed 는 m/s, null 가능(기기·브라우저가 속력을 못 줄 때). null 이면 속도 기반 경고(과속)를 내지 않는다.
  const [liveSpeedKmh, setLiveSpeedKmh] = useState<number | null>(null);
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
          setLiveSpeedKmh(coords.speed != null && coords.speed >= 0 ? coords.speed * 3.6 : null);
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

  // 턴바이턴 음성 안내. schoolZoneRoute 가 activeRoute 와 같은 경로(좌표)라 그대로 재사용한다.
  useTurnInstructionSpeech({
    active: !!activeRoute,
    routeKey: schoolZoneRoute?.id ?? '',
    route: schoolZoneRoute,
    instructions: activeRoute?.instructions ?? [],
    guides: activeRoute?.guides,
    source: 'home',
    progressM: liveProgressM,
    language: i18n.language,
  });

  // 과속방지턱 음성 경고. 상세 경로에는 표시하지 않는다 — 음성 전용.
  useSpeedBumpSpeech({
    active: !!activeRoute,
    routeKey: schoolZoneRoute?.id ?? '',
    route: schoolZoneRoute,
    bumps: speedBumpPoints,
    progressM: liveProgressM,
  });

  // 어린이보호구역 과속 음성 경고(제한속도 30km/h). 속도를 모르면(liveSpeedKmh null) 경고하지 않는다.
  // 노인·장애인보호구역은 30km/h가 전국 공통 법정 속도라고 확정할 수 없어 뺀다(지자체 조례로 다를 수 있다).
  const childZonesOnRoute = useMemo(
    () => schoolZoneWarning.zoneOnRoute.filter((z) => z.alert.zoneType === 'child'),
    [schoolZoneWarning.zoneOnRoute],
  );
  useSpeedingWarning({
    active: !!activeRoute,
    routeKey: schoolZoneRoute?.id ?? '',
    route: schoolZoneRoute,
    zones: childZonesOnRoute,
    progressM: liveProgressM,
    speedKmh: liveSpeedKmh,
  });

  const onChangeDestination = (text: string) => {
    closeNearby();
    closeFavoriteCategoryView();
    setPlannerOpen(true);
    setDestination(text);
    setManualDestination(null);
  };

  // shortcut: 출발지도 도착지와 같은 방식(findDemoDestination, 데모 지점 4곳)으로만 텍스트 검색된다.
  const onChangeOrigin = (text: string) => {
    setOriginText(text);
    setManualOrigin(null);
  };

  // 로그인 상태에서만 "자주/최근 간 곳" 랭킹(대중교통·네비게이션 탭)에 쓸 방문 기록을 남긴다.
  // 실패해도 경로 검색 자체를 막지 않는다(부가 기능).
  const logTrip = (origin: RoutePoint, destination: RoutePoint, label: string, addressText: string | null) => {
    if (!authToken) return;
    tripsApi
      .create(
        { origin: { lat: origin.lat, lon: origin.lng }, destination: { lat: destination.lat, lon: destination.lng, label, address_text: addressText ?? '' } },
        authToken,
      )
      .catch(() => {});
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
    setRouteFetchFailed(false);
    setOriginAddress(null);
    setDestinationAddress(null);
    setTransitResult(null);
    setTransitCategory('all');
    const origin = manualOrigin ?? findDemoDestination(originText) ?? (await getCurrentLocation());
    lastSearchRef.current = { origin, destination: destinationPoint, label };
    if (travelMode === 'transit') {
      const [transit, originAddressValue, destinationAddressValue] = await Promise.all([
        fetchTransitRoutes(origin, destinationPoint, i18n.language),
        fetchAddress(origin, i18n.language),
        fetchAddress(destinationPoint, i18n.language),
      ]);
      setOriginAddress(originAddressValue);
      setDestinationAddress(destinationAddressValue);
      setLiveLoading(false);
      const originLabel =
        originAddressValue ?? (manualOrigin ? t('map.pickedLocation') : originText || t('map.myLocation'));
      const destinationLabel = destinationAddressValue ?? label;
      if (transit && transit.routes.length > 0) {
        setTransitResult(transit);
        showTransitRoute(mapRef.current, transit.routes[0]);
        setRecents(saveRecent({ label: destinationLabel, point: destinationPoint }));
        setRecentRoutes(saveRecentRoute({ originLabel, destinationLabel, destinationPoint, mode: travelMode }));
        logTrip(origin, destinationPoint, label, destinationAddressValue);
        return transit.routes.map(toStyledRoute);
      }
      setLiveError(true);
      setRouteFetchFailed(true);
      return null;
    }
    const [results, originAddressValue, destinationAddressValue] = await Promise.all([
      travelMode === 'driving'
        ? // Tmap 5가지 스타일이 실패(한도 초과 429 → 503 등)하면 /navigation/route 의 추천 경로 하나로 대신한다.
          fetchRouteStyles(origin, destinationPoint, { lang: i18n.language }).then(
            (styles) => styles ?? fetchBestRoute(origin, destinationPoint, i18n.language),
          )
        : fetchModeRoute(origin, destinationPoint, travelMode, { lang: i18n.language }),
      fetchAddress(origin, i18n.language),
      fetchAddress(destinationPoint, i18n.language),
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
      logTrip(origin, destinationPoint, label, destinationAddressValue);
      return results;
    }
    setRouteStyles(null);
    setLiveError(true);
    setRouteFetchFailed(true);
    return null;
  };

  // 검색 후 언어를 바꾸면 화면에 남아있는 출발/도착 주소도 같은 좌표로 다시 번역해 보여준다.
  useEffect(() => {
    const search = lastSearchRef.current;
    if (!search) return;
    fetchAddress(search.origin, i18n.language).then(setOriginAddress);
    fetchAddress(search.destination, i18n.language).then(setDestinationAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  // "내 주변" 카테고리 시트를 열어둔 채 언어를 바꾸면 그 목록도 같은 조건으로 다시 번역해 보여준다.
  useEffect(() => {
    if (!nearbyCategory) return;
    getCurrentLocation()
      .then((origin) => fetchNearbyPlaces(nearbyCategory, origin, 1000, i18n.language))
      .then(setNearbyPlaces)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  // 즐겨찾기 카테고리 시트를 열어둔 채 언어를 바꾸면 그 목록도 같은 조건으로 다시 번역해 보여준다.
  useEffect(() => {
    if (!favoriteCategoryView || !authToken) return;
    favoritesApi
      .list(authToken, { lang: i18n.language })
      .then((list) => setFavoriteCategoryPlaces(list.filter((f) => f.category === favoriteCategoryView)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  // 대중교통·네비게이션 탭에서 목적지를 고르고 돌아오면, 그 조건으로 바로 경로를 검색해 지도에 보여준다.
  useFocusEffect(
    useCallback(() => {
      const pending = getPendingSearch();
      if (!pending) return;
      clearPendingSearch();
      setMode(pending.mode);
      setDestination(pending.label);
      setManualDestination(pending.point);
      searchRoutes(pending.point, pending.label, pending.mode);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const onSearch = async () => {
    const trimmed = destination.trim();
    if (trimmed.length === 0) {
      setDestinationFocused(true);
      return;
    }
    // 제안 목록에서 고르지 않고 그냥 검색을 누르면: 데모 목적지(즉시) → 실제 장소 검색 첫 결과 순으로 찾는다.
    let destinationPoint: RoutePoint | null;
    try {
      destinationPoint = manualDestination ?? findDemoDestination(destination) ?? (await searchPlaces(trimmed))[0]?.point ?? null;
    } catch {
      // 장소 검색 서버 오류·네트워크 실패 시 버튼이 아무 반응 없이 끝나지 않게 실패 안내를 띄운다.
      setSearched(true);
      setRouteStyles(null);
      setLiveError(true);
      return;
    }
    if (!destinationPoint) {
      setSearched(true);
      setRouteStyles(null);
      setLiveError(false);
      return;
    }
    await searchRoutes(destinationPoint, trimmed, mode);
  };

  const closeLiveError = () => {
    setLiveError(false);
    // 목적지는 찾았는데 경로 계산만 실패한 경우(routeFetchFailed)는 검색 화면·모드탭을 그대로 둬서
    // 다른 이동수단으로 바로 재시도할 수 있게 한다. 목적지 자체를 못 찾은 경우만 처음 화면으로 되돌린다.
    if (!routeFetchFailed) setSearched(false);
  };

  const onPickSuggestion = async (place: PlaceSearchResult) => {
    setDestinationSuggestions([]);
    setDestination(place.name);
    setManualDestination(place.point);
    await searchRoutes(place.point, place.name, mode);
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
      setRouteFetchFailed(false);
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

  const onConfirmFrequent = async () => {
    if (!frequentDestination) return;
    const point: RoutePoint = { lat: frequentDestination.lat, lng: frequentDestination.lon };
    setFrequentDestination(null);
    setDestination(frequentDestination.label);
    setManualDestination(point);
    await searchRoutes(point, frequentDestination.label, mode);
  };

  const onDismissFrequent = () => setFrequentDestination(null);

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
    setRouteFetchFailed(false);
    setPlannerOpen(false);
    mapRef.current?.clearRoute();
  };

  // 출발/도착 두 칸(plannerOpen)을 입력하다가 지도를 손으로 움직이면 원래 검색창으로 되돌린다.
  // 검색 결과가 이미 나와 있을 때(inRouteView)는 지도를 둘러보는 동작일 수 있어 건드리지 않는다.
  const onMapPan = () => {
    if (plannerOpen && !searched && routeStyles === null && transitResult === null && !activeRoute) {
      onResetSearch();
    }
  };

  const closeNearby = () => {
    setNearbyCategory(null);
    setNearbyPlaces(null);
    setNearbyError(false);
    mapRef.current?.clearPlaces();
  };

  // 즐겨찾기 카테고리 시트를 닫는다. nearbyCategory 시트와 배타적이라 둘 다 있을 땐 서로 닫아줘야 한다.
  const closeFavoriteCategoryView = () => {
    setFavoriteCategoryView(null);
    setFavoriteCategoryPlaces(null);
    mapRef.current?.clearPlaces();
  };

  // 카테고리 버튼: 같은 카테고리를 다시 누르면 닫고, 다른 카테고리면 현재 위치 기준으로 다시 찾아 지도에 점을 찍는다.
  const onPressCategory = async (category: PlaceCategory) => {
    closeFavoriteCategoryView();
    if (nearbyCategory === category) {
      closeNearby();
      return;
    }
    onResetSearch();
    setNearbyCategory(category);
    setNearbyPlaces(null);
    setNearbyError(false);
    setNearbyLoading(true);
    try {
      const origin = await getCurrentLocation();
      const places = await fetchNearbyPlaces(category, origin, 1000, i18n.language);
      setNearbyPlaces(places);
      const color = NEARBY_CATEGORIES.find((c) => c.key === category)?.color ?? colors.brand;
      mapRef.current?.showPlaces(places.map((p) => ({ point: p.point, label: p.name })), color);
    } catch {
      setNearbyError(true);
    } finally {
      setNearbyLoading(false);
    }
  };

  const onPickNearbyPlace = async (place: NearbyPlace) => {
    closeNearby();
    setDestination(place.name);
    setManualDestination(place.point);
    await searchRoutes(place.point, place.name, mode);
  };

  const onPickFavoritePlace = async (place: FavoritePlace) => {
    closeFavoriteCategoryView();
    setDestination(place.label);
    setManualDestination({ lat: place.lat, lng: place.lon });
    await searchRoutes({ lat: place.lat, lng: place.lon }, place.label, mode);
  };

  const onPickPopularPlace = async (place: FrequentDestination) => {
    const point: RoutePoint = { lat: place.lat, lng: place.lon };
    setDestination(place.label);
    setManualDestination(point);
    await searchRoutes(point, place.label, mode);
  };

  // 대중교통: 목록에서 고른 옵션(구간 정보 포함)을 그대로 길안내 화면에 넘긴다.
  const onStartTransitGuidance = (option: TransitRouteOption) => {
    const search = lastSearchRef.current;
    if (!search) return;
    setActiveRoute(null);
    clearGuidanceRequest();
    setRideRequest({ origin: search.origin, destination: search.destination, destinationLabel: search.label, mode: 'transit', transit: option });
    router.push('/navigation');
  };

  const onStartGuidance = (route: StyledRoute) => {
    // 자동차·도보·자전거는 별도 길안내 화면이 GPS 를 맡는다. 홈의 안내 상태(위치 폴링·위험 경고)는 꺼서 위치 추적기가 둘이 되지 않게 한다.
    const target = guidanceTargetOf(route.style);
    const search = lastSearchRef.current;
    if (route.style === 'cycling' && search) {
      setActiveRoute(null);
      clearGuidanceRequest();
      setRideRequest({ origin: search.origin, destination: search.destination, destinationLabel: search.label, mode: 'cycling', cycling: route });
      router.push('/navigation');
      return;
    }
    if (target && search) {
      setActiveRoute(null);
      clearRideRequest();
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

  // 지도를 탭해 위치를 고르면, 그 좌표가 뭔지(장소명·카테고리, 없으면 주소)를 바로 조회해 패널에 보여준다.
  useEffect(() => {
    if (!pickedPoint) {
      setPickedPlace(null);
      return;
    }
    let cancelled = false;
    setPickedPlace(null);
    setPickedFavorited(false);
    fetchPlaceAt(pickedPoint, i18n.language).then((place) => {
      if (!cancelled) setPickedPlace(place);
    });
    return () => {
      cancelled = true;
    };
  }, [pickedPoint, i18n.language]);

  // 지도에서 고른 위치를 출발지로만 지정한다 — 바로 안내를 시작하지 않고, 도착지를 마저 입력받는다.
  // 경로 검색을 기다리지 않고 여기서 바로 역지오코딩해서, "지도에서 선택한 위치" 대신 실제 주소를 보여준다.
  const onPickOrigin = () => {
    if (!pickedPoint) return;
    const origin = pickedPoint;
    setManualOrigin(origin);
    setOriginText(t('map.pickedLocation'));
    setOriginAddress(null);
    setPickedPoint(null);
    setPlannerOpen(true);
    destinationInputRef.current?.focus();
    fetchAddress(origin, i18n.language).then((address) => setOriginAddress(address));
  };

  // 지도에서 고른 위치를 도착지로 지정하고, 검색 결과(경로 스타일 선택지)를 보여준다.
  // 텍스트로 검색했을 때와 똑같이 여기서 바로 안내를 시작하지 않는다 - 이동수단·경로를 고르는 건 사용자 몫이다.
  const onPickDestination = async () => {
    if (!pickedPoint) return;
    const destinationPoint = pickedPoint;
    const label = t('map.pickedLocation');
    setManualDestination(destinationPoint);
    setDestination(label);
    setPickedPoint(null);
    await searchRoutes(destinationPoint, label, mode);
  };

  // 선택한 위치를 즐겨찾기(저장 탭)에 custom 으로 추가한다. 비로그인이면 로그인부터 하게 한다.
  const onPressPickedFavorite = () => {
    if (!pickedPoint || pickedFavorited) return;
    if (authStatus !== 'authenticated' || !authToken) {
      router.push('/login');
      return;
    }
    const label = pickedPlace?.name ?? pickedPlace?.address ?? t('map.pickedLocation');
    favoritesApi
      .create({ kind: 'custom', label, lat: pickedPoint.lat, lon: pickedPoint.lng, address_text: pickedPlace?.address ?? '' }, authToken)
      .then(() => setPickedFavorited(true))
      .catch(() => {});
  };

  // 장소 이름(또는 주소)과 좌표를 공유한다. 웹은 Web Share API, 없으면 클립보드로 대신한다.
  const onSharePicked = async () => {
    if (!pickedPoint) return;
    const title = pickedPlace?.name ?? pickedPlace?.address ?? t('map.pickedLocation');
    const text = [title, pickedPlace?.address, `${pickedPoint.lat.toFixed(6)}, ${pickedPoint.lng.toFixed(6)}`].filter(Boolean).join('\n');
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (data: { title?: string; text?: string }) => Promise<void> }) : null;
        if (nav?.share) await nav.share({ title, text });
        else await navigator.clipboard?.writeText(text);
      } else {
        await Share.share({ message: text });
      }
    } catch {
      // 공유 시트를 취소한 경우 등 - 조용히 무시
    }
  };

  // 위험 경고: 시트가 있으면 그 높이만큼 위로 올린다. 시트를 크게 펼쳐도 경고 카드(닫기 버튼 포함)가 화면 위로 잘리지 않게
  // 카드 높이만큼의 여유는 남긴다. 그 경우 경고는 시트의 맨 윗부분(손잡이)만 덮고 안쪽 내용은 가리지 않는다.
  const urgent = pickUrgentWarning(warning, schoolZoneWarning.warning);
  // 경고가 떠 있을 때 그 카드(+위아래 여백)가 차지하는 높이. 시트·최근 검색 패널은 이만큼을 비워 둔다.
  const alertReserve = urgent ? alertHeight + space.lg + space.sm : 0;
  const maxSheetHeightWithAlert = Math.max(0, windowHeight - TAB_BAR_ALLOWANCE - alertReserve - insets.top);
  const hasPopularSheet =
    !nearbyCategory && !favoriteCategoryView && !pickedPoint && !activeRoute && !liveLoading && !routeStyles && !transitResult && !searched;
  const hasSheet = !!(
    nearbyCategory ||
    favoriteCategoryView ||
    pickedPoint ||
    activeRoute ||
    liveLoading ||
    routeStyles ||
    transitResult ||
    searched ||
    hasPopularSheet
  );
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
  const showSuggestions = destinationFocused && !inRouteView && destination.trim().length >= 2;
  const showRecents = destinationFocused && !inRouteView && !showSuggestions && (recents.length > 0 || recentRoutes.length > 0);

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap
          ref={mapRef}
          onMapClick={onMapClick}
          onUserPan={onMapPan}
          onPlaceClick={(i) => {
            if (favoriteCategoryPlaces) {
              favoriteCategoryPlaces[i] && onPickFavoritePlace(favoriteCategoryPlaces[i]);
              return;
            }
            nearbyPlaces?.[i] && onPickNearbyPlace(nearbyPlaces[i]);
          }}
        />
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
          {frequentDestination && !inRouteView && (
            <FrequentDestinationBanner
              label={frequentDestination.label}
              onConfirm={onConfirmFrequent}
              onDismiss={onDismissFrequent}
            />
          )}
          {/* 개발용 임시 진입점(docs/ADR/0002 vision-test). 캘리브레이션 끝나면 제거. */}
          {__DEV__ && (
            <Pressable onPress={() => router.push('/vision-test')} style={styles.devVisionTestButton}>
              <Text style={styles.devVisionTestText}>[DEV] vision-test 열기</Text>
            </Pressable>
          )}
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
                      onFocus={() => { closeNearby(); closeFavoriteCategoryView(); setDestinationFocused(true); }}
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
              onFocus={() => { closeNearby(); closeFavoriteCategoryView(); setPlannerOpen(true); }}
              onSubmitEditing={() => setPlannerOpen(true)}
              trailing={<SearchAction label={t('map.search')} compact={compactSearch} onPress={() => setPlannerOpen(true)} />}
            />
          )}
          {!showPlanner && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
              accessibilityRole="tablist"
            >
              {NEARBY_CATEGORIES.map((c) => (
                <CategoryChip
                  key={c.key}
                  label={t(c.labelKey)}
                  icon={c.icon}
                  color={c.color}
                  selected={nearbyCategory === c.key}
                  onPress={() => onPressCategory(c.key)}
                />
              ))}
            </ScrollView>
          )}
          {showSuggestions && (
            <ScrollView
              style={[styles.recentsPanel, { maxHeight: recentsMaxHeight }]}
              contentContainerStyle={styles.recentsPanelContent}
              onLayout={(e) => setRecentsTop(insets.top + space.md + e.nativeEvent.layout.y)}
              keyboardShouldPersistTaps="handled"
            >
              {suggestionsLoading ? (
                <Text style={styles.notice}>{t('map.searchingPlaces')}</Text>
              ) : destinationSuggestions.length === 0 ? (
                <Text style={styles.notice}>{t('map.noDestination')}</Text>
              ) : (
                destinationSuggestions.map((p, i) => (
                  <Pressable key={i} style={styles.recentItem} onPress={() => onPickSuggestion(p)} accessibilityRole="button">
                    <Text style={styles.recentItemText} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={styles.nearbyAddress} numberOfLines={1}>
                      {p.address}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
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
            <RoundButton icon={MessageCircle} label={t('chat.openLabel')} variant="brand" onPress={() => setChatOpen(true)} />
          </View>
        </View>
      </View>

      {/* 하단 패널 6곳. 고정 4곳(지점 선택·탐색 중·경로 카드·안내 문구)은 draggable={false}, 드래그 2곳(안내 중·대중교통)은 기본값.
          key 는 패널 종류가 바뀔 때 접힘 상태를 새로 시작하게 한다(예전엔 컴포넌트 종류가 달라 자연히 새로 시작했다).
          챗봇은 제일 먼저 검사한다 - 안내 중이든 다른 패널이 열려 있든 상태를 건드리지 않고 그 위에 잠깐 떴다가,
          닫으면(chatOpen=false) 원래 있던 패널로 그대로 돌아간다. */}
      {chatOpen ? (
        <BottomSheet key="chat" {...sheetProps} draggable={false} avoidKeyboard keyboardOffset={keyboardHeight}>
          <ChatAssistantPanel onClose={() => setChatOpen(false)} />
        </BottomSheet>
      ) : nearbyCategory ? (
        <BottomSheet key="nearby" {...sheetProps}>
          <Text style={styles.recentsTitle}>{t('places.nearbyTitle', { category: t(`places.${nearbyCategory}`) })}</Text>
          {nearbyLoading ? (
            <Text style={styles.notice}>{t('map.liveLoading')}</Text>
          ) : nearbyError ? (
            <Text style={styles.notice}>{t('places.error')}</Text>
          ) : nearbyPlaces && nearbyPlaces.length === 0 ? (
            <Text style={styles.notice}>{t('places.empty')}</Text>
          ) : (
            <ScrollView style={styles.nearbyList}>
              {nearbyPlaces?.map((place, i) => (
                <Pressable key={i} style={styles.nearbyRow} onPress={() => onPickNearbyPlace(place)} accessibilityRole="button">
                  <View style={styles.nearbyItemMain}>
                    <Text style={styles.recentItemText} numberOfLines={1}>
                      {place.name}
                    </Text>
                    <Text style={styles.nearbyAddress} numberOfLines={1}>
                      {place.address}
                    </Text>
                  </View>
                  <Text style={styles.nearbyDistance}>{t('places.distanceM', { n: place.distanceM })}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </BottomSheet>
      ) : pickedPoint ? (
        <BottomSheet key="pick" {...sheetProps}>
          <View style={styles.pickTopRow}>
            <View style={styles.pickTitleBlock}>
              <Text style={styles.pickTitle} numberOfLines={2}>
                {pickedPlace === null ? t('map.liveLoading') : (pickedPlace.name ?? pickedPlace.address ?? t('map.pickedLocation'))}
              </Text>
              {pickedPlace?.category ? (
                <Text style={styles.pickCategory} numberOfLines={1}>
                  {pickedPlace.category}
                </Text>
              ) : null}
            </View>
            <RoundButton
              icon={Star}
              label={t(pickedFavorited ? 'favorites.added' : 'favorites.add')}
              variant={pickedFavorited ? 'brand' : 'soft'}
              size={44}
              onPress={onPressPickedFavorite}
            />
            <RoundButton icon={X} label={t('map.cancel')} variant="soft" size={44} onPress={() => setPickedPoint(null)} />
          </View>
          <View style={styles.pickActionRow}>
            <Pressable style={[styles.pickActionButton, styles.pickActionButtonOrigin]} onPress={onPickOrigin} accessibilityRole="button">
              <Text style={[styles.pickActionText, styles.pickActionTextOrigin]}>{t('map.setAsOrigin')}</Text>
            </Pressable>
            <Pressable style={[styles.pickActionButton, styles.pickActionButtonDestination]} onPress={onPickDestination} accessibilityRole="button">
              <Text style={[styles.pickActionText, styles.pickActionTextDestination]}>{t('map.setAsDestination')}</Text>
            </Pressable>
            <Pressable style={styles.pickShareButton} onPress={onSharePicked} accessibilityRole="button">
              <Icon icon={Share2} size={16} color={colors.ink} />
              <Text style={styles.pickActionText}>{t('map.share')}</Text>
            </Pressable>
          </View>
          {pickedPlace?.name && pickedPlace.address ? (
            <View style={styles.pickAddressRow}>
              <Icon icon={MapPin} size={14} color={colors.muted} />
              <Text style={styles.pickAddressText} numberOfLines={1}>
                {pickedPlace.address}
              </Text>
            </View>
          ) : null}
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
          {displayInstructions.length > 0 && (
            <View style={styles.instructions}>
              <Text style={styles.instructionsTitle}>{t('map.detailedRoute')}</Text>
              {displayInstructions.map((text, i) => (
                <Text key={i} style={styles.instructionStep}>
                  {i + 1}. {text}
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
            onPreview={(option) => showTransitRoute(mapRef.current, option)}
            onStart={onStartTransitGuidance}
            t={t}
          />
        </BottomSheet>
      ) : searched && !liveError && !routeFetchFailed ? (
        <BottomSheet key="notice" draggable={false} {...sheetProps}>
          <Text style={styles.notice}>{t('map.noDestination')}</Text>
        </BottomSheet>
      ) : favoriteCategoryView ? (
        <BottomSheet key="favorite-category" {...sheetProps}>
          <View style={styles.pickTopRow}>
            <Text style={[styles.recentsTitle, styles.favoriteCategoryTitle]} numberOfLines={1}>
              {t('places.favoriteCategoryTitle', { category: favoriteCategoryView })}
            </Text>
            <RoundButton icon={X} label={t('map.cancel')} variant="soft" size={44} onPress={closeFavoriteCategoryView} />
          </View>
          {favoriteCategoryPlaces && favoriteCategoryPlaces.length === 0 ? (
            <Text style={styles.notice}>{t('places.empty')}</Text>
          ) : (
            <ScrollView style={styles.nearbyList}>
              {favoriteCategoryPlaces?.map((place) => (
                <Pressable key={place.id} style={styles.nearbyRow} onPress={() => onPickFavoritePlace(place)} accessibilityRole="button">
                  <View style={styles.nearbyItemMain}>
                    <Text style={styles.recentItemText} numberOfLines={1}>
                      {place.label}
                    </Text>
                    {!!place.address_text && (
                      <Text style={styles.nearbyAddress} numberOfLines={1}>
                        {place.address_text}
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </BottomSheet>
      ) : hasPopularSheet ? (
        <BottomSheet key="popular" {...sheetProps}>
          <View style={styles.popularTabBar}>
            <Pressable
              style={[styles.popularTab, popularTab === 'nearby' && styles.popularTabActive]}
              onPress={() => setPopularTab('nearby')}
              accessibilityRole="button"
              aria-selected={popularTab === 'nearby'}
            >
              <Icon icon={Compass} size={15} color={popularTab === 'nearby' ? colors.surface : colors.muted} />
              <Text style={[styles.popularTabText, popularTab === 'nearby' && styles.popularTabTextActive]}>
                {t('places.popularNearby')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.popularTab, popularTab === 'trending' && styles.popularTabActive]}
              onPress={() => setPopularTab('trending')}
              accessibilityRole="button"
              aria-selected={popularTab === 'trending'}
            >
              <Icon icon={TrendingUp} size={15} color={popularTab === 'trending' ? colors.surface : colors.muted} />
              <Text style={[styles.popularTabText, popularTab === 'trending' && styles.popularTabTextActive]}>
                {t('places.popularTrending')}
              </Text>
            </Pressable>
          </View>
          {popularTab === 'nearby' ? (
            popularPlaces && popularPlaces.length > 0 ? (
              <View style={styles.popularGrid}>
                {popularPlaces.map((place, i) => (
                  <Pressable
                    key={`${place.label}-${place.lat}-${place.lon}`}
                    style={styles.popularCard}
                    onPress={() => onPickPopularPlace(place)}
                    accessibilityRole="button"
                  >
                    <View style={styles.popularRankBadge}>
                      <Text style={styles.popularRankText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.popularCardLabel} numberOfLines={2}>
                      {place.label}
                    </Text>
                    <Text style={styles.popularCardAddress} numberOfLines={1}>
                      {place.address_text}
                    </Text>
                    <View style={styles.popularHashtag}>
                      <Text style={styles.popularHashtagText} numberOfLines={1}>
                        #{describePlace(place.label)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.notice}>{t('places.empty')}</Text>
            )
          ) : (
            <>
              <View style={styles.popularGrid}>
                {PLACEHOLDER_TRENDS.map((item) => (
                  <View key={item.id} style={styles.popularCard}>
                    <View style={styles.trendCategoryRow}>
                      <Icon icon={TREND_ICON[item.category]} size={14} color={colors.brand} />
                      <Text style={styles.trendCategoryText}>{t(`places.trendCategory.${item.category}`)}</Text>
                    </View>
                    <Text style={styles.popularCardLabel} numberOfLines={2}>
                      {t(`places.trendItems.${item.id}.name`)}
                    </Text>
                    <Text style={styles.popularCardAddress} numberOfLines={1}>
                      {t(`places.trendItems.${item.id}.region`)}
                    </Text>
                    <View style={styles.popularHashtag}>
                      <Text style={styles.popularHashtagText} numberOfLines={2}>
                        #{t(`places.trendItems.${item.id}.description`)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={styles.trendDisclaimer}>{t('places.trendDisclaimer')}</Text>
            </>
          )}
        </BottomSheet>
      ) : null}
      {/* 경로 실패는 하단 한 줄로는 놓치기 쉬워 웹·앱 모두 가운데 팝업으로 알린다. */}
      <Modal visible={liveError} transparent animationType="fade" statusBarTranslucent onRequestClose={closeLiveError}>
        <View style={styles.errorBackdrop}>
          <View style={styles.errorDialog} accessibilityViewIsModal accessibilityRole="alert">
            <Text style={styles.errorText}>{t('map.liveError')}</Text>
            <View style={styles.errorActions}>
              <Pressable style={styles.errorButton} onPress={closeLiveError} accessibilityRole="button">
                <Text style={styles.errorButtonText}>{t('common.close')}</Text>
              </Pressable>
              <Pressable
                style={[styles.errorButton, styles.errorButtonPrimary]}
                onPress={onSearch}
                accessibilityRole="button"
              >
                <Text style={[styles.errorButtonText, styles.errorButtonTextPrimary]}>{t('nav.retry')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  devVisionTestButton: { alignSelf: 'flex-start', backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4 },
  devVisionTestText: { color: 'white', fontSize: 12, fontWeight: '700' },
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
  fabWrap: { alignSelf: 'flex-end', gap: space.sm },
  notice: { fontSize: 14, lineHeight: 20, color: colors.muted },
  errorBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  errorDialog: { width: '100%', maxWidth: 360, gap: space.lg, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  errorText: { fontSize: 16, lineHeight: 23, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: space.sm },
  errorButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  errorButtonPrimary: { backgroundColor: colors.brand },
  errorButtonText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  errorButtonTextPrimary: { color: colors.surface },
  pickTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pickTitleBlock: { flex: 1, minWidth: 0, gap: 2 },
  pickTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, lineHeight: 22 },
  pickCategory: { fontSize: 13, color: colors.muted },
  pickActionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  pickActionButton: { flex: 1, minHeight: 44, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pickActionButtonOrigin: { borderColor: colors.guide, backgroundColor: colors.surface },
  pickActionButtonDestination: { borderColor: colors.dangerStrong, backgroundColor: colors.surface },
  pickActionText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  pickActionTextOrigin: { color: colors.guide },
  pickActionTextDestination: { color: colors.dangerStrong },
  pickShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pickAddressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  pickAddressText: { flex: 1, minWidth: 0, fontSize: 13, color: colors.muted },
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
  categoryRow: { gap: space.sm, paddingVertical: space.xs },
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
  favoriteCategoryTitle: { flex: 1 },
  recentItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.xs },
  recentItemText: { fontSize: 15, color: colors.ink },
  nearbyList: { maxHeight: 360 },
  nearbyRow: { minHeight: 52, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs, paddingVertical: space.xs },
  nearbyItemMain: { flex: 1, minWidth: 0, gap: 2 },
  nearbyAddress: { fontSize: 12, color: colors.muted },
  nearbyDistance: { fontSize: 13, fontWeight: '700', color: colors.muted },
  popularTabBar: { flexDirection: 'row', backgroundColor: colors.paper, borderRadius: radius.pill, padding: 4, gap: 4 },
  popularTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: radius.pill },
  popularTabActive: { backgroundColor: colors.brand, boxShadow: shadow.card },
  popularTabText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  popularTabTextActive: { color: colors.surface },
  popularGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.xs },
  popularCard: {
    width: '47%',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: space.md,
    gap: 4,
  },
  popularRankBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  popularRankText: { fontSize: 12, fontWeight: '800', color: colors.surface },
  popularCardLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  popularCardAddress: { fontSize: 11, color: colors.muted },
  popularHashtag: {
    alignSelf: 'flex-start',
    marginTop: 4,
    maxWidth: '100%',
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  popularHashtagText: { fontSize: 11, fontWeight: '600', color: colors.brand },
  trendCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trendCategoryText: { fontSize: 11, fontWeight: '700', color: colors.brand },
  trendDisclaimer: { fontSize: 11, color: colors.muted, marginTop: space.xs },
});
