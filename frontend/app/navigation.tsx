import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Crosshair } from 'lucide-react-native';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';

import { NavigationHazardAlert } from '../src/components/alerts/NavigationHazardAlert';
import { HazardRail, RAIL_ITEM_HEIGHT, RAIL_ITEM_HEIGHT_COMPACT, RAIL_OVERFLOW_HEIGHT } from '../src/components/navigation/HazardRail';
import { NavBottomPanel } from '../src/components/navigation/NavBottomPanel';
import { NavStatus } from '../src/components/navigation/NavStatus';
import { TurnCard } from '../src/components/navigation/TurnCard';
import { Card } from '../src/components/ui/Card';
import { RoundButton } from '../src/components/ui/RoundButton';
import { createReplayPort, replayFixes, replayRerouteFrom } from '../src/dev/guidanceReplay';
import { MOCK_ROUTE_A } from '../src/dev/mockRoute';
import { RAIL_TEST_SAMPLES, TEST_INSTRUCTIONS, TEST_SCHOOL_ZONES, TEST_SPEED_BUMPS } from '../src/dev/railSamples';
import { TTS_TEST_ALERTS, TTS_TEST_INSTRUCTIONS, TTS_TEST_PATH, TTS_TEST_SPEED_BUMPS, TTS_TEST_ZONES } from '../src/dev/ttsScenario';
import { fitVisible, overflowFits, splitRail } from '../src/lib/hazardRail';
import { displayEta } from '../src/lib/navigation/guidanceDisplay';
import type { LatLng, NavRoute, TrackingView } from '../src/lib/navigation/guidanceEngine';
import { toNavRoute } from '../src/lib/navigation/guidanceEngine';
import { clearGuidanceRequest, getGuidanceRequest, type GuidanceRequest } from '../src/lib/navigation/guidanceSession';
import { useGuidanceTracking } from '../src/lib/navigation/useGuidanceTracking';
import { useRouteHazardWarning } from '../src/lib/navigation/useRouteHazardWarning';
import { dedupeSpokenInstructions } from '../src/lib/navigation/speechInstructions';
import { useRouteSpeedBumps } from '../src/lib/navigation/useRouteSpeedBumps';
import { useSpeedBumpSpeech } from '../src/lib/useSpeedBumpSpeech';
import { useSpeedingWarning } from '../src/lib/useSpeedingWarning';
import { useTurnInstructionSpeech } from '../src/lib/useTurnInstructionSpeech';
import { KakaoMap } from '../src/map/KakaoMap';
import { fetchGuidanceRoute } from '../src/map/navigationApi';
import type { KakaoMapHandle } from '../src/map/types';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../src/theme';

// 자동 재탐색이 연달아 이만큼 실패하면 더 부르지 않고 사용자가 직접 "다시 탐색"을 누르게 한다(무한 재시도 방지).
const MAX_AUTO_REROUTE_FAILURES = 3;
// 길안내 시작 시 지도 확대 수준(카카오 level: 작을수록 확대)
const FOLLOW_LEVEL = 3;
// 새 위험 경고가 음성으로 읽히는 동안(대략 이 시간) 일반 안내(턴·방지턱·과속)는 읽지 않고 기다린다. 경고가 우선이다.
// 기다린 안내는 아직 지나치지 않았다면 이 시간이 지난 뒤 읽힌다(훅이 읽은 지점으로 기록하지 않았기 때문).
const ALERT_SPEECH_QUIET_MS = 3500;

type Status = 'noRequest' | 'loading' | 'error' | 'ready';
type RerouteState = 'idle' | 'loading' | 'failed';

const GPS_FAILURE_TEXT: Record<string, string> = {
  denied: 'nav.gpsDenied',
  permanentlyDenied: 'nav.gpsPermanentlyDenied',
  servicesDisabled: 'nav.gpsServicesDisabled',
  unsupported: 'nav.gpsUnsupported',
  unavailable: 'nav.gpsUnavailable',
  timeout: 'nav.gpsUnavailable',
};

interface StatusInfo {
  key: string;
  tone: 'info' | 'warn';
  actionKey?: string;
  onAction?: () => void;
}

