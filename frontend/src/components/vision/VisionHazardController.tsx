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
import { STAGE_RANK } from '../../lib/vision/visionAlertTrigger';

// MVP 임시 기준: 모델 recall(~0.57)로 final 안에서도 몇 프레임씩 놓쳤다가 재탐지되곤 한다. 그때마다 "재진입"으로
// 다시 진동·음성을 울리면 같은 대상이 계속 가까이 있는데도 반복 경고가 된다 - 배너는 그대로 두되(계속 final로 보임),
// 진동·음성만 이 시간 안에는 다시 울리지 않는다.
const ALERT_COOLDOWN_MS = 4000;

interface Props {
  enabled: boolean;
  // GPS 기준 어린이보호구역 등 상황 적응형 민감도 대상 구역 안에 있는지(frontend/src/lib/navigation/drivingDisplay.ts nearSchoolZone 등으로 계산).
  inProtectionZone: boolean;
  // 보호구역 안에서 차량 탐지를 다시 켤지 판단하는 데만 쓴다(sensitivityProfile.ts). 모르면 null.
  speedKmh: number | null;
}

export function VisionHazardController({ enabled, inProtectionZone, speedKmh }: Props) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<VisionFrameState>(INITIAL_VISION_FRAME_STATE);
  const [closed, setClosed] = useState(false);
  const lastAlertAt = useRef(0);
  // onDetections 안에서 항상 최신 값을 읽으려고 ref로 따로 들고 있는다 - 네이티브 카메라 콜백이
  // React 리렌더보다 빠르게 연속으로 오면 state(클로저)가 아직 이전 값이라 missStreak 하강 보정이
  // 정확히 누적되지 않을 수 있다(코드 리뷰 finding 3).
  const frameStateRef = useRef<VisionFrameState>(INITIAL_VISION_FRAME_STATE);

  useEffect(() => {
    if (!enabled) {
      frameStateRef.current = INITIAL_VISION_FRAME_STATE;
      setState(INITIAL_VISION_FRAME_STATE);
      setClosed(false);
      lastAlertAt.current = 0;
      void speaker.stopSpeaking();
    }
  }, [enabled]);

  if (!enabled) return null;

  const profile = sensitivityProfileFor(inProtectionZone, speedKmh);

  const onDetections = ({ nativeEvent }: { nativeEvent: { detections: RawDetectionEvent[] } }) => {
    const prev = frameStateRef.current;
    const detections = fromModelDetections(nativeEvent.detections);
    const result = reduceVisionFrame(prev, detections, profile);
    frameStateRef.current = result.state;
    setState(result.state);
    // 같은 위험이 계속 감지되는 동안(매 프레임) 다시 열지 않는다 - 사용자가 닫은 배너는 단계가
    // 실제로 더 나빠질 때만(= 새로운 위험으로 간주) 다시 띄운다(코드 리뷰 finding 1).
    if (STAGE_RANK[result.state.stage] > STAGE_RANK[prev.stage]) setClosed(false);
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

  // 카메라 권한 거부·모델 로드 실패·프레임 추론 오류를 조용히 버리지 않는다(코드 리뷰 finding 2) -
  // 사용자에게 보여줄 UI는 아직 없어 최소한 콘솔에는 남긴다.
  const onError = ({ nativeEvent }: { nativeEvent: { message: string } }) => {
    console.warn('[VisionHazardController] vision detector error:', nativeEvent.message);
  };

  return (
    <>
      <VisionDetectorView style={styles.hidden} targetFps={profile.targetFps} onDetections={onDetections} onError={onError} />
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
