// 도로 표지판에서 가져온 색: 아스팔트(ink) · 보호구역 노랑(zone) · 위험 빨강(danger) · 안내 초록(guide)
export const colors = {
  ink: '#17202A',
  paper: '#F2F3F0',
  surface: '#FFFFFF',
  line: '#D9DCD6',
  muted: '#5B6570',
  zone: '#FFC400',
  zoneInk: '#3A2E00',
  danger: '#D93A2B',
  guide: '#0B7A5A',
  info: '#2A5BD7',
  // 브랜드 프라이머리(라벤더). 헤더·하단 탭 배경. primaryMuted 는 라벤더 위 비활성 글자(대비 4.5:1 이상)
  primary: '#C3B5F0',
  primaryMuted: '#4B4170',
  // 로고 "Data" 글자색(보라). 라벤더 primary 위에서 큰 글자 대비 3:1 이상
  brand: '#6D3FE0',
  // 라벤더 위에 얹는 연한 배경(언어 선택 알약)
  primarySoft: '#F1EDFC',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 8, md: 14, pill: 999 } as const;

// 웹에서 본문이 너무 넓어지지 않도록 모바일 폭으로 제한한다.
export const MAX_CONTENT_WIDTH = 560;
