// 관리자 화면 안에 들어가는 탐지 디버그 패널: 실기기에서 멀리/가까이에 따라 단계·진동이 맞게 동작하는지, 빠르게 지나가는
// 차를 놓치는지 확인한다. 신뢰도 기준·추론 주기를 화면에서 바꿔 보고, 기준에 걸러진 탐지도 신뢰도와 함께 보여준다.
// docs/ADR/0002-vision-yolo-integration.md 참고. 캘리브레이션 끝나면 정한 값을 sensitivityProfile.ts 에 반영한다.
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, Vibration, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { VisionHazardAlert } from '../alerts/VisionHazardAlert';
import { VisionDetectorView, VISION_DETECTOR_AVAILABLE, type RawDetectionEvent } from '../../native/visionDetectorView';
import { PortalCandidateOverlay, usePortalCandidates } from './PortalCandidateOverlay';
import { DEFAULT_SENSITIVITY, isInstant, passesThreshold, type SensitivityProfile } from '../../lib/vision/sensitivityProfile';
import { fromModelDetections } from '../../lib/vision/modelLabels';
import { stageOfDetection } from '../../lib/vision/visionHazardStage';
import type { Detection, HazardClass } from '../../lib/vision/visionTypes';
import { INITIAL_VISION_FRAME_STATE, reduceVisionFrame, type VisionFrameState } from '../../lib/vision/useVisionHazardWarning';
import { colors } from '../../theme';
import { STAGE_RANK } from '../../lib/vision/visionAlertTrigger';

const FPS_OPTIONS = [5, 10, 15, 30];
const CLASSES = Object.keys(DEFAULT_SENSITIVITY.confidenceByClass) as HazardClass[];

function profileOf(threshold: number, fps: number): SensitivityProfile {
  const confidenceByClass = {} as Record<HazardClass, number>;
  for (const c of CLASSES) confidenceByClass[c] = threshold;
  return { confidenceByClass, instantConfidence: DEFAULT_SENSITIVITY.instantConfidence, targetFps: fps };
}

