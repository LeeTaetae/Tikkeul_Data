// shortcut: 전국 트렌드(행사·음식점·카페·공연) 실연동 전까지 쓰는 더미 데이터.
// 실시간 트렌드가 아니다 - 공공데이터포털(한국관광공사 TourAPI·공연예술통합전산망 KOPIS) 연동 전까지의 자리채움.
// 이름·지역·설명은 여기 하드코딩하지 않는다 - i18n(places.trendItems.<id>)에서 ko/en/zh로 가져온다(id만 고정 키).
export type TrendCategory = 'event' | 'restaurant' | 'cafe' | 'performance';

export interface TrendItem {
  id: string;
  category: TrendCategory;
}

export const PLACEHOLDER_TRENDS: TrendItem[] = [
  { id: 'jinhae-gunhangje', category: 'event' },
  { id: 'busan-fireworks', category: 'event' },
  { id: 'daehangno-theater', category: 'performance' },
  { id: 'hapjeong-cafe-street', category: 'cafe' },
  { id: 'euljiro-eatery-alley', category: 'restaurant' },
  { id: 'jarasum-jazz-festival', category: 'event' },
  { id: 'jeonpo-cafe-street', category: 'cafe' },
  { id: 'seoul-arts-center', category: 'performance' },
  { id: 'songjeong-seafood-street', category: 'restaurant' },
  { id: 'hangang-zoning-out', category: 'event' },
  { id: 'sinpo-food-cart-alley', category: 'restaurant' },
  { id: 'haeridan-cafe-street', category: 'cafe' },
  { id: 'sejong-center', category: 'performance' },
  { id: 'cheongchun-festival', category: 'event' },
];
