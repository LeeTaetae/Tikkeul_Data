import { useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { MAX_CONTENT_WIDTH, colors, radius, shadow, space } from '../../theme';

const COLLAPSED_HEIGHT = 180;
// PanResponder 가 "탭"과 "드래그"를 가르는 기준(px). 기존 DraggableSheet 와 같다.
const DRAG_THRESHOLD = 4;

interface Props {
  windowHeight: number;
  // 하단 Safe Area 높이. 내용이 홈 인디케이터에 가리지 않게 아래 여백으로 더한다.
  bottomInset: number;
  // true 면 손잡이를 위아래로 끌어 접고 펼친다. false 면 내용 높이만큼만 차지하는 고정 패널.
  draggable?: boolean;
  // 펼쳤을 때 넘지 않을 최대 높이. 시트 위에 경고처럼 꼭 보여야 하는 것을 올려놓을 자리를 비울 때 쓴다(기본은 화면의 75%).
  maxExpandedHeight?: number;
  // 시트가 실제로 차지하는 높이를 알린다. 시트 위에 다른 것(위험 경고)을 올려놓을 때 쓴다.
  onHeightChange?: (height: number) => void;
  children: ReactNode;
}

// 지도 위로 올라오는 하단 시트(경로 결과·상세 경로·위험 정보).
// 시트 바깥은 터치를 지도로 통과시키고(box-none), 드래그는 손잡이에만 걸어서 안쪽 ScrollView 스크롤과 충돌하지 않는다.
export function BottomSheet({ windowHeight, bottomInset, draggable = true, maxExpandedHeight, onHeightChange, children }: Props) {
  const { t } = useTranslation();
  const expandedHeight = Math.max(COLLAPSED_HEIGHT, Math.min(Math.round(windowHeight * 0.75), maxExpandedHeight ?? Infinity));
  const expandedRef = useRef(expandedHeight);
  expandedRef.current = expandedHeight;

  const [rawHeight, setHeight] = useState(COLLAPSED_HEIGHT);
  // 최대 높이가 줄어들면(경고가 떠서) 이미 펼쳐 둔 시트도 같이 줄어든다.
  const height = Math.min(rawHeight, expandedHeight);
  // 드래그를 시작한 시점의 높이. 손을 뗄 때마다 확정된 높이로 갱신한다.
  const settledRef = useRef(COLLAPSED_HEIGHT);
  const expanded = height > COLLAPSED_HEIGHT;

  // 웹은 드래그를 끝내고 손을 떼면 click 도 한 번 더 보낸다. 그 click 이 탭 토글로 이어지지 않게 막는 표시.
  const draggedRef = useRef(false);

  const settle = (dy: number) => {
    const mid = (COLLAPSED_HEIGHT + expandedRef.current) / 2;
    const next = settledRef.current - dy > mid ? expandedRef.current : COLLAPSED_HEIGHT;
    settledRef.current = next;
    setHeight(next);
    // click 은 손을 뗀 직후 같은 틱에 오므로, 그 뒤에 표시를 지운다.
    setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };

  const panResponder = useRef(
    PanResponder.create({
      // 처음 터치는 안쪽 Pressable(탭)이 받고, 세로로 끌기 시작하면 캡처 단계에서 가로채 드래그로 바꾼다.
      onMoveShouldSetPanResponderCapture: (_, gesture) => Math.abs(gesture.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        draggedRef.current = true;
      },
      onPanResponderMove: (_, gesture) => {
        setHeight(Math.min(Math.max(settledRef.current - gesture.dy, COLLAPSED_HEIGHT), expandedRef.current));
      },
      onPanResponderRelease: (_, gesture) => settle(gesture.dy),
      onPanResponderTerminate: (_, gesture) => settle(gesture.dy),
    }),
  ).current;

  // 키보드·스크린리더 사용자를 위한 대체 동작: 손잡이를 누르면 접힘 ↔ 펼침.
  const toggle = () => {
    if (draggedRef.current) return;
    const next = settledRef.current === COLLAPSED_HEIGHT ? expandedRef.current : COLLAPSED_HEIGHT;
    settledRef.current = next;
    setHeight(next);
  };

  const sheetHeight = draggable ? { height, maxHeight: height } : { maxHeight: Math.round(windowHeight * 0.6) };

  return (
    <View style={styles.layer}>
      <View
        style={[styles.sheet, sheetHeight]}
        onLayout={(e) => onHeightChange?.(Math.round(e.nativeEvent.layout.height))}
      >
        {draggable && (
          <View {...panResponder.panHandlers}>
            <Pressable
              onPress={toggle}
              accessibilityRole="button"
              accessibilityLabel={t(expanded ? 'sheet.collapse' : 'sheet.expand')}
              aria-expanded={expanded}
              style={styles.handleArea}
            >
              <View style={styles.handle} />
            </Pressable>
          </View>
        )}
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + space.lg }]}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 화면 전체를 덮지만 box-none 이라 시트 밖은 지도로 터치가 통과한다.
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
    justifyContent: 'flex-end',
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    boxShadow: shadow.sheet,
  },
  // 터치 영역 44px 이상. 눈에 보이는 손잡이는 얇아도 누를 수 있는 영역은 넓게 잡는다.
  handleArea: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.line },
  content: { paddingHorizontal: space.lg, paddingTop: space.xs, gap: space.sm },
});
