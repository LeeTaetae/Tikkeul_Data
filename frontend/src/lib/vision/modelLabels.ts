// 모델(ultralytics) 출력 라벨 ↔ 앱의 HazardClass 변환. 모델 클래스명은 car이고 앱은 vehicle을 쓴다
// (docs/ADR/0002-vision-yolo-integration.md 참고). 신뢰 경계(네이티브 모듈이 돌려준 값)에서 변환하고,
// 모델에 없는 라벨은 조용히 버린다 — 라벨이 바뀌어도 앱이 죽지 않게 한다.
import type { Box, Detection, HazardClass } from './visionTypes';

export type ModelLabel = 'kickboard' | 'person' | 'car' | 'motorcycle' | 'animal';

const HAZARD_CLASS_TO_MODEL_LABEL: Record<HazardClass, ModelLabel> = {
  kickboard: 'kickboard',
  person: 'person',
  vehicle: 'car',
  motorcycle: 'motorcycle',
  animal: 'animal',
};

const MODEL_LABEL_TO_HAZARD_CLASS: Record<ModelLabel, HazardClass> = {
  kickboard: 'kickboard',
  person: 'person',
  car: 'vehicle',
  motorcycle: 'motorcycle',
  animal: 'animal',
};

export function toModelLabelConfidence(confidenceByClass: Record<HazardClass, number>): Record<ModelLabel, number> {
  const out = {} as Record<ModelLabel, number>;
  for (const hazardClass of Object.keys(confidenceByClass) as HazardClass[]) {
    out[HAZARD_CLASS_TO_MODEL_LABEL[hazardClass]] = confidenceByClass[hazardClass];
  }
  return out;
}

interface RawDetection {
  class: string;
  confidence: number;
  box: Box;
}

export function fromModelDetections(raw: RawDetection[]): Detection[] {
  const out: Detection[] = [];
  for (const d of raw) {
    const hazardClass = MODEL_LABEL_TO_HAZARD_CLASS[d.class as ModelLabel];
    if (!hazardClass) continue; // 모델에 없는/바뀐 라벨은 버린다
    out.push({ class: hazardClass, confidence: d.confidence, box: d.box });
  }
  return out;
}
