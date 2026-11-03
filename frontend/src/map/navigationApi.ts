import { fetchWithTimeout } from '../lib/api/fetchTimeout';
import { API_BASE_URL } from '../lib/config';
import { buildRouteBody, parseBestRoute, parseRoutes, type RouteGuide, type RouteRequestOptions } from './parseRoutes';
import { parseTransitVehicle } from './parseTransitVehicle';
import type { RoutePoint } from './types';

export type { RouteGuide } from './parseRoutes';

// 앞의 5개는 자동차(Tmap searchOption) 스타일, 뒤의 3개는 이동수단 자체(도보/자전거/대중교통).
// 경로 탐색은 외부 API 여러 개를 부르고 무료 서버는 처음 깨어나는 데 오래 걸려서 넉넉히 둔다. 주소 변환은 부가 정보라 짧게 둔다.
const ROUTE_TIMEOUT_MS = 40_000;
const ADDRESS_TIMEOUT_MS = 8_000;

export type RouteStyle =
  | 'recommended'
  | 'toll_free'
  | 'major_road'
  | 'shortest'
  | 'avoid_school_zone'
  | 'walking'
  | 'cycling'
  | 'transit';

export type TravelMode = 'driving' | 'walking' | 'cycling' | 'transit';

// point 가 있으면 그 지점 근처에서 TTS 로 읽을 수 있다(없으면 텍스트만 표시).
export interface RouteInstruction {
  text: string;
  point: RoutePoint | null;
}

// route-styles 의 styles 로 고를 수 있는 자동차 스타일(백엔드 DrivingStyle)
export type DrivingStyle = Extract<RouteStyle, 'recommended' | 'toll_free' | 'major_road' | 'shortest' | 'avoid_school_zone'>;

export interface StyledRoute {
  style: RouteStyle;
  distanceKm: number;
  durationMin: number;
  path: RoutePoint[];
  instructions: RouteInstruction[];
  /** include_guides 로 요청했고 응답에 있을 때만 채워진다. 자전거·대중교통은 지원하지 않아 항상 없다 */
  guides?: RouteGuide[];
}

// PoC 백엔드가 Tmap searchOption 5가지(추천/무료/고속도로우선/최단거리/어린이보호구역회피)를
// 동시에 호출해서 돌려준다. 실패하면 null. options 를 생략하면 기존 요청과 똑같다.
export async function fetchRouteStyles(
  origin: RoutePoint,
  destination: RoutePoint,
  options: RouteRequestOptions = {},
): Promise<StyledRoute[] | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/navigation/route-styles`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRouteBody(origin, destination, options)),
      },
      ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return parseRoutes(await res.json());
  } catch {
    return null;
  }
}

// route-styles(Tmap 5가지)가 실패했을 때만 쓰는 대체 경로. 백엔드 /navigation/route 는 Tmap 이 안 되면 네이버로 넘어간다.
// 카드 하나('추천')만 돌려준다. 실제 길안내는 카카오 SDK 가 따로 계산하므로 이 경로는 미리보기용이다. 실패하면 null.
export async function fetchBestRoute(origin: RoutePoint, destination: RoutePoint): Promise<StyledRoute[] | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/navigation/route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRouteBody(origin, destination)),
      },
      ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const route = parseBestRoute(await res.json());
    return route ? [route] : null;
  } catch {
    return null;
  }
}

// 도보/자전거/대중교통 — 자동차처럼 여러 스타일이 아니라 경로 하나만 온다(배열 길이 1).
export async function fetchModeRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  mode: Exclude<TravelMode, 'driving'>,
  options: Pick<RouteRequestOptions, 'includeGuides'> = {},
): Promise<StyledRoute[] | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/navigation/route-by-mode`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRouteBody(origin, destination, options, { mode })),
      },
      ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return parseRoutes(await res.json());
  } catch {
    return null;
  }
}

// 길안내 시작·재탐색용: 경로 하나와 회전 안내 지점(guides)을 함께 받는다. 기존 경로 탐색 API 를 그대로 쓴다.
// 자동차는 스타일 하나만 요청해 외부 호출을 줄인다(style 을 생략하면 recommended). 도보는 경로가 하나뿐이다.
export async function fetchGuidanceRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  mode: 'driving' | 'walking',
  style: DrivingStyle = 'recommended',
): Promise<StyledRoute | null> {
  const routes =
    mode === 'driving'
      ? await fetchRouteStyles(origin, destination, { includeGuides: true, styles: [style] })
      : await fetchModeRoute(origin, destination, 'walking', { includeGuides: true });
  return routes?.[0] ?? null;
}

