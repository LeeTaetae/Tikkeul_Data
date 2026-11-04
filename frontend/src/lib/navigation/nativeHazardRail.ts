// 네이티브(카카오 SDK) 주행 화면 왼쪽 위험 레일에 보낼 스냅샷을 만든다. React·네이티브에 의존하지 않는 순수 함수라 Node 로 테스트한다.
// 위험 판정·점수·P등급은 새로 계산하지 않는다. useRouteHazardWarning 이 돌려준 rail(RailItem[])을 "화면에 그릴 것만" 골라 담는다.
//
// 정책: 유형별 대표 하나 → P등급·confirmed·거리 순(orderRailItems) → 최대 3개 + 나머지는 +N.
//       2km 사전 알림 이내의 위험만 보이고, 지난 위험·경로 밖 위험은 rail 에 이미 없다(buildHazardRail).
//       어린이·노인·장애인 보호구역은 하나의 school_zone 아이콘이고, 구분(zoneType)은 상세 안내·TTS 용으로 남긴다.
import { RAIL_MAX_VISIBLE, pickTypeRepresentatives, splitRail, type RailEmphasis, type RailItem } from '../hazardRail';
import { ADVANCE_NOTICE_M, stageOf, type HazardStage } from '../hazardStage';
import type { Priority } from '../hazardPriority';
import type { AlertType } from '../../types/alert';

/** 레일에 보일 수 있는 위험 유형 5종. 기상·재난·터널 역광은 AlertType 에 없어 여기까지 오지 않지만, 방어적으로 한 번 더 거른다 */
const RAIL_TYPES: readonly AlertType[] = ['accident', 'construction', 'accident_prone', 'school_zone', 'congestion'];

export type NativeZoneType = 'child' | 'senior' | 'disabled';

export interface NativeRailItem {
  key: string;
  type: AlertType;
  /** school_zone 일 때만. 아이콘은 하나지만 상세 안내·TTS 에서 구분한다 */
  zoneType: NativeZoneType | null;
  priority: Priority;
  emphasis: RailEmphasis;
  /** 경로상 남은 거리(m), 10m 단위로 반올림 */
  distanceM: number;
  stage: HazardStage;
}

export interface NativeRailSnapshot {
  /** 스키마 버전. 네이티브가 모르는 버전이면 무시한다 */
  v: 1;
  items: NativeRailItem[];
  /** 보이지 않는 나머지 위험 유형 수(+N) */
  overflow: number;
}

export const EMPTY_NATIVE_RAIL: NativeRailSnapshot = { v: 1, items: [], overflow: 0 };

export interface SnapshotOptions {
  /** 한 번에 보일 최대 개수. 기본 3 */
  maxVisible?: number;
  /** 이 거리(m) 안의 위험만 보인다. 기본 2km 사전 알림 거리 */
  withinM?: number;
  now?: Date;
}

const zoneTypeOf = (item: RailItem): NativeZoneType | null => {
  if (item.type !== 'school_zone') return null;
  const z = item.alert.zoneType;
  return z === 'child' || z === 'senior' || z === 'disabled' ? z : null;
};

/** rail → 네이티브로 보낼 스냅샷. 같은 입력이면 항상 같은 결과다 */
export function buildNativeRailSnapshot(rail: RailItem[], options: SnapshotOptions = {}): NativeRailSnapshot {
  const { maxVisible = RAIL_MAX_VISIBLE, withinM = ADVANCE_NOTICE_M, now = new Date() } = options;
  const candidates = rail.filter((item) => RAIL_TYPES.includes(item.type) && item.distanceM > 0 && item.distanceM <= withinM);
  const { visible, overflow } = splitRail(pickTypeRepresentatives(candidates), maxVisible);
  return {
    v: 1,
    items: visible.map((item) => ({
      key: item.key,
      type: item.type,
      zoneType: zoneTypeOf(item),
      priority: item.priority,
      emphasis: item.emphasis,
      distanceM: Math.round(item.distanceM / 10) * 10,
      stage: stageOf(item.distanceM, item.type, now),
    })),
    overflow,
  };
}

/**
 * 네이티브로 다시 보내야 하는지. 위치 이벤트는 1초마다 오지만 레일은 거의 안 바뀌므로, 보이는 내용이 바뀔 때만 보낸다.
 * 거리는 50m 단위로 묶어 비교한다(표시 거리가 그보다 잘게 바뀌어도 매번 보내지 않는다). 단계(stage)·순서·강조가 바뀌면 즉시 보낸다.
 */
export function railChanged(prev: NativeRailSnapshot | null, next: NativeRailSnapshot): boolean {
  if (prev === null) return next.items.length > 0 || next.overflow > 0;
  const sig = (s: NativeRailSnapshot) =>
    JSON.stringify([s.overflow, s.items.map((i) => [i.key, i.type, i.zoneType, i.priority, i.emphasis, i.stage, Math.round(i.distanceM / 50)])]);
  return sig(prev) !== sig(next);
}

/** 네이티브 모듈로 넘길 문자열(JSON) */
export const serializeNativeRail = (snapshot: NativeRailSnapshot): string => JSON.stringify(snapshot);
