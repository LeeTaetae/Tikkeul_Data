// 보호구역 상황 적응형 비전 민감도. 모델은 그대로 두고 추론 파라미터만 바꾼다. docs/ADR/0002 참고.
import type { Detection, HazardClass } from './visionTypes';

export interface SensitivityProfile {
  // 후보 기준: 이 이상이면 후보로 본다. instantConfidence 미만인 후보는 같은 자리에서 연속 2프레임 잡혀야 경고한다.
  confidenceByClass: Record<HazardClass, number>;
  // 이 이상이면 한 프레임만으로 경고한다.
  instantConfidence: number;
  targetFps: number;
}

// 0.8 단일 기준은 오탐은 거의 없지만 빠른 객체를 거의 다 놓쳤다(ml/eval_motion_blur.py, person 169건:
// recall 블러 없음 0.19, 25px 블러 0.04). 0.4 후보 + 2프레임 확인으로 recall을 올리고(0.53 / 0.30),
// 단발성 오탐(0.4에서 100장당 4.7건)은 연속 프레임 확인으로 거른다. 0.6 이상은 오탐이 100장당 2.3건 이하라 즉시 경고.
const BASE_CONFIDENCE: Record<HazardClass, number> = {
  kickboard: 0.4,
  motorcycle: 0.4,
  vehicle: 0.4,
  person: 0.4,
  animal: 0.4,
};

const INSTANT_CONFIDENCE = 0.6;

// 5fps에서는 빠른 객체가 한두 프레임에만 잡혀 2프레임 확인이 어렵다 - 10fps로 올린다. 발열 시에는 thermalPolicy가 낮춘다.
export const DEFAULT_SENSITIVITY: SensitivityProfile = {
  confidenceByClass: BASE_CONFIDENCE,
  instantConfidence: INSTANT_CONFIDENCE,
  targetFps: 10,
};

// person 클래스만 낮춘다 — 다른 클래스까지 낮추면 오탐(동물·배경) 증가로 경고 피로가 생긴다.
export const PROTECTION_ZONE_SENSITIVITY: SensitivityProfile = {
  confidenceByClass: { ...BASE_CONFIDENCE, person: 0.25 },
  instantConfidence: INSTANT_CONFIDENCE,
  targetFps: 15,
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

export function isInstant(detection: Detection, profile: SensitivityProfile): boolean {
  return detection.confidence >= profile.instantConfidence;
}
