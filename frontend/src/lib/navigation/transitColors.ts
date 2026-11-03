// 대중교통 지도 경로선 색상. 다른 모듈을 런타임 import 하지 않는 순수 함수라 Node 로도 테스트한다.
// 경로 선택 화면과 실제 길안내 화면이 같은 buildRouteSegments 를 쓰므로 색이 항상 같다.
//
// 데이터 한계(카카오 REST 실호출로 확인):
//  - 구간(step)마다 노선명(vehicles[].name)과 유형(vehicles[].type)은 온다. 지하철은 "2호선"·"신분당선", 버스는 번호와 "간선/지선/직행/마을/일반/좌석/광역/급행/순환/외곽/농어촌".
//  - 노선 ID와 지역 필드는 없다. 부산·대구·대전·광주의 지하철도 "1호선"이라 노선명만으로는 서울과 구분할 수 없어서, 구간 첫 좌표로 지역을 정한다(대략적인 사각형이다).
//  - 버스 유형 이름은 지역마다 뜻이 다르다(같은 "간선"이라도 서울·대구·광주의 색 기준이 다르다). 그래서 지역별 표에 확인된 것만 넣고, 나머지는 기본 버스 색을 쓴다. 번호로 유형을 추정하지 않는다.
//
// 색상 출처:
//  - 지하철: IT위키 '한국 철도 노선색'(https://www.itwiki.kr/w/틀:한국_철도_노선색)이 정리한 값. 이 문서는 공식 발행물이 아니라, 각 값의 근거를 표시한 위키 정리본이다.
//    근거 표기: A 한국철도공사 「철도 사인류 설치 기준 매뉴얼」 · B 운영사 홈페이지·CI에서 편집자가 추출 · C 서울특별시가 밝힌 색 · D 서울특별시가 밝힌 차량 강조색
//    · E 인천2호선 누리집 Q&A · F 「공공디자인색채표준가이드」 · G 대구3호선 노랑(DIC124). 근거가 적혀 있지 않은 노선(경강선·GTX-A·대전1호선·광주1호선·동해선 등)과
//    값이 엇갈리는 공항철도는 넣지 않았다(기본 색). 서울교통공사가 따로 밝힌 값과 한 단계 다른 노선(예: 2호선 009D3E ↔ 00A84D)이 있어도 한 문서의 값으로 통일했다.
//  - 서울 버스: 서울시 공식 자료가 밝힌 색 이름(간선 파랑·지선 초록·광역 빨강·순환 노랑)만 확인했다. 정확한 HEX 는 공식 자료에 없어서 앱 디자인 값이다.
//    마을버스 색은 확인하지 못해 넣지 않았다(기본 색). 카카오의 유형 라벨은 지역마다 뜻이 달라 색을 정하는 데 쓰지 않는다: 서버가 공식 데이터로 확정한 노선만 색을 받는다.

interface Pt {
  lat: number;
  lng: number;
}

export type TransitRegion = 'capital' | 'busan' | 'daegu' | 'daejeon' | 'gwangju';

// 지역 판정용 대략적인 사각형(남서-북동). 정밀한 행정구역 경계가 아니다.
const BOXES: { region: TransitRegion; minLat: number; maxLat: number; minLng: number; maxLng: number }[] = [
  { region: 'capital', minLat: 36.7, maxLat: 38.2, minLng: 126.3, maxLng: 127.95 }, // 서울·경기·인천(1호선은 천안·아산까지 같은 노선)
  { region: 'busan', minLat: 34.95, maxLat: 35.45, minLng: 128.7, maxLng: 129.4 },
  { region: 'daegu', minLat: 35.7, maxLat: 36.05, minLng: 128.35, maxLng: 128.9 },
  { region: 'daejeon', minLat: 36.2, maxLat: 36.5, minLng: 127.25, maxLng: 127.55 },
  { region: 'gwangju', minLat: 35.05, maxLat: 35.3, minLng: 126.7, maxLng: 127.0 },
];

export function regionOf(p: Pt): TransitRegion | null {
  return BOXES.find((b) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng)?.region ?? null;
}

export const DEFAULT_SUBWAY_COLOR = '#6C5CE7'; // 앱 기본 경로색(지금까지 대중교통 경로선 색)
export const DEFAULT_BUS_COLOR = '#4F6D8F';
export const WALK_COLOR = '#8A94A3';

