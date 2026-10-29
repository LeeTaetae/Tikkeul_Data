// 위치 권한·조회 실패 분류. 다른 모듈을 import 하지 않는 순수 함수라 Node 로도 테스트한다.

export type LocationFailure =
  | 'denied' // 권한 거부(다시 요청할 수 있음)
  | 'permanentlyDenied' // 다시 요청할 수 없음: 기기 설정에서 허용해야 함
  | 'servicesDisabled' // 기기의 위치 서비스(GPS)가 꺼짐
  | 'timeout' // 시간 안에 위치를 못 받음
  | 'unavailable' // 위치를 확인할 수 없음(신호 없음 등)
  | 'unsupported'; // 위치 기능을 쓸 수 없는 환경(브라우저 미지원, 비보안 컨텍스트)

export interface PermissionLike {
  status: string;
  canAskAgain: boolean;
}

export type PermissionKind = 'granted' | 'undetermined' | 'denied' | 'permanentlyDenied';

/**
 * 권한 응답을 분류한다. 웹은 거부돼도 canAskAgain 이 항상 true 라서 영구 거부를 알 수 없다
 * (브라우저가 차단한 경우 다시 요청해도 대화상자가 뜨지 않는다 → 화면에서 사이트 설정 안내를 함께 보여준다).
 */
export function classifyPermission(p: PermissionLike): PermissionKind {
  if (p.status === 'granted') return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain ? 'denied' : 'permanentlyDenied';
}

/** 직접 만든 시간 초과 오류의 이름 */
export const LOCATION_TIMEOUT_NAME = 'LocationTimeout';

/**
 * 위치 조회 예외를 분류한다.
 * - 웹: GeolocationPositionError 의 code(1=거부, 2=확인 불가, 3=시간 초과)
 * - 네이티브: expo-location 의 오류 코드·메시지 문자열. 공식 문서에 코드 목록이 없어 문자열 일부로 추정하며,
 *   실기기에서 확인하지 못했다. 알 수 없으면 unavailable 로 처리한다.
 */
export function classifyPositionError(error: unknown): LocationFailure {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  if (e.name === LOCATION_TIMEOUT_NAME) return 'timeout';
  if (typeof e.code === 'number') return e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';
  const text = `${typeof e.code === 'string' ? e.code : ''} ${typeof e.message === 'string' ? e.message : ''}`.toUpperCase();
  if (/TIMEOUT|TIMED OUT/.test(text)) return 'timeout';
  if (/SERVICES_DISABLED|SETTINGS_UNSATISFIED|LOCATION SERVICES|PROVIDER/.test(text)) return 'servicesDisabled';
  if (/DENIED|PERMISSION/.test(text)) return 'denied';
  return 'unavailable';
}
