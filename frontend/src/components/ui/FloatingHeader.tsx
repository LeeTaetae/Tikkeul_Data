import { Menu } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radius, shadow, space } from '../../theme';
import { RoundButton } from './RoundButton';

interface Props {
  // 왼쪽 제목 자리. 로고나 화면 제목을 넣는다.
  title: ReactNode;
  onMenuPress: () => void;
  menuExpanded: boolean;
}

// 지도 위에 뜨는 흰 헤더. 제목 + 메뉴 버튼만 둔다(언어 선택은 MenuSheet 안).
// 상단 Safe Area 는 이 컴포넌트를 담는 오버레이가 맡는다. 헤더 바깥 빈 곳은 지도 조작을 막지 않는다.
export function FloatingHeader({ title, onMenuPress, menuExpanded }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <View style={styles.title}>{title}</View>
      <RoundButton icon={Menu} label={t('menu.label')} variant="soft" size={44} expanded={menuExpanded} onPress={onMenuPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  title: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
});
