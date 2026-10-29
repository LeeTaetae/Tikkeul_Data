import { useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';

import { MATCH_MAX_LATERAL_M, projectOntoRoute, type Route } from './routeHazards';

// i18n 언어 코드(ko/en/zh) → Speech locale.
const SPEECH_LOCALE: Record<string, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };

// 이 거리 안에 들어오면 한 번 읽는다. 통과 직후(-20m)까지는 늦게라도 읽어준다.
const ANNOUNCE_DISTANCE_M = 100;
const PASSED_GRACE_M = -20;

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
// 상세 경로 목록에는 표시하지 않는다 — 음성 전용 경고다. useTurnInstructionSpeech 와 같은 구조.
export function useSpeedBumpSpeech({ active, routeKey, route, bumps, progressM }: Options) {
  const { t, i18n } = useTranslation();
  const spoken = useRef(new Set<number>());
  const lastRouteKey = useRef(routeKey);

  useEffect(() => {
    if (lastRouteKey.current !== routeKey) {
      spoken.current.clear();
      lastRouteKey.current = routeKey;
    }
    if (!active || !route) return;

    // 한 틱에 여러 개가 겹쳐도 하나만 읽는다(Chrome 이 연달아 큐에 넣은 speak() 를 조용히 버리는 문제 회피).
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    for (const [i, bump] of bumps.entries()) {
      if (spoken.current.has(i)) continue;
      const projected = projectOntoRoute(route, { latitude: bump.lat, longitude: bump.lng });
      if (!projected || projected.lateralM > MATCH_MAX_LATERAL_M) continue; // 경로에서 먼 방지턱(옆길 등)은 무시한다.
      const distanceM = projected.offsetM - progressM;
      if (distanceM <= ANNOUNCE_DISTANCE_M && distanceM > PASSED_GRACE_M && distanceM < nearestDistance) {
        nearestIndex = i;
        nearestDistance = distanceM;
      }
    }
    if (nearestIndex >= 0) {
      spoken.current.add(nearestIndex);
      Speech.speak(t('hazard.speedBump'), { language: SPEECH_LOCALE[i18n.language] ?? SPEECH_LOCALE.ko });
    }
  }, [active, routeKey, route, bumps, progressM, t, i18n.language]);
}
