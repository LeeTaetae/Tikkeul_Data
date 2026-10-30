import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, space } from '../../theme';
import { Icon } from './Icon';

interface Props {
  label: string;
  // 안 주면 상태 없는 일반 버튼. 주면 선택 상태를 가진 버튼(role=button 은 눌림 토글, radio 는 선택 하나).
  selected?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
  // 이동수단·필터는 button, 언어처럼 하나만 고르는 묶음은 radio 로 쓴다.
  role?: 'button' | 'radio';
}

// 알약 모양 선택 버튼. 선택되면 브랜드 퍼플로 채우고 글자를 굵게 해서 색 말고 굵기로도 구분된다.
export function Chip({ label, selected, onPress, icon, role = 'button' }: Props) {
  const fg = selected ? colors.surface : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      // RN 웹은 accessibilityState 를 aria 속성으로 내보내지 않아 aria-* 를 쓴다. radio 에는 checked, button 에는 pressed.
      aria-checked={role === 'radio' ? selected : undefined}
      aria-pressed={role === 'radio' ? undefined : selected}
      style={({ pressed }) => [styles.base, selected && styles.selected, pressed && styles.pressed]}
    >
      {icon && <Icon icon={icon} size={18} color={fg} />}
      <Text style={[styles.text, { color: fg }, selected && styles.textSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  pressed: { opacity: 0.8 },
  text: { fontSize: 14, fontWeight: '600' },
  textSelected: { fontWeight: '800' },
});
