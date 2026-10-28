// EXPO_PUBLIC_ 변수는 번들에 포함되어 공개된다. 비밀값을 넣지 않는다.
// localhost 폴백은 개발 중에만 허용한다. 운영에서 미설정이면 빈 문자열(API 미설정)이다.
const DEV_FALLBACK = 'http://localhost:8000';

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? (__DEV__ ? DEV_FALLBACK : '');
  
export const KAKAO_JS_KEY: string =
  process.env.EXPO_PUBLIC_KAKAO_JS_KEY ?? '';