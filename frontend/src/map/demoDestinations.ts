// shortcut: 실제 장소검색(geocoding) API 연동 전까지 쓰는 고정 목적지 목록.
// 실제 연동 시 Kakao 키워드 장소검색 API 등으로 교체 필요.
import type { RoutePoint } from './types';

export const DEMO_ORIGIN: RoutePoint = { lat: 37.5665, lng: 126.978 }; // 서울시청

export const DEMO_DESTINATIONS: Record<string, RoutePoint> = {
  강남역: { lat: 37.497942, lng: 127.027621 },
  서울역: { lat: 37.554648, lng: 126.970697 },
  홍대입구역: { lat: 37.557192, lng: 126.925381 },
  부산역: { lat: 35.115359, lng: 129.042655 },
};

export function findDemoDestination(query: string): RoutePoint | null {
  const key = query.trim();
  return DEMO_DESTINATIONS[key] ?? null;
}
