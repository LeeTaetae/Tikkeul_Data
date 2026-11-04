// 전방 비전 경고를 실제 길안내 화면에 배선한다. 카메라 화면은 보여주지 않는다(ADR 0002) - 뷰는 1x1로
// 숨기되 마운트는 유지해 네이티브 캡처 세션이 계속 돈다. enabled 가 꺼지면(길안내 종료 등) 상태를 리셋한다.
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Vibration } from 'react-native';
import { useTranslation } from 'react-i18next';

import { VisionHazardAlert } from '../alerts/VisionHazardAlert';
import { VisionDetectorView, type RawDetectionEvent } from '../../native/visionDetectorView';
import { speaker } from '../../lib/speech/speaker';
import { sensitivityProfileFor } from '../../lib/vision/sensitivityProfile';
import { fromModelDetections } from '../../lib/vision/modelLabels';
import { INITIAL_VISION_FRAME_STATE, reduceVisionFrame, type VisionFrameState } from '../../lib/vision/useVisionHazardWarning';

// MVP 임시 기준: 모델 recall(~0.57)로 final 안에서도 몇 프레임씩 놓쳤다가 재탐지되곤 한다. 그때마다 "재진입"으로
// 다시 진동·음성을 울리면 같은 대상이 계속 가까이 있는데도 반복 경고가 된다 - 배너는 그대로 두되(계속 final로 보임),
// 진동·음성만 이 시간 안에는 다시 울리지 않는다.
const ALERT_COOLDOWN_MS = 4000;

interface Props {
  enabled: boolean;
  // GPS 기준 어린이보호구역 등 상황 적응형 민감도 대상 구역 안에 있는지(frontend/src/lib/navigation/drivingDisplay.ts nearSchoolZone 등으로 계산).
  inProtectionZone: boolean;
}

export function VisionHazardController({ enabled, inProtectionZone }: Props) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<VisionFrameState>(INITIAL_VISION_FRAME_STATE);
  const [closed, setClosed] = useState(false);
  const lastAlertAt = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_VISION_FRAME_STATE);
      setClosed(false);
      lastAlertAt.current = 0;
      void speaker.stopSpeaking();
    }
  }, [enabled]);

  if (!enabled) return null;

  const profile = sensitivityProfileFor(inProtectionZone);

  const onDetections = ({ nativeEvent }: { nativeEvent: { detections: RawDetectionEvent[] } }) => {
    const detections = fromModelDetections(nativeEvent.detections);
    const result = reduceVisionFrame(state, detections, profile);
    setState(result.state);
    if (result.state.stage !== 'advance') setClosed(false);
    const now = Date.now();
    if (result.vibrate && now - lastAlertAt.current >= ALERT_COOLDOWN_MS) {
      lastAlertAt.current = now;
      Vibration.vibrate();
      // 돌발 상황이라 안내 중인 다른 음성(턴 안내 등)을 끊고 바로 읽는다(interrupt: true).
      if (result.state.topClass) {
        void speaker.speak(t(`visionHazard.finalSpeech.${result.state.topClass}`), i18n.language, { source: 'vision-hazard', interrupt: true });
      }
    }
  };

  return (
    <>
      <VisionDetectorView style={styles.hidden} targetFps={profile.targetFps} onDetections={onDetections} />
      {!closed && state.stage !== 'advance' && state.topClass && (
        <VisionHazardAlert hazardClass={state.topClass} stage={state.stage} onClose={() => setClosed(true)} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // 화면에 보이지 않지만(ADR 0002) 캡처 세션이 돌 수 있게 마운트는 유지한다.
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
