import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { KAKAO_JS_KEY } from '../lib/config';
import { carOffsetPx, headingUpOffsetPx, unwrapAngle } from '../lib/navigation/drivingCamera';
import { colors, radius, space } from '../theme';
import type { KakaoMapHandle, MapInsets, RoutePoint } from './types';

interface KakaoMapInstance {
  relayout: () => void;
  setCenter: (position: object) => void;
  setBounds: (bounds: object) => void;
  panTo: (position: object) => void;
  setLevel: (level: number) => void;
  getLevel: () => number;
  getCenter: () => KakaoLatLngInstance;
  getProjection: () => { coordsFromContainerPoint: (point: object) => KakaoLatLngInstance };
}

interface KakaoOverlay {
  setPosition: (position: object) => void;
  setMap: (map: object | null) => void;
}

interface KakaoPolyline {
  setMap: (map: object | null) => void;
  setPath: (path: object[]) => void;
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
        Point: new (x: number, y: number) => object;
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

// 차량 주행 중 현재 위치: 진행 방향을 가리키는 화살표. 흰 원은 가만히 두고 화살표(rotor)만 돌린다.
function createArrowMarker(label: string): { root: HTMLElement; rotor: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  Object.assign(root.style, {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    backgroundColor: colors.surface,
    boxShadow: '0 2px 10px rgba(15, 23, 42, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  const rotor = document.createElement('div');
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Object.assign(rotor.style, { width: '28px', height: '28px', transition: reduceMotion ? 'none' : 'transform 0.4s ease-out' });
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  const arrow = document.createElementNS(svgNs, 'path');
  arrow.setAttribute('d', 'M12 2.5 L20 21 L12 16.5 L4 21 Z');
  arrow.setAttribute('fill', colors.info);
  arrow.setAttribute('stroke', colors.info);
  arrow.setAttribute('stroke-width', '1.5');
  arrow.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(arrow);
  rotor.appendChild(svg);
  root.appendChild(rotor);
  return { root, rotor };
}

// 도착 지점 표시: 어두운 원 안에 흰 점(과녁). 경로선(보라)·현재 위치(파랑)와 헷갈리지 않는 색이다.
function createDestinationMarker(label: string): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  Object.assign(root.style, {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    backgroundColor: colors.ink,
    border: `3px solid ${colors.surface}`,
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  const dot = document.createElement('div');
  Object.assign(dot.style, { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors.surface });
  root.appendChild(dot);
  return root;
}

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
  headingUp?: boolean;
  ref?: Ref<KakaoMapHandle>;
  onMapClick?: (point: RoutePoint) => void;
  /** false 면 지도가 뜰 때 브라우저 위치를 한 번 읽어 중심을 옮기지 않는다(길안내 화면은 GPS 추적이 위치를 맡는다). 기본 true */
  autoLocate?: boolean;
  /** 사용자가 지도를 직접 끌기 시작했을 때(길안내 자동 추적 해제용). 코드로 옮긴 이동은 부르지 않는다 */
  onUserPan?: () => void;
  /** 지도가 준비되면 한 번 부른다. 준비 전에 호출한 showRoute·setLocationMarker 는 무시되므로 이때 다시 적용한다 */
  onReady?: () => void;
}

export function KakaoMap({ ref, onMapClick, autoLocate = true, onUserPan, onReady, headingUp = false }: KakaoMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef<number | null>(null);
  const drivingScaleRef = useRef(2);
  const followRef = useRef<{ point: RoutePoint; options: { level: number; headingDeg: number | null; insets: MapInsets } } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const markerRef = useRef<KakaoOverlay | null>(null);
  const markerElementRef = useRef<HTMLElement | null>(null);
  const polylineRef = useRef<KakaoPolyline | null>(null);
  // 주행 스타일 경로의 흰 테두리 선(코어 선 polylineRef 아래에 깔린다). 둘은 항상 같은 좌표를 가진다.
  const casingRef = useRef<KakaoPolyline | null>(null);
  const destinationRef = useRef<KakaoOverlay | null>(null);
  const markerKindRef = useRef<'dot' | 'arrow'>('dot');
  const arrowRotorRef = useRef<HTMLElement | null>(null);
  const arrowAngleRef = useRef<number | null>(null);
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
    casingRef.current?.setMap(null);
    casingRef.current = null;
    polylineRef.current?.setMap(null);
    polylineRef.current = null;
  };

  // 현재 위치 점을 만들거나 옮긴다.
  // headingDeg 가 숫자면 그 방향의 화살표, null 이면 점. 모양이 바뀌면 마커를 새로 만든다.
  const placeMarker = (position: object, headingDeg: number | null = null) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao || !map) return;
    const kind = headingDeg === null ? 'dot' : 'arrow';
    if (markerRef.current && markerKindRef.current !== kind) removeMarker();
    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else {
      let content: HTMLElement;
      if (kind === 'arrow') {
        const arrow = createArrowMarker(t('map.myLocation'));
        arrowRotorRef.current = arrow.rotor;
        content = arrow.root;
      } else {
        content = createLocationDot(t('map.myLocation'));
      }
      markerKindRef.current = kind;
      markerElementRef.current = content;
      markerRef.current = new kakao.maps.CustomOverlay({ map, position, content, xAnchor: 0.5, yAnchor: 0.5 });
    }
    if (headingDeg !== null && arrowRotorRef.current) {
      // 359° → 1° 처럼 넘어갈 때 한 바퀴 거꾸로 돌지 않게 이어지는 각도로 돌린다.
      const angle = unwrapAngle(arrowAngleRef.current, headingDeg);
      arrowAngleRef.current = angle;
      arrowRotorRef.current.style.transform = `rotate(${angle}deg)`;
    }
  };

