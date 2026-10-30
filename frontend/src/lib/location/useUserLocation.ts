import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

import { classifyPermission, classifyPositionError, LOCATION_TIMEOUT_NAME, type LocationFailure, type PermissionLike } from './failure';
import type { Coords } from './geo';

// 사용자의 실제 위치만 돌려준다. 위치를 얻지 못하면 어떤 대체 좌표도 만들지 않는다(failed 상태로 알린다).
export type LocationState =
  | { status: 'idle' } // 권한을 아직 정하지 않음: 사용자가 버튼을 눌러야 권한을 요청한다
  | { status: 'locating' }
  | { status: 'ready'; coords: Coords; /** 대략적 위치만 허용된 경우 */ coarse: boolean }
  | { status: 'failed'; reason: LocationFailure };

const TIMEOUT_MS = 15000;
// 앱이 다시 활성화될 때 위치를 다시 읽되, 너무 잦은 재시도는 막는다.
const MIN_RETRY_GAP_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: LOCATION_TIMEOUT_NAME })), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    );
  });
}

// 웹은 HTTPS(또는 localhost)에서만 위치를 쓸 수 있다.
export function webUnsupported(): boolean {
  if (Platform.OS !== 'web') return false;
  return typeof navigator === 'undefined' || !navigator.geolocation || (typeof window !== 'undefined' && window.isSecureContext === false);
}

async function readPermission(): Promise<PermissionLike & { coarse: boolean }> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    return { status: p.status, canAskAgain: p.canAskAgain, coarse: p.ios?.accuracy === 'reduced' || p.android?.accuracy === 'coarse' };
  } catch {
    // 웹에서 Permissions API 가 없는 브라우저 등: 상태를 알 수 없으므로 아직 정하지 않은 것으로 본다.
    return { status: 'undetermined', canAskAgain: true, coarse: false };
  }
}

export function useUserLocation() {
  const [state, setState] = useState<LocationState>({ status: 'idle' });
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef(false);
  const lastAttempt = useRef(0);
  const mounted = useRef(true);

  const set = useCallback((next: LocationState) => {
    if (mounted.current) setState(next);
  }, []);

  // ask=true: 사용자가 버튼을 눌러 권한 요청까지 진행. ask=false: 이미 허용된 경우에만 조용히 조회.
  const acquire = useCallback(
    async (ask: boolean) => {
      if (inFlight.current) return; // 같은 요청이 겹치지 않게 한다
      inFlight.current = true;
      lastAttempt.current = Date.now();
      const hadLocation = stateRef.current.status === 'ready';
      try {
        if (webUnsupported()) return set({ status: 'failed', reason: 'unsupported' });

        let permission = await readPermission();
        let kind = classifyPermission(permission);

        if (kind !== 'granted' && ask) {
          // GPS(위치 서비스)가 꺼져 있으면 권한을 요청해도 소용없으므로 먼저 알린다. 웹은 이 값을 알 수 없다.
          if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) {
            return set({ status: 'failed', reason: 'servicesDisabled' });
          }
          const requested = await Location.requestForegroundPermissionsAsync();
          permission = { status: requested.status, canAskAgain: requested.canAskAgain, coarse: requested.ios?.accuracy === 'reduced' || requested.android?.accuracy === 'coarse' };
          kind = classifyPermission(permission);
        }

        if (kind === 'undetermined') return set({ status: 'idle' });
        if (kind !== 'granted') return set({ status: 'failed', reason: kind });

        if (Platform.OS !== 'web' && !(await Location.hasServicesEnabledAsync())) {
          return set({ status: 'failed', reason: 'servicesDisabled' });
        }
        if (!hadLocation) set({ status: 'locating' });
        // 정확도 Balanced(수십~수백 m)면 시군구·약 5km 반경 조회에 충분하고 배터리도 덜 쓴다.
        // 웹 구현은 기본값이 maximumAge: Infinity 라 브라우저가 아주 오래된 위치를 돌려줄 수 있다. 60초 안의 위치만 받도록 제한한다.
        // (maximumAge 는 expo 타입에 없지만 웹 구현이 브라우저 옵션으로 그대로 넘긴다. 네이티브는 무시한다.)
        const options = { accuracy: Location.Accuracy.Balanced, maximumAge: 60000 } as Location.LocationOptions;
        const position = await withTimeout(Location.getCurrentPositionAsync(options), TIMEOUT_MS);
        set({
          status: 'ready',
          coords: { latitude: position.coords.latitude, longitude: position.coords.longitude },
          coarse: permission.coarse,
        });
      } catch (error) {
        const reason = classifyPositionError(error);
        // 이미 받은 실제 위치가 있으면, 일시적인 실패(시간 초과·신호 없음)로는 지우지 않는다.
        if (hadLocation && (reason === 'timeout' || reason === 'unavailable')) return;
        set({ status: 'failed', reason });
      } finally {
        inFlight.current = false;
      }
    },
    [set],
  );

  useEffect(() => {
    mounted.current = true;
    acquire(false);
    // 설정에서 권한을 바꾸거나 GPS 를 켜고 돌아오면 다시 읽는다.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && stateRef.current.status !== 'idle' && Date.now() - lastAttempt.current > MIN_RETRY_GAP_MS) {
        acquire(false);
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [acquire]);

  const request = useCallback(() => acquire(true), [acquire]);
  return { state, request };
}