// 대중교통만 버스/지하철/버스+지하철 조합으로 경로가 여러 개 온다. 카테고리별로 골라볼 수 있게 전부 받는다.
export interface TransitVehicle {
  name: string;
  type: string | null;
  /** 버스만: 공식 노선 데이터(국토교통부 TAGO · 서울 노선정보조회)와 서버가 확정한 경우에만 값이 있다. 확정하지 못했거나 옛 서버면 null */
  routeId: string | null;
  /** 노선이 등록된 시·도 (seoul, incheon, gyeonggi ...) */
  operatorRegion: string | null;
  /** 공식 노선 유형 그대로 (TAGO: 간선버스, 일반버스 ... / 서울: 간선, 지선, 순환, 광역, 마을). 서울 API 로만 채운 경기·인천 노선은 유형을 몰라 null */
  routeClass: string | null;
}

export interface TransitStop {
  name: string;
  /** 공식 좌표 데이터와 매칭된 정거장만 값이 있다(지금은 지하철만). 매칭하지 못했거나 옛 서버면 null */
  lat: number | null;
  lng: number | null;
  matchConfidence: 'high' | 'medium' | null;
}

// 구간 하나 — 도보 한 토막, 또는 버스/지하철 한 번 타는 구간. 몇 호선·몇 번 버스를 어디서 타고 내리는지
// 상세 표시하는 데 쓴다.
export interface TransitStep {
  type: 'WALKING' | 'BUS' | 'SUBWAY';
  distanceM: number;
  timeSec: number;
  stops: TransitStop[];
  vehicles: TransitVehicle[];
  /** 합쳐진 path 에서 이 구간의 첫 좌표 위치. 서버가 구간 좌표를 주지 않았거나 옛 서버면 없다(만들어내지 않는다) */
  pathStartIndex?: number;
}

export interface TransitRouteOption {
  type: 'BUS' | 'SUBWAY' | 'BUS_AND_SUBWAY';
  distanceKm: number;
  durationMin: number;
  transfers: number;
  fare: number;
  path: RoutePoint[];
  instructions: string[];
  steps: TransitStep[];
}

export interface TransitRoutesResult {
  total: number;
  bus: number;
  subway: number;
  busAndSubway: number;
  routes: TransitRouteOption[];
}

// 좌표는 숫자 두 개와 서버가 검증한 신뢰도(high/medium)가 모두 있을 때만 믿는다. 하나라도 빠지면 좌표를 버린다(채워 넣지 않는다).
function parseTransitStop(raw: any): TransitStop {
  const trusted = Number.isFinite(raw?.lat) && Number.isFinite(raw?.lng) && (raw.match_confidence === 'high' || raw.match_confidence === 'medium');
  return {
    name: typeof raw?.name === 'string' ? raw.name : '',
    lat: trusted ? raw.lat : null,
    lng: trusted ? raw.lng : null,
    matchConfidence: trusted ? raw.match_confidence : null,
  };
}

function parseTransitRoutes(data: unknown): TransitRoutesResult | null {
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d?.routes)) return null;
  return {
    total: typeof d.total === 'number' ? d.total : d.routes.length,
    bus: typeof d.bus === 'number' ? d.bus : 0,
    subway: typeof d.subway === 'number' ? d.subway : 0,
    busAndSubway: typeof d.bus_and_subway === 'number' ? d.bus_and_subway : 0,
    routes: d.routes.map((r: any) => ({
      type: r.type,
      distanceKm: r.distance_km,
      durationMin: r.duration_min,
      transfers: r.transfers,
      fare: r.fare,
      path: r.path,
      instructions: Array.isArray(r.instructions) ? r.instructions : [],
      steps: Array.isArray(r.steps)
        ? r.steps.map((s: any) => ({
            type: s.type,
            distanceM: s.distance_m,
            timeSec: s.time_sec,
            stops: Array.isArray(s.stops) ? s.stops.map(parseTransitStop) : [],
            vehicles: Array.isArray(s.vehicles) ? s.vehicles.map(parseTransitVehicle) : [],
            ...(Number.isInteger(s.path_start_index) && s.path_start_index >= 0 ? { pathStartIndex: s.path_start_index } : {}),
          }))
        : [],
    })),
  };
}

export async function fetchTransitRoutes(origin: RoutePoint, destination: RoutePoint): Promise<TransitRoutesResult | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/navigation/transit-routes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      },
      ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return parseTransitRoutes(await res.json());
  } catch {
    return null;
  }
}

// 좌표를 실제 주소 문자열로 바꾼다(카카오 역지오코딩). REST 키가 없으면 서버가 null을 주고,
// 호출 쪽에서 "내 위치"/"지도에서 선택한 위치" 같은 라벨로 대체한다.
export async function fetchAddress(point: RoutePoint): Promise<string | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/geocode/reverse?lat=${point.lat}&lng=${point.lng}`, {}, ADDRESS_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.address === 'string' ? data.address : null;
  } catch {
    return null;
  }
}
