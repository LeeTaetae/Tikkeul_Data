import { fetchWithTimeout } from '../lib/api/fetchTimeout';
import { API_BASE_URL } from '../lib/config';
import type { RoutePoint } from './types';

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

export interface StyledRoute {
  style: RouteStyle;
  distanceKm: number;
  durationMin: number;
  path: RoutePoint[];
  instructions: RouteInstruction[];
}

function parseRoutes(data: unknown): StyledRoute[] | null {
  const routes = (data as { routes?: unknown[] })?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  return routes.map((r: any) => ({
    style: r.style,
    distanceKm: r.distance_km,
    durationMin: r.duration_min,
    path: r.path,
    instructions: Array.isArray(r.instructions)
      ? r.instructions.map((i: any) => ({ text: i.text, point: i.point ?? null }))
      : [],
  }));
}

// PoC 백엔드가 Tmap searchOption 5가지(추천/무료/고속도로우선/최단거리/어린이보호구역회피)를
// 동시에 호출해서 돌려준다. 실패하면 null.
export async function fetchRouteStyles(origin: RoutePoint, destination: RoutePoint): Promise<StyledRoute[] | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/navigation/route-styles`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      },
      ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return parseRoutes(await res.json());
  } catch {
    return null;
  }
}

// 도보/자전거/대중교통 — 자동차처럼 여러 스타일이 아니라 경로 하나만 온다(배열 길이 1).
export async function fetchModeRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  mode: Exclude<TravelMode, 'driving'>,
): Promise<StyledRoute[] | null> {
  if (!API_BASE_URL) return null;
  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/navigation/route-by-mode`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination, mode }),
      },
      ROUTE_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return parseRoutes(await res.json());
  } catch {
    return null;
  }
}

// 대중교통만 버스/지하철/버스+지하철 조합으로 경로가 여러 개 온다. 카테고리별로 골라볼 수 있게 전부 받는다.
export interface TransitVehicle {
  name: string;
  type: string | null;
}

export interface TransitStop {
  name: string;
}

// 구간 하나 — 도보 한 토막, 또는 버스/지하철 한 번 타는 구간. 몇 호선·몇 번 버스를 어디서 타고 내리는지
// 상세 표시하는 데 쓴다.
export interface TransitStep {
  type: 'WALKING' | 'BUS' | 'SUBWAY';
  distanceM: number;
  timeSec: number;
  stops: TransitStop[];
  vehicles: TransitVehicle[];
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
            stops: Array.isArray(s.stops) ? s.stops : [],
            vehicles: Array.isArray(s.vehicles) ? s.vehicles : [],
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