// 권한 확인은 이 패널을 띄우는 쪽(관리자 화면)이 한다. 카메라를 켜므로 화면이 보일 때만 마운트한다.
export function VisionDebugPanel() {
  const [portalEnabled,setPortalEnabled]=useState(true);
  const [portalThreshold,setPortalThreshold]=useState(0.6);
  const portals=usePortalCandidates(portalEnabled && VISION_DETECTOR_AVAILABLE,portalThreshold);
  const { t } = useTranslation();
  const [state, setState] = useState<VisionFrameState>(INITIAL_VISION_FRAME_STATE);
  const [errorMsgs, setErrorMsgs] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const [debug, setDebug] = useState({ rawType: '-', rawCount: 0, recognizedCount: 0 });
  const [threshold, setThreshold] = useState(DEFAULT_SENSITIVITY.confidenceByClass.vehicle);
  const [fps, setFps] = useState(DEFAULT_SENSITIVITY.targetFps);
  const [lastDetections, setLastDetections] = useState<Detection[]>([]);
  const profile = profileOf(threshold, fps);
  const frameStateRef=useRef(INITIAL_VISION_FRAME_STATE);
  const lastAlertAt=useRef(0);


  const onDetections = ({
    nativeEvent,
  }: {
    nativeEvent: { detections: RawDetectionEvent[]; debugRawType: string; debugRawCount: number; debugRecognizedCount: number };
  }) => {
    setDebug({ rawType: nativeEvent.debugRawType, rawCount: nativeEvent.debugRawCount, recognizedCount: nativeEvent.debugRecognizedCount });
    const detections = fromModelDetections(nativeEvent.detections);
    setLastDetections(detections);
    const prev=frameStateRef.current;
    const result = reduceVisionFrame(prev, detections, profile);
    frameStateRef.current=result.state;
    setState(result.state);
    if (STAGE_RANK[result.state.stage]>STAGE_RANK[prev.stage]) setClosed(false);
    const now=Date.now();
    if (result.vibrate && now-lastAlertAt.current>=4000) {lastAlertAt.current=now;Vibration.vibrate();}
  };

  const stepThreshold = (delta: number) =>
    setThreshold((v) => Math.round(Math.min(0.95, Math.max(0.1, v + delta)) * 100) / 100);

  // The admin's existing permission/focus gate owns this panel. No second camera route is mounted.
  if (!VISION_DETECTOR_AVAILABLE) return <Text style={styles.unsupported}>{t('auth.adminVisionUnsupported')}</Text>;

  return (
    <View style={styles.container}>
      <VisionDetectorView
        style={styles.camera}
        targetFps={fps}
        portalCandidatesEnabled={portalEnabled}
        onPortalFrame={portals.onPortalFrame}
        onDetections={onDetections}
        onError={(e) => setErrorMsgs((prev) => [...prev, e.nativeEvent.message])}
      />
      {portalEnabled && <PortalCandidateOverlay sample={portals.sample} />}
      <View style={styles.portalControls}>
        <Text style={styles.debugText}>터널 후보 (실험용)</Text>
        <Switch value={portalEnabled} onValueChange={setPortalEnabled} />
        <Pressable accessibilityLabel="터널 후보 임계값 낮추기" onPress={()=>setPortalThreshold(v=>Math.max(.3,Math.round((v-.05)*100)/100))}><Text style={styles.debugText}> − </Text></Pressable>
        <Text style={styles.debugText}>{portalThreshold.toFixed(2)}</Text>
        <Pressable accessibilityLabel="터널 후보 임계값 높이기" onPress={()=>setPortalThreshold(v=>Math.min(.95,Math.round((v+.05)*100)/100))}><Text style={styles.debugText}> ＋ </Text></Pressable>
      </View>
      <View style={styles.debug} pointerEvents="none">
        <Text style={styles.debugText}>stage: {state.stage}</Text>
        <Text style={styles.debugText}>class: {state.topClass ?? '-'}</Text>
        <Text style={styles.debugText}>rawType: {debug.rawType}</Text>
        <Text style={styles.debugText}>rawCount: {debug.rawCount}</Text>
        <Text style={styles.debugText}>recognizedCount: {debug.recognizedCount}</Text>
        {/* ✓ 즉시 경고 · ~ 후보(연속 2프레임이면 경고) · ✗ 기준 미달. 빠른 객체가 낮은 신뢰도로 잡혔다가
            걸러지는지, 아예 안 잡히는지 구분하려고 미달도 보여준다. */}
        <Text style={styles.debugText}>instant ≥ {profile.instantConfidence.toFixed(2)}</Text>
        {lastDetections.map((d, i) => (
          <Text key={i} style={styles.debugText}>
            {isInstant(d, profile) ? '✓' : passesThreshold(d, profile) ? '~' : '✗'} {d.class} {d.confidence.toFixed(2)} h={d.box.height.toFixed(2)} {stageOfDetection(d)}
          </Text>
        ))}
        {errorMsgs.map((msg, i) => (
          <Text key={i} style={styles.debugText}>
            error: {msg}
          </Text>
        ))}
      </View>
      <View style={styles.controls}>
        <Text style={styles.controlLabel}>conf ≥ {threshold.toFixed(2)}</Text>
        <Pressable accessibilityRole="button" style={styles.controlButton} onPress={() => stepThreshold(-0.05)}>
          <Text style={styles.controlButtonText}>−</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.controlButton} onPress={() => stepThreshold(0.05)}>
          <Text style={styles.controlButtonText}>+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.controlButton}
          onPress={() => setFps((v) => FPS_OPTIONS[(FPS_OPTIONS.indexOf(v) + 1) % FPS_OPTIONS.length])}
        >
          <Text style={styles.controlButtonText}>{fps} fps</Text>
        </Pressable>
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
  portalControls:{position:'absolute',bottom:105,left:12,right:12,flexDirection:'row',alignItems:'center',gap:8},
  container: { height: 560, backgroundColor: 'black', borderRadius: 12, overflow: 'hidden' },
  camera: { flex: 1 },
  debug: { position: 'absolute', top: 12, left: 12, gap: 4 },
  debugText: { color: 'white', fontSize: 14, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.5)' },
  controls: { position: 'absolute', bottom: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  controlLabel: { color: 'white', fontSize: 16, fontWeight: '800', backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 8 },
  controlButton: { backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  controlButtonText: { fontSize: 16, fontWeight: '800', color: 'black' },
  unsupported: { color: colors.muted },
});