  const removeMarker = () => {
    markerRef.current?.setMap(null);
    markerRef.current = null;
    markerElementRef.current = null;
    arrowRotorRef.current = null;
    arrowAngleRef.current = null;
  };

  const setLocationMarker = (point: RoutePoint | null, options?: { headingDeg?: number | null; preview?: boolean }) => {
    const kakao = window.kakao;
    if (!kakao || !mapRef.current) return;
    if (!point) return removeMarker();
    placeMarker(new kakao.maps.LatLng(point.lat, point.lng), options?.headingDeg ?? null);
    const element = markerElementRef.current;
    if (element) {
      element.style.transform = headingUp ? `scale(${1 / drivingScaleRef.current})` : '';
      element.style.opacity = options?.preview ? '0.55' : '1';
      element.style.border = '3px solid #0866FF';
      element.setAttribute('aria-label', options?.preview ? t('nav.gpsStarting') : t('map.myLocation'));
      element.title = options?.preview ? t('nav.gpsStarting') : t('map.myLocation');
    }
  };

  const setDestination = (point: RoutePoint | null) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao || !map) return;
    destinationRef.current?.setMap(null);
    destinationRef.current = null;
    if (!point) return;
    destinationRef.current = new kakao.maps.CustomOverlay({
      map,
      position: new kakao.maps.LatLng(point.lat, point.lng),
      content: createDestinationMarker(t('nav.statArrival')),
      xAnchor: 0.5,
      yAnchor: 0.5,
    });
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

  const toLatLngs = (path: RoutePoint[]) => path.map((p) => new window.kakao!.maps.LatLng(p.lat, p.lng));

  const showRoute = (path: RoutePoint[], options?: { fit?: boolean; style?: 'overview' | 'driving' }) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    if (!kakao || !map || path.length === 0) return;

    clearRoute();
    const points = toLatLngs(path);
    if (options?.style === 'driving') {
      // 주행용: 흰 테두리 위에 굵고 진한 선 하나. 두 선은 같은 좌표라 하나의 선으로 보인다.
      casingRef.current = new kakao.maps.Polyline({ map, path: points, strokeWeight: 14, strokeColor: colors.surface, strokeOpacity: 1 });
      polylineRef.current = new kakao.maps.Polyline({ map, path: points, strokeWeight: 9, strokeColor: colors.brand, strokeOpacity: 1 });
    } else {
      polylineRef.current = new kakao.maps.Polyline({ map, path: points, strokeWeight: 5, strokeColor: colors.brand, strokeOpacity: 0.85 });
    }

    if (options?.fit === false) return;
    const bounds = new kakao.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.setBounds(bounds);
  };

  const setRoutePath = (path: RoutePoint[]) => {
    if (!window.kakao || !polylineRef.current || path.length === 0) return;
    const points = toLatLngs(path);
    casingRef.current?.setPath(points);
    polylineRef.current.setPath(points);
  };

  // SDK의 북쪽 고정 지도를 큰 정사각형에 그리고 DOM을 회전해 진행 방향을 위로 둔다.
  // 확대 단계를 바꾸면 투영(픽셀↔좌표)이 달라지므로 단계를 먼저 바꾼 뒤 중심을 계산한다.
  const followTo = (point: RoutePoint, options: { level: number; headingDeg: number | null; insets: MapInsets }) => {
    const kakao = window.kakao;
    const map = mapRef.current;
    const container = containerRef.current;
    if (!kakao || !map || !container) return;
    followRef.current = { point, options };
    const levelChanged = map.getLevel() !== options.level;
    if (levelChanged) map.setLevel(options.level);
    const width = container.clientWidth;
    const height = container.clientHeight;
    const viewport = viewportRef.current;
    const heading = options.headingDeg ?? 0;
    if (headingUp) {
      rotationRef.current = unwrapAngle(rotationRef.current, -heading);
      container.style.transform = `translate(-50%, -50%) rotate(${rotationRef.current}deg) scale(${drivingScaleRef.current})`;
    }
    const { dx, dy } = headingUp && viewport
      ? headingUpOffsetPx(heading, { width: viewport.clientWidth, height: viewport.clientHeight }, options.insets, drivingScaleRef.current)
      : carOffsetPx(options.headingDeg, { width, height }, options.insets);
    // 지금 화면에서 (차가 놓일 자리)에 있는 좌표와 지도 중심의 차이만큼, 차 좌표에서 뺀 곳을 새 중심으로 한다.
    const probe = map.getProjection().coordsFromContainerPoint(new kakao.maps.Point(width / 2 + dx, height / 2 + dy));
    const center = map.getCenter();
    const next = new kakao.maps.LatLng(point.lat - (probe.getLat() - center.getLat()), point.lng - (probe.getLng() - center.getLng()));
    if (levelChanged || headingUp) map.setCenter(next);
    else map.panTo(next);
  };

  useImperativeHandle(ref, () => ({ moveToMyLocation: () => locate(true), showRoute, setRoutePath, clearRoute, setDestination, setLocationMarker, panTo, followTo }));

  useEffect(() => {
    const viewport = viewportRef.current;
    const container = containerRef.current;
    if (!viewport || !container || !headingUp) return;
    const resize = () => {
      // 대각선보다 크게 그려 회전 중에도 화면 모서리에 빈 공간이 생기지 않게 한다.
      // 넓은 데스크톱에서도 모바일 주행 화면처럼 좁은 주변 범위를 보여준다.
      const scale = Math.max(2, Math.min(4, viewport.clientWidth / 390));
      drivingScaleRef.current = scale;
      const side = Math.ceil(Math.hypot(viewport.clientWidth, viewport.clientHeight) / scale) + 4;
      Object.assign(container.style, { position: 'absolute', left: '50%', top: '50%', width: `${side}px`, height: `${side}px` });
      container.style.transform = `translate(-50%, -50%) rotate(${rotationRef.current ?? 0}deg) scale(${scale})`;
      if (markerElementRef.current) markerElementRef.current.style.transform = `scale(${1 / scale})`;
      mapRef.current?.relayout();
      const last = followRef.current;
      if (last) followTo(last.point, last.options);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [headingUp]);

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
      ref={viewportRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
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
