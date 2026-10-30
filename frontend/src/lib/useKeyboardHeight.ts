import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// 화면 키보드가 가리는 높이(px). 키보드가 없으면 0.
// 네이티브는 Keyboard 이벤트로, 웹(모바일 브라우저)은 visualViewport 가 줄어든 만큼으로 잰다.
// 핀치 줌(scale > 1)으로 visualViewport 가 줄어든 경우는 키보드가 아니므로 0 으로 본다.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (viewport) {
      const update = () =>
        setHeight(viewport.scale > 1 ? 0 : Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
      update();
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      return () => {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
      };
    }
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
