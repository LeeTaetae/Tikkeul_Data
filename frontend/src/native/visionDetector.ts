// 브라우저 빌드에는 비전 탐지 네이티브 모듈이 없다. docs/ADR/0002-vision-yolo-integration.md 참고.
import type { Detection } from '../lib/vision/visionTypes';
import type { SensitivityProfile } from '../lib/vision/sensitivityProfile';

export function isVisionDetectorAvailable(): boolean {
  return false;
}

export async function detectFrame(_frameRef: unknown, _profile: SensitivityProfile): Promise<Detection[]> {
  return [];
}
