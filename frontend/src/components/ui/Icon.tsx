import type { LucideIcon } from 'lucide-react-native';
import type { ColorValue } from 'react-native';

import { colors } from '../../theme';

interface Props {
  icon: LucideIcon;
  size?: number;
  color?: ColorValue;
  strokeWidth?: number;
}

// lucide 아이콘의 크기·색·선 두께 기본값을 한곳에서 정한다. 아이콘은 장식이라 의미는 부모 라벨이 전달한다.
export function Icon({ icon: Glyph, size = 22, color = colors.ink, strokeWidth = 2 }: Props) {
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} />;
}
