// 보호구역 안에 있는지만 필요한 화면(자전거 등)용 경량 버전. useRouteHazardWarning 은 ITS 돌발정보·사고다발구역까지
// 묶어서 들고 있어 무겁고, 자전거 화면은 애초에 보호구역만 쓴다는 정책이라(useRouteHazardWarning.ts 주석 참고) 떼어냈다.
import { useMemo } from 'react';

import { protectionZonesToAlerts } from '../api/convert';
import { matchHazardsToRoute, type Route } from '../routeHazards';
import { nearSchoolZone } from './drivingDisplay';
import type { NavRoute } from './guidanceEngine';
import { useRouteZones } from './useRouteZones';

export function useProtectionZoneStatus(route: NavRoute | null, progressM: number, enabled: boolean): boolean {
  const zones = useRouteZones(route, enabled && route?.source === 'api');
  const zoneAlerts = useMemo(() => (zones.status === 'done' ? protectionZonesToAlerts(zones.items) : []), [zones]);
  const hazardRoute = useMemo<Route | null>(
    () => (route ? { id: route.id, points: route.path.map((p) => ({ latitude: p.lat, longitude: p.lng })) } : null),
    [route],
  );
  const zoneOnRoute = useMemo(() => (hazardRoute ? matchHazardsToRoute(hazardRoute, zoneAlerts).onRoute : []), [hazardRoute, zoneAlerts]);
  return nearSchoolZone(zoneOnRoute.map((z) => z.offsetM), progressM);
}
