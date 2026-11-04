// 전방 비전 위험 경고의 한 프레임 처리(순수 함수 부분만 둔다 — 실제 주기적 detectFrame 폴링·진동 API
// 호출·화면 배선은 Task 7의 네이티브 모듈이 실제로 구현된 뒤 이어서 만든다. docs/ADR/0002 참고).
//
// 단계가 오르는 건 즉시 반영하고, 내리는 것만 STAGE_DROP_HOLD_FRAMES 연속 확인 후 반영한다.
// 모델 recall(~0.57)로 단발성 미탐지가 흔해서, 매 프레임 그대로 반영하면 final→advance→final 같은
// 깜빡임이 생기고 그때마다 재진동한다(코드 리뷰 finding 2) — 그래서 하락에만 hold를 둔다.
import type { HazardStage } from '../hazardStage';
import type { Detection, HazardClass } from './visionTypes';
import { mostSevereStage, stageOfDetection } from './visionHazardStage';
import { passesThreshold, type SensitivityProfile } from './sensitivityProfile';
import { shouldVibrate, STAGE_RANK } from './visionAlertTrigger';

export interface VisionFrameState {
  stage: HazardStage;
  topClass: HazardClass | null;
  missStreak: number;
}

export const INITIAL_VISION_FRAME_STATE: VisionFrameState = { stage: 'advance', topClass: null, missStreak: 0 };

// MVP 임시 기준(실측 보정 전까지).
export const STAGE_DROP_HOLD_FRAMES = 3;

export interface VisionFrameResult {
  state: VisionFrameState;
  vibrate: boolean;
}

export function reduceVisionFrame(prev: VisionFrameState, detections: Detection[], profile: SensitivityProfile): VisionFrameResult {
  const passed = detections.filter((d) => passesThreshold(d, profile));
  const rawStage = mostSevereStage(passed.map((d) => stageOfDetection(d)));
  const rawTopClass = rawStage === 'advance' ? null : (passed.find((d) => stageOfDetection(d) === rawStage)?.class ?? null);

  const rising = STAGE_RANK[rawStage] >= STAGE_RANK[prev.stage];
  if (rising) {
    const state = { stage: rawStage, topClass: rawTopClass, missStreak: 0 };
    return { state, vibrate: shouldVibrate(prev.stage, state.stage) };
  }

  const missStreak = prev.missStreak + 1;
  if (missStreak < STAGE_DROP_HOLD_FRAMES) {
    // hold: 아직 하락을 확정하지 않는다 — 단계·대표 클래스 모두 이전 값을 유지해 배너가 깜빡이지 않는다.
    return { state: { stage: prev.stage, topClass: prev.topClass, missStreak }, vibrate: false };
  }
  const state = { stage: rawStage, topClass: rawTopClass, missStreak: 0 };
  return { state, vibrate: shouldVibrate(prev.stage, state.stage) };
}
