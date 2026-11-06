// 터널 시설 데이터 검증과 검색 색인.
//
// 핵심 규칙: **입구 좌표를 정확히 아는 시설만** 거리 기반 사전 경고 대상으로 쓴다.
//  - 좌표가 없거나, 한쪽 끝점만 있거나, 시점=종점인 대표 좌표(point only)는 입구가 어디인지 모른다. 받아들이지 않는다.
//    (PoC 실측: 점 하나 기록은 입구도 중앙도 아니다. 거기서 입구를 추정하면 틀린 거리로 경고하게 된다.)
//  - 양 끝점이 있어도 직선거리가 연장보다 지나치게 길면 좌표 오류로 보고 받아들이지 않는다.
// 번들 데이터는 ai/tunnel_detection/scripts/export_app_tunnels.py 가 같은 기준으로 걸러 만들지만, 앱도 한 번 더 검사한다.
import { haversineM, type LatLng } from './geo';

export type TunnelDirection = 'up' | 'down' | 'both' | 'unknown';

export interface TunnelFacility {
  id: string;
  name: string;
  /** 상·하행·신·구 같은 괄호 접미를 뗀 이름. 같은 시설의 다른 관을 묶는 데 쓴다. */
  baseName: string;
  roadType: string | null;
  roadName: string | null;
  direction: TunnelDirection;
  lengthM: number;
  /** 기록의 시점. 입구인지 출구인지는 진행 방향으로 정한다. */
  a: LatLng;
  /** 기록의 종점. */
  b: LatLng;
  /** 같은 시설의 다른 관(쌍굴 등)끼리 같은 값. 경고 이력의 키로 쓴다. */
  groupId: string;
}

export type RejectReason =
  | 'malformed'
  | 'noCoords'
  | 'outsideKorea'
  | 'pointOnly'
  | 'lengthInvalid'
  | 'lengthMismatch'
  | 'duplicate';

export const POINT_ONLY_M = 3; // 두 끝점이 이보다 가까우면 점 하나뿐인 기록
export const GROUP_WINDOW_M = 150; // 이름이 같고 끝점이 이 안이면 같은 시설의 다른 관
const KOREA = { minLat: 32.5, maxLat: 39.5, minLng: 124, maxLng: 132.5 };
const GRID_DEG = 0.02; // 약 2.2km

export interface TunnelIndex {
  facilities: TunnelFacility[];
  /** 반경 안(어느 한 끝점이라도)에 있는 시설. */
  near(p: LatLng, radiusM: number): TunnelFacility[];
}

export interface ParsedDataset {
  index: TunnelIndex;
  rejected: Record<RejectReason, number>;
}

const emptyRejected = (): Record<RejectReason, number> => ({
  malformed: 0,
  noCoords: 0,
  outsideKorea: 0,
  pointOnly: 0,
  lengthInvalid: 0,
  lengthMismatch: 0,
  duplicate: 0,
});

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inKorea = (p: LatLng) => p.lat >= KOREA.minLat && p.lat <= KOREA.maxLat && p.lng >= KOREA.minLng && p.lng <= KOREA.maxLng;

function toPoint(v: unknown): LatLng | null {
  if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) return null;
  return { lat: v[0], lng: v[1] };
}

type Candidate = Omit<TunnelFacility, 'groupId'>;

function check(raw: unknown): { ok: Candidate } | { reject: RejectReason } {
  if (typeof raw !== 'object' || raw === null) return { reject: 'malformed' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return { reject: 'malformed' };
  const a = toPoint(r.entranceA);
  const b = toPoint(r.entranceB);
  // 위도·경도 둘 다 0 이거나 좌표가 없는 기록은 "좌표 없음"이다.
  const missing = (p: LatLng | null) => p === null || (p.lat === 0 && p.lng === 0);
  if (missing(a) || missing(b)) return { reject: 'noCoords' };
  if (!inKorea(a!) || !inKorea(b!)) return { reject: 'outsideKorea' };
  const chord = haversineM(a!, b!);
  if (chord <= POINT_ONLY_M) return { reject: 'pointOnly' };
  const lengthM = r.lengthM;
  if (!isNum(lengthM) || lengthM <= 0) return { reject: 'lengthInvalid' };
  if (chord > lengthM * 1.3 + 30) return { reject: 'lengthMismatch' }; // 굽은 터널은 직선이 연장보다 짧다. 더 길면 좌표가 이상하다.
  const direction = r.direction === 'up' || r.direction === 'down' || r.direction === 'both' ? r.direction : 'unknown';
  return {
    ok: {
      id: r.id,
      name: r.name,
      baseName: typeof r.baseName === 'string' ? r.baseName : baseNameOf(r.name),
      roadType: typeof r.roadType === 'string' ? r.roadType : null,
      roadName: typeof r.roadName === 'string' ? r.roadName : null,
      direction,
      lengthM,
      a: a!,
      b: b!,
    },
  };
}

/** 방향·신구 접미(괄호)를 떼고 공백을 없앤 이름. */
export function baseNameOf(name: string): string {
  return name.replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '').replace(/\s/g, '');
}

