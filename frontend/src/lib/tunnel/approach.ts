// GPS 위치·진행 방향으로 "지금 어느 터널 입구에 접근 중인가"를 판정한다. 경로(Kakao 안내)가 없어도 동작한다.
//
// 한계(중요):
//  - 진행 방향은 최근 GPS 점들의 이동 방향에서 구한다(expo-location 에 의존하지 않아 iOS·Android·웹이 같다).
//  - 경로 없이는 "같은 방향으로 평행한 다른 길"과 터널 진입로를 구분하지 못한다. 입구에 가까워질수록(150m 안) 터널 축에서 옆으로
//    벗어난 거리를 검사해 줄이지만, 멀리서는 진행 방향과 입구 방위만 본다. 경로가 있으면 makeRouteFilter 로 한 번 더 거른다.
//  - 임계값(60°·45°·25m·150m)은 PoC 의 초안 값이며 실주행으로 검증하지 않았다.
import { projectOntoRoute, type Route } from '../routeHazards';
import { angleDiffDeg, axisPosition, bearingDeg, haversineM, type LatLng } from './geo';
import type { TunnelFacility, TunnelIndex } from './dataset';

export interface GpsFix extends LatLng {
  /** 수평 정확도(m). 모르면 null. */
  accuracyM: number | null;
  timestampMs: number;
}

export interface Motion {
  headingDeg: number;
  speedMs: number;
}

export interface ApproachConfig {
  /** 이 거리 안의 입구만 본다. */
  maxRangeM: number;
  /** 차량 진행 방향과 터널 축(입구→출구) 방향이 이 각도 안이어야 진입 방향으로 본다. */
  axisHeadingTolDeg: number;
  /** 멀리 있을 때, 차량 진행 방향과 입구 방위가 이 각도 안이어야 입구를 향해 가는 것으로 본다. */
  bearingToEntranceTolDeg: number;
  /** 이 거리 안에서는 터널 축에서 옆으로 벗어난 거리도 검사한다. */
  nearRangeM: number;
  lateralTolM: number;
  /** 멀리서: 차량 진행 방향선이 입구에서 옆으로 비껴가는 거리(m)의 허용치 = base + perM * 거리. 휘어진 진입로는 허용하고 평행 도로는 줄인다. */
  crossTrackBaseM: number;
  crossTrackPerM: number;
  /** 입구를 지나 이 거리(m)까지는 음수 거리로 계속 돌려준다(통과를 알아채는 용도, 이보다 더 들어가면 목록에서 뺀다). */
  passedWindowM: number;
}

export const APPROACH_CONFIG: ApproachConfig = {
  maxRangeM: 1100,
  axisHeadingTolDeg: 60,
  bearingToEntranceTolDeg: 45,
  nearRangeM: 150,
  lateralTolM: 25,
  crossTrackBaseM: 40,
  crossTrackPerM: 0.15,
  passedWindowM: 100,
};

export interface Approach {
  facility: TunnelFacility;
  entrance: 'a' | 'b';
  entrancePos: LatLng;
  exitPos: LatLng;
  /** 입구까지 남은 거리(m). 음수면 입구를 지나 터널 안쪽(통과). */
  distanceM: number;
  lateralM: number;
}

/** 경로(Kakao 안내 경로 등)가 있을 때, 입구가 경로 위에 있고 같은 방향일 때만 통과시키는 필터. */
export type EntranceFilter = (entrance: LatLng, exit: LatLng) => boolean;

export function makeRouteFilter(route: Route, maxLateralM = 30, maxHeadingDiffDeg = 60): EntranceFilter {
  return (entrance, exit) => {
    const proj = projectOntoRoute(route, { latitude: entrance.lat, longitude: entrance.lng });
    if (!proj || proj.lateralM > maxLateralM) return false;
    return angleDiffDeg(proj.bearingDeg, bearingDeg(entrance, exit)) <= maxHeadingDiffDeg;
  };
}

