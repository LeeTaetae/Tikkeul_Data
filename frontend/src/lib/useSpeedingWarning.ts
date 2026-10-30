import { useTranslation } from 'react-i18next';

import type { OnRouteHazard, Route } from './routeHazards';
import { useAnnounceOnApproach } from './useAnnounceOnApproach';

// 어린이보호구역 법정 제한속도(도로교통법 시행규칙, 전국 공통).
export const SCHOOL_ZONE_SPEED_LIMIT_KMH = 30;

interface Options {
  active: boolean;
  routeKey: string;
  route: Route | null;
  zones: OnRouteHazard[];
  progressM: number;
  /** GPS 현재 속력(km/h). 기기가 속력을 안 주면(coords.speed null) 경고하지 않는다 - 오탐보다 무경고가 낫다. */
  speedKmh: number | null;
}

// 경로 위 어린이보호구역에 접근/진입했을 때 현재 속도가 제한(30km/h)을 넘으면 한 번 음성으로 경고한다.
// useSpeedBumpSpeech 와 같은 "다가오면 한 번만 읽기" 패턴(useAnnounceOnApproach)을 그대로 쓴다.
export function useSpeedingWarning({ active, routeKey, route, zones, progressM, speedKmh }: Options) {
  const { t, i18n } = useTranslation();
  const speeding = speedKmh != null && speedKmh > SCHOOL_ZONE_SPEED_LIMIT_KMH;
  useAnnounceOnApproach({
    active,
    routeKey,
    route,
    candidates: speeding ? zones : [],
    progressM,
    language: i18n.language,
    getPoint: (zone) => ({ lat: zone.alert.latitude, lng: zone.alert.longitude }),
    getText: () => t('hazard.speedingSchoolZone'),
  });
}
