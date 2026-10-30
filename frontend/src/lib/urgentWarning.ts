import type { HazardStage, HazardWarning } from './useHazardWarning';

// 값이 클수록 위험구간에 가까운 단계다. useHazardWarning.ts 의 단계 순서와 같다.
const STAGE_ORDER: HazardStage[] = ['advance', 'caution', 'approach', 'final'];

// 경고가 두 곳(개발용 시뮬레이터·어린이보호구역)에서 동시에 올라오면 화면에는 하나만 보여준다.
// 더 가까운 단계가 우선이고, 단계가 같으면 더 가까운 위험구간이 우선, 그래도 같으면 a 가 우선이다.
// 보이지 않는 쪽의 경고는 각자의 훅 안에 그대로 남아 있다가, 보이던 쪽을 닫거나 통과하면 이어서 나온다.
export function pickUrgentWarning(a: HazardWarning | null, b: HazardWarning | null): HazardWarning | null {
  if (!a) return b;
  if (!b) return a;
  const rankA = STAGE_ORDER.indexOf(a.stage);
  const rankB = STAGE_ORDER.indexOf(b.stage);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return b.distanceM < a.distanceM ? b : a;
}
