import { useState, type ReactNode } from 'react';

import { FloatingHeader } from './FloatingHeader';
import { MenuSheet } from './MenuSheet';

// 화면 맨 위 헤더 + 그 메뉴 시트. 메뉴 열림 상태를 안에서 들고 있어서, 화면은 제목만 넘기면 된다.
export function ScreenHeader({ title }: { title: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <FloatingHeader title={title} menuExpanded={menuOpen} onMenuPress={() => setMenuOpen(true)} />
      <MenuSheet visible={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
