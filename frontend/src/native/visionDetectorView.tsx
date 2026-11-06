// modules/vision-detector(iOS Swift·Android Kotlin, 웹은 네이티브 모듈 없음)를 감싼다. 두 플랫폼의 이벤트 계약은 같다.
// docs/ADR/0002-vision-yolo-integration.md, docs/ANDROID_VISION_DETECTOR.md 참고.
import { Platform, type ViewProps } from 'react-native';
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';

import type { Box } from '../lib/vision/visionTypes';
import type { PortalFrame } from '../lib/vision/portalCandidates';

export interface RawDetectionEvent {
  class: string;
  confidence: number;
  box: Box;
}

export interface VisionDetectorViewProps extends ViewProps {
  targetFps?: number;
  portalCandidatesEnabled?: boolean;
  onPortalFrame?: (event: { nativeEvent: PortalFrame }) => void;
  onDetections?: (event: {
    nativeEvent: { detections: RawDetectionEvent[]; debugRawType: string; debugRawCount: number; debugRecognizedCount: number };
  }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
}

// iOS 는 기존과 같다. Android 는 비전 모듈이 들어 있는 빌드에서만 뷰를 만든다 - 모듈 추가 전에 만든 APK 에 새 JS 가 올라가도
// 앱이 죽지 않고 탐지만 꺼진다(웹은 항상 null).
const NativeView =
  Platform.OS === 'ios' || (Platform.OS === 'android' && requireOptionalNativeModule('VisionDetector') != null)
    ? requireNativeViewManager<VisionDetectorViewProps>('VisionDetector')
    : null;

export const VISION_DETECTOR_AVAILABLE = NativeView !== null;

export function VisionDetectorView(props: VisionDetectorViewProps) {
  if (!NativeView) return null;
  return <NativeView {...props} />;
}
