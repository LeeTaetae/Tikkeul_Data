import type { NearbyPlace } from './api';
import type { FrequentDestination } from '../trips/api';

// 트립 데이터가 없는(콜드스타트) 동네에서 nearby 탭을 채우기 위한 변환.
// visit_count/last_used_at은 화면에 쓰이지 않아 임의 채움값이다.
export function toFallbackPopular(places: NearbyPlace[], limit: number): FrequentDestination[] {
  const now = new Date().toISOString();
  return [...places]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit)
    .map((place) => ({
      label: place.name,
      lat: place.point.lat,
      lon: place.point.lng,
      address_text: place.address,
      visit_count: 0,
      last_used_at: now,
    }));
}
