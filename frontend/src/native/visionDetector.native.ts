import { requireOptionalNativeModule } from 'expo-modules-core';

import type { Box, Detection } from '../lib/vision/visionTypes';
import type { SensitivityProfile } from '../lib/vision/sensitivityProfile';
import { fromModelDetections, toModelLabelConfidence, type ModelLabel } from '../lib/vision/modelLabels';

interface RawModelDetection {
  class: string;
  confidence: number;
  box: Box;
}

interface VisionDetectorModule {
  // confidenceByClass는 모델 라벨(ModelLabel) 기준이다 — 네이티브 쪽은 HazardClass를 모른다.
  detect(frameRef: unknown, confidenceByClass: Record<ModelLabel, number>): Promise<RawModelDetection[]>;
}

const nativeModule = () => requireOptionalNativeModule<VisionDetectorModule>('VisionDetector');

/** 이 빌드에 비전 탐지 네이티브 모듈(TFLite/CoreML)이 들어있는지. 아직 Task 7의 Android/iOS 구현이 없어 항상 false다. */
export function isVisionDetectorAvailable(): boolean {
  return nativeModule() != null;
}

export async function detectFrame(frameRef: unknown, profile: SensitivityProfile): Promise<Detection[]> {
  const module = nativeModule();
  if (!module) return [];
  const raw = await module.detect(frameRef, toModelLabelConfidence(profile.confidenceByClass));
  return fromModelDetections(raw);
}
