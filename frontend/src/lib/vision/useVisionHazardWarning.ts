// 전방 비전 위험 경고의 한 프레임 처리(순수 함수 부분만 둔다 — 실제 주기적 detectFrame 폴링·진동 API
// 호출·화면 배선은 Task 7의 네이티브 모듈이 실제로 구현된 뒤 이어서 만든다. docs/ADR/0002 참고).
//
// 단계가 오르는 건 즉시 반영하고, 내리는 것만 STAGE_DROP_HOLD_FRAMES 연속 확인 후 반영한다.
// 모델 recall(~0.57)로 단발성 미탐지가 흔해서, 매 프레임 그대로 반영하면 final→advance→final 같은
// 깜빡임이 생기고 그때마다 재진동한다(코드 리뷰 finding 2) — 그래서 하락에만 hold를 둔다.
import type { HazardStage } from '../hazardStage';
import type { Box, Detection, HazardClass } from './visionTypes';
import { mostSevereStage, stageOfDetection } from './visionHazardStage';
import { isInstant, passesThreshold, type SensitivityProfile } from './sensitivityProfile';
import { shouldVibrate, STAGE_RANK } from './visionAlertTrigger';

export interface VisionFrameState {
  stage: HazardStage;
  topClass: HazardClass | null;
  missStreak: number;
  // 직전 프레임에 ROI 안에서 후보 기준 이상으로 잡힌 박스들(즉시 기준 이상 포함). 이번 프레임의 후보가
  // 이 중 하나와 같은 자리면 확정한다(연속 2프레임 확인). 빠른 객체는 프레임마다 클래스가 바뀌기 쉬워
  // (킥보드↔사람, 오토바이↔차) 클래스가 아니라 위치로 같은 객체인지 본다.
  prevBoxes: Box[];
}

export const INITIAL_VISION_FRAME_STATE: VisionFrameState = { stage: 'advance', topClass: null, missStreak: 0, prevBoxes: [] };

// MVP 임시 기준(실측 보정 전까지).
export const STAGE_DROP_HOLD_FRAMES = 3;

export interface VisionFrameResult {
  state: VisionFrameState;
  vibrate: boolean;
}

// 주행 영상에서 모델이 신뢰도 0.4~0.5로 화면 거의 전체를 덮는 엉뚱한 차 박스를 연속 프레임에 걸쳐 내서
// 빈 도로에 최종 경고가 떴다. 이 폭 이상인 박스는 즉시 기준 미만이면 버린다 - 범퍼 앞에 붙은 진짜 차는
// 보통 신뢰도가 높아 즉시 기준을 넘으므로 계속 잡힌다.
export const IMPLAUSIBLE_BOX_WIDTH = 0.85;

function isPlausible(d: Detection, profile: SensitivityProfile): boolean {
  return d.box.width < IMPLAUSIBLE_BOX_WIDTH || isInstant(d, profile);
}

// 직전 박스를 자기 폭·높이의 이 비율만큼 사방으로 넓혀서 겹치면 같은 객체로 본다. 10fps에서 프레임 사이에
// 움직인 만큼을 허용하려는 값이다. shortcut: 실측 전 임시값, 주행 영상(ml/eval_video.py)으로 1프레임 이동량을 재서 맞춘다.
export const NEAR_MARGIN = 0.5;

export function isNearPrev(box: Box, prevBoxes: Box[]): boolean {
  return prevBoxes.some((p) => {
    const mx = p.width * NEAR_MARGIN;
    const my = p.height * NEAR_MARGIN;
    return box.x < p.x + p.width + mx && box.x + box.width > p.x - mx && box.y < p.y + p.height + my && box.y + box.height > p.y - my;
  });
}

export function reduceVisionFrame(prev: VisionFrameState, detections: Detection[], profile: SensitivityProfile): VisionFrameResult {
  const inRoi = detections.filter((d) => passesThreshold(d, profile) && isPlausible(d, profile) && stageOfDetection(d) !== 'advance');
  const prevBoxes = inRoi.map((d) => d.box);
  // 확정: 즉시 기준 이상이거나, 직전 프레임에 같은 자리에서 잡혔던 것.
  const confirmed = inRoi.filter((d) => isInstant(d, profile) || isNearPrev(d.box, prev.prevBoxes));
  const rawStage = mostSevereStage(confirmed.map((d) => stageOfDetection(d)));
  const rawTopClass = rawStage === 'advance' ? null : (confirmed.find((d) => stageOfDetection(d) === rawStage)?.class ?? null);

  const rising = STAGE_RANK[rawStage] >= STAGE_RANK[prev.stage];
  if (rising) {
    const state = { stage: rawStage, topClass: rawTopClass, missStreak: 0, prevBoxes };
    return { state, vibrate: shouldVibrate(prev.stage, state.stage) };
  }

  const missStreak = prev.missStreak + 1;
  if (missStreak < STAGE_DROP_HOLD_FRAMES) {
    // hold: 아직 하락을 확정하지 않는다 — 단계·대표 클래스 모두 이전 값을 유지해 배너가 깜빡이지 않는다.
    return { state: { stage: prev.stage, topClass: prev.topClass, missStreak, prevBoxes }, vibrate: false };
  }
  const state = { stage: rawStage, topClass: rawTopClass, missStreak: 0, prevBoxes };
  return { state, vibrate: shouldVibrate(prev.stage, state.stage) };
}
