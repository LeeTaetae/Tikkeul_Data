import { useEffect, useState } from 'react';

import { geoApi, trafficApi } from '../api/api';
import { ApiClientError } from '../api/client';
import { regionQueryFor } from '../location/geo';
import type { ProtectionZone } from '../../types/traffic';
import type { NavRoute } from './guidanceEngine';
import { collectRouteZones, type ZoneCoverage } from './routeZones';

// 같은 위치·같은 시군구를 안내 중에 다시 묻지 않게 이 세션 동안 기억한다(재탐색해도 새로 조회하지 않는다).
// 지역 조회는 좌표를 소수 3자리로 반올림한 키로 묶는다(regionQueryFor). 실패한 호출은 기억하지 않는다.
const regionCache = new Map<string, Promise<string | null>>();
const zonesCache = new Map<string, { at: number; promise: Promise<ProtectionZone[]> }>();
const ZONES_TTL_MS = 10 * 60 * 1000;

function cachedRegion(lat: number, lng: number): Promise<string | null> {
  const query = regionQueryFor({ latitude: lat, longitude: lng });
  let promise = regionCache.get(query.key);
  if (!promise) {
    promise = geoApi
      .region(query.lat, query.lon)
      .then((region) => region.sgg_cd)
      .catch((error: unknown) => {
        regionCache.delete(query.key);
        // 시군구를 확인할 수 없는 좌표(바다·국외)는 실패가 아니라 "지역 없음"이다.
        if (error instanceof ApiClientError && error.kind === 'regionNotFound') return null;
        throw error;
      });
    regionCache.set(query.key, promise);
  }
  return promise;
}

function cachedZones(sggCd: string): Promise<ProtectionZone[]> {
  const hit = zonesCache.get(sggCd);
  if (hit && Date.now() - hit.at < ZONES_TTL_MS) return hit.promise;
  const promise = trafficApi
    .protectionZones(sggCd)
    .then((res) => res.items)
    .catch((error: unknown) => {
      zonesCache.delete(sggCd);
      throw error;
    });
  zonesCache.set(sggCd, { at: Date.now(), promise });
  return promise;
}

export type RouteZonesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; items: ProtectionZone[]; coverage: ZoneCoverage };

/**
 * 경로가 지나는 시군구들의 보호구역(routeZones.collectRouteZones). 경로(route.id)가 바뀔 때만 다시 조회한다.
 * 결과의 coverage 는 'sampled'(표본 조회 성공)·'partial'(일부 실패·한도)·'failed'이며, 전체 조회라고 보장하지 않는다.
 */
export function useRouteZones(route: NavRoute | null, enabled: boolean): RouteZonesState {
  const [state, setState] = useState<RouteZonesState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled || !route) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    collectRouteZones(route.path, {
      fetchRegion: (p) => cachedRegion(p.lat, p.lng),
      fetchZones: cachedZones,
      keyOf: (zone) => zone.id,
    }).then((result) => {
      if (!cancelled) setState({ status: 'done', items: result.items, coverage: result.coverage });
    });
    return () => {
      cancelled = true;
    };
    // route 객체가 아니라 id 로 비교한다(같은 경로가 다시 렌더돼도 새로 조회하지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id, enabled]);

  return state;
}
