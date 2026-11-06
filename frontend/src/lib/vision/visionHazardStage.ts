// 전방 ROI(위험구간) 포함 판정과 박스 크기 기반 단계 판정. 순수 함수만 둔다(hazardStage.ts 와 같은 이유).
import type { HazardStage } from '../hazardStage';
import type { Box, Detection } from './visionTypes';

// 화면 가로 중심 0.5 기준 좌우 대칭 사다리꼴. topY 에서 bottomY 로 갈수록 반폭이 선형으로 넓어진다.
export interface RoiTrapezoid {
  topY: number;
  topHalfWidth: number;
  bottomY: number;
  bottomHalfWidth: number;
}

// 화면 하단-중앙(차량이 실제로 지나갈 도로 경로). docs/ADR/0002 참고.
// 바닥 폭 90%(반폭 0.45)였을 때 주행 영상(ml/eval_video.py, 크라쿠프 시내 5분)에서 주차된 차·반대 차선·인도
// 보행자까지 ROI 안으로 잡혀 최종 경고가 80회 떴다. 내 차선 폭(바닥 50%)으로 좁히니 5회로 줄고, 앞을
// 가로지르는 트램·횡단보도 보행자는 계속 잡았다. 블랙박스 화각 기준이라 폰 거치대에서는 실기기로 다시 맞춘다.
export const DEFAULT_ROI: RoiTrapezoid = { topY: 0.55, topHalfWidth: 0.05, bottomY: 1.0, bottomHalfWidth: 0.25 };

// MVP 임시 기준(실측 보정 전까지). box.height(정규화) 가 클수록 카메라에 가깝다(=가까워짐)로 본다.
export const BOX_HEIGHT_RATIO = { approach: 0.18, final: 0.32 } as const;

const RANK: Record<HazardStage, number> = { advance: 0, caution: 1, approach: 2, final: 3 };

export function isInRoi(box: Box, roi: RoiTrapezoid = DEFAULT_ROI): boolean {
  const cx = box.x + box.width / 2;
  // 범퍼 바로 앞 객체는 화면 바닥을 넘어설 수 있다(부동소수점 오차·클리핑 안 된 박스) — 가장 가까운 경우가
  // ROI 밖으로 취급돼 경고를 놓치지 않도록 bottomY로 clamp한다.
  const cy = Math.min(box.y + box.height, roi.bottomY);
  if (cy < roi.topY) return false;
  const t = (cy - roi.topY) / (roi.bottomY - roi.topY);
  const halfWidth = roi.topHalfWidth + t * (roi.bottomHalfWidth - roi.topHalfWidth);
  return cx >= 0.5 - halfWidth && cx <= 0.5 + halfWidth;
}

export function stageOfDetection(detection: Detection, roi: RoiTrapezoid = DEFAULT_ROI): HazardStage {
  if (!isInRoi(detection.box, roi)) return 'advance';
  if (detection.box.height >= BOX_HEIGHT_RATIO.final) return 'final';
  if (detection.box.height >= BOX_HEIGHT_RATIO.approach) return 'approach';
  return 'caution';
}

export function mostSevereStage(stages: HazardStage[]): HazardStage {
  return stages.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'advance' as HazardStage);
}
