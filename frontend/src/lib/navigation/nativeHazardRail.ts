// 네이티브(카카오 SDK) 주행 화면 왼쪽 위험 레일에 보낼 스냅샷을 만든다. React·네이티브에 의존하지 않는 순수 함수라 Node 로 테스트한다.
// 위험 판정·점수·P등급은 새로 계산하지 않는다. useRouteHazardWarning 이 돌려준 rail(RailItem[])을 "화면에 그릴 것만" 골라 담는다.
//
// 정책: 유형별 대표 하나(확정된 위험 중 현재 위치에서 가장 가까운 것, P등급 무관) → 유형 사이는 P등급·거리 순(orderRailItems) → 최대 3개 + 나머지는 +N.
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
  /** 아이콘을 눌렀을 때 보여줄 상세 문장(현재 앱 언어). 없으면 네이티브가 이름·거리만 보여준다 */
  detail?: string;
}

/** 단계별(2km 사전 안내·500·300·100m) 위험 안내. useHazardWarning 이 단계마다 한 번만 만들고 통과하면 거둔다 */
export interface NativeRailWarning {
  key: string;
  stage: HazardStage;
  text: string;
}

export interface NativeRailSnapshot {
  /** 스키마 버전. 네이티브가 모르는 버전이면 무시한다 */
  v: 1;
  items: NativeRailItem[];
  /** 보이지 않는 나머지 위험 유형 수(+N) */
  overflow: number;
  /** 지금 알려야 할 단계 안내 하나. 없으면 생략 */
  warning?: NativeRailWarning;
}

export const EMPTY_NATIVE_RAIL: NativeRailSnapshot = { v: 1, items: [], overflow: 0 };

export interface SnapshotOptions {
  /** 한 번에 보일 최대 개수. 기본 3 */
  maxVisible?: number;
  /** 이 거리(m) 안의 위험만 보인다. 기본 2km 사전 알림 거리 */
  withinM?: number;
  now?: Date;
  /** 상세 문장 생성기(언어·i18n 은 호출하는 쪽이 정한다) */
  describe?: (item: RailItem) => string;
  warning?: NativeRailWarning | null;
}

const zoneTypeOf = (item: RailItem): NativeZoneType | null => {
  if (item.type !== 'school_zone') return null;
  const z = item.alert.zoneType;
  return z === 'child' || z === 'senior' || z === 'disabled' ? z : null;
};

/** rail → 네이티브로 보낼 스냅샷. 같은 입력이면 항상 같은 결과다 */
export function buildNativeRailSnapshot(rail: RailItem[], options: SnapshotOptions = {}): NativeRailSnapshot {
  const { maxVisible = RAIL_MAX_VISIBLE, withinM = ADVANCE_NOTICE_M, now = new Date(), describe, warning } = options;
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
      ...(describe ? { detail: describe(item) } : {}),
    })),
    overflow,
    ...(warning ? { warning } : {}),
  };
}

/**
 * 네이티브로 다시 보내야 하는지. 위치 이벤트는 1초마다 오지만 레일은 거의 안 바뀌므로, 보이는 내용이 바뀔 때만 보낸다.
 * 거리는 50m 단위로 묶어 비교한다(표시 거리가 그보다 잘게 바뀌어도 매번 보내지 않는다). 단계(stage)·순서·강조가 바뀌면 즉시 보낸다.
 */
export function railChanged(prev: NativeRailSnapshot | null, next: NativeRailSnapshot): boolean {
  if (prev === null) return next.items.length > 0 || next.overflow > 0 || !!next.warning;
  const sig = (s: NativeRailSnapshot) =>
    JSON.stringify([s.overflow, s.warning ? [s.warning.key, s.warning.stage, s.warning.text] : null, s.items.map((i) => [i.key, i.type, i.zoneType, i.priority, i.emphasis, i.stage, i.detail ?? '', Math.round(i.distanceM / 50)])]);
  return sig(prev) !== sig(next);
}

/** 네이티브 모듈로 넘길 문자열(JSON) */
export const serializeNativeRail = (snapshot: NativeRailSnapshot): string => JSON.stringify(snapshot);

/**
 * 단계 위험 배너가 화면에 떠 있는 시간(ms). 네이티브 오버레이의 WARNING_MS(HazardRailOverlay.kt, HazardRailOverlayView.m)와 같게 둔다.
 * 날씨·터널 안내는 이 시간 동안만 위험 배너에 자리를 양보한다. useHazardWarning 의 warning 은 위험을 지날 때까지 남아 있으므로
 * 그 존재 여부로 막으면 터널 안내가 위험 접근 내내(최대 2km) 사라진다.
 */
export const HAZARD_BANNER_MS = 8_000;

/** 위험 배너가 뜬 시각(shownAtMs)으로부터 아직 배너가 떠 있는 동안이면 true. 타이머가 멈춰 있어도 위치 이벤트 시각으로 판단한다 */
export const hazardBannerActive = (shownAtMs: number | null, nowMs: number): boolean =>
  shownAtMs !== null && nowMs >= shownAtMs && nowMs - shownAtMs < HAZARD_BANNER_MS;
