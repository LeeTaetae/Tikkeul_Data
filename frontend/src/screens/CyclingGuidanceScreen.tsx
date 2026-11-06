import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Bike, Crosshair } from 'lucide-react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { speaker } from '../lib/speech/speaker';
import { useTranslation } from 'react-i18next';

import { NavBottomPanel } from '../components/navigation/NavBottomPanel';
import { NavStatus } from '../components/navigation/NavStatus';
import { TurnCard } from '../components/navigation/TurnCard';
import { Card } from '../components/ui/Card';
import { Icon } from '../components/ui/Icon';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { RoundButton } from '../components/ui/RoundButton';
import { VisionHazardController } from '../components/vision/VisionHazardController';
import { displayEta } from '../lib/navigation/guidanceDisplay';
import { RIDE_POLICY, toNavRoute, type LatLng, type NavRoute } from '../lib/navigation/guidanceEngine';
import { clearRideRequest, getRideRequest } from '../lib/navigation/guidanceSession';
import { cyclingGuides } from '../lib/navigation/rideGuidance';
import { useProtectionZoneStatus } from '../lib/navigation/useProtectionZoneStatus';
import { rideGpsStatus, useRideMapFollow } from '../lib/navigation/useRideMap';
import { useGuidanceTracking } from '../lib/navigation/useGuidanceTracking';
import { useTurnInstructionSpeech } from '../lib/useTurnInstructionSpeech';
import { KakaoMap } from '../map/KakaoMap';
import { fetchModeRoute, type StyledRoute } from '../map/navigationApi';
import type { KakaoMapHandle } from '../map/types';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../theme';

// 자동 재탐색이 연달아 이만큼 실패하면 더 부르지 않고 사용자가 직접 "다시 탐색"을 누르게 한다(무한 재시도 방지).
const MAX_AUTO_REROUTE_FAILURES = 3;
// 자전거는 도보(3)보다 조금 넓게 본다(카카오 level: 작을수록 확대)
const FOLLOW_LEVEL = 4;

type RerouteState = 'idle' | 'loading' | 'failed';

let routeSeq = 0;
const newRouteId = () => `cycling-${Date.now()}-${++routeSeq}`;

// 카카오 자전거 응답에는 회전 안내 지점이 없어서, 좌표가 있는 안내 문구를 안내 지점으로 바꿔 쓴다(rideGuidance.cyclingGuides).
// NavRoute.mode 는 정책 선택에 쓰이지 않고(policy 가 우선), ITS 돌발정보·과속 경고 같은 자동차 전용 기능은 이 화면이 쓰지 않는다.
// 보호구역 상태만 useProtectionZoneStatus 로 가볍게 받아 전방 비전 민감도에 쓴다.
const toCyclingRoute = (styled: StyledRoute): NavRoute => ({
  ...toNavRoute(styled, 'walking', newRouteId()),
  policy: RIDE_POLICY.cycling,
  guides: cyclingGuides(styled.path, styled.instructions),
});

// 자전거 길안내. 홈에서 고른 자전거 경로를 그대로 받아(guidanceSession) GPS 로 진행·회전 안내·이탈 재탐색·도착을 처리한다.
// 지도는 모바일 WebView 카카오맵이라 네이티브 모듈이 필요 없다.
export function CyclingGuidanceScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();

  const requestRef = useRef(getRideRequest());
  const mapRef = useRef<KakaoMapHandle>(null);
  const aliveRef = useRef(true);
  const reroutingRef = useRef(false);
  const endedRef = useRef(false);
  const failuresRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [following, setFollowing] = useState(true);
  const [rerouteState, setRerouteState] = useState<RerouteState>('idle');
  const [panelHeight, setPanelHeight] = useState(0);
  const [route, setRoute] = useState<NavRoute | null>(() => {
    const request = requestRef.current;
    return request?.mode === 'cycling' && request.cycling.path.length >= 2 ? toCyclingRoute(request.cycling) : null;
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 이탈이 확정되면 현재 위치에서 같은 목적지로 다시 탐색한다. 실패하면 기존 경로를 그대로 둔다.
  const reroute = async (from: LatLng, manual: boolean) => {
    const destination = requestRef.current?.destination;
    if (!destination || reroutingRef.current || endedRef.current) return;
    if (!manual && failuresRef.current >= MAX_AUTO_REROUTE_FAILURES) return;
    reroutingRef.current = true;
    setRerouteState('loading');
    try {
      const styled = (await fetchModeRoute(from, destination, 'cycling', { lang: i18n.language }))?.[0];
      // 응답을 기다리는 사이 안내를 끝냈으면 새 경로로 되살리지 않는다(위치 추적이 다시 켜진다).
      if (!aliveRef.current || endedRef.current) return;
      if (!styled || styled.path.length < 2) {
        failuresRef.current++;
        setRerouteState('failed');
        return;
      }
      failuresRef.current = 0;
      setRerouteState('idle');
      setRoute(toCyclingRoute(styled));
    } finally {
      reroutingRef.current = false;
    }
  };

  const view = useGuidanceTracking({ route, enabled: focused && route !== null, onReroute: (fix) => reroute({ lat: fix.lat, lng: fix.lng }, false) });
  const { snapshot, position } = view;
  const arrived = view.phase === 'arrived';
  const visionEnabled = focused && route !== null && position !== null && !arrived;
  const inProtectionZone = useProtectionZoneStatus(route, snapshot?.progressM ?? 0, visionEnabled);

  // 음성 안내: 좌표가 있는 안내 문구를 그 지점에 가까워질 때 한 번씩 읽는다(자동차 길안내와 같은 훅).
  const speechRoute = useMemo(() => (route ? { id: route.id, points: route.path.map((p) => ({ latitude: p.lat, longitude: p.lng })) } : null), [route]);
  useTurnInstructionSpeech({
    active: focused && route !== null && position !== null && !arrived,
    routeKey: route?.id ?? '',
    route: speechRoute,
    instructions: route?.instructions ?? [],
    guides: route?.guides,
    source: 'cycling',
    progressM: snapshot?.progressM ?? 0,
    language: i18n.language,
  });
  // 재탐색으로 경로가 바뀌거나 화면을 떠나면 읽던 음성을 멈춘다.
  useEffect(() => () => void speaker.stop('reroute-or-unmount'), [route?.id]);
  useEffect(() => {
    if (!focused) void speaker.stop('screen-blur');
  }, [focused]);

  useEffect(() => {
    if (!mapReady) return;
    if (!route) {
      mapRef.current?.clearRoute();
      mapRef.current?.setDestination(null);
      return;
    }
    // 현재 위치를 이미 알면 지도를 옮기지 않는다(재탐색 중 자동 추적을 방해하지 않게).
    mapRef.current?.showRoute(route.path, { fit: !position, style: 'overview' });
    mapRef.current?.setDestination(route.path[route.path.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, route]);

  useRideMapFollow({ mapRef, mapReady, position, following, level: FOLLOW_LEVEL });

  const onEnd = () => {
    void speaker.stop('guidance-end');
    endedRef.current = true;
    clearRideRequest();
    setRoute(null); // 경로가 없으면 위치 구독이 해제된다
    router.navigate('/');
  };

  const gps = rideGpsStatus(view);
  const offRoute = snapshot?.status === 'offRoute';
  const status: { message: string; tone: 'info' | 'warn'; actionLabel?: string; onAction?: () => void } | null = (() => {
    if (arrived || !route) return null;
    if (gps?.tone === 'warn') return { message: t(gps.key), tone: 'warn', actionLabel: gps.retry ? t('nav.gpsRetry') : undefined, onAction: gps.retry ? view.retry : undefined };
    if (offRoute) {
      if (rerouteState === 'loading') return { message: t('nav.rerouting'), tone: 'warn' };
      if (rerouteState === 'failed' && position) {
        return {
          message: t('nav.rerouteFailed'),
          tone: 'warn',
          actionLabel: t('nav.rerouteRetry'),
          onAction: () => {
            failuresRef.current = 0;
            void reroute({ lat: position.lat, lng: position.lng }, true);
          },
        };
      }
      return { message: t('nav.offRoute'), tone: 'warn' };
    }
    if (rerouteState === 'loading') return { message: t('nav.rerouting'), tone: 'info' };
    if (gps) return { message: t(gps.key), tone: gps.tone };
    return null;
  })();

  // 하단 값: 위치를 받기 전에는 경로 전체 값으로 보여준다. 도착 시각은 기기 시계 기준이고 교통을 반영하지 않는다.
  const remainingM = snapshot?.remainingM ?? route?.distanceM ?? null;
  const etaSec = snapshot ? snapshot.eta?.remainingSec : route?.durationSec;
  const eta = etaSec === undefined ? null : displayEta(etaSec, Date.now());
  const compact = windowHeight < 700;

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} autoLocate={false} onUserPan={() => setFollowing(false)} onReady={() => setMapReady(true)} />
      </View>

      {/* 전방 비전 경고(ADR 0002). 화면엔 카메라를 띄우지 않고 배너·진동만 낸다. */}
      <VisionHazardController
        enabled={visionEnabled}
        inProtectionZone={inProtectionZone}
        speedKmh={snapshot?.speedMps != null ? snapshot.speedMps * 3.6 : null}
      />

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.column}>
          {route ? (
            <>
              <View style={styles.badge}>
                <Icon icon={Bike} size={16} color={colors.brand} />
                <Text style={styles.badgeText}>
                  {t('ride.cyclingTitle')} · {t('map.guiding')}
                </Text>
              </View>
              {!arrived && <TurnCard turn={snapshot?.nextTurn ?? null} />}
            </>
          ) : (
            <Card>
              <Text style={styles.text} accessibilityRole="alert">
                {t('nav.noRequest')}
              </Text>
              <View style={styles.row}>
                <PrimaryButton label={t('nav.goHome')} onPress={() => router.navigate('/')} />
              </View>
            </Card>
          )}
          {status && <NavStatus message={status.message} tone={status.tone} actionLabel={status.actionLabel} onAction={status.onAction} />}
        </View>
      </View>

      {route && (
        <>
          <View style={[styles.fabLayer, { bottom: insets.bottom + space.md + panelHeight + space.sm }]}>
            <View style={styles.column}>
              <View style={styles.fabWrap}>
                <RoundButton icon={Crosshair} label={t('map.myLocation')} variant={following ? 'brand' : 'surface'} onPress={() => setFollowing(true)} />
              </View>
            </View>
          </View>

          <View style={[styles.bottom, { bottom: insets.bottom + space.md }]}>
            <View style={styles.column}>
              <NavBottomPanel
                destinationLabel={requestRef.current?.destinationLabel}
                compact={compact}
                remainingM={remainingM}
                etaMinutes={eta?.minutes ?? null}
                arrivalAtMs={eta?.arrivalAtMs ?? null}
                fraction={snapshot?.fraction ?? 0}
                arrived={arrived}
                hazardNotice={null}
                onEnd={onEnd}
                onLayout={(e: LayoutChangeEvent) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
              />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  mapLayer: { ...StyleSheet.absoluteFill, zIndex: 0 },
  // 빈 곳은 터치를 지도로 통과시킨다(box-none). 안 하면 지도 드래그가 막힌다.
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  bottom: { position: 'absolute', left: 0, right: 0, zIndex: 2, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  fabLayer: { position: 'absolute', left: 0, right: 0, zIndex: 4, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space.sm, pointerEvents: 'box-none' },
  fabWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  text: { fontSize: 15, lineHeight: 22, color: colors.ink, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, minHeight: 32, borderRadius: radius.pill, backgroundColor: colors.surface },
  badgeText: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