export interface LineColor {
  color: string;
  /** 값의 근거 표기(위 주석의 A~G) */
  source: string;
}

const L = (color: string, source: string): LineColor => ({ color, source });

// 지역 -> 카카오 노선명 -> 색. 이름이 겹치는 "1호선" 같은 노선은 지역별로 따로 둔다.
export const SUBWAY_COLORS: Record<TransitRegion, Record<string, LineColor>> = {
  capital: {
    '1호선': L('#0052A4', 'A'),
    '2호선': L('#009D3E', 'A'),
    '3호선': L('#EF7C1C', 'A'),
    '4호선': L('#00A4E3', 'A'),
    '5호선': L('#996CAC', 'A'),
    '6호선': L('#CD7C2F', 'A'),
    '7호선': L('#747F00', 'A'),
    '8호선': L('#F15B66', 'A'),
    '9호선': L('#BDB092', 'A'),
    경의중앙선: L('#77C4A3', 'A'),
    수인분당선: L('#F5A200', 'A'),
    경춘선: L('#0C8E72', 'A'),
    신분당선: L('#D4003B', 'A'),
    인천1호선: L('#7CA8D5', 'A'),
    인천2호선: L('#ED8B00', 'E'),
    서해선: L('#81A914', 'B'),
    우이신설: L('#B0CE18', 'C'),
    '의정부 경전철': L('#FDA600', 'B'),
    에버라인: L('#509F22', 'B'),
  },
  busan: {
    '1호선': L('#F06A00', 'F'),
    '2호선': L('#81BF48', 'F'),
    '3호선': L('#BB8C00', 'F'),
    '4호선': L('#217DCB', 'F'),
  },
  daegu: {
    '1호선': L('#D93F5C', 'F'),
    '2호선': L('#00AA80', 'F'),
    '3호선': L('#FFB100', 'G'),
  },
  daejeon: {},
  gwangju: {},
};

/** 지하철 노선색. 지역을 모르거나 표에 없는 노선이면 null(호출한 쪽이 기본 색을 쓴다). */
export function subwayColor(region: TransitRegion | null, lineName: string): LineColor | null {
  if (!region) return null;
  return SUBWAY_COLORS[region][lineName] ?? null;
}

// 서울시 버스 유형 -> 색. 색 이름은 서울시 공식 자료(간선 파랑·지선 초록·광역 빨강·순환 노랑), HEX 는 앱 디자인 값이다.
export const SEOUL_BUS_COLORS: Record<string, LineColor> = {
  간선: L('#2F66D0', '서울시 색 이름: 파랑'),
  지선: L('#3C9A3C', '서울시 색 이름: 초록'),
  광역: L('#D32F2F', '서울시 색 이름: 빨강'),
  순환: L('#E5A800', '서울시 색 이름: 노랑'),
};

// 공식 노선 데이터(TAGO)로 운영 지역과 노선 유형을 모두 확인한 버스의 색. 시·도 -> 공식 노선 유형(routetp) -> 색.
// 근거는 해당 지자체가 밝힌 색 이름만이다(HEX 는 앱 디자인 값). 근거가 없는 지역·유형은 넣지 않는다.
//  - 인천: 인천시 누리집 「색상개선(시내버스 유형별 색상)」 2013-10-09 - 광역 빨강, 간선 파랑, 지선·순환 초록. (급행간선 자색은 TAGO 의 "급행버스"와 같은지 확인하지 못해 뺐다.
//    좌석·공항·마을은 문서에 색이 없다.) 문서가 오래되어 현재 도색과 다를 수 있다.
//  - 경기: 공식 색 기준 자료를 찾지 못했다(2차 자료는 공공관리제 이후 도색이 섞여 있다고 한다). 넣지 않는다.
//  - 서울: 서울 노선정보조회(routeType 3 간선·4 지선·5 순환·6 광역)가 정류장 순서 검증까지 통과해 서버가 확정한 노선만 위 SEOUL_BUS_COLORS 를 쓴다.
//    마을(2)은 색 기준이 없어 기본 색이다. 확정하지 못한 버스는 서울 안이든 밖이든 카카오 라벨로 추정하지 않고 기본 색이다.
export const OFFICIAL_BUS_COLORS: Record<string, Record<string, LineColor>> = {
  seoul: SEOUL_BUS_COLORS,
  incheon: {
    광역버스: L('#D32F2F', '인천시 색 이름: 빨강'),
    간선버스: L('#2F66D0', '인천시 색 이름: 파랑'),
    지선버스: L('#3C9A3C', '인천시 색 이름: 초록'),
    순환버스: L('#3C9A3C', '인천시 색 이름: 초록'),
  },
};

