// 경고 단계 판정. 다른 모듈을 import 하지 않는 순수 함수라 Node 로도 테스트한다(distance.ts·convert.ts 와 같은 이유).
import type { AlertType } from '../types/alert';

// advance 는 caution 보다 먼 경로 사전 알림, 나머지는 근접 경고다.
export type HazardStage = 'advance' | 'caution' | 'approach' | 'final';

// MVP 임시 기준. 실제 안내 연동 후 설정값으로 옮길 수 있다.
export const HAZARD_STAGE_DISTANCE_M = { caution: 500, approach: 300, final: 100 } as const;
// 등교·하교 시간대엔 어린이보호구역만 더 일찍(caution 단계를 더 먼 거리에서) 경고한다. F-03의
// "GPS·시간·보호구역 결합" 중 시간 축 - 등하교 시간대엔 아이들이 많아 더 먼저 주의를 주는 게 맞다.
const SCHOOL_ZONE_COMMUTE_CAUTION_M = 700;

// 등교(07~09시)·하교(14~17시) 시간대 판정. 기기 타임존 설정과 무관하게 KST 로 본다(국내 전용 서비스).
export function isSchoolCommuteHourKst(now: Date = new Date()): boolean {
  const h = (now.getUTCHours() + 9) % 24;
  return (h >= 7 && h < 9) || (h >= 14 && h < 17);
}

export function stageOf(distanceM: number, alertType?: AlertType, now: Date = new Date()): HazardStage {
  const cautionM =
    alertType === 'school_zone' && isSchoolCommuteHourKst(now) ? SCHOOL_ZONE_COMMUTE_CAUTION_M : HAZARD_STAGE_DISTANCE_M.caution;
  if (distanceM <= HAZARD_STAGE_DISTANCE_M.final) return 'final';
  if (distanceM <= HAZARD_STAGE_DISTANCE_M.approach) return 'approach';
  if (distanceM <= cautionM) return 'caution';
  return 'advance';
}
