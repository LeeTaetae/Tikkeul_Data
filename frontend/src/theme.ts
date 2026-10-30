// 도로 표지판에서 가져온 색: 아스팔트(ink) · 보호구역 노랑(zone) · 위험 빨강(danger) · 안내 초록(guide)
export const colors = {
  ink: '#1E293B',
  paper: '#F8FAFC',
  surface: '#FFFFFF',
  line: '#E2E8F0',
  muted: '#64748B',
  zone: '#FFC400',
  zoneInk: '#3A2E00',
  // danger: 아이콘·테두리·연한 배경용. 흰 글자 대비가 3.76:1 이라 글자·채움에는 dangerStrong(4.83:1)을 쓴다.
  danger: '#EF4444',
  dangerStrong: '#DC2626',
  // 오류·오프라인 안내 상자. dangerSoft=배경, dangerInk=그 위의 글자(대비 7:1 이상)
  dangerSoft: '#FEF2F2',
  dangerInk: '#991B1B',
  // warning·success 는 밝아서 흰 글자 대비가 모자라다. 위에 얹는 글자는 ink 를 쓴다.
  warning: '#F59E0B',
  success: '#10B981',
  guide: '#0B7A5A',
  info: '#2A5BD7',
  // 라벤더 primary·primaryMuted: 홈 헤더·메뉴·언어 알약이 아직 쓴다(3단계에서 흰 플로팅 헤더로 교체 후 제거).
  primary: '#C3B5F0',
  primaryMuted: '#4B4170',
  // 브랜드 퍼플. 활성 상태·주요 버튼·로고 강조에만 쓴다.
  brand: '#6C5CE7',
  primarySoft: '#F1EEFF',
} as const;

// 위험 유형별 색. 유형은 아이콘·글자로도 구분하므로 색은 보조다.
// tint=아이콘 타일 배경 · accent=아이콘(타일 위 3:1 이상) · strong=배지·경고 띠 배경(흰 글자 4.5:1 이상)
// 거리 단계(주의·접근·최종)는 이 색을 쓰지 않는다. 단계는 중립색 알약과 글자로 따로 보여준다.
export const hazardTone = {
  accident: { tint: '#FEF2F2', accent: '#DC2626', strong: '#DC2626' },
  construction: { tint: '#FFFBEB', accent: '#D97706', strong: '#B45309' },
  congestion: { tint: '#FEFCE8', accent: '#A16207', strong: '#854D0E' },
  school_zone: { tint: '#ECFDF5', accent: '#059669', strong: '#047857' },
  caution: { tint: '#EFF6FF', accent: '#2A5BD7', strong: '#1D4ED8' },
} as const;

// 데이터 종류 배지 색(실시간·예측·등록 현황). 글자로도 구분한다.
export const dataKindTone = {
  realtime: { bg: '#ECFDF5', fg: '#047857' },
  forecast: { bg: '#FFFBEB', fg: '#92400E' },
  registry: { bg: '#F1F5F9', fg: '#475569' },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 12, md: 16, lg: 20, pill: 999 } as const;

// 부드러운 그림자. card: 일반 카드 · float: 지도 위에 뜬 헤더·검색창·버튼 · sheet: 아래에서 올라오는 시트
export const shadow = {
  card: '0 2px 12px rgba(15, 23, 42, 0.08)',
  float: '0 4px 20px rgba(15, 23, 42, 0.16)',
  sheet: '0 -4px 24px rgba(15, 23, 42, 0.14)',
} as const;

// 웹에서 본문이 너무 넓어지지 않도록 모바일 폭으로 제한한다.
export const MAX_CONTENT_WIDTH = 560;