export function officialBusColor(region: string | null, routeClass: string | null): LineColor | null {
  if (!region || !routeClass) return null;
  return OFFICIAL_BUS_COLORS[region]?.[routeClass] ?? null;
}

// ───────────────────────── 구간별 선 ─────────────────────────

export interface RouteSegment {
  path: Pt[];
  color: string;
  /** 도보·환승 구간은 점선 */
  dashed: boolean;
  kind: 'walk' | 'bus' | 'subway';
}

interface StepLike {
  type: string;
  vehicles: { name: string; type: string | null; operatorRegion?: string | null; routeClass?: string | null }[];
  pathStartIndex?: number;
}

export interface TransitOptionLike {
  path: Pt[];
  steps: StepLike[];
}

/** 구간 경계에서 앞 구간의 끝 점과 다음 구간의 시작 점이 이만큼(m) 넘게 떨어져 있으면 서로 잘못 연결된 것으로 본다(실제 응답은 1m 안쪽) */
export const MAX_BOUNDARY_GAP_M = 150;

const M_PER_DEG = 111_320;
function gapM(a: Pt, b: Pt): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

const uniqueOrNull = (values: (string | null | undefined)[]): string | null => {
  const set = new Set(values.filter((v): v is string => !!v));
  return set.size === 1 ? [...set][0] : null;
};

/**
 * 대중교통 옵션을 구간별 색 선으로 나눈다. 기존 경로 좌표를 그대로 쓰고 새 좌표를 만들지 않는다.
 * 구간 시작 위치(pathStartIndex)가 없거나 순서·범위·경계 연결이 맞지 않으면 null 을 돌려주고, 호출한 쪽은 기존처럼 한 가지 색 경로선을 그린다.
 * 각 구간 선은 다음 구간의 첫 점까지 이어서 그려 색이 바뀌는 곳에서 선이 끊기지 않는다.
 */
export function buildRouteSegments(option: TransitOptionLike): RouteSegment[] | null {
  const { path, steps } = option;
  if (path.length < 2 || steps.length === 0) return null;
  const starts: { step: StepLike; start: number }[] = [];
  for (const step of steps) {
    if (typeof step.pathStartIndex !== 'number') continue; // 좌표가 없는 구간(그릴 것이 없다)
    starts.push({ step, start: step.pathStartIndex });
  }
  if (starts.length === 0 || starts[0].start !== 0) return null; // 앞부분 좌표가 어느 구간 것인지 알 수 없다
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].start;
    if (!Number.isInteger(start) || start >= path.length || (i > 0 && start <= starts[i - 1].start)) return null;
  }
  const segments: RouteSegment[] = [];
  for (let i = 0; i < starts.length; i++) {
    const { step, start } = starts[i];
    const nextStart = i + 1 < starts.length ? starts[i + 1].start : null;
    if (nextStart !== null && gapM(path[nextStart - 1], path[nextStart]) > MAX_BOUNDARY_GAP_M) return null;
    const slice = path.slice(start, nextStart === null ? path.length : nextStart + 1);
    if (slice.length < 2) continue;
    segments.push(styleOf(step, slice));
  }
  return segments.length > 0 ? segments : null;
}

// ───────────────────────── 버스 구간 색: 검색 카드와 지도가 이 함수 하나를 쓴다 ─────────────────────────

/**
 * 공식 색 기준이 없는 버스의 표시 색. 공식 노선 유형 색이 아니라 카카오맵 배색과 같은 표시용 구분이다: 직행·급행·광역은 빨강, 그 외는 초록.
 * (서울·인천이 공식으로 밝힌 색은 이 상수가 아니라 SEOUL_BUS_COLORS / OFFICIAL_BUS_COLORS 에서 온다. 광역의 공식 빨강 HEX 와 이 표시용 빨강 HEX 는 일부러 다르다.)
 */
export const EXPRESS_BUS_COLOR = '#DC2626';
export const REGULAR_BUS_COLOR = '#0B7A5A';

