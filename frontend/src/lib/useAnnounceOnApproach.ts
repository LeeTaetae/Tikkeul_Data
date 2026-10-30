import { useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

import { projectOntoRoute, type Route } from './routeHazards';
import { resolveVoiceId } from './speechVoice';

// i18n 언어 코드(ko/en/zh) → Speech locale.
const SPEECH_LOCALE: Record<string, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };

// 이 거리 안에 들어오면 한 번 읽는다. 통과 직후(-20m)까지는 늦게라도 읽어준다.
const ANNOUNCE_DISTANCE_M = 100;
const PASSED_GRACE_M = -20;

interface Options<T> {
  active: boolean;
  routeKey: string;
  route: Route | null;
  candidates: T[];
  progressM: number;
  language: string;
  getPoint: (item: T) => { lat: number; lng: number } | null | undefined;
  getText: (item: T) => string;
  // 지정하면 경로에서 이 거리(m) 이상 떨어진 후보(예: 옆길의 방지턱)는 무시한다.
  maxLateralM?: number;
}

// 경로 위를 다가오는 후보(과속방지턱, 턴바이턴 안내 지점 등) 중 가장 가까운 것 하나를 골라 한 번씩
// TTS 로 읽는다. useSpeedBumpSpeech·useTurnInstructionSpeech 가 공유하는 공통 로직.
export function useAnnounceOnApproach<T>({
  active,
  routeKey,
  route,
  candidates,
  progressM,
  language,
  getPoint,
  getText,
  maxLateralM,
}: Options<T>) {
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
    let nearestText = '';
    let nearestDistance = Infinity;
    for (const [i, item] of candidates.entries()) {
      if (spoken.current.has(i)) continue;
      const point = getPoint(item);
      if (!point) continue;
      const projected = projectOntoRoute(route, { latitude: point.lat, longitude: point.lng });
      if (!projected) continue;
      if (maxLateralM != null && projected.lateralM > maxLateralM) continue;
      const distanceM = projected.offsetM - progressM;
      if (distanceM <= ANNOUNCE_DISTANCE_M && distanceM > PASSED_GRACE_M && distanceM < nearestDistance) {
        nearestIndex = i;
        nearestText = getText(item);
        nearestDistance = distanceM;
      }
    }
    if (nearestIndex >= 0) {
      spoken.current.add(nearestIndex);
      const locale = SPEECH_LOCALE[language] ?? SPEECH_LOCALE.ko;
      resolveVoiceId(locale).then((voice) => Speech.speak(nearestText, { language: locale, voice }));
    }
    // getPoint/getText/maxLateralM 은 deps 에서 뺀다 - 매 렌더 새 클로저지만, 위 목록(active/routeKey/
    // route/candidates/progressM/language)이 바뀔 때마다 effect 가 다시 돌면서 항상 최신 클로저를 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, routeKey, route, candidates, progressM, language]);
}
