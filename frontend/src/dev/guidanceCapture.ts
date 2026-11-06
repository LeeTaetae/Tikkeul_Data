// 개발 빌드 전용: onGuidance 이벤트 관찰 진단의 연결부. app/guidance-capture.tsx 가 __DEV__ 일 때만 require 한다(운영 번들에는 포함되지 않는다).
// 만들기만 해서는 아무 구독도 생기지 않는다. 사용자가 화면에서 켜야(setLevel) 구독이 생긴다.
import { createGuidanceCapture } from '../lib/navigation/guidanceCapture';
export { MATCH_LATERAL_M } from '../lib/navigation/guidanceCapture';
import { getNativeNavigationStatus, onNativeGuidanceFeed } from '../native/kakaoNavigation';

/** 이 빌드에 카카오 네이티브 모듈이 있는가(없으면 onGuidance 이벤트가 올 수 없다 = 네이티브 재빌드 필요). 읽기만 한다. */
export function nativeModuleAvailable(): boolean {
  return getNativeNavigationStatus().available;
}

// 로그에는 점 개수·잘림 여부·길이 같은 요약만 나간다(좌표는 로그에 남기지 않는다).
export const guidanceCapture = createGuidanceCapture(
  { allowed: __DEV__, now: Date.now, log: (...args) => console.warn('[guidance-capture]', ...args) },
  onNativeGuidanceFeed,
);
