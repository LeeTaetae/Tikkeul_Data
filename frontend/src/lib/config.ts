import Constants from 'expo-constants';
import { Platform } from 'react-native';

// EXPO_PUBLIC_ 변수는 번들에 포함되어 공개된다. 비밀값을 넣지 않는다.
// 개발 중 폴백은 EXPO_PUBLIC_API_BASE_URL 이 없을 때만 쓴다. 운영에서 미설정이면 빈 문자열(API 미설정)이다.
// - 웹: localhost 가 개발 PC 이므로 그대로 쓴다.
// - 네이티브(Expo Go·실기기·에뮬레이터): localhost 는 휴대폰(에뮬레이터) 자신이라 백엔드에 닿지 않는다.
//   Expo 개발 서버 주소(hostUri, 예: 192.168.0.5:8081)에서 개발 PC 주소를 가져와 같은 PC 의 8000 포트를 쓴다.
//   ※ 실기기에서는 확인하지 못했다. 안 되면 .env 에 PC 의 LAN 주소를 직접 적는다(.env.example 참고).
const API_PORT = 8000;

function devApiBaseUrl(): string {
  if (Platform.OS === 'web') return `http://localhost:${API_PORT}`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:${API_PORT}` : `http://localhost:${API_PORT}`;
}

export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? (__DEV__ ? devApiBaseUrl() : '');
  
export const KAKAO_JS_KEY: string =
  process.env.EXPO_PUBLIC_KAKAO_JS_KEY ?? '';