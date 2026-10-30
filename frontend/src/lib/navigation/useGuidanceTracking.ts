import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

import { classifyPermission, classifyPositionError, type LocationFailure } from '../location/failure';
import { webUnsupported } from '../location/useUserLocation';
import {
  createGuidanceTracker,
  IDLE_VIEW,
  type Fix,
  type GuidanceTracker,
  type LocationPort,
  type NavRoute,
  type TrackingView,
} from './guidanceEngine';

const SIGNAL_CHECK_MS = 2000;

// expo-location 을 엔진이 쓰는 LocationPort 로 감싼다. 웹은 브라우저 watchPosition 으로 동작한다.
// 네이티브의 오류 문자열 분류는 실기기에서 확인하지 못했다(failure.ts 의 classifyPositionError 참고).
const expoPort: LocationPort = {
  async ensurePermission() {
    if (webUnsupported()) return 'unsupported'; // 브라우저 미지원·HTTPS 아님
    let permission: Location.LocationPermissionResponse | null = null;
    try {
      permission = await Location.getForegroundPermissionsAsync();
    } catch {
      // 웹에서 Permissions API 가 없는 브라우저 등: 아직 정하지 않은 것으로 보고 아래에서 요청한다.
    }
    if (permission && classifyPermission(permission) === 'granted') return 'granted';

    // 안내 시작은 사용자가 직접 누른 동작이라 여기서 권한을 요청한다. GPS 가 꺼져 있으면 요청해도 소용없어 먼저 알린다.
    if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) return 'servicesDisabled';
    const kind = classifyPermission(await Location.requestForegroundPermissionsAsync());
    if (kind === 'granted') return 'granted';
    return kind === 'permanentlyDenied' ? 'permanentlyDenied' : 'denied';
  },

  async watch(onFix, onError) {
    try {
      return await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 },
        (position) =>
          onFix({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyM: position.coords.accuracy ?? null,
            timestampMs: position.timestamp,
          }),
        (message) => onError(classifyPositionError({ message })),
      );
    } catch (error) {
      throw classifyPositionError(error) satisfies LocationFailure;
    }
  },
};

interface Options {
  /** 안내할 경로. 재탐색한 경로는 새 id 를 달아 넘긴다(이전 진행 상태가 새 경로에 적용되지 않는다) */
  route: NavRoute | null;
  /** true 인 동안만 위치를 추적한다. false 가 되면 구독을 해제한다 */
  enabled: boolean;
  /** 위치 소스를 바꿔 끼운다(개발용 가상 GPS 재생). 생략하면 expo-location. 훅이 처음 만들어질 때 값이 아니라 매 구독 시작 때 읽는다 */
  port?: LocationPort;
  /** 이탈이 확정되면 한 번 불린다. 새 경로를 받아 route 를 바꿔 주면 된다. 끝나면(성공·실패) 요청 중 표시는 자동으로 풀린다 */
  onReroute?: (fix: Fix, route: NavRoute) => Promise<unknown> | void;
}

/**
 * 길안내용 실시간 GPS 추적. 판정 로직은 guidanceEngine 에 있고 이 훅은 구독 수명만 이어 준다.
 * 같은 화면에서 getCurrentPosition 폴링을 따로 돌리지 말고 이 훅의 snapshot.progressM 을 쓴다.
 */
export function useGuidanceTracking({ route, enabled, onReroute, port }: Options): TrackingView & { retry: () => void } {
  const [view, setView] = useState<TrackingView>(IDLE_VIEW);
  const onRerouteRef = useRef(onReroute);
  onRerouteRef.current = onReroute;
  const portRef = useRef(port);
  portRef.current = port;

  const trackerRef = useRef<GuidanceTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createGuidanceTracker({
      // 구독을 시작할 때마다 그 시점의 port 를 쓴다.
      port: {
        ensurePermission: () => (portRef.current ?? expoPort).ensurePermission(),
        watch: (onFix, onError) => (portRef.current ?? expoPort).watch(onFix, onError),
      },
      onChange: setView,
      onReroute: (fix, current) => onRerouteRef.current?.(fix, current),
    });
  }
  const tracker = trackerRef.current;

  // 경로·활성 여부가 바뀔 때마다 맞춘다. 비활성이면 구독을 해제한다.
  useEffect(() => {
    tracker.sync(enabled ? route : null);
  }, [tracker, enabled, route]);

  // 화면이 사라지면 구독을 해제한다.
  useEffect(() => () => tracker.stop(), [tracker]);

  // 백그라운드에서는 구독을 끊고, 돌아오면 다시 잇는다.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') tracker.resume();
      else tracker.pause();
    });
    return () => subscription.remove();
  }, [tracker]);

  // 새 위치가 한동안 안 오면 신호 끊김으로 알린다.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => tracker.checkSignal(), SIGNAL_CHECK_MS);
    return () => clearInterval(id);
  }, [tracker, enabled]);

  // 권한 거부·GPS 꺼짐 같은 실패 뒤에 사용자가 다시 시도할 때 쓴다(구독이 없을 때만 다시 시작한다).
  const retry = useCallback(() => tracker.resume(), [tracker]);

  return useMemo(() => ({ ...view, retry }), [view, retry]);
}
