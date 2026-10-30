import { useMemo } from 'react';

import { trafficApi } from '../api/api';
import { childProtectionZonesToAlerts, incidentsToAlerts } from '../api/convert';
import { useApi } from '../api/useApi';
import { areaFor } from '../location/geo';
import { prioritizeHazards, type PrioritizedHazard } from '../hazardPriority';
import { buildHazardRail, registryZoneInput } from '../hazardRail';
import { classifyIncidentOnRoute, matchHazardsToRoute, remainingHazards, type HazardApproach, type Route } from '../routeHazards';
import { useHazardWarning } from '../useHazardWarning';
import type { RoadAlert } from '../../types/alert';
import type { NavRoute } from './guidanceEngine';
import type { ZoneCoverage } from './routeZones';
import { useRouteZones } from './useRouteZones';

/** 돌발정보를 다시 받는 주기(ms) */
const INCIDENT_REFRESH_MS = 60_000;
/** 서버가 받아온 시각이 이보다 오래됐으면 오래된 데이터로 본다(ms) */
const INCIDENT_STALE_MS = 10 * 60 * 1000;

interface Options {
  route: NavRoute | null;
  /** 경로를 따라 진행한 거리(m). 아직 모르면 0 */
  progressM: number;
  /** 위치를 받아 진행 중일 때만 true. false 가 되면 경고 이력이 지워지므로, 재탐색 중에도 true 로 둔다 */
  active: boolean;
  /** 현재 위치(돌발정보를 이 주변에서 받는다)와 그 정확도(m), 속도(m/s). 모르면 null */
  position?: { lat: number; lng: number; accuracyM: number | null } | null;
  speedMps?: number | null;
  /** false 면 사고·공사·정체(ITS 돌발정보)를 조회·매칭하지 않는다. 홈의 기존 안내(자전거·대중교통)는 보호구역만 쓴다. 기본 true */
  includeIncidents?: boolean;
  /** 개발용 가상 경로에서만 넘기는 예시 위험. 실제 경로(source 'api')에서는 쓰지 않는다 */
  sampleAlerts?: RoadAlert[];
  /** 개발용 가상 경로에서만 넘기는 예시 보호구역(음성 확인용). 실제 경로에서는 쓰지 않는다 */
  sampleZoneAlerts?: RoadAlert[];
}

export type HazardDataNotice = 'failed' | 'partial' | null;

/**
 * 경로 기반 위험 경고. 두 갈래를 한 화면 경고(useHazardWarning)로 합친다.
 *
 * 1) 어린이보호구역(등록 현황): 경로가 지나는 시군구들을 표본 조회한다(useRouteZones). 구역 전체에 적용되는 위험이라
 *    기존 방식(matchHazardsToRoute, omnidirectional)으로 경로 위 여부를 판정한다. 홈과 같은 동작이다.
 * 2) 사고·공사·정체(ITS 돌발정보): classifyIncidentOnRoute 로 confirmed/probable/excluded 를 나누고 우선순위 엔진으로 순위를 매긴다.
 *    기존 단계별 긴급 경고(500·300·100m)에는 confirmed 이면서 urgentEligible 인 것만 넣는다. probable 은 candidates 로만 돌려준다.
 *
 * 한계: 보호구역 조회는 표본 조회라 전체 조회를 보장하지 않는다(coverage 'sampled'). 돌발정보는 현재 위치 주변(약 5km)만 받는다.
 */
