import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// 웹은 브라우저 online/offline 이벤트를 쓴다. 네이티브 감지는 NetInfo 도입 시 추가(TBD).
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
