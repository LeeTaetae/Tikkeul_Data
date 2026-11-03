import { buildRouteSegments } from '../lib/navigation/transitColors';
import type { TransitRouteOption } from './navigationApi';
import type { KakaoMapHandle } from './types';

/**
 * 대중교통 경로를 지도에 그린다. 경로 선택 화면과 길안내 화면이 이 함수를 같이 써서 색이 같다.
 * 구간 색을 만들 수 없거나(구간 좌표 없음·검증 실패) 지도가 구간별 선을 지원하지 않으면 기존처럼 한 가지 색 경로선을 그린다.
 */
export function showTransitRoute(map: KakaoMapHandle | null | undefined, option: TransitRouteOption, options?: { fit?: boolean }): void {
  if (!map) return;
  const segments = map.showRouteSegments ? buildRouteSegments(option) : null;
  if (segments && map.showRouteSegments) map.showRouteSegments(segments, options);
  else map.showRoute(option.path, options);
}
