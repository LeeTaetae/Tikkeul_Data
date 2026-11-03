// 보호구역 상황 적응형 비전 민감도. 모델은 그대로 두고 추론 파라미터만 바꾼다. docs/ADR/0002 참고.
import type { Detection, HazardClass } from './visionTypes';

export interface SensitivityProfile {
  confidenceByClass: Record<HazardClass, number>;
  targetFps: number;
}

const BASE_CONFIDENCE: Record<HazardClass, number> = {
  kickboard: 0.45,
  motorcycle: 0.45,
  vehicle: 0.45,
  person: 0.45,
  animal: 0.45,
};

export const DEFAULT_SENSITIVITY: SensitivityProfile = { confidenceByClass: BASE_CONFIDENCE, targetFps: 5 };

// person 클래스만 낮춘다 — 다른 클래스까지 낮추면 오탐(동물·배경) 증가로 경고 피로가 생긴다.
export const PROTECTION_ZONE_SENSITIVITY: SensitivityProfile = {
  confidenceByClass: { ...BASE_CONFIDENCE, person: 0.25 },
  targetFps: 10,
};

export function sensitivityProfileFor(inProtectionZone: boolean): SensitivityProfile {
  return inProtectionZone ? PROTECTION_ZONE_SENSITIVITY : DEFAULT_SENSITIVITY;
}

export function passesThreshold(detection: Detection, profile: SensitivityProfile): boolean {
  return detection.confidence >= profile.confidenceByClass[detection.class];
}
