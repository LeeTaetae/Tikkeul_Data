// 보호구역 상황 적응형 비전 민감도. 모델은 그대로 두고 추론 파라미터만 바꾼다. docs/ADR/0002 참고.
import type { Detection, HazardClass } from './visionTypes';

export interface SensitivityProfile {
  confidenceByClass: Record<HazardClass, number>;
  targetFps: number;
}

// 0.45 -> 0.8: 실기기 테스트에서 학습 범위 밖 사물(실내 책상 등)이 애매한 확신도로 오탐되는 경우가
// 많아, 기준을 올려 자신 없는 탐지를 더 많이 걸러낸다. docs/ADR/0002 참고.
const BASE_CONFIDENCE: Record<HazardClass, number> = {
  kickboard: 0.8,
  motorcycle: 0.8,
  vehicle: 0.8,
  person: 0.8,
  animal: 0.8,
};

export const DEFAULT_SENSITIVITY: SensitivityProfile = { confidenceByClass: BASE_CONFIDENCE, targetFps: 5 };

// person 클래스만 낮춘다 — 다른 클래스까지 낮추면 오탐(동물·배경) 증가로 경고 피로가 생긴다.
export const PROTECTION_ZONE_SENSITIVITY: SensitivityProfile = {
  confidenceByClass: { ...BASE_CONFIDENCE, person: 0.25 },
  targetFps: 10,
};

// 보호구역 안에서는 차량이 갑자기 튀어나올 상황이 없다고 보고 차량 탐지를 끈다(오탐·경고 피로 방지).
// 다만 이 속도 이상으로 달리고 있으면(= 도로 주행에 가까움) 차량 탐지를 다시 켠다.
const VEHICLE_DISABLE_MIN_SPEED_KMH = 50;

export function sensitivityProfileFor(inProtectionZone: boolean, speedKmh: number | null): SensitivityProfile {
  const base = inProtectionZone ? PROTECTION_ZONE_SENSITIVITY : DEFAULT_SENSITIVITY;
  if (!inProtectionZone) return base;
  const fastEnoughToKeepVehicleDetection = speedKmh !== null && speedKmh >= VEHICLE_DISABLE_MIN_SPEED_KMH;
  if (fastEnoughToKeepVehicleDetection) return base;
  return { ...base, confidenceByClass: { ...base.confidenceByClass, vehicle: Number.POSITIVE_INFINITY } };
}

export function passesThreshold(detection: Detection, profile: SensitivityProfile): boolean {
  return detection.confidence >= profile.confidenceByClass[detection.class];
}
