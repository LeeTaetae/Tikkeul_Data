// 위험 아이콘 세로 레일의 데이터 모델. 우선순위 엔진(hazardPriority)의 결과를 "화면에 보일 것만 골라 담는" 순수 함수다.
// 이 파일에는 위험 점수·등급·확정 여부를 새로 계산하는 코드가 없다. 순서도 엔진이 정한 것을 그대로 쓴다.
//   엔진의 정렬 기준: priority(P0→P3) → 점수 → 경로상 남은 거리 → 식별자.
//   (점수에 근접·TTC·최신성·확정 배율이 이미 들어 있어, 레일이 따로 TTC·신뢰도로 다시 정렬하지 않는다.)
// React 에 의존하지 않고 다른 모듈을 런타임 import 하지 않는다(Node 로 테스트한다).
import type { PrioritizedHazard, Priority } from './hazardPriority';
import type { IncidentMatch, MatchReason } from './routeHazards';
import type { AlertType, RoadAlert } from '../types/alert';

/** 레일에 한 번에 보이는 최대 개수. 넘으면 +N 으로 줄인다 */
export const RAIL_MAX_VISIBLE = 3;

/**
 * strong : 확정(confirmed)이고 엔진이 P0(즉각적 위험)로 본 것 — 긴급 강조는 여기에만 쓴다.
 *           P1 은 점수만으로도 먼 위험(예: 수 km 앞 사고)에 붙을 수 있어 긴급 강조에서 뺀다. 판정 정책이 아니라 표시 규칙이다.
 * normal : 확정이지만 P1 이하
 * neutral: 확정되지 않음(probable) — 중립 색, 긴급 강조·애니메이션 없음
 */
export type RailEmphasis = 'strong' | 'normal' | 'neutral';

export interface RailItem {
  /** 목록 키·선택 키. 같은 사건(eventKey, 없으면 id)이면 같다 */
  key: string;
  alert: RoadAlert;
  type: AlertType;
  priority: Priority;
  matchClass: 'confirmed' | 'probable';
  emphasis: RailEmphasis;
  /** 경로상 남은 거리(m). 항상 0 보다 크다(이미 지난 위험은 레일에 없다) */
  distanceM: number;
  /** 도달 예상 시간(초). 속도를 모르면 null */
  ttcSec: number | null;
  matchReason: MatchReason;
  freshness: IncidentMatch['freshness'];
  /** 개발용 예시 데이터. 실제 위험이 아니다 */
  isSample: boolean;
}

/**
 * 엔진 결과에서 레일에 보일 것만 고른다(순서는 그대로).
 *  - excluded(표시 자격 없음), 이미 지난 위험(남은 거리 ≤ 0), 거리를 모르는 위험은 뺀다.
 *  - 같은 사건(dedupeKey)은 한 번만 — 엔진 순서에서 먼저 나온 것을 남긴다.
 *  - 강조는 엔진 결과만으로 정한다: confirmed + P0 + 최신(fresh) 일 때만 strong.
 */
export function buildHazardRail(prioritized: PrioritizedHazard[]): RailItem[] {
  const seen = new Set<string>();
  const items: RailItem[] = [];
  for (const h of prioritized) {
    if (!h.displayEligible || h.matchClass === 'excluded') continue;
    if (h.distanceAlongRouteM === null || !(h.distanceAlongRouteM > 0)) continue;
    if (seen.has(h.dedupeKey)) continue;
    seen.add(h.dedupeKey);
    const confirmed = h.matchClass === 'confirmed';
    items.push({
      key: h.dedupeKey,
      alert: h.alert,
      type: h.alert.type,
      priority: h.priority,
      matchClass: confirmed ? 'confirmed' : 'probable',
      emphasis: !confirmed ? 'neutral' : h.freshness === 'fresh' && h.priority === 'P0' ? 'strong' : 'normal',
      distanceM: h.distanceAlongRouteM,
      ttcSec: h.ttcSec,
      matchReason: h.matchReason,
      freshness: h.freshness,
      isSample: h.alert.isSample === true,
    });
  }
  return items;
}

/** 보이는 만큼 자르고, 남은 수를 +N 으로 돌려준다 */
export function splitRail(items: RailItem[], visibleCount: number): { visible: RailItem[]; overflow: number } {
  const n = Math.max(0, Math.min(visibleCount, items.length));
  return { visible: items.slice(0, n), overflow: items.length - n };
}

/**
 * 쓸 수 있는 세로 공간(px)에 몇 개까지 들어가는지. +N 표시가 필요하면 그 높이도 뺀다.
 * 좁은 화면에서는 3개보다 적게 보일 수 있고(남은 것은 +N), 하나도 못 들어가면 0 이다.
 */
export function fitVisible(total: number, availablePx: number, itemPx: number, overflowPx: number, max: number = RAIL_MAX_VISIBLE): number {
  let n = Math.min(max, total);
  while (n > 0 && n * itemPx + (total > n ? overflowPx : 0) > availablePx) n--;
  return n;
}

/**
 * 구역 전체에 적용되는 등록 현황(어린이보호구역)을 우선순위 엔진에 넣을 입력으로 만든다.
 * 경로 위 여부는 기존 matchHazardsToRoute 가 이미 판정했으므로 확정(confirmed)으로 본다. 등록 현황은 방향과 무관하다.
 */
export function registryZoneInput(alert: RoadAlert, distanceAlongRouteM: number): { alert: RoadAlert; match: IncidentMatch } {
  return {
    alert,
    match: { class: 'confirmed', reason: 'zoneOnRoute', distanceAlongRouteM, lateralM: null, directionBasis: 'both', freshness: 'fresh' },
  };
}

export type HazardSource = 'sample' | 'its' | 'registry';

export interface HazardDetail {
  /** 데이터 출처. 예시 → 학교 구역 등록 현황 → ITS 순으로 판단한다 */
  source: HazardSource;
  /** 확인되지 않은 이유(probable 일 때만). 값이 없으면 이유를 지어내지 않는다 */
  unverifiedReason: MatchReason | null;
  /** 발생 시각(ISO). 실제 돌발정보에 있을 때만. 없으면 null — 시각을 만들어 보여주지 않는다 */
  startedIso: string | null;
  /** 화면에 덧붙일 안내 종류 */
  notes: Array<'sample' | 'registry' | 'unverified' | 'stale'>;
}

/** 상세 패널에 보일 사실만 모은다. 정보가 없으면 null/빈 값으로 두고 화면이 "정보 없음"을 보여준다. */
export function describeHazard(item: RailItem): HazardDetail {
  const source: HazardSource = item.isSample ? 'sample' : item.type === 'school_zone' ? 'registry' : 'its';
  const notes: HazardDetail['notes'] = [];
  if (source === 'sample') notes.push('sample');
  if (source === 'registry') notes.push('registry');
  if (item.matchClass === 'probable') notes.push('unverified');
  if (item.freshness === 'stale') notes.push('stale');
  return {
    source,
    unverifiedReason: item.matchClass === 'probable' ? item.matchReason : null,
    startedIso: source === 'its' && item.alert.timeKind === 'started' && item.alert.updatedAt ? item.alert.updatedAt : null,
    notes,
  };
}
