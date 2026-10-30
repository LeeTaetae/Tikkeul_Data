import type { ViewInsets } from '../lib/navigation/drivingCamera';

// 지도 컴포넌트가 화면(홈)에 노출하는 동작. 웹·모바일 구현이 같은 모양을 쓴다.
export interface RoutePoint {
  lat: number;
  lng: number;
}

export type MapInsets = ViewInsets;

export interface KakaoMapHandle {
  moveToMyLocation: () => void;
  /**
   * fit 을 false 로 주면 경로만 바꾸고 지도 위치·확대는 그대로 둔다(길안내 중 재탐색). 기본은 경로 전체가 보이게 맞춘다.
   * style 'driving' 은 차량 주행용으로 흰 테두리를 두른 굵은 선 하나로 그린다(기본 'overview' 는 얇은 선).
   */
  showRoute: (path: RoutePoint[], options?: { fit?: boolean; style?: 'overview' | 'driving' }) => void;
  /** 지금 그려진 경로 선의 좌표만 바꾼다(지나온 구간을 지우는 데 쓴다). 그려진 선이 없으면 무시한다 */
  setRoutePath: (path: RoutePoint[]) => void;
  clearRoute: () => void;
  /** 도착 지점 표시를 둔다. null 이면 지운다 */
  setDestination: (point: RoutePoint | null) => void;
  /** 현재 위치를 옮긴다. null 이면 지운다. 지도 중심은 옮기지 않는다. headingDeg 가 숫자면 그 방향을 가리키는 화살표로, 아니면 점으로 보인다 */
  setLocationMarker: (point: RoutePoint | null, options?: { headingDeg?: number | null; preview?: boolean }) => void;
  /** 지도 중심을 옮긴다. level 을 주면 확대 수준도 바꾼다(카카오 level: 작을수록 확대) */
  panTo: (point: RoutePoint, options?: { level?: number }) => void;
  /**
   * 차량 주행용 카메라. 웹의 headingUp 모드에서는 지도 레이어를 회전해 차량을 화면 아래 중앙에 둔다.
   * insets 는 위 카드·아래 패널처럼 지도를 가리는 픽셀 크기다. level 이 지금과 같으면 부드럽게, 다르면 바로 옮긴다.
   */
  followTo: (point: RoutePoint, options: { level: number; headingDeg: number | null; insets: MapInsets }) => void;
}
