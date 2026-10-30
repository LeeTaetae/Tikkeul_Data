import { useCallback, useEffect, useRef, useState } from 'react';

import { formatDistance } from './distance';
import { stageOf, type HazardStage } from './hazardStage';
import type { HazardApproach } from './routeHazards';
import type { RoadAlert } from '../types/alert';

export type { HazardStage };

// 값이 클수록 위험구간에 가까운 단계다.
const RANK: Record<HazardStage, number> = { advance: 0, caution: 1, approach: 2, final: 3 };
const STAGES: HazardStage[] = ['advance', 'caution', 'approach', 'final'];

export interface HazardWarning {
  alert: RoadAlert;
  distanceM: number;
  stage: HazardStage;
  /** i18n 키와 값. 화면은 t(key, params) 로 표시하고, 추후 TTS 도 같은 문장을 읽는다. */
  message: { key: string; params: { distance: string } };
}

interface Options {
  /** 안내가 활성화된 상태에서만 경고한다. */
  active: boolean;
  /** 경로 식별자. 바뀌면 재탐색으로 보고 이력을 정리한다. */
  routeKey: string;
  /** 경로 매칭을 이미 통과한 위험구간과 경로를 따라 계산한 남은 거리. 매칭은 src/lib/routeHazards.ts 가 맡는다. */
  hazards: HazardApproach[];
}

// 위험구간 식별자. revision 이 바뀌면 다른 위험으로 보고 단계별 경고를 처음부터 다시 한다.
const keyOf = (alert: RoadAlert) => (alert.revision != null ? `${alert.id}#${alert.revision}` : alert.id);

// 경고 표시 여부와 단계별 중복 방지를 맡는다.
// - 이력은 "위험구간 + 단계" 단위다. 사전 알림을 봤어도 500·300·100m 경고는 각각 처음이므로 표시된다.
// - 한 번에 하나만 표시한다. 더 가까운 단계가 우선이고, 같으면 더 가까운 위험구간이 우선이다.
// - 닫기(X)는 그 단계만 닫는다. 다음 단계에 들어서면 다시 표시한다.
// - 단계를 건너뛰어 들어오면(800m → 250m) 가장 가까운 단계 하나만 표시하고 그보다 먼 단계는 본 것으로 기록한다.
// - 위험구간을 통과(거리 0 이하)하면 해제한다.
// - 안내 종료: 이력을 모두 비운다. 재탐색(routeKey 변경): 새 경로에도 있는 위험구간의 이력은 유지하고,
//   새 경로에서 빠진 위험구간의 이력과 표시 중인 경고는 지운다.
export function useHazardWarning({ active, routeKey, hazards }: Options) {
  const [shown, setShown] = useState<{ key: string; stage: HazardStage } | null>(null);
  const seen = useRef(new Set<string>()); // `${위험구간 key}:${단계}`
  const lastRouteKey = useRef(routeKey);

  const ahead = active ? hazards.filter((h) => h.distanceM > 0) : [];
  const shownHazard = shown ? ahead.find((h) => keyOf(h.alert) === shown.key) : undefined;

  // 아직 보지 않은 (위험구간, 현재 단계) 중 우선순위가 가장 높은 것
  const candidate = ahead
    .map((hazard) => ({ hazard, stage: stageOf(hazard.distanceM, hazard.alert.type) }))
    .filter((c) => !seen.current.has(`${keyOf(c.hazard.alert)}:${c.stage}`))
    .sort((a, b) => RANK[b.stage] - RANK[a.stage] || a.hazard.distanceM - b.hazard.distanceM)[0];

  // 표시 중인 경고는 더 가까운 단계의 새 경고가 생길 때만 교체한다.
  const keepShown = shown && shownHazard && !(candidate && RANK[candidate.stage] > RANK[shown.stage]);
  const current = keepShown ? { hazard: shownHazard, stage: shown.stage } : candidate;

  // 표시 상태와 이력은 렌더 뒤에 반영한다. 매 렌더 실행하지만 값이 달라질 때만 상태를 바꾼다.
  useEffect(() => {
    if (!active) {
      seen.current.clear();
      lastRouteKey.current = routeKey;
      if (shown) setShown(null);
      return;
    }

    if (lastRouteKey.current !== routeKey) {
      lastRouteKey.current = routeKey;
      const keys = new Set(hazards.map((h) => keyOf(h.alert)));
      for (const entry of [...seen.current]) {
        if (!keys.has(entry.slice(0, entry.lastIndexOf(':')))) seen.current.delete(entry);
      }
    }

    const nextKey = current ? keyOf(current.hazard.alert) : null;
    const nextStage = current ? current.stage : null;
    if (nextKey === (shown?.key ?? null) && nextStage === (shown?.stage ?? null)) return;

    if (current && nextKey) {
      // 이 단계와 그보다 먼 단계를 본 것으로 기록한다.
      for (const stage of STAGES) {
        if (RANK[stage] <= RANK[current.stage]) seen.current.add(`${nextKey}:${stage}`);
      }
      setShown({ key: nextKey, stage: current.stage });
    } else {
      setShown(null);
    }
  });

  const dismiss = useCallback(() => setShown(null), []);

  const warning: HazardWarning | null = current
    ? {
        alert: current.hazard.alert,
        distanceM: current.hazard.distanceM,
        stage: current.stage,
        message: {
          key: `hazard.${current.stage === 'advance' ? 'advance' : 'message'}.${current.hazard.alert.type}`,
          params: { distance: formatDistance(current.hazard.distanceM) },
        },
      }
    : null;

  return { warning, dismiss };
}
