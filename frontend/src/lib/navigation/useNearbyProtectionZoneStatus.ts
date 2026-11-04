// 경로(path) 없이도 보호구역 민감도를 쓸 수 있게, 실시간 GPS만으로 "지금 보호구역 안인지"를 판정한다.
// 카카오 내비 SDK 화면(NativeNavigationScreen)처럼 우리 쪽이 경로를 들고 있지 않은 곳에서 쓴다.
// useRouteZones(경로 기반)와 달리 현재 위치 하나만 보고, 반경 안에 보호구역 center가 있는지로 판정한다.
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

import { distanceM } from './guidanceEngine';
import { cachedRegion, cachedZones } from './useRouteZones';

// MVP 임시 기준: 보호구역 표시 지점(point) 반경 150m 안이면 "안"으로 본다(구역 경계 도형을 안 쓰고 점 근사).
const NEAR_ZONE_RADIUS_M = 150;
// SDK 가 이미 자체 GPS를 쓰고 있어 배터리를 아끼려고 성긴 주기로만 추가 추적한다.
const WATCH_TIME_INTERVAL_MS = 8000;
const WATCH_DISTANCE_INTERVAL_M = 30;

export function useNearbyProtectionZoneStatus(enabled: boolean): boolean {
  const [inZone, setInZone] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setInZone(false);
      return;
    }
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: WATCH_TIME_INTERVAL_MS, distanceInterval: WATCH_DISTANCE_INTERVAL_M },
      (fix) => {
        const point = { lat: fix.coords.latitude, lng: fix.coords.longitude };
        cachedRegion(point.lat, point.lng)
          .then((sggCd) => (sggCd ? cachedZones(sggCd) : []))
          .then((zones) => {
            if (cancelled) return;
            setInZone(zones.some((z) => z.center && distanceM(point, { lat: z.center!.lat, lng: z.center!.lon }) <= NEAR_ZONE_RADIUS_M));
          })
          .catch(() => {
            // 지역·구역 조회 실패(네트워크 끊김 등)는 "보호구역 아님"으로 둔다 - 기본 민감도로 안전하게 되돌아간다.
            if (!cancelled) setInZone(false);
          });
      },
    ).then((sub) => {
      if (cancelled) sub.remove();
      else subscription = sub;
    });

    return () => {
      cancelled = true;
      subscription?.remove();
      setInZone(false);
    };
  }, [enabled]);

  return inZone;
}