export function useRouteHazardWarning({ route, progressM, active, position = null, speedMps = null, includeIncidents = true, sampleAlerts, sampleZoneAlerts }: Options) {
  const isApiRoute = route?.source === 'api';
  const mode = route?.mode ?? 'driving';

  // ── 어린이보호구역
  const zones = useRouteZones(route, isApiRoute);
  const zoneAlerts = useMemo(() => {
    if (route?.source === 'mock') return sampleZoneAlerts ?? [];
    return zones.status === 'done' ? childProtectionZonesToAlerts(zones.items) : [];
  }, [route?.source, sampleZoneAlerts, zones]);

  // 경로가 바뀔 때(안내 시작·재탐색)만 새로 만든다. 그래야 위험 데이터와 경로가 그대로인 렌더에서 매칭을 다시 돌리지 않는다.
  const hazardRoute = useMemo<Route | null>(
    () => (route ? { id: route.id, points: route.path.map((p) => ({ latitude: p.lat, longitude: p.lng })) } : null),
    [route],
  );
  const zoneOnRoute = useMemo(() => (hazardRoute ? matchHazardsToRoute(hazardRoute, zoneAlerts).onRoute : []), [hazardRoute, zoneAlerts]);

  // ── ITS 돌발정보(실제 경로) 또는 예시 위험(가상 경로)
  const area = includeIncidents && isApiRoute && position ? areaFor({ latitude: position.lat, longitude: position.lng }) : null;
  const incidents = useApi((signal) => trafficApi.incidents(area!.bbox, { signal }), {
    key: area?.key ?? '',
    enabled: !!area,
    refreshMs: INCIDENT_REFRESH_MS,
    keepPrevious: true,
  });
  const incidentResponse = incidents.state.status === 'success' ? incidents.state.data : null;
  const incidentAlerts = useMemo<RoadAlert[]>(() => {
    if (!includeIncidents) return [];
    if (route?.source === 'mock') return sampleAlerts ?? [];
    return incidentResponse ? incidentsToAlerts(incidentResponse.items, '') : [];
  }, [includeIncidents, route?.source, sampleAlerts, incidentResponse]);
  const dataStale = incidentResponse
    ? incidentResponse.meta.stale || Date.now() - Date.parse(incidentResponse.meta.fetched_at) > INCIDENT_STALE_MS
    : false;

  // 위치가 바뀔 때마다 모든 돌발정보를 다시 분류하지 않도록 진행 거리와 정확도는 거친 단위로 묶는다.
  const progressBucket = Math.round(progressM / 5);
  const accuracyM = position?.accuracyM ?? null;
  const incidentInputs = useMemo(() => {
    if (!hazardRoute || incidentAlerts.length === 0) return [];
    const nowMs = Date.now();
    return incidentAlerts.map((alert) => ({
      alert,
      match: classifyIncidentOnRoute(hazardRoute, alert, { mode, progressM: progressBucket * 5, gpsAccuracyM: accuracyM, nowMs, dataStale }),
    }));
  }, [hazardRoute, incidentAlerts, mode, progressBucket, accuracyM, dataStale]);

  // 구역 전체에 적용되는 보호구역도 같은 엔진으로 순위를 매긴다(레일 정렬용). 단계 경고는 아래에서 기존 방식 그대로 쓴다.
  const zoneInputs = useMemo(() => zoneOnRoute.map(({ alert, offsetM }) => registryZoneInput(alert, offsetM - progressBucket * 5)), [zoneOnRoute, progressBucket]);

  const prioritized = useMemo<PrioritizedHazard[]>(
    () => (incidentInputs.length + zoneInputs.length === 0 ? [] : prioritizeHazards([...incidentInputs, ...zoneInputs], { mode, speedMps })),
    // speedMps 는 거칠게 묶어 쓴다(매 위치마다 다시 계산하지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidentInputs, zoneInputs, mode, speedMps === null ? null : Math.round(speedMps)],
  );

  // 기존 단계별 긴급 경고에는 돌발정보 중 confirmed(urgentEligible)만 넣는다. probable·excluded 는 넣지 않는다.
  // 보호구역은 위에서 기존 방식으로 따로 넣으므로 여기서는 뺀다(중복 방지).
  const incidentHazards = useMemo<HazardApproach[]>(
    () =>
      prioritized
        .filter((h) => h.urgentEligible && h.alert.type !== 'school_zone' && h.distanceAlongRouteM !== null)
        .map((h) => ({ alert: h.alert, distanceM: h.distanceAlongRouteM as number })),
    [prioritized],
  );

  // 위험 아이콘 레일용 목록: 엔진 순서 그대로, 보일 것만(excluded·이미 지난 위험·중복 제외). 이 목록은 음성·팝업 경고를 만들지 않는다.
  const rail = useMemo(() => buildHazardRail(prioritized), [prioritized]);

  const { warning, dismiss } = useHazardWarning({
    active: active && hazardRoute !== null,
    routeKey: route?.id ?? '',
    hazards: [...remainingHazards(zoneOnRoute, progressM), ...incidentHazards],
  });

  // 조회 실패·부분 조회는 "위험 없음"과 구분해서 알려야 한다(경고가 안 뜨는 것이 안전하다는 뜻이 아니다).
  const zoneCoverage: ZoneCoverage | 'loading' | 'idle' = zones.status === 'done' ? zones.coverage : zones.status;
  const incidentsFailed = includeIncidents && isApiRoute && incidents.state.status === 'error';
  const notice: HazardDataNotice = !isApiRoute ? null : zoneCoverage === 'failed' || incidentsFailed ? 'failed' : zoneCoverage === 'partial' ? 'partial' : null;

  return {
    warning,
    dismiss,
    /** 경로(좌표) — 팀 TTS 훅(useTurnInstructionSpeech 등)이 쓰는 Route 형태. route 가 바뀔 때만 새로 만들어진다 */
    hazardRoute,
    /** 경로 위로 판정된 보호구역(구역 전체 적용). 보호구역 과속 음성 경고(useSpeedingWarning)가 쓴다 */
    zoneOnRoute,
    notice,
    zoneCoverage,
    rail,
    /** 확정되지 않았지만 경로 근처에 있는 돌발정보(probable). 화면 표시용 후보이며 긴급 경고에는 들어가지 않는다 */
    candidates: prioritized.filter((h) => h.displayEligible && !h.urgentEligible),
  };
}
