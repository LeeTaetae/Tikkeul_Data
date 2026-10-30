import { ArrowUp, CornerUpLeft, CornerUpRight, Flag, Navigation, Undo2, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { formatDistance } from '../../lib/distance';
import { turnKindOf, type TurnKind } from '../../lib/navigation/guidanceDisplay';
import type { RouteGuide } from '../../map/parseRoutes';
import { colors, radius, shadow, space } from '../../theme';
import { Icon } from '../ui/Icon';

const ICON: Record<TurnKind, LucideIcon> = {
  straight: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  uturn: Undo2,
  arrive: Flag,
  generic: Navigation,
};

interface Props {
  /** 다음 안내 지점과 거기까지 남은 거리. guides 가 없거나 남은 지점이 없으면 null */
  turn: { guide: RouteGuide; distanceM: number } | null;
}

// 상단 회전 안내. 방향은 검증된 turnType(guidanceDisplay.turnKindOf)만 아이콘·문구로 보여준다.
// 모르는 turnType 은 중립 아이콘과 TMAP 이 준 안내 문구를 그대로 보여주고, guides 가 없으면 "경로를 따라 이동하세요"만 보여준다.
export function TurnCard({ turn }: Props) {
  const { t } = useTranslation();
  const kind: TurnKind | null = turn ? turnKindOf(turn.guide) : null;

  let title: string;
  let detail: string | null = null;
  if (!turn || !kind) {
    title = t('nav.turn.keepGoing');
  } else if (kind === 'generic') {
    // TMAP 안내 문구를 그대로 보여준다. 문구가 없으면 일반 안내 문구로 대신한다.
    title = formatDistance(turn.distanceM);
    detail = turn.guide.description || t('nav.turn.generic');
  } else {
    title = formatDistance(turn.distanceM);
    detail = [t(`nav.turn.${kind}`), turn.guide.nextRoadName].filter(Boolean).join(' · ');
  }

  return (
    <View style={styles.card} accessibilityRole="header" accessibilityLabel={detail ? `${title}, ${detail}` : title}>
      <View style={styles.tile}>
        <Icon icon={ICON[kind ?? 'generic']} size={32} color={colors.surface} strokeWidth={2.6} />
      </View>
      <View style={styles.texts}>
        <Text style={turn ? styles.distance : styles.plain} numberOfLines={turn ? 1 : 2}>
          {title}
        </Text>
        {detail && (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    boxShadow: shadow.float,
  },
  tile: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  distance: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: colors.surface },
  plain: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: colors.surface },
  detail: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.line },
});
