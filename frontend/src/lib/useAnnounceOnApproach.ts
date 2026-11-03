import { useEffect, useRef } from 'react';

import { projectOntoRoute, type Route } from './routeHazards';
import { speaker } from './speech/speaker';

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
  /** 진단 로그용 안내 종류(car · walk · cycling · home). */
  source?: string;
  getPoint: (item: T) => { lat: number; lng: number } | null | undefined;
  // 읽을 문장. distanceM 은 그 지점까지 남은 거리(m). 빈 문자열이면 읽지 않는다(언어에 맞는 문장을 만들 수 없는 안내).
  getText: (item: T, context: { distanceM: number }) => string;
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
  source,
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
    let nearestItem: T | undefined;
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
        nearestItem = item;
        nearestDistance = distanceM;
      }
    }
    if (nearestIndex >= 0 && nearestItem !== undefined) {
      const index = nearestIndex;
      spoken.current.add(index);
      const text = getText(nearestItem, { distanceM: nearestDistance });
      // 언어가 바뀌는 사이에 취소된('stale') 안내는 읽지 못했으니 '읽음'을 취소한다: 다음 갱신에서 새 언어로 다시 읽는다.
      void speaker.speak(text, language, { source }).then((result) => {
        if (result === 'stale' && lastRouteKey.current === routeKey) spoken.current.delete(index);
      });
    }
    // getPoint/getText/maxLateralM 은 deps 에서 뺀다 - 매 렌더 새 클로저지만, 위 목록(active/routeKey/
    // route/candidates/progressM/language)이 바뀔 때마다 effect 가 다시 돌면서 항상 최신 클로저를 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, routeKey, route, candidates, progressM, language]);
}
