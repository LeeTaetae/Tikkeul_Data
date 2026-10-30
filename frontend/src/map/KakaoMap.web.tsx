import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { KAKAO_JS_KEY } from '../lib/config';
import { colors, radius, space } from '../theme';
import type { KakaoMapHandle, RoutePoint } from './types';

interface KakaoMapInstance {
  setCenter: (position: object) => void;
  setBounds: (bounds: object) => void;
  panTo: (position: object) => void;
  setLevel: (level: number) => void;
}

interface KakaoOverlay {
  setPosition: (position: object) => void;
  setMap: (map: object | null) => void;
}

interface KakaoPolyline {
  setMap: (map: object | null) => void;
}

interface KakaoLatLngBounds {
  extend: (position: object) => void;
}

interface KakaoLatLngInstance {
  getLat: () => number;
  getLng: () => number;
}

interface KakaoMouseEvent {
  latLng: KakaoLatLngInstance;
}

declare global {
  interface Window {
    kakao?: {
      maps: {
        load: (callback: () => void) => void;
        LatLng: new (lat: number, lng: number) => KakaoLatLngInstance;
        LatLngBounds: new () => KakaoLatLngBounds;
        Map: new (container: HTMLElement, options: { center: object; level: number }) => KakaoMapInstance;
        CustomOverlay: new (options: {
          map: object;
          position: object;
          content: HTMLElement;
          xAnchor: number;
          yAnchor: number;
        }) => KakaoOverlay;
        Polyline: new (options: {
          map: object;
          path: object[];
          strokeWeight: number;
          strokeColor: string;
          strokeOpacity: number;
        }) => KakaoPolyline;
        event: {
          addListener: (target: object, type: string, handler: (event: KakaoMouseEvent) => void) => void;
          removeListener: (target: object, type: string, handler: (event: KakaoMouseEvent) => void) => void;
        };
      };
    };
  }
}

const SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js';
// 위치 권한을 거부하거나 위치를 못 얻을 때 보여주는 기본 위치 (서울시청)
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };
const NOTICE_MS = 4000;

type LocationNotice = 'map.locationDenied' | 'map.locationFailed';

// 현재 위치 표시: 파란 점. 텍스트가 없어 innerHTML 없이 DOM 으로 만든다.
function createLocationDot(label: string): HTMLElement {
  const dot = document.createElement('div');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', label);
  Object.assign(dot.style, {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    backgroundColor: colors.info,
    border: `3px solid ${colors.surface}`,
    boxShadow: '0 0 0 2px rgba(42, 91, 215, 0.35)',
  });
  return dot;
}

interface KakaoMapProps {
  ref?: Ref<KakaoMapHandle>;
  onMapClick?: (point: RoutePoint) => void;
  /** false 면 지도가 뜰 때 브라우저 위치를 한 번 읽어 중심을 옮기지 않는다(길안내 화면은 GPS 추적이 위치를 맡는다). 기본 true */
  autoLocate?: boolean;
  /** 사용자가 지도를 직접 끌기 시작했을 때(길안내 자동 추적 해제용). 코드로 옮긴 이동은 부르지 않는다 */
  onUserPan?: () => void;
  /** 지도가 준비되면 한 번 부른다. 준비 전에 호출한 showRoute·setLocationMarker 는 무시되므로 이때 다시 적용한다 */
  onReady?: () => void;
}