// 개발용 가상 경로의 가짜 안내 지점(실제 TMAP 응답이 아니다). 방향 아이콘 확인용: 우회전(13)·미확인 코드(16, 일반 안내로 보여야 한다)·U턴(14)·도착.
const TEST_GUIDES: NavRoute['guides'] = MOCK_ROUTE_A.points.map((p, i, all) => {
  const base = { index: i, lat: p.latitude, lng: p.longitude, pathIndex: i, name: '', description: '', nextRoadName: '' };
  if (i === 0) return { ...base, pointType: 'S', turnType: 200 };
  if (i === 1) return { ...base, pointType: 'N', turnType: 13, nextRoadName: '테스트대로' };
  if (i === 2) return { ...base, pointType: 'N', turnType: 16, description: '8시 방향 좌회전 후 테스트로를 따라 이동 (미확인 코드)' };
  if (i === all.length - 1) return { ...base, pointType: 'E', turnType: 201 };
  return { ...base, pointType: 'N', turnType: 14, nextRoadName: '테스트길' };
});

let routeSeq = 0;
const newRouteId = () => `nav-${Date.now()}-${++routeSeq}`;

// 별도 길안내 화면. 홈에서 고른 조건(guidanceSession)으로 안내용 경로(guides 포함)를 받고, GPS 추적 결과를 지도·회전 안내·위험 경고에 반영한다.
// 탭 화면은 다른 곳으로 가도 마운트가 유지되므로, 화면이 포커스일 때만 위치를 추적한다(useIsFocused).
export default function NavigationScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ test?: string }>();
  // 개발용 가상 GPS 재생. 실제 위치·실제 경로가 아니며, 켜면 화면에 테스트 모드 표시가 뜬다.
  const scenario = __DEV__ && (params.test === 'replay' || params.test === 'offroute' || params.test === 'rerouteFail' || params.test === 'tts') ? params.test : null;
  const testRoute = useMemo<NavRoute | null>(
    () =>
      scenario
        ? {
            id: `test-${scenario}`,
            source: 'mock',
            mode: 'driving',
            path: scenario === 'tts' ? TTS_TEST_PATH : MOCK_ROUTE_A.points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
            durationSec: scenario === 'tts' ? 65 : 900,
            guides: scenario === 'tts' ? undefined : TEST_GUIDES,
            instructions: scenario === 'tts' ? TTS_TEST_INSTRUCTIONS : TEST_INSTRUCTIONS,
          }
        : null,
    [scenario],
  );
  // tts 시나리오는 실제 속도(시속 약 50km = 0.5초마다 7m)로 실시간 재생한다. 나머지는 빠르게 재생한다.
  const replayPort = useMemo(
    () =>
      testRoute && scenario
        ? scenario === 'tts'
          ? createReplayPort(replayFixes(testRoute.path, scenario, 7, 0, 500), 500)
          : createReplayPort(replayFixes(testRoute.path, scenario))
        : undefined,
    [testRoute, scenario],
  );

  const mapRef = useRef<KakaoMapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  const [following, setFollowing] = useState(true);
  const [status, setStatus] = useState<Status>('loading');
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [rerouteState, setRerouteState] = useState<RerouteState>('idle');
  const [attempt, setAttempt] = useState(0);
  // 하단 패널·위험 경고 카드의 실제 높이. 위험 경고는 패널 위에, 현재 위치 버튼은 경고 위에 올려 서로 가리지 않게 한다.
  const [panelHeight, setPanelHeight] = useState(0);
  const [alertHeight, setAlertHeight] = useState(0);
  // 위험 레일: 위쪽 카드들의 높이(레일은 그 아래에서 시작), 선택한 위험(상세 패널)
  const [topHeight, setTopHeight] = useState(0);
  const [selectedHazard, setSelectedHazard] = useState<string | null>(null);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const requestRef = useRef<GuidanceRequest | null>(null);
  // 마지막으로 불러온 (요청, 시도 횟수). 같은 값이면 탭을 갔다 와도 다시 불러오지 않는다.
  const loadedRef = useRef<{ request: GuidanceRequest | null; attempt: number } | null>(null);
  const aliveRef = useRef(true);
  const reroutingRef = useRef(false);
  const failuresRef = useRef(0);
  const firstFocusDone = useRef(false);

  // 재탐색·안내 종료로 경로가 바뀌면 열려 있던 위험 상세는 닫는다(새 경로의 위험 목록으로 다시 시작).
  useEffect(() => {
    setSelectedHazard(null);
  }, [route?.id]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 화면이 포커스를 얻을 때 새 안내 요청이 있으면 경로를 불러온다.
  useEffect(() => {
    if (!focused) return;
    const request = getGuidanceRequest();
    if (testRoute) {
      if (!route && status !== 'ready') {
        setRoute(testRoute);
        setStatus('ready');
      }
      return;
    }
    const loaded = loadedRef.current;
    if (loaded && loaded.request === request && loaded.attempt === attempt) return;
    const token = { request, attempt };
    loadedRef.current = token;
    requestRef.current = request;
    failuresRef.current = 0;
    firstFocusDone.current = false;
    setFollowing(true);
    setRerouteState('idle');
    setRoute(null);
    if (!request) {
      setStatus('noRequest');
      return;
    }
    setStatus('loading');
    fetchGuidanceRoute(request.origin, request.destination, request.mode, request.style).then((styled) => {
      if (!aliveRef.current || loadedRef.current !== token) return; // 화면이 닫혔거나 더 새 요청이 있다
      // 실패하면 가짜 경로로 채우지 않고 오류를 보여준다. guides 가 없어도(undefined) 경로 자체는 안내에 쓴다.
      if (!styled || styled.path.length < 2) return setStatus('error');
      setRoute(toNavRoute(styled, request.mode, newRouteId(), 'api'));
      setStatus('ready');
    });
  }, [focused, attempt, testRoute, route, status]);

  // 이탈이 확정되면 현재 위치에서 같은 목적지·이동수단·스타일로 다시 탐색한다. 실패하면 기존 경로를 그대로 둔다.
  const viewRef = useRef<TrackingView | null>(null);
  const reroute = async (from: LatLng, current: NavRoute, manual: boolean) => {
    if (reroutingRef.current) return; // 이미 재탐색 중
    if (!manual && failuresRef.current >= MAX_AUTO_REROUTE_FAILURES) return;
    reroutingRef.current = true;
    setRerouteState('loading');
    try {
      let next: NavRoute | null = null;
      if (current.source === 'mock') {
        // 개발용 가상 재탐색. rerouteFail 시나리오는 일부러 실패시킨다.
        if (scenario !== 'rerouteFail') next = { ...current, id: newRouteId(), path: replayRerouteFrom(from, current.path) };
      } else if (requestRef.current) {
        const { destination, style } = requestRef.current;
        const styled = await fetchGuidanceRoute(from, destination, current.mode, style);
        if (styled && styled.path.length >= 2) next = toNavRoute(styled, current.mode, newRouteId(), 'api');
      }
      // 화면이 닫혔거나 그 사이 도착했다면 결과를 버린다.
      if (!aliveRef.current || viewRef.current?.phase === 'arrived') return;
      if (!next) {
        failuresRef.current++;
        setRerouteState('failed');
        return;
      }
      failuresRef.current = 0;
      setRerouteState('idle');
      setRoute(next);
    } catch {
      failuresRef.current++;
      if (aliveRef.current) setRerouteState('failed');
    } finally {
      reroutingRef.current = false;
    }
  };

  const view = useGuidanceTracking({
    route,
    enabled: focused && status === 'ready' && route !== null,
    onReroute: (fix, current) => reroute({ lat: fix.lat, lng: fix.lng }, current, false),
    port: replayPort,
  });
  viewRef.current = view;
  const { snapshot, position } = view;
  const arrived = view.phase === 'arrived';

  // 경로 기반 위험 경고. 위치를 받아 진행 중일 때만 켠다(재탐색 중에도 위치는 남아 있어 경고 이력이 유지된다).
  const hazard = useRouteHazardWarning({
    route,
    progressM: snapshot?.progressM ?? 0,
    active: status === 'ready' && position !== null && !arrived,
    position: position ? { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM } : null,
    speedMps: snapshot?.speedMps ?? null,
    sampleAlerts: route?.source === 'mock' ? (scenario === 'tts' ? TTS_TEST_ALERTS : RAIL_TEST_SAMPLES) : undefined,
    sampleZoneAlerts: route?.source === 'mock' ? (scenario === 'tts' ? TTS_TEST_ZONES : TEST_SCHOOL_ZONES) : undefined,
  });

  // 음성 안내(팀 main 의 TTS 훅을 그대로 재사용). 길안내 중(첫 위치를 받은 뒤, 도착 전)이고 화면이 포커스일 때만 켠다.
  // routeKey 는 경로 id 라서, 재탐색으로 새 경로가 오면 훅 안의 "이미 읽은 지점" 기록이 비워진다.
  const speechActive = focused && status === 'ready' && position !== null && !arrived;
  const speechProgressM = snapshot?.progressM ?? 0;
  const speechRouteKey = route?.id ?? '';
  const apiSpeedBumps = useRouteSpeedBumps(route?.source === 'api' ? route.path : null);
  // 읽을 턴 안내: 같은 위치·같은 거리의 "도로명, 거리" 요약 줄(직전 턴 문구와 같은 뜻)만 뺀다. 문구는 원문 그대로다.
  const speechInstructions = useMemo(() => dedupeSpokenInstructions(route?.instructions ?? []), [route]);

  // 위험 경고 음성이 우선이다. 새 경고(위험·단계가 바뀔 때)가 뜨면 잠시 일반 안내를 보류해, 경고와 일반 안내가 같은 순간에 겹쳐 읽히거나
  // 서로 끊기지 않게 한다. 일반 안내 훅은 active 가 꺼진 동안 "읽은 지점"으로 기록하지 않으므로 보류된 안내는 나중에 읽힌다.
  const alertSpeechKey = hazard.warning ? `${hazard.warning.alert.eventKey || hazard.warning.alert.id}:${hazard.warning.stage}` : '';
  const alertQuietUntil = useRef(0);
  const lastAlertSpeechKey = useRef('');
  if (alertSpeechKey !== lastAlertSpeechKey.current) {
    lastAlertSpeechKey.current = alertSpeechKey;
    if (alertSpeechKey) alertQuietUntil.current = Date.now() + ALERT_SPEECH_QUIET_MS;
  }
  const generalSpeechActive = speechActive && Date.now() >= alertQuietUntil.current;

  useTurnInstructionSpeech({ active: generalSpeechActive, routeKey: speechRouteKey, route: hazard.hazardRoute, instructions: speechInstructions, progressM: speechProgressM, language: i18n.language });
  useSpeedBumpSpeech({ active: generalSpeechActive, routeKey: speechRouteKey, route: hazard.hazardRoute, bumps: route?.source === 'mock' ? (scenario === 'tts' ? TTS_TEST_SPEED_BUMPS : TEST_SPEED_BUMPS) : apiSpeedBumps, progressM: speechProgressM });
  // 속도는 엔진이 최근 위치로 추정한 값(m/s → km/h). 모르면 null 이라 과속 경고를 내지 않는다(팀 정책과 같다).
  useSpeedingWarning({ active: generalSpeechActive, routeKey: speechRouteKey, route: hazard.hazardRoute, zones: hazard.zoneOnRoute, progressM: speechProgressM, speedKmh: snapshot?.speedMps != null ? snapshot.speedMps * 3.6 : null });

  // 재탐색으로 새 경로가 오면 이전 경로의 읽는 중·대기 중 음성을 모두 취소한다(새 경로의 안내만 읽도록). 처음 경로를 받을 때는 취소하지 않는다.
  const lastSpeechRouteId = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastSpeechRouteId.current;
    lastSpeechRouteId.current = route?.id ?? null;
    if (previous && route?.id && previous !== route.id) {
      alertQuietUntil.current = 0;
      void Speech.stop();
    }
  }, [route?.id]);

  // 화면을 떠나거나 닫히면 읽던 음성을 멈춘다(탭 화면은 마운트가 유지되므로 포커스를 잃을 때도).
  useEffect(() => {
    if (!focused) void Speech.stop();
  }, [focused]);
  useEffect(() => () => void Speech.stop(), []);

  // 경로: 지도가 준비되면(또는 경로가 바뀌면) 그린다. 현재 위치를 이미 알면 지도를 옮기지 않는다(재탐색 중 자동 추적을 방해하지 않게).
  useEffect(() => {
    if (!mapReady) return;
    if (!route) return mapRef.current?.clearRoute();
    mapRef.current?.showRoute(route.path, { fit: !viewRef.current?.position });
  }, [mapReady, route]);

  // 현재 위치 마커와 자동 추적. 마커·추적은 엔진이 걸러낸 위치(view.position)만 따른다.
  useEffect(() => {
    if (!mapReady) return;
    const point = position ? { lat: position.lat, lng: position.lng } : null;
    mapRef.current?.setLocationMarker(point);
    if (point && following) {
      mapRef.current?.panTo(point, firstFocusDone.current ? undefined : { level: FOLLOW_LEVEL });
      firstFocusDone.current = true;
    }
  }, [mapReady, position, following]);

  const onEnd = () => {
    void Speech.stop(); // 안내를 끝내면 읽던 음성도 멈춘다
    clearGuidanceRequest();
    loadedRef.current = null;
    requestRef.current = null;
    setRoute(null);
    setStatus('noRequest');
    router.navigate('/');
  };

  // 화면에 띄울 GPS·재탐색 상태 하나. 문제가 있는 것부터 보여주고, 정상 추적 중이면 없다.
  const gpsStatus: StatusInfo | null = (() => {
    if (arrived || status !== 'ready') return null;
    if (view.phase === 'failed') return { key: GPS_FAILURE_TEXT[view.failure ?? 'unavailable'] ?? 'nav.gpsUnavailable', tone: 'warn', actionKey: 'nav.gpsRetry', onAction: view.retry };
    if (snapshot?.status === 'offRoute') {
      if (rerouteState === 'loading') return { key: 'nav.rerouting', tone: 'warn' };
      if (rerouteState === 'failed' && position && route) {
        return {
          key: 'nav.rerouteFailed',
          tone: 'warn',
          actionKey: 'nav.rerouteRetry',
          onAction: () => {
            failuresRef.current = 0;
            reroute({ lat: position.lat, lng: position.lng }, route, true);
          },
        };
      }
      return { key: 'nav.offRoute', tone: 'warn' };
    }
    if (rerouteState === 'loading') return { key: 'nav.rerouting', tone: 'info' };
    if (view.phase === 'signalLost') return { key: 'nav.gpsSignalLost', tone: 'warn' };
    if (snapshot && !snapshot.fixUsed && snapshot.ignoredReason === 'lowAccuracy') return { key: 'nav.gpsLowAccuracy', tone: 'info' };
    if (view.phase === 'starting') return { key: 'nav.gpsStarting', tone: 'info' };
    return null;
  })();

  // 하단 값: 위치를 받기 전에는 경로 전체 값(경로 거리·소요시간)으로 보여준다. 도착 시각은 GPS 시각이 아니라 기기 시계 기준이다.
  const remainingM = snapshot?.remainingM ?? route?.distanceM ?? null;
  const etaSec = snapshot ? snapshot.eta?.remainingSec : route?.durationSec;
  const eta = etaSec === undefined ? null : displayEta(etaSec, Date.now());

  const ready = status === 'ready';
  // 가로 화면(넓고 낮음)에서는 왼쪽 열(회전 카드·상태·레일)과 오른쪽 열(경고·하단 패널)로 나눠 서로 겹치지 않게 한다.
  // 낮은 화면(세로 700px 미만 또는 가로)에서는 하단 패널과 레일 아이콘을 작게 한다. 390×844 같은 기본 화면은 그대로다.
  const sideBySide = windowWidth >= 640 && windowHeight < 560;
  const compactLayout = sideBySide || windowHeight < 700;
  const colWidth = sideBySide ? Math.min(380, Math.floor(windowWidth * 0.44)) : MAX_CONTENT_WIDTH;
  const itemHeight = compactLayout ? RAIL_ITEM_HEIGHT_COMPACT : RAIL_ITEM_HEIGHT;
  const panelH = ready ? panelHeight : 0;
  const panelTop = insets.bottom + space.md + panelH;
  const showAlert = ready && hazard.warning !== null;

  // 위험 레일: 엔진이 정한 순서 그대로, 쓸 수 있는 세로 공간에 맞춰 최대 3개 + 나머지는 +N.
  // 첫 위치를 받기 전에는 진행 거리를 몰라 위험까지 거리가 의미 없으므로 보이지 않는다.
  const railTop = topHeight + space.sm;
  // 가로 화면에서는 경고·패널이 오른쪽 열이라 레일 아래쪽을 차지하지 않는다.
  const railBottomReserve = sideBySide ? insets.bottom + space.md : panelTop + space.sm + (showAlert ? alertHeight + space.sm : 0) + space.sm;
  const railAvailable = windowHeight - railTop - railBottomReserve;
  const railCount = fitVisible(hazard.rail.length, railAvailable, itemHeight, RAIL_OVERFLOW_HEIGHT);
  const railPillFits = overflowFits(hazard.rail.length, railCount, railAvailable, itemHeight, RAIL_OVERFLOW_HEIGHT);
  const { visible: railVisible, overflow: railOverflow } = splitRail(hazard.rail, railCount);
  // 아이콘이 하나도 못 들어가면 레일을 숨긴다("+N" 만 덩그러니 남지 않게).
  const showRail = ready && !arrived && position !== null && railVisible.length > 0;
  // 선택한 위험이 지나갔거나 목록에서 빠지면 상세 패널은 저절로 닫힌다.
  const activeHazard = railVisible.some((i) => i.key === selectedHazard) ? selectedHazard : null;

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} autoLocate={false} onUserPan={() => setFollowing(false)} onReady={() => setMapReady(true)} />
      </View>

      {/* 위험 경고는 하단 패널 바로 위에 올려놓는다(NavigationHazardAlert 의 bottomOffset). */}
      {showAlert && hazard.warning && (
        <NavigationHazardAlert
          // 같은 사건·같은 단계는 문구(id 는 문구 해시)가 바뀌어도 다시 마운트되지 않게 eventKey 로 구분한다(마운트될 때 음성으로 읽기 때문)
          key={alertSpeechKey}
          align={sideBySide ? 'end' : 'center'}
          maxWidth={sideBySide ? colWidth : undefined}
          warning={hazard.warning}
          bottomOffset={Math.max(0, panelTop - space.md)}
          onHeightChange={setAlertHeight}
          onClose={hazard.dismiss}
        />
      )}

      <View style={[styles.top, { paddingTop: insets.top + space.sm }, sideBySide && styles.sideStart]} onLayout={(e: LayoutChangeEvent) => setTopHeight(Math.round(e.nativeEvent.layout.height))}>
        <View style={[styles.column, sideBySide && { maxWidth: colWidth }]}>
          {route?.source === 'mock' && (
            <View style={styles.testBanner} accessibilityRole="alert">
              <Text style={styles.testBannerText}>{t('nav.testMode')}</Text>
            </View>
          )}

          {status === 'loading' && (
            <Card>
              <Text style={styles.text} accessibilityLiveRegion="polite">
                {t('nav.loadingRoute')}
              </Text>
            </Card>
          )}

          {(status === 'error' || status === 'noRequest') && (
            <Card>
              <Text style={styles.text} accessibilityRole="alert">
                {t(status === 'error' ? 'nav.routeFailed' : 'nav.noRequest')}
              </Text>
              <View style={styles.row}>
                {status === 'error' && <ActionButton label={t('nav.retry')} onPress={() => setAttempt((n) => n + 1)} />}
                <ActionButton label={t('nav.goHome')} variant="plain" onPress={() => router.navigate('/')} />
              </View>
            </Card>
          )}

          {ready && !arrived && <TurnCard turn={snapshot?.nextTurn ?? null} />}
          {gpsStatus && (
            <NavStatus
              message={t(gpsStatus.key)}
              tone={gpsStatus.tone}
              actionLabel={gpsStatus.actionKey ? t(gpsStatus.actionKey) : undefined}
              onAction={gpsStatus.onAction}
            />
          )}
        </View>
      </View>

      {/* 위험 아이콘 레일(지도 왼쪽). 위쪽 카드 바로 아래에서 시작한다. 레일은 음성·팝업 경고를 만들지 않는다(단계 경고는 위 NavigationHazardAlert 가 따로 맡는다). */}
      {showRail && (
        <View style={[styles.railLayer, { top: railTop }, sideBySide && styles.sideStart]}>
          <View style={[styles.column, sideBySide && { maxWidth: colWidth }]}>
            <HazardRail
              items={railVisible}
              overflow={railOverflow}
              selectedKey={activeHazard}
              onSelect={setSelectedHazard}
              compact={compactLayout}
              overflowAsBadge={!railPillFits}
              detailMaxWidth={sideBySide ? 300 : undefined}
              // 상세 패널의 머리(약 64px)를 뺀 남은 높이까지만 본문을 늘린다(기본 260)
              detailMaxBodyHeight={Math.max(96, Math.min(260, railAvailable - 64))}
            />
          </View>
        </View>
      )}

      {/* 지도 조작 버튼: 하단 패널과 위험 경고 카드 위에 올려, 둘 중 어느 것도 가리지 않는다. */}
      {sideBySide ? (
        // 가로 화면: 오른쪽 열(경고·패널)의 왼쪽 옆, 패널 높이에 둔다. 경고 카드가 커져도 가려지지 않는다.
        <View style={[styles.fabSide, { right: colWidth + space.lg + space.sm, bottom: insets.bottom + space.md }]}>
          <RoundButton icon={Crosshair} label={t('map.myLocation')} variant={following ? 'brand' : 'surface'} onPress={() => setFollowing(true)} />
        </View>
      ) : (
        <View style={[styles.fabLayer, { bottom: panelTop + space.sm + (showAlert ? alertHeight + space.sm : 0) }]}>
          <View style={styles.column}>
            <View style={styles.fabWrap}>
              <RoundButton icon={Crosshair} label={t('map.myLocation')} variant={following ? 'brand' : 'surface'} onPress={() => setFollowing(true)} />
            </View>
          </View>
        </View>
      )}

      {ready && (
        <View style={[styles.bottom, { bottom: insets.bottom + space.md }, sideBySide && styles.sideEnd]}>
          <View style={[styles.column, sideBySide && { maxWidth: colWidth }]}>
            <NavBottomPanel
              compact={compactLayout}
              remainingM={remainingM}
              etaMinutes={eta?.minutes ?? null}
              arrivalAtMs={eta?.arrivalAtMs ?? null}
              fraction={snapshot?.fraction ?? 0}
              arrived={arrived}
              hazardNotice={hazard.notice}
              onEnd={onEnd}
              onLayout={(e: LayoutChangeEvent) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function ActionButton({ label, onPress, variant = 'primary' }: { label: string; onPress: () => void; variant?: 'primary' | 'plain' }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, variant === 'plain' && styles.buttonPlain, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, variant === 'plain' && styles.buttonTextPlain]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  mapLayer: { ...StyleSheet.absoluteFill, zIndex: 0 },
  // 빈 곳은 터치를 지도로 통과시킨다(box-none). 안 하면 지도 드래그가 막힌다.
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  bottom: { position: 'absolute', left: 0, right: 0, zIndex: 2, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  railLayer: { position: 'absolute', left: 0, right: 0, zIndex: 2, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  sideStart: { alignItems: 'flex-start' },
  sideEnd: { alignItems: 'flex-end' },
  fabSide: { position: 'absolute', zIndex: 4 },
  fabLayer: { position: 'absolute', left: 0, right: 0, zIndex: 4, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space.sm, pointerEvents: 'box-none' },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  text: { fontSize: 15, lineHeight: 22, color: colors.ink, fontWeight: '600' },
  testBanner: { padding: space.sm, borderRadius: radius.md, backgroundColor: colors.zone },
  testBannerText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.zoneInk },
  fabWrap: { alignSelf: 'flex-end' },
  button: { minHeight: 48, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  buttonPlain: { backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1 },
  buttonText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  buttonTextPlain: { color: colors.ink },
  pressed: { opacity: 0.85 },
});
