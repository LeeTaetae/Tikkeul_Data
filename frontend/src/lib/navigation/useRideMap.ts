import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { KakaoMapHandle, RoutePoint } from '../../map/types';
import type { Fix, TrackingView } from './guidanceEngine';
import { bearingDeg, distanceM } from './rideGuidance';

// 이만큼(m) 움직여야 진행 방향을 새로 계산한다(제자리에서 위치가 흔들릴 때 화살표가 돌지 않게).
const MIN_HEADING_MOVE_M = 3;

interface FollowOptions {
  mapRef: RefObject<KakaoMapHandle | null>;
  mapReady: boolean;
  /** 엔진이 걸러낸 위치(useGuidanceTracking 의 position) */
  position: Fix | null;
  following: boolean;
  /** 처음 위치를 받을 때 맞출 지도 확대 수준(카카오 level: 작을수록 확대) */
  level: number;
}

/**
 * 현재 위치 마커를 옮기고, following 이면 지도 중심을 따라 옮긴다. 진행 방향은 GPS 에 방향 값이 없어서(Fix 에 heading 이 없다)
 * 직전 위치에서 지금 위치로 움직인 방위로 정한다. 멈춰 있으면 마지막 방향을 유지하고, 처음에는 방향 없이 점으로 보인다.
 */
export function useRideMapFollow({ mapRef, mapReady, position, following, level }: FollowOptions) {
  const lastRef = useRef<RoutePoint | null>(null);
  const headingRef = useRef<number | null>(null);
  const firstFocusDone = useRef(false);

  useEffect(() => {
    if (!mapReady) return;
    const point = position ? { lat: position.lat, lng: position.lng } : null;
    if (point) {
      if (!lastRef.current) lastRef.current = point;
      else if (distanceM(lastRef.current, point) >= MIN_HEADING_MOVE_M) {
        headingRef.current = bearingDeg(lastRef.current, point) ?? headingRef.current;
        lastRef.current = point;
      }
    }
    mapRef.current?.setLocationMarker(point, { headingDeg: headingRef.current });
    if (point && following) {
      mapRef.current?.panTo(point, firstFocusDone.current ? undefined : { level });
      firstFocusDone.current = true;
    }
  }, [mapRef, mapReady, position, following, level]);
}

const GPS_FAILURE_TEXT: Record<string, string> = {
  denied: 'nav.gpsDenied',
  permanentlyDenied: 'nav.gpsPermanentlyDenied',
  servicesDisabled: 'nav.gpsServicesDisabled',
  unsupported: 'nav.gpsUnsupported',
  unavailable: 'nav.gpsUnavailable',
  timeout: 'nav.gpsUnavailable',
};

export interface RideGpsStatus {
  key: string;
  tone: 'info' | 'warn';
  /** true 면 "위치 다시 시도" 버튼을 함께 보인다 */
  retry: boolean;
}

/** 화면에 띄울 GPS 상태 하나. 정상 추적 중이면 null. 도착한 뒤에는 보이지 않는다. */
export function rideGpsStatus(view: TrackingView): RideGpsStatus | null {
  if (view.phase === 'arrived') return null;
  if (view.phase === 'failed') return { key: GPS_FAILURE_TEXT[view.failure ?? 'unavailable'] ?? 'nav.gpsUnavailable', tone: 'warn', retry: true };
  if (view.phase === 'signalLost') return { key: 'nav.gpsSignalLost', tone: 'warn', retry: false };
  if (view.snapshot && !view.snapshot.fixUsed && view.snapshot.ignoredReason === 'lowAccuracy') return { key: 'nav.gpsLowAccuracy', tone: 'info', retry: false };
  if (view.phase === 'starting') return { key: 'nav.gpsStarting', tone: 'info', retry: false };
  return null;
}