export type BusColorBasis = 'official' | 'category' | 'default';
/** 표시용 구분에 쓴 글자의 출처: 서버가 공식 데이터로 확정한 노선 유형 이름 / 카카오가 준 유형 라벨 / 둘이 섞임 */
export type BusLabelSource = 'official-class' | 'kakao-label' | 'mixed';
export interface BusColor {
  color: string;
  /** official: 서버가 공식 데이터로 확정한 지역·유형의 공식 색 · category: 공식 색이 없어 직행(급행·광역)/일반만 표시용으로 구분 · default: 구분할 근거가 없는 기본 색 */
  basis: BusColorBasis;
  /** basis 가 category 일 때만: 어떤 글자로 구분했는가 */
  labelSource?: BusLabelSource;
}

const isExpress = (label: string): boolean => label.includes('직행') || label.includes('급행') || label.includes('광역');

/**
 * 버스 구간 하나의 색. 우선순위:
 *  1. 서버가 모든 노선의 지역·유형을 공식 데이터로 확정했고 그 지역·유형의 공식 색이 있으면 그 색(서울 간선·지선·순환·광역, 인천 광역·간선·지선·순환). basis=official.
 *  2. 서울 마을버스(공식 확정)는 색 기준이 없어 기본 색.
 *  3. 그 밖에는(경기 등 공식 색 기준이 없거나, 확정하지 못했거나, 옛 서버) 공식 유형 이름 또는 카카오 유형 라벨의 글자로 직행·급행·광역(빨강)과 그 외(초록)를
 *     구분한다. basis=category 이고 labelSource 가 글자의 출처를 알려 준다. 이것은 표시용 구분이지 공식 색이 아니다.
 *  구간의 노선들을 하나로 정할 수 없으면(지역·유형이 섞이거나 라벨이 없거나 구분이 갈림) 기본 색이다. 노선 번호나 좌표로 유형을 추정하지 않는다.
 */
export function busLegColor(vehicles: StepLike['vehicles']): BusColor {
  const fallback: BusColor = { color: DEFAULT_BUS_COLOR, basis: 'default' };
  if (vehicles.length === 0) return fallback;
  if (vehicles.every((v) => v.operatorRegion)) {
    const regions = new Set(vehicles.map((v) => v.operatorRegion));
    if (regions.size !== 1) return fallback; // 서로 다른 지역 노선이 섞임
    const classes = new Set(vehicles.map((v) => v.routeClass).filter((c): c is string => !!c));
    if (classes.size > 1) return fallback; // 공식 유형이 섞임: 어느 쪽 색인지 모른다
    const region = [...regions][0] as string;
    const official = classes.size === 1 ? officialBusColor(region, [...classes][0]) : null;
    if (official) return { color: official.color, basis: 'official' };
    if (region === 'seoul' && classes.has('마을')) return fallback; // 서울 마을버스는 색 기준이 없다
  }
  const picked = vehicles.map((v) => (v.operatorRegion && v.routeClass ? { text: v.routeClass, official: true } : { text: v.type ?? '', official: false }));
  if (picked.some((p) => p.text === '')) return fallback;
  const express = picked.map((p) => isExpress(p.text));
  if (express.some((e) => e !== express[0])) return fallback; // 직행(급행·광역)과 일반이 한 구간에 섞임
  const labelSource: BusLabelSource = picked.every((p) => p.official) ? 'official-class' : picked.every((p) => !p.official) ? 'kakao-label' : 'mixed';
  return { color: express[0] ? EXPRESS_BUS_COLOR : REGULAR_BUS_COLOR, basis: 'category', labelSource };
}

function styleOf(step: StepLike, slice: Pt[]): RouteSegment {
  if (step.type === 'WALKING') return { path: slice, color: WALK_COLOR, dashed: true, kind: 'walk' };
  if (step.type === 'SUBWAY') {
    const line = uniqueOrNull(step.vehicles.map((v) => v.name));
    const found = line ? subwayColor(regionOf(slice[0]), line) : null;
    return { path: slice, color: found?.color ?? DEFAULT_SUBWAY_COLOR, dashed: false, kind: 'subway' };
  }
  return { path: slice, color: busLegColor(step.vehicles).color, dashed: false, kind: 'bus' };
}
