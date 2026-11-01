import { useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

import { KAKAO_JS_KEY } from '../lib/config';
import { colors } from '../theme';
import { kakaoMapHtml } from './kakaoMapHtml';
import type { KakaoMapHandle, RoutePoint } from './types';

// 모바일 지도: KakaoMap.web.tsx 와 같은 Kakao JS SDK 지도를 WebView 안에서 그린다(kakaoMapHtml.ts).
// RN → 지도 명령은 injectJavaScript 로, 지도 → RN 이벤트(준비·클릭·드래그)는 postMessage 로 주고받는다.
interface KakaoMapProps {
  headingUp?: boolean;
  ref?: Ref<KakaoMapHandle>;
  onMapClick?: (point: RoutePoint) => void;
  autoLocate?: boolean;
  onUserPan?: () => void;
  onReady?: () => void;
  /** showPlaces 로 찍은 점을 탭했을 때, 그 점의 places 배열 안 순번을 알려준다 */
  onPlaceClick?: (index: number) => void;
}

export function KakaoMap({ ref, onMapClick, autoLocate = true, onUserPan, onReady, onPlaceClick }: KakaoMapProps) {
  const webRef = useRef<WebView<object>>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const { t } = useTranslation();

  const run = (js: string) => {
    if (readyRef.current) webRef.current?.injectJavaScript(js);
    else queueRef.current.push(js);
  };

  const call = (method: string, ...args: unknown[]) => {
    run(`window.KMAP && window.KMAP.${method}(${args.map((a) => JSON.stringify(a ?? null)).join(',')});true;`);
  };

  const moveTo = async (point: RoutePoint) => {
    call('panTo', point);
    call('setLocationMarker', point);
  };

  const moveToMyLocation = async () => {
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await moveTo({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      // 조용히 무시: 실패 안내는 홈 화면의 useUserLocation 이 맡는다(웹과 달리 여기선 버튼별 알림을 두지 않는다)
      // shortcut: 버튼 눌렀을 때 실패 토스트 미구현, 필요해지면 web.tsx 의 notice 패턴을 옮긴다.
    }
  };

  useImperativeHandle(ref, () => ({
    moveToMyLocation,
    showRoute: (path, options) => call('showRoute', path, options ?? {}),
    setRoutePath: (path) => call('setRoutePath', path),
    clearRoute: () => call('clearRoute'),
    setDestination: (point) => call('setDestination', point),
    showPlaces: (places, color) => call('showPlaces', places, color),
    clearPlaces: () => call('clearPlaces'),
    setLocationMarker: (point, options) => call('setLocationMarker', point, options ?? {}),
    panTo: (point, options) => call('panTo', point, options ?? {}),
    followTo: (point, options) => call('followTo', point, options),
  }));

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    let message: { type: string; point?: RoutePoint; index?: number };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === 'ready') {
      readyRef.current = true;
      const queued = queueRef.current;
      queueRef.current = [];
      queued.forEach((js) => webRef.current?.injectJavaScript(js));
      if (autoLocate) {
        Location.getForegroundPermissionsAsync().then((permission) => {
          if (permission.status === 'granted') moveToMyLocation();
        });
      }
      onReady?.();
    } else if (message.type === 'mapClick' && message.point) {
      onMapClick?.(message.point);
    } else if (message.type === 'userPan') {
      onUserPan?.();
    } else if (message.type === 'placeClick' && typeof message.index === 'number') {
      onPlaceClick?.(message.index);
    }
  };

  if (!KAKAO_JS_KEY) {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>{t('map.keyMissing')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <WebView<object>
        ref={webRef}
        source={{ html: kakaoMapHtml(KAKAO_JS_KEY) }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        javaScriptEnabled
        geolocationEnabled={false}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: colors.paper },
  webview: { flex: 1, backgroundColor: colors.paper },
  text: { fontSize: 15, color: colors.muted, textAlign: 'center', marginTop: 24 },
});
