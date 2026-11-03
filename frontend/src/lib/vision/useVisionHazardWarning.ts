// 전방 비전 위험 경고의 한 프레임 처리(순수 함수 부분만 둔다 — 실제 주기적 detectFrame 폴링·진동 API
// 호출·화면 배선은 Task 7의 네이티브 모듈이 실제로 구현된 뒤 이어서 만든다. docs/ADR/0002 참고).
import type { HazardStage } from '../hazardStage';
import type { Detection, HazardClass } from './visionTypes';
import { mostSevereStage, stageOfDetection } from './visionHazardStage';
import { passesThreshold, type SensitivityProfile } from './sensitivityProfile';
import { shouldVibrate } from './visionAlertTrigger';

export interface VisionFrameResult {
  stage: HazardStage;
  vibrate: boolean;
  topClass: HazardClass | null;
}

export function reduceVisionFrame(prevStage: HazardStage, detections: Detection[], profile: SensitivityProfile): VisionFrameResult {
  const passed = detections.filter((d) => passesThreshold(d, profile));
  const stage = mostSevereStage(passed.map((d) => stageOfDetection(d)));
  const topClass = passed.find((d) => stageOfDetection(d) === stage)?.class ?? null;
  return { stage, vibrate: shouldVibrate(prevStage, stage), topClass: stage === 'advance' ? null : topClass };
}
