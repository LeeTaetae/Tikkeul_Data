import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { KAKAO_JS_KEY } from '../lib/config';
import { colors } from '../theme';

declare global {
  interface Window {
    kakao?: {
      maps: {
        load: (callback: () => void) => void;
        LatLng: new (lat: number, lng: number) => object;
        Map: new (container: HTMLElement, options: { center: object; level: number }) => object;
      };
    };
  }
}

const SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js';

export function KakaoMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'keyMissing' | 'loadError'>(
    KAKAO_JS_KEY ? 'loading' : 'keyMissing',
  );

  const { t } = useTranslation();

  useEffect(() => {
    if (!KAKAO_JS_KEY) return;

    let canceled = false;

    // SDK 로드가 끝난 뒤 호출한다.
    const initMap = () => {
      const container = containerRef.current;
      const kakao = window.kakao;
      if (canceled || !container) return;
      if (!kakao) {
        setStatus('loadError');
        return;
      }

      // autoload=false 라서 load 콜백 안에서만 kakao.maps 객체를 쓸 수 있다.
      kakao.maps.load(() => {
        if (canceled) return;
        const center = new kakao.maps.LatLng(37.5665, 126.978); // 서울시청 (위도, 경도)
        new kakao.maps.Map(container, { center, level: 4 });
        setStatus('ready');
      });
    };

    // 이미 로드됐으면(재마운트 등) 스크립트를 다시 붙이지 않는다.
    if (window.kakao?.maps) {
      initMap();
      return () => {
        canceled = true;
      };
    }

    // 같은 스크립트가 DOM 에 있으면(로드 중) 새로 만들지 않고 이벤트만 기다린다.
    // 스크립트는 다른 마운트도 쓰므로 cleanup 에서 제거하지 않는다.
    let script = document.querySelector<HTMLScriptElement>(`script[src^="${SDK_URL}"]`);
    const isNew = !script;
    if (!script) {
      script = document.createElement('script');
      script.async = true;
      script.src = `${SDK_URL}?appkey=${KAKAO_JS_KEY}&autoload=false`;
    }

    const onLoad = () => initMap();
    const onError = () => {
      if (!canceled) setStatus('loadError');
    };
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (isNew) document.head.appendChild(script);

    return () => {
      canceled = true;
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
  }, []);

  const message =
    status === 'keyMissing'
      ? t('map.keyMissing')
      : status === 'loadError'
        ? t('map.loadError')
        : t('map.loading');

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 240,
      }}
    >
      {/* 실제 카카오맵이 들어갈 영역 */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      {/* 로딩 중이거나 키 없음·로드 실패일 때 지도 위에 안내를 겹쳐 보여준다 */}
      {status !== 'ready' && (
        <div
          role={status === 'loading' ? undefined : 'alert'}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: colors.paper,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
