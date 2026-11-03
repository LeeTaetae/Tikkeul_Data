import { Car, Motorbike, PawPrint, PersonStanding, Scooter, X } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { HazardStage } from '../../lib/hazardStage';
import type { HazardClass } from '../../lib/vision/visionTypes';
import { MAX_CONTENT_WIDTH, colors, radius, shadow, space, visionHazardTone } from '../../theme';
import { Icon } from '../ui/Icon';
import { STAGE_PILL } from './NavigationHazardAlert';

// 전방 비전(YOLO) 탐지 배너. NavigationHazardAlert의 시각 패턴(색 띠·아이콘 타일·stage pill·닫기 버튼)을
// 따르되, 교통·ITS 경로 경고 전용 필드(RoadAlert, distanceM, message.params)는 쓰지 않는다.
// 공용 AlertType은 건드리지 않는다 — docs/ADR/0002-vision-yolo-integration.md 참고.
const CLASS_ICON: Record<HazardClass, typeof Car> = {
  kickboard: Scooter,
  motorcycle: Motorbike,
  vehicle: Car,
  person: PersonStanding,
  animal: PawPrint,
};

interface Props {
  hazardClass: HazardClass;
  stage: Exclude<HazardStage, 'advance'>;
  onClose: () => void;
}

export function VisionHazardAlert({ hazardClass, stage, onClose }: Props) {
  const { t } = useTranslation();
  const tone = visionHazardTone[hazardClass];
  const pill = STAGE_PILL[stage];

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <View style={[styles.card, { maxWidth: MAX_CONTENT_WIDTH }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
        <View style={[styles.band, { backgroundColor: tone.strong }]}>
          <Icon icon={CLASS_ICON[hazardClass]} size={28} color={colors.surface} />
          <Text style={[styles.message, { color: colors.surface }]}>{t(`visionHazard.message.${hazardClass}`)}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('hazard.close')} style={styles.close}>
            <Icon icon={X} size={22} color={colors.surface} strokeWidth={2.6} />
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={[styles.stagePill, { backgroundColor: pill.bg, borderColor: pill.border }]}>
            <Text style={[styles.stageText, { color: pill.fg }]}>{t(`hazard.stage.${stage}`)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  card: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  band: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.lg, paddingRight: space.xs },
  message: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 26, fontWeight: '800', paddingVertical: space.sm },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: space.lg, paddingVertical: space.md },
  stagePill: { alignSelf: 'flex-start', borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.sm, paddingVertical: 1 },
  stageText: { fontSize: 12, fontWeight: '800' },
});
