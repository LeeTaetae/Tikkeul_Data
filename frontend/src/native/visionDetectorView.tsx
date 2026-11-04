// 개발용 임시 테스트 뷰: modules/vision-detector(iOS만, Android/웹 네이티브 모듈 없음)를 감싼다.
// docs/ADR/0002-vision-yolo-integration.md 참고. 캘리브레이션 끝나면 실제 배선으로 교체한다.
import { Platform, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

import type { Box } from '../lib/vision/visionTypes';

export interface RawDetectionEvent {
  class: string;
  confidence: number;
  box: Box;
}

export interface VisionDetectorViewProps extends ViewProps {
  targetFps?: number;
  onDetections?: (event: {
    nativeEvent: { detections: RawDetectionEvent[]; debugRawType: string; debugRawCount: number; debugRecognizedCount: number };
  }) => void;
  onError?: (event: { nativeEvent: { message: string } }) => void;
}

const NativeView =
  Platform.OS === 'ios' ? requireNativeViewManager<VisionDetectorViewProps>('VisionDetector') : null;

export function VisionDetectorView(props: VisionDetectorViewProps) {
  if (!NativeView) return null;
  return <NativeView {...props} />;
}
