import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, shadow } from '../../theme';
import { Icon } from './Icon';

type Variant = 'surface' | 'brand' | 'soft';

interface Props {
  icon: LucideIcon;
  // 글자가 없는 버튼이라 스크린리더가 읽을 이름이 필수다.
  label: string;
  onPress: () => void;
  variant?: Variant;
  // 터치 영역 최소 44px. 지도 위 떠 있는 버튼은 48 을 쓴다.
  size?: 44 | 48;
  expanded?: boolean;
}

const ICON_COLOR: Record<Variant, string> = {
  surface: colors.ink,
  brand: colors.surface,
  soft: colors.brand,
};

const BACKGROUND: Record<Variant, string> = {
  surface: colors.surface,
  brand: colors.brand,
  soft: colors.primarySoft,
};

// 동그란 아이콘 버튼. 현재 위치(FAB)·메뉴 버튼·닫기 버튼에 쓴다.
export function RoundButton({ icon, label, onPress, variant = 'surface', size = 48, expanded }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-expanded={expanded}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, backgroundColor: BACKGROUND[variant] },
        variant === 'surface' && styles.floating,
        pressed && styles.pressed,
      ]}
    >
      <Icon icon={icon} size={size === 48 ? 24 : 22} color={ICON_COLOR[variant]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  floating: { boxShadow: shadow.float },
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
});
