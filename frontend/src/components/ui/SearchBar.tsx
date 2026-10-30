import { Search, type LucideIcon } from 'lucide-react-native';
import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, shadow, space } from '../../theme';
import { Icon } from './Icon';

interface Props
  extends Pick<
    TextInputProps,
    'value' | 'onChangeText' | 'onFocus' | 'onBlur' | 'onSubmitEditing' | 'placeholder' | 'returnKeyType' | 'autoFocus'
  > {
  accessibilityLabel: string;
  // 입력창 ref. 부모가 다른 입력창으로 포커스를 옮길 때 쓴다.
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
  leadingIcon?: LucideIcon;
  // 오른쪽 자리. 검색 버튼 같은 부모의 요소를 넣는다.
  trailing?: ReactNode;
}

// 지도 위에 뜨는 검색창. 모양만 담당하고, 검색 동작은 부모가 넘긴 핸들러(onChangeText·onSubmitEditing 등)가 그대로 처리한다.
export function SearchBar({
  accessibilityLabel,
  inputRef,
  leadingIcon = Search,
  trailing,
  onFocus,
  onBlur,
  ...inputProps
}: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.bar, focused && styles.barFocused]}>
      <Icon icon={leadingIcon} size={20} color={colors.muted} />
      <TextInput
        ref={inputRef}
        accessibilityLabel={accessibilityLabel}
        placeholderTextColor={colors.muted}
        style={styles.input}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...inputProps}
      />
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    boxShadow: shadow.float,
  },
  // 키보드 포커스 위치가 보이도록 브랜드 색 테두리를 건다.
  barFocused: { borderColor: colors.brand },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    fontSize: 16,
    color: colors.ink,
    // 웹 기본 포커스 윤곽선은 바깥 테두리(barFocused)가 대신한다.
    outlineWidth: 0,
  },
});
