// shortcut: 전국 트렌드(행사·음식점·카페·공연) 실연동 전까지 쓰는 더미 데이터.
// 실시간 트렌드가 아니다 - 공공데이터포털(한국관광공사 TourAPI·공연예술통합전산망 KOPIS) 연동 전까지의 자리채움.
export type TrendCategory = 'event' | 'restaurant' | 'cafe' | 'performance';

export interface TrendItem {
  category: TrendCategory;
  name: string;
  region: string;
  description: string;
}

export const PLACEHOLDER_TRENDS: TrendItem[] = [
  { category: 'event', name: '진해 군항제', region: '경남 창원', description: '해마다 봄에 열리는 벚꽃 축제' },
  { category: 'event', name: '부산불꽃축제', region: '부산 광안리', description: '밤하늘을 수놓는 불꽃놀이' },
  { category: 'performance', name: '대학로 소극장 공연', region: '서울 혜화', description: '소극장 연극·뮤지컬이 모인 거리' },
  { category: 'cafe', name: '합정 로스터리 카페거리', region: '서울 합정동', description: '원두를 직접 로스팅하는 카페들' },
  { category: 'restaurant', name: '을지로 노포 골목', region: '서울 을지로', description: '오래된 노포 맛집이 모인 골목' },
  { category: 'event', name: '자라섬 재즈페스티벌', region: '경기 가평', description: '가을마다 열리는 재즈 축제' },
  { category: 'cafe', name: '전포 카페거리', region: '부산 전포동', description: '개성 있는 카페들이 모인 거리' },
  { category: 'performance', name: '예술의전당 공연', region: '서울 서초', description: '클래식·오페라를 만날 수 있는 공연장' },
  { category: 'restaurant', name: '송정 해물요리 거리', region: '울산 송정', description: '해산물 맛집이 모인 거리' },
  { category: 'event', name: '한강 멍때리기 대회', region: '서울 한강공원', description: '도심 속에서 쉬어가는 이색 행사' },
  { category: 'restaurant', name: '포장마차 골목', region: '인천 신포동', description: '밤에 더 북적이는 노점 골목' },
  { category: 'cafe', name: '해리단길 카페거리', region: '부산 해운대', description: '바다 근처 개성 있는 카페들' },
  { category: 'performance', name: '세종문화회관 공연', region: '서울 광화문', description: '클래식·무용 공연이 자주 열리는 곳' },
  { category: 'event', name: '청춘페스티벌', region: '경기 수원', description: '매년 열리는 청년 문화 축제' },
];
