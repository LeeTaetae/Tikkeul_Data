// 경로 응답 파서와 요청 본문 조립. 다른 모듈을 런타임 import 하지 않는 순수 함수라 Node 로도 테스트한다.
import type { DrivingStyle, StyledRoute } from './navigationApi';
import type { RoutePoint } from './types';

// 회전·안내 지점 하나(백엔드 RouteGuide). 모르는 숫자 값은 응답에서 키가 빠지므로 optional 로 둔다. 없는 값을 추측해 채우지 않는다.
export interface RouteGuide {
  index: number;
  lat: number;
  lng: number;
  /** 같은 응답의 path 배열에서 이 지점의 위치. 경로를 따라 진행 거리를 잴 때 쓴다 */
  pathIndex: number;
  /** Tmap turnType 코드. 모르면 undefined */
  turnType?: number;
  /** Tmap pointType: S 출발, E 도착, B1~B3 경유, N 일반 안내점. 모르면 빈 문자열 */
  pointType: string;
  description: string;
  name: string;
  nextRoadName: string;
  /** 이 지점부터 다음 안내 지점까지 거리(m)·시간(초) */
  legDistanceM?: number;
  legTimeSec?: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// guides 가 없거나 배열이 아니면 undefined. 좌표나 path_index 가 깨진 항목은 버리고, 나머지 선택 필드는 있는 것만 담는다.
export function parseGuides(raw: unknown): RouteGuide[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const guides: RouteGuide[] = [];
  raw.forEach((item: any, position) => {
    if (!item || !isNum(item.lat) || !isNum(item.lng) || !isNum(item.path_index) || item.path_index < 0) return;
    const guide: RouteGuide = {
      index: isNum(item.index) ? item.index : position,
      lat: item.lat,
      lng: item.lng,
      pathIndex: Math.floor(item.path_index),
      pointType: str(item.point_type),
      description: str(item.description),
      name: str(item.name),
      nextRoadName: str(item.next_road_name),
    };
    if (isNum(item.turn_type)) guide.turnType = item.turn_type;
    if (isNum(item.leg_distance_m)) guide.legDistanceM = item.leg_distance_m;
    if (isNum(item.leg_time_sec)) guide.legTimeSec = item.leg_time_sec;
    guides.push(guide);
  });
  return guides;
}

export function parseRoutes(data: unknown): StyledRoute[] | null {
  const routes = (data as { routes?: unknown[] })?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  return routes.map((r: any) => {
    const route: StyledRoute = {
      style: r.style,
      distanceKm: r.distance_km,
      durationMin: r.duration_min,
      path: r.path,
      instructions: Array.isArray(r.instructions) ? r.instructions : [],
    };
    // 안내용 요청(include_guides)이 아니면 응답에 guides 키가 없다. 그때는 키 자체를 만들지 않는다.
    const guides = parseGuides(r.guides);
    if (guides) route.guides = guides;
    return route;
  });
}

export interface RouteRequestOptions {
  /** 길안내 시작·재탐색 요청만 true. 경로 검색 목록은 켜지 않는다(응답이 커진다) */
  includeGuides?: boolean;
  /** 자동차 전용. 재탐색처럼 한 스타일만 필요할 때 좁혀서 외부 API 호출을 줄인다 */
  styles?: DrivingStyle[];
}

// include_guides·styles 는 값을 줬을 때만 본문에 넣는다. 그래서 옵션이 없으면 기존 요청 본문과 똑같다.
export function buildRouteBody(
  origin: RoutePoint,
  destination: RoutePoint,
  options: RouteRequestOptions = {},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { origin, destination, ...extra };
  if (options.includeGuides) body.include_guides = true;
  if (options.styles && options.styles.length > 0) body.styles = options.styles;
  return body;
}
