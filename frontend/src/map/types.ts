// 지도 컴포넌트가 화면(홈)에 노출하는 동작. 웹·모바일 구현이 같은 모양을 쓴다.
export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface KakaoMapHandle {
  moveToMyLocation: () => void;
  /** fit 을 false 로 주면 경로만 바꾸고 지도 위치·확대는 그대로 둔다(길안내 중 재탐색). 기본은 경로 전체가 보이게 맞춘다 */
  showRoute: (path: RoutePoint[], options?: { fit?: boolean }) => void;
  clearRoute: () => void;
  /** 현재 위치 점을 옮긴다. null 이면 지운다. 지도 중심은 옮기지 않는다 */
  setLocationMarker: (point: RoutePoint | null) => void;
  /** 지도 중심을 옮긴다. level 을 주면 확대 수준도 바꾼다(카카오 level: 작을수록 확대) */
  panTo: (point: RoutePoint, options?: { level?: number }) => void;
}
