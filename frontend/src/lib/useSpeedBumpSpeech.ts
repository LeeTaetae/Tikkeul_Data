import { useTranslation } from 'react-i18next';

import { MATCH_MAX_LATERAL_M, type Route } from './routeHazards';
import { useAnnounceOnApproach } from './useAnnounceOnApproach';

interface Bump {
  lat: number;
  lng: number;
}

interface Options {
  active: boolean;
  routeKey: string;
  route: Route | null;
  bumps: Bump[];
  progressM: number;
}

// 경로 위 과속방지턱이 가까워지면 고정 문구("전방에 과속방지턱이 있습니다")로 한 번씩 읽는다.
// 상세 경로 목록에는 표시하지 않는다 — 음성 전용 경고다. useTurnInstructionSpeech 와 같은 구조
// (공통 로직은 useAnnounceOnApproach).
export function useSpeedBumpSpeech({ active, routeKey, route, bumps, progressM }: Options) {
  const { t, i18n } = useTranslation();
  useAnnounceOnApproach({
    active,
    routeKey,
    route,
    candidates: bumps,
    progressM,
    language: i18n.language,
    getPoint: (bump) => bump,
    getText: () => t('hazard.speedBump'),
    maxLateralM: MATCH_MAX_LATERAL_M, // 경로에서 먼 방지턱(옆길 등)은 무시한다.
  });
}
