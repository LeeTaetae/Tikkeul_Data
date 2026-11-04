// 개발용 임시 테스트 화면: 실기기에서 멀리/가까이에 따라 단계·진동이 맞게 동작하는지 확인한다.
// docs/ADR/0002-vision-yolo-integration.md 참고. 캘리브레이션 끝나면 지우거나 navigation.tsx 실제 배선으로 교체한다.
import { useState } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';

import { VisionHazardAlert } from '../src/components/alerts/VisionHazardAlert';
import { VisionDetectorView, type RawDetectionEvent } from '../src/native/visionDetectorView';
import { DEFAULT_SENSITIVITY } from '../src/lib/vision/sensitivityProfile';
import { fromModelDetections } from '../src/lib/vision/modelLabels';
import { INITIAL_VISION_FRAME_STATE, reduceVisionFrame, type VisionFrameState } from '../src/lib/vision/useVisionHazardWarning';

export default function VisionTestScreen() {
  const [state, setState] = useState<VisionFrameState>(INITIAL_VISION_FRAME_STATE);
  const [errorMsgs, setErrorMsgs] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const [debug, setDebug] = useState({ rawType: '-', rawCount: 0, recognizedCount: 0 });

  const onDetections = ({
    nativeEvent,
  }: {
    nativeEvent: { detections: RawDetectionEvent[]; debugRawType: string; debugRawCount: number; debugRecognizedCount: number };
  }) => {
    setDebug({ rawType: nativeEvent.debugRawType, rawCount: nativeEvent.debugRawCount, recognizedCount: nativeEvent.debugRecognizedCount });
    const detections = fromModelDetections(nativeEvent.detections);
    const result = reduceVisionFrame(state, detections, DEFAULT_SENSITIVITY);
    setState(result.state);
    if (result.state.stage !== 'advance') setClosed(false);
    if (result.vibrate) Vibration.vibrate();
  };

  return (
    <View style={styles.container}>
      <VisionDetectorView
        style={styles.camera}
        targetFps={DEFAULT_SENSITIVITY.targetFps}
        onDetections={onDetections}
        onError={(e) => setErrorMsgs((prev) => [...prev, e.nativeEvent.message])}
      />
      <View style={styles.debug} pointerEvents="none">
        <Text style={styles.debugText}>stage: {state.stage}</Text>
        <Text style={styles.debugText}>class: {state.topClass ?? '-'}</Text>
        <Text style={styles.debugText}>rawType: {debug.rawType}</Text>
        <Text style={styles.debugText}>rawCount: {debug.rawCount}</Text>
        <Text style={styles.debugText}>recognizedCount: {debug.recognizedCount}</Text>
        {errorMsgs.map((msg, i) => (
          <Text key={i} style={styles.debugText}>
            error: {msg}
          </Text>
        ))}
      </View>
      {!closed && state.stage !== 'advance' && state.topClass && (
        <VisionHazardAlert
          hazardClass={state.topClass}
          stage={state.stage}
          onClose={() => setClosed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  camera: { flex: 1 },
  debug: { position: 'absolute', top: 60, left: 16, gap: 4 },
  debugText: { color: 'white', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)' },
});
