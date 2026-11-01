// 자동차 안내 시작 직전에 다시 잰 현재 위치가 출발점으로 쓸 만한지 판단한다. 순수 함수라 Node 로 테스트한다.
// 기준을 넘으면 안내를 시작하지 않고 사용자에게 알린다. 오래되거나 부정확한 좌표, 서울시청 같은 대체 좌표로 진행하지 않는다.

/** 이보다 넓은 오차(m)는 차로·건물 단위로 틀릴 수 있어 출발점으로 쓰지 않는다 */
export const GUIDANCE_FIX_MAX_ACCURACY_M = 50;
/** 이보다 오래된 측정값(ms)은 지금 위치라고 보지 않는다 */
export const GUIDANCE_FIX_MAX_AGE_MS = 30_000;

export interface GuidanceFix {
  lat: number;
  lng: number;
  /** 수평 오차 반경(m). 기기가 알려 주지 않으면 null */
  accuracy: number | null;
  /** 측정 시각(epoch ms) */
  timestamp: number;
}

export type GuidanceFixProblem = 'invalid' | 'stale' | 'inaccurate';

export function checkGuidanceFix(fix: GuidanceFix, now: number): GuidanceFixProblem | null {
  const finite = (v: number) => Number.isFinite(v);
  if (!finite(fix.lat) || !finite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180 || !finite(fix.timestamp)) return 'invalid';
  if (now - fix.timestamp > GUIDANCE_FIX_MAX_AGE_MS) return 'stale';
  // 오차를 모르는 측정값은 정확하다고 가정하지 않는다.
  if (fix.accuracy === null || !finite(fix.accuracy) || fix.accuracy > GUIDANCE_FIX_MAX_ACCURACY_M) return 'inaccurate';
  return null;
}