const cellOf = (p: LatLng) => `${Math.floor(p.lat / GRID_DEG)}:${Math.floor(p.lng / GRID_DEG)}`;

function minEndpointDistanceM(x: Candidate, y: Candidate): number {
  return Math.min(haversineM(x.a, y.a), haversineM(x.a, y.b), haversineM(x.b, y.a), haversineM(x.b, y.b));
}

/** 같은 이름이고 끝점이 가까운 시설을 같은 그룹으로 묶는다(union-find). */
function assignGroups(items: Candidate[]): TunnelFacility[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byName = new Map<string, number[]>();
  items.forEach((it, i) => byName.set(it.baseName, [...(byName.get(it.baseName) ?? []), i]));
  for (const members of byName.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (minEndpointDistanceM(items[members[i]], items[members[j]]) <= GROUP_WINDOW_M) parent[find(members[i])] = find(members[j]);
      }
    }
  }
  const groupMinId = new Map<number, string>();
  items.forEach((it, i) => {
    const root = find(i);
    const cur = groupMinId.get(root);
    if (cur === undefined || it.id < cur) groupMinId.set(root, it.id);
  });
  return items.map((it, i) => ({ ...it, groupId: `${it.baseName}|${groupMinId.get(find(i))}` }));
}

function buildIndex(facilities: TunnelFacility[]): TunnelIndex {
  const grid = new Map<string, TunnelFacility[]>();
  const put = (cell: string, f: TunnelFacility) => {
    const list = grid.get(cell);
    if (!list) grid.set(cell, [f]);
    else if (!list.includes(f)) list.push(f);
  };
  for (const f of facilities) {
    put(cellOf(f.a), f);
    put(cellOf(f.b), f);
  }
  return {
    facilities,
    near(p, radiusM) {
      const dLat = radiusM / 111_320;
      const dLng = radiusM / (111_320 * Math.cos((p.lat * Math.PI) / 180));
      const out = new Set<TunnelFacility>();
      for (let la = Math.floor((p.lat - dLat) / GRID_DEG); la <= Math.floor((p.lat + dLat) / GRID_DEG); la++) {
        for (let ln = Math.floor((p.lng - dLng) / GRID_DEG); ln <= Math.floor((p.lng + dLng) / GRID_DEG); ln++) {
          for (const f of grid.get(`${la}:${ln}`) ?? []) {
            if (Math.min(haversineM(p, f.a), haversineM(p, f.b)) <= radiusM) out.add(f);
          }
        }
      }
      return [...out];
    },
  };
}

/** 번들·서버 JSON(`{ tunnels: [...] }` 또는 배열)을 검증해 색인을 만든다. 걸러진 이유별 개수도 돌려준다. */
export function parseTunnelDataset(raw: unknown): ParsedDataset {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { tunnels?: unknown }).tunnels)
      ? (raw as { tunnels: unknown[] }).tunnels
      : [];
  const rejected = emptyRejected();
  const accepted: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const res = check(item);
    if ('reject' in res) {
      rejected[res.reject]++;
      continue;
    }
    const c = res.ok;
    const key = `${c.id}`;
    if (seen.has(key)) {
      rejected.duplicate++;
      continue;
    }
    seen.add(key);
    accepted.push(c);
  }
  return { index: buildIndex(assignGroups(accepted)), rejected };
}
