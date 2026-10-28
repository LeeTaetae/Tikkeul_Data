// 지도 컴포넌트가 화면(홈)에 노출하는 동작. 웹·모바일 구현이 같은 모양을 쓴다.
export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface KakaoMapHandle {
  moveToMyLocation: () => void;
  showRoute: (path: RoutePoint[]) => void;
  clearRoute: () => void;
}