function evaluate(
  f: TunnelFacility,
  which: 'a' | 'b',
  fix: GpsFix,
  motion: Motion,
  cfg: ApproachConfig,
  filter: EntranceFilter | undefined,
): Approach | null {
  const entrance = which === 'a' ? f.a : f.b;
  const exit = which === 'a' ? f.b : f.a;
  // 1. 차량이 이 입구로 "들어가는" 방향인가(반대 방향이면 이 끝은 출구다).
  if (angleDiffDeg(motion.headingDeg, bearingDeg(entrance, exit)) > cfg.axisHeadingTolDeg) return null;

  const dist = haversineM(fix, entrance);
  if (dist > cfg.maxRangeM) return null;
  const { alongM, lateralM } = axisPosition(entrance, exit, fix);
  if (alongM > cfg.passedWindowM) return null; // 이미 터널 안쪽 깊이 들어갔다

  if (dist > cfg.nearRangeM) {
    // 멀리서는 입구를 향해 가고 있는지만 본다. 진입로가 휘어 있으면 축에서의 옆 거리는 의미가 없다.
    const off = angleDiffDeg(motion.headingDeg, bearingDeg(fix, entrance));
    if (off > cfg.bearingToEntranceTolDeg) return null;
    if (dist * Math.sin((off * Math.PI) / 180) > cfg.crossTrackBaseM + cfg.crossTrackPerM * dist) return null; // 진행선이 입구를 크게 비껴간다
  } else {
    const tol = cfg.lateralTolM + Math.min(fix.accuracyM ?? 0, 30) * 0.5;
    if (lateralM > tol) return null;
  }
  if (filter && !filter(entrance, exit)) return null;
  return {
    facility: f,
    entrance: which,
    entrancePos: entrance,
    exitPos: exit,
    distanceM: alongM > 0 ? -alongM : dist, // 입구를 지났으면 음수(통과)
    lateralM,
  };
}

/**
 * 접근 중인 입구 목록(가까운 순). 같은 그룹(쌍굴 등)은 하나만 남긴다.
 * 입구 좌표가 정확한 시설만 색인에 있으므로(dataset.ts) 좌표 없는 터널·대표 좌표 터널은 여기까지 오지 않는다.
 */
export function findApproaches(
  index: TunnelIndex,
  fix: GpsFix,
  motion: Motion,
  cfg: ApproachConfig = APPROACH_CONFIG,
  filter?: EntranceFilter,
): Approach[] {
  const best = new Map<string, Approach>();
  for (const f of index.near(fix, cfg.maxRangeM)) {
    for (const which of ['a', 'b'] as const) {
      const ap = evaluate(f, which, fix, motion, cfg, filter);
      if (!ap) continue;
      const cur = best.get(f.groupId);
      if (!cur || ap.lateralM < cur.lateralM) best.set(f.groupId, ap);
    }
  }
  return [...best.values()].sort((x, y) => x.distanceM - y.distanceM);
}

// ───────────── 진행 방향·속도 추정 ─────────────

const MIN_STEP_M = 12; // 이보다 덜 움직였으면 방향이 GPS 잡음일 수 있다
const MAX_FIX_ACCURACY_M = 50;
const HISTORY_MS = 15_000;

/** 최근 GPS 점들로 진행 방향과 속도를 구한다. 점이 충분히 움직이지 않았으면 null. */
export class MotionEstimator {
  private fixes: GpsFix[] = [];

  push(fix: GpsFix): Motion | null {
    if (fix.accuracyM !== null && fix.accuracyM > MAX_FIX_ACCURACY_M) return null; // 부정확한 점은 쓰지 않는다
    const last = this.fixes[this.fixes.length - 1];
    if (last && (fix.timestampMs <= last.timestampMs || fix.timestampMs - last.timestampMs > HISTORY_MS)) {
      this.fixes = []; // 시간이 거꾸로 가거나 오래 끊겼다: 이어 쓰지 않는다
    }
    this.fixes.push(fix);
    this.fixes = this.fixes.filter((f) => fix.timestampMs - f.timestampMs <= HISTORY_MS);
    // 최신 점에서 충분히 떨어진 가장 가까운 과거 점
    for (let i = this.fixes.length - 2; i >= 0; i--) {
      const old = this.fixes[i];
      const dist = haversineM(old, fix);
      const dt = (fix.timestampMs - old.timestampMs) / 1000;
      if (dist >= MIN_STEP_M && dt > 0) return { headingDeg: bearingDeg(old, fix), speedMs: dist / dt };
    }
    return null;
  }

  reset(): void {
    this.fixes = [];
  }
}
