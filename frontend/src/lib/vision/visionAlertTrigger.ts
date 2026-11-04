// 진동 edge-trigger: final(최종 경고) 단계에 막 들어온 순간에만 울린다. 주의·접근 경고는 배너만 뜨고
// 진동은 없다 - 매 단계마다 울리면 과잉 경보라 사용자 요청으로 final만으로 좁혔다. docs/ADR/0002 참고.
import type { HazardStage } from '../hazardStage';

export const STAGE_RANK: Record<HazardStage, number> = { advance: 0, caution: 1, approach: 2, final: 3 };

export function shouldVibrate(prevStage: HazardStage, nextStage: HazardStage): boolean {
  return nextStage === 'final' && prevStage !== 'final';
}
