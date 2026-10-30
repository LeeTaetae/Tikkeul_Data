// 홈에서 고른 안내 조건을 길안내 화면으로 넘기는 메모리 저장소. 다른 모듈을 런타임 import 하지 않는 순수 코드라 Node 로도 테스트한다.
// 좌표는 위치정보라 URL 파라미터에 싣지 않는다. 새로고침하면 사라지고, 그때 길안내 화면은 "안내할 경로 없음"을 보여준다.
import type { DrivingStyle, RouteStyle } from '../../map/navigationApi';
import type { RoutePoint } from '../../map/types';
import type { GuidanceMode } from './guidanceEngine';

export interface GuidanceRequest {
  /** 경로를 검색할 때 쓴 출발지(현재 위치·지도에서 고른 지점·데모 지점) */
  origin: RoutePoint;
  destination: RoutePoint;
  mode: GuidanceMode;
  /** 자동차에서 사용자가 고른 스타일. 도보는 쓰지 않는다 */
  style: DrivingStyle;
  destinationLabel: string;
}

const DRIVING_STYLES: readonly RouteStyle[] = ['recommended', 'toll_free', 'major_road', 'shortest', 'avoid_school_zone'];

/** 선택한 경로 스타일이 실시간 길안내를 지원하면 그 이동수단과 스타일을, 아니면(자전거·대중교통) null 을 돌려준다. */
export function guidanceTargetOf(style: RouteStyle): { mode: GuidanceMode; style: DrivingStyle } | null {
  if (style === 'walking') return { mode: 'walking', style: 'recommended' };
  if (DRIVING_STYLES.includes(style)) return { mode: 'driving', style: style as DrivingStyle };
  return null;
}

let current: GuidanceRequest | null = null;

/** 새 객체를 넣을 때마다 화면이 "새 안내 요청"으로 알아본다(객체 동일성으로 비교한다). */
export function setGuidanceRequest(request: GuidanceRequest): void {
  current = request;
}

export function getGuidanceRequest(): GuidanceRequest | null {
  return current;
}

export function clearGuidanceRequest(): void {
  current = null;
}
