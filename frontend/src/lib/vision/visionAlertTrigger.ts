// 진동 edge-trigger: 단계가 올라갈 때만 울린다. 같은 단계 유지·하락은 울리지 않는다. docs/ADR/0002 참고.
import type { HazardStage } from '../hazardStage';

const STAGE_RANK: Record<HazardStage, number> = { advance: 0, caution: 1, approach: 2, final: 3 };

export function shouldVibrate(prevStage: HazardStage, nextStage: HazardStage): boolean {
  return STAGE_RANK[nextStage] > STAGE_RANK[prevStage] && nextStage !== 'advance';
}