export function KakaoMap({ ref, onMapClick, autoLocate = true, onUserPan, onReady }: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const markerRef = useRef<KakaoOverlay | null>(null);
  const polylineRef = useRef<KakaoPolyline | null>(null);
  const mountedRef = useRef(true);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // 클릭 리스너는 지도 초기화 시 한 번만 등록하므로, 최신 콜백을 ref로 들고 있다가 그걸 읽는다.
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onUserPanRef = useRef(onUserPan);
  onUserPanRef.current = onUserPan;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const autoLocateRef = useRef(autoLocate);
  autoLocateRef.current = autoLocate;

  const [status, setStatus] = useState<'loading' | 'ready' | 'keyMissing' | 'loadError'>(
    KAKAO_JS_KEY ? 'loading' : 'keyMissing',
  );
  const [notice, setNotice] = useState<LocationNotice | null>(null);

  const { t } = useTranslation();

  const showNotice = (next: LocationNotice) => {
    setNotice(next);
    clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };

  // 위치는 이 기기 안에서만 쓰고 서버로 보내지 않는다.
  // showError: 사용자가 버튼을 눌렀을 때만 실패 안내를 보여준다(첫 자동 요청은 조용히 기본 위치 유지).
  const locate = (showError: boolean) => {
    if (!navigator.geolocation) {
      if (showError) showNotice('map.locationFailed');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const kakao = window.kakao;
        const map = mapRef.current;
        if (!mountedRef.current || !kakao || !map) return;
        const position = new kakao.maps.LatLng(coords.latitude, coords.longitude);
        map.setCenter(position);
        placeMarker(position);
      },
      (error) => {
        if (!showError || !mountedRef.current) return;
        showNotice(error.code === error.PERMISSION_DENIED ? 'map.locationDenied' : 'map.locationFailed');
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  };

  // 백엔드가 Tmap/Naver 중 고른 경로를 그대로 Polyline 으로 그린다. 지도 레이어(Kakao)와
  // 경로 계산(Tmap/Naver)은 서로 다른 레이어라, 좌표 배열만 넘기면 출처와 무관하게 그려진다.
  const clearRoute = () => {
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
  };

  // 현재 위치 점을 만들거나 옮긴다.
  const placeMarker = (position: object) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao || !map) return;
    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else {
      markerRef.current = new kakao.maps.CustomOverlay({
        map,
        position,
        content: createLocationDot(t('map.myLocation')),
        xAnchor: 0.5,
        yAnchor: 0.5,
      });
    }
  };

  const setLocationMarker = (point: RoutePoint | null) => {
    const kakao = window.kakao;
    if (!kakao || !mapRef.current) return;
    if (!point) {
      markerRef.current?.setMap(null);
      markerRef.current = null;
      return;
    }
    placeMarker(new kakao.maps.LatLng(point.lat, point.lng));
  };

  // level 을 주면(처음 맞출 때) 확대 수준을 바꾸고 바로 옮기고, 아니면 부드럽게 옮긴다.
  const panTo = (point: RoutePoint, options?: { level?: number }) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao || !map) return;
    const position = new kakao.maps.LatLng(point.lat, point.lng);
    if (options?.level !== undefined) {
      map.setLevel(options.level);
      map.setCenter(position);
    } else {
      map.panTo(position);
    }
  };

  const showRoute = (path: RoutePoint[], options?: { fit?: boolean }) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao || !map || path.length === 0) return;

    clearRoute();
    const points = path.map((p) => new kakao.maps.LatLng(p.lat, p.lng));
    polylineRef.current = new kakao.maps.Polyline({
      map,
      path: points,
      strokeWeight: 5,
      strokeColor: colors.brand,
      strokeOpacity: 0.85,
    });

    if (options?.fit === false) return;
    const bounds = new kakao.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.setBounds(bounds);
  };

  useImperativeHandle(ref, () => ({ moveToMyLocation: () => locate(true), showRoute, clearRoute, setLocationMarker, panTo }));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(noticeTimerRef.current);
    };
  }, []);

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
        const center = new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
        mapRef.current = new kakao.maps.Map(container, { center, level: 4 });
        kakao.maps.event.addListener(mapRef.current, 'click', (event: KakaoMouseEvent) => {
          onMapClickRef.current?.({ lat: event.latLng.getLat(), lng: event.latLng.getLng() });
        });
        // 사용자가 직접 끌기 시작한 때만 알린다(setCenter·panTo 로 옮긴 이동에는 이 이벤트가 오지 않는다).
        kakao.maps.event.addListener(mapRef.current, 'dragstart', () => onUserPanRef.current?.());
        setStatus('ready');
        if (autoLocateRef.current) locate(false);
        onReadyRef.current?.();
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
        height: '100%',
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

      {/* 현재 위치 버튼을 눌렀는데 실패했을 때 잠깐 보이는 안내 */}
      {notice && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            left: space.lg,
            right: space.lg,
            bottom: space.lg,
            zIndex: 10,
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            backgroundColor: colors.ink,
            color: colors.surface,
            fontSize: 14,
            textAlign: 'center',
          }}
        >
          {t(notice)}
        </div>
      )}
    </div>
  );
}
