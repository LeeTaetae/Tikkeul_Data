// 경로가 지나는 시군구 찾기와 보호구역 모으기. 네트워크 호출은 함수로 주입받는 순수 코드라 Node 로 테스트한다.
//
// 왜 이렇게 하나: 백엔드가 주는 것은 "좌표 하나 → 시군구(sgg_cd)"(/api/geo/region)와 "sgg_cd 하나 → 보호구역 목록"뿐이다.
// 경로나 영역으로 지나는 시군구를 한 번에 묻는 API, 행정구역 경계(폴리곤) 조회는 없다(지원한다고 가정하지 않는다).
// 그래서 경로를 일정 간격으로 표본 조회한다. 표본과 표본 사이만 지나는 아주 좁은 시군구는 놓칠 수 있으므로,
// 결과는 절대 "전부 조회했다(complete)"가 아니라 'sampled'(표본 조회)다. 일부 호출이 실패하거나 한도에 걸리면 'partial', 하나도 못 찾으면 'failed'.
// 보낸 좌표는 경로 위의 점이며(소수 3자리 반올림은 호출하는 쪽이 한다), 한 경로당 호출 수를 한도로 묶는다.

export interface LatLng {
  lat: number;
  lng: number;
}

export const ZONE_SAMPLING = {
  /** 표본 간격 하한·상한(m). 경로가 길면 간격을 늘려 표본 수 한도(maxSamples)에 맞춘다 */
  minSpacingM: 3000,
  maxSpacingM: 8000,
  maxSamples: 14,
  /** 시군구가 바뀐 구간의 중간을 더 조회하는 횟수 상한(깊이). 사이에 낀 작은 시군구를 찾기 위함이다 */
  bisectDepth: 2,
  /** 한 경로의 지역 조회 총 한도 */
  maxLookups: 24,
} as const;

const M_PER_DEG = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function distanceM(a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

export interface RouteSampler {
  totalM: number;
  /** 경로 시작에서 distM 만큼 간 지점의 좌표 */
  pointAt: (distM: number) => LatLng;
}

/** 경로가 한 점뿐이거나 길이가 0 이면 null */
export function buildRouteSampler(path: LatLng[]): RouteSampler | null {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distanceM(path[i - 1], path[i]));
  const totalM = cum[cum.length - 1] ?? 0;
  if (path.length < 2 || !(totalM > 0)) return null;
  return {
    totalM,
    pointAt: (d) => {
      const target = Math.min(Math.max(d, 0), totalM);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const len = cum[i] - cum[i - 1];
      const t = len > 0 ? (target - cum[i - 1]) / len : 0;
      return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t };
    },
  };
}

export interface SamplePlan {
  /** 경로 시작에서 잰 표본 거리(m). 항상 0 으로 시작한다 */
  distances: number[];
  spacingM: number;
  /** 경로가 너무 길어 끝까지 표본을 못 잡았다 */
  truncated: boolean;
}

export function planSamples(totalM: number): SamplePlan {
  const { minSpacingM, maxSpacingM, maxSamples } = ZONE_SAMPLING;
  const wanted = totalM / (maxSamples - 1);
  const spacingM = Math.min(maxSpacingM, Math.max(minSpacingM, wanted));
  const truncated = wanted > maxSpacingM;
  const distances: number[] = [];
  for (let d = 0; d < totalM && distances.length < maxSamples - (truncated ? 0 : 1); d += spacingM) distances.push(d);
  if (!truncated) distances.push(totalM); // 도착 지점은 항상 조회한다
  return { distances, spacingM, truncated };
}

/** sgg_cd 를 돌려준다. 시군구를 못 찾으면(바다 등) null, 호출이 실패하면 throw 한다. */
export type RegionFetcher = (point: LatLng) => Promise<string | null>;

export interface RegionScan {
  sggCodes: string[];
  lookups: number;
  failedLookups: number;
  /** 길이 때문에 끝까지 못 잡았거나 조회 한도에 걸려 중간 확인을 멈췄다 */
  truncated: boolean;
  spacingM: number;
}

type Sample = { distM: number; sgg: string | null | 'error' };

export async function scanRouteRegions(path: LatLng[], fetchRegion: RegionFetcher): Promise<RegionScan | null> {
  const sampler = buildRouteSampler(path);
  if (!sampler) return null;
  const plan = planSamples(sampler.totalM);
  let lookups = 0;
  let failedLookups = 0;
  let capped = false;
  const codes = new Set<string>();

  const lookup = async (distM: number): Promise<Sample> => {
    lookups++;
    try {
      const sgg = await fetchRegion(sampler.pointAt(distM));
      if (sgg) codes.add(sgg);
      return { distM, sgg };
    } catch {
      failedLookups++;
      return { distM, sgg: 'error' };
    }
  };

  const samples = await Promise.all(plan.distances.map(lookup));

  // 이웃한 표본의 시군구가 다르면 그 사이를 이분해서 더 본다(사이에 낀 다른 시군구를 찾기 위함).
  const bisect = async (a: Sample, b: Sample, depth: number): Promise<void> => {
    if (depth <= 0) return;
    if (lookups >= ZONE_SAMPLING.maxLookups) {
      capped = true;
      return;
    }
    const mid = await lookup((a.distM + b.distM) / 2);
    if (typeof mid.sgg !== 'string') return;
    if (mid.sgg !== a.sgg) await bisect(a, mid, depth - 1);
    if (mid.sgg !== b.sgg) await bisect(mid, b, depth - 1);
  };
  for (let i = 0; i + 1 < samples.length; i++) {
    const [a, b] = [samples[i], samples[i + 1]];
    if (typeof a.sgg === 'string' && typeof b.sgg === 'string' && a.sgg !== b.sgg) await bisect(a, b, ZONE_SAMPLING.bisectDepth);
  }

  return { sggCodes: [...codes], lookups, failedLookups, truncated: plan.truncated || capped, spacingM: plan.spacingM };
}

/** 'sampled' 는 "표본 조회에 성공"일 뿐 전체 조회가 아니다. 'complete' 는 만들지 않는다. */
export type ZoneCoverage = 'sampled' | 'partial' | 'failed';

export function coverageOf(scan: RegionScan | null, failedZoneFetches: number): ZoneCoverage {
  if (!scan || scan.sggCodes.length === 0) return 'failed';
  if (scan.failedLookups > 0 || scan.truncated || failedZoneFetches > 0) return 'partial';
  return 'sampled';
}

export interface RouteZones<T> {
  items: T[];
  sggCodes: string[];
  coverage: ZoneCoverage;
  spacingM: number | null;
}

/** 지나는 시군구마다 보호구역을 받아 하나로 합친다. keyOf 가 같은 항목은 한 번만 담는다. */
export async function collectRouteZones<T>(
  path: LatLng[],
  deps: { fetchRegion: RegionFetcher; fetchZones: (sggCd: string) => Promise<T[]>; keyOf: (item: T) => string },
): Promise<RouteZones<T>> {
  const scan = await scanRouteRegions(path, deps.fetchRegion);
  if (!scan) return { items: [], sggCodes: [], coverage: 'failed', spacingM: null };
  let failedZoneFetches = 0;
  const lists = await Promise.all(
    scan.sggCodes.map((code) =>
      deps.fetchZones(code).catch(() => {
        failedZoneFetches++;
        return [] as T[];
      }),
    ),
  );
  const byKey = new Map<string, T>();
  for (const item of lists.flat()) byKey.set(deps.keyOf(item), item);
  return { items: [...byKey.values()], sggCodes: scan.sggCodes, coverage: coverageOf(scan, failedZoneFetches), spacingM: scan.spacingM };
}
