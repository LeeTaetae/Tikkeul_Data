// GPS 한 점이 들어올 때마다 터널 접근 경고 이벤트를 만든다. 순수 상태 기계라 훅·화면 없이 테스트할 수 있다.
//
// 이 모듈은 화면·TTS·진동을 직접 부르지 않는다(기존 경고 코드를 건드리지 않기 위해). 호출하는 쪽이 이벤트의
// presentation 을 보고 배너/음성/진동을 요청한다. 연동 방법은 docs/TUNNEL_APPROACH.md.
//
// 알림이 없는 경우도 구분한다: 터널 접근 "감지"는 날씨와 무관하게 이벤트로 알려주고(stage), 경고를 낼지는 presentation 이 정한다.
import { APPROACH_CONFIG, findApproaches, MotionEstimator, type ApproachConfig, type EntranceFilter, type GpsFix } from './approach';
import { createPresentationState, decidePresentation, StageTracker, stageThresholds, type TunnelPresentation, type TunnelStage } from './alert';
import { haversineM, type LatLng } from './geo';
import type { TunnelFacility, TunnelIndex } from './dataset';
import { assessRoadWeather, type RoadWeatherObservation, type RoadWeatherRisk } from './weather';

export interface TunnelStageEvent {
  kind: 'stage';
  groupId: string;
  facility: TunnelFacility;
  entrance: LatLng;
  stage: TunnelStage;
  distanceM: number;
  tteS: number;
  speedKmh: number;
  risk: RoadWeatherRisk;
  followInCluster: boolean;
  presentation: TunnelPresentation;
}

/** 입구를 지났다 - 화면의 터널 배너를 내리는 데 쓴다. */
export interface TunnelClearedEvent {
  kind: 'cleared';
  groupId: string;
  facility: TunnelFacility;
}

export type TunnelEvent = TunnelStageEvent | TunnelClearedEvent;

export interface WatcherOptions {
  thresholdMode?: 'fixed' | 'adaptive';
  approach?: ApproachConfig;
  /** 경로가 있을 때만 넘긴다(approach.makeRouteFilter). */
  entranceFilter?: EntranceFilter;
  /** 앞 터널 출구에서 다음 터널 입구까지 이 거리 안이면 이어지는 터널로 본다. */
  clusterGapM?: number;
  /** 이어지는 터널로 보는 최대 경과 시간. */
  clusterMaxAgeMs?: number;
  /** 이 거리 밖으로 멀어진 시설의 경고 이력은 잊는다. */
  forgetRangeM?: number;
}

const DEFAULTS = { clusterGapM: 1000, clusterMaxAgeMs: 300_000, forgetRangeM: 3000 };

export interface TunnelWatcher {
  update(fix: GpsFix, weather: RoadWeatherObservation | null, nowMs: number): TunnelEvent[];
  reset(): void;
}

export function createTunnelWatcher(index: TunnelIndex, options: WatcherOptions = {}): TunnelWatcher {
  const cfg = options.approach ?? APPROACH_CONFIG;
  const mode = options.thresholdMode ?? 'adaptive';
  const clusterGapM = options.clusterGapM ?? DEFAULTS.clusterGapM;
  const clusterMaxAgeMs = options.clusterMaxAgeMs ?? DEFAULTS.clusterMaxAgeMs;
  const forgetRangeM = options.forgetRangeM ?? DEFAULTS.forgetRangeM;

  const motion = new MotionEstimator();
  const tracker = new StageTracker();
  let presentation = createPresentationState();
  let lastAlerted: { groupId: string; exit: LatLng; atMs: number } | null = null;
  // 이어지는 터널인지는 그 시설의 "첫 단계"에서 한 번 정하고 이후 단계에도 같은 값을 쓴다(그 사이에 lastAlerted 가 자기 자신으로 바뀐다).
  const followByGroup = new Map<string, boolean>();

  return {
    update(fix, weather, nowMs) {
      const m = motion.push(fix);
      if (!m) return []; // 진행 방향을 아직 모른다

      const active = new Set(index.near(fix, forgetRangeM).map((f) => f.groupId));
      tracker.retainOnly(active);
      for (const k of [...followByGroup.keys()]) if (!active.has(k)) followByGroup.delete(k);

      const risk = assessRoadWeather(weather, nowMs);
      const thr = stageThresholds(m.speedMs, mode);
      const events: TunnelEvent[] = [];
      for (const ap of findApproaches(index, fix, m, cfg, options.entranceFilter)) {
        const key = ap.facility.groupId;
        const step = tracker.step(key, ap.distanceM, thr);
        if (step === null) continue;
        if (step === 'cleared') {
          events.push({ kind: 'cleared', groupId: key, facility: ap.facility });
          continue;
        }
        // 이어지는 터널: 앞서 알린 "다른" 시설의 출구에서 가깝고 얼마 지나지 않았을 때
        let followInCluster = followByGroup.get(key);
        if (followInCluster === undefined) {
          followInCluster =
            lastAlerted !== null &&
            lastAlerted.groupId !== key &&
            nowMs - lastAlerted.atMs <= clusterMaxAgeMs &&
            haversineM(lastAlerted.exit, ap.entrancePos) <= clusterGapM;
          followByGroup.set(key, followInCluster);
        }
        const speedKmh = m.speedMs * 3.6;
        const tteS = m.speedMs > 0 ? Math.max(ap.distanceM, 0) / m.speedMs : Infinity;
        const decided = decidePresentation(
          { risk, stage: step, tteS, speedKmh, lengthM: ap.facility.lengthM, key, followInCluster, nowMs },
          presentation,
        );
        lastAlerted = { groupId: key, exit: ap.exitPos, atMs: nowMs }; // 가장 최근에 알린 터널의 출구 기준으로 갱신한다
        events.push({
          kind: 'stage',
          groupId: key,
          facility: ap.facility,
          entrance: ap.entrancePos,
          stage: step,
          distanceM: ap.distanceM,
          tteS,
          speedKmh,
          risk,
          followInCluster,
          presentation: decided,
        });
      }
      return events;
    },
    reset() {
      motion.reset();
      tracker.reset();
      presentation = createPresentationState();
      lastAlerted = null;
      followByGroup.clear();
    },
  };
}
