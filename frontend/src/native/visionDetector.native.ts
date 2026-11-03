import { requireOptionalNativeModule } from 'expo-modules-core';

import type { Detection } from '../lib/vision/visionTypes';
import type { SensitivityProfile } from '../lib/vision/sensitivityProfile';

interface VisionDetectorModule {
  detect(frameRef: unknown, confidenceByClass: Record<string, number>): Promise<Detection[]>;
}

const nativeModule = () => requireOptionalNativeModule<VisionDetectorModule>('VisionDetector');

/** 이 빌드에 비전 탐지 네이티브 모듈(TFLite/CoreML)이 들어있는지. 아직 Task 7의 Android/iOS 구현이 없어 항상 false다. */
export function isVisionDetectorAvailable(): boolean {
  return nativeModule() != null;
}

export async function detectFrame(frameRef: unknown, profile: SensitivityProfile): Promise<Detection[]> {
  const module = nativeModule();
  if (!module) return [];
  return module.detect(frameRef, profile.confidenceByClass);
}
