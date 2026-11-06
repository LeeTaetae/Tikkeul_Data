// 터널 접근 경고의 단계 거리와 표시 방식(배너·음성·진동) 정책. ai/tunnel_detection/road_hazard_poc 의 alert_policy·alert_presentation 을 TS 로 옮긴 것이다.
//
// 모든 수치(리드 시간, 속도 하한, 쿨다운)는 PoC 가 가정한 초안이며 실주행·TTS 길이 실측으로 검증하지 않았다.
// 날씨가 unknown/none 이면 어떤 경우에도 경고를 내지 않는다. unknown 은 "모름"이지 "안전"이 아니므로, 상태 표시는 앱 화면 몫이다.
import type { RoadWeatherRisk } from './weather';

export type TunnelStage = 'caution' | 'approach' | 'final';
export const STAGES: readonly TunnelStage[] = ['caution', 'approach', 'final'];
const RANK: Record<TunnelStage, number> = { caution: 1, approach: 2, final: 3 };

/** 기존 앱 위험 경고(hazardStage.ts)와 같은 고정 거리. */
export const FIXED_THRESHOLDS_M: readonly [number, number, number] = [500, 300, 100];

export interface AdaptivePolicy {
  /** 단계별로 입구 도달 전에 확보하고 싶은 시간(초). */
  leadS: readonly [number, number, number];
  /** 너무 멀리서 알리지 않도록 단계별 상한(m). */
  capM: readonly [number, number, number];
  /** 단계 사이 최소 간격(m): 단조성 유지. */
  minGapM: number;
}

export const ADAPTIVE_POLICY: AdaptivePolicy = { leadS: [25, 14, 7], capM: [1000, 600, 300], minGapM: 50 };

/**
 * 속도별 단계 거리. 고정 100m 는 100km/h 에서 3.6초라 음성이 입구에 늦으므로(PoC §5.1), 속도에 비례해 늘리되 상한을 둔다.
 * 느린 속도에서는 기존 고정 거리(500/300/100)보다 가까워지지 않는다.
 */
export function stageThresholds(speedMs: number, mode: 'fixed' | 'adaptive' = 'adaptive', p: AdaptivePolicy = ADAPTIVE_POLICY): [number, number, number] {
  if (mode === 'fixed') return [...FIXED_THRESHOLDS_M];
  const [c, a, f] = FIXED_THRESHOLDS_M.map((base, i) => Math.min(p.capM[i], Math.max(base, speedMs * p.leadS[i])));
  const approach = Math.min(a, c - p.minGapM);
  return [c, approach, Math.min(f, approach - p.minGapM)];
}

/** 남은 거리 → 단계. 첫 임계값보다 멀면 null, 이미 지났으면(≤0) null. */
export function stageFor(distanceM: number, thr: readonly [number, number, number]): TunnelStage | null {
  if (distanceM <= 0) return null;
  if (distanceM <= thr[2]) return 'final';
  if (distanceM <= thr[1]) return 'approach';
  if (distanceM <= thr[0]) return 'caution';
  return null;
}

// ───────────── 중복 방지: 시설(그룹)별 단계 이력 ─────────────

export type StepResult = TunnelStage | 'cleared' | null;

/** 키별 단계 이력. 본 단계와 그보다 먼 단계는 다시 알리지 않고, 입구를 지나면 그 키는 끝난다. */
export class StageTracker {
  private seen = new Set<string>();
  private passed = new Set<string>();
  private readonly passHysteresisM: number;

  // 테스트가 Node 의 TypeScript strip 모드로 돌기 때문에 생성자 매개변수 속성(private x)은 쓰지 않는다.
  constructor(passHysteresisM = 20) {
    this.passHysteresisM = passHysteresisM;
  }

  step(key: string, distanceM: number, thr: readonly [number, number, number]): StepResult {
    if (this.passed.has(key)) return null;
    if (distanceM <= -this.passHysteresisM) {
      this.passed.add(key);
      return STAGES.some((s) => this.seen.has(`${key}:${s}`)) ? 'cleared' : null;
    }
    const stage = stageFor(Math.max(distanceM, 0.1), thr); // 입구 직전 GPS 오차로 음수가 돼도 final 로 본다
    if (stage === null || this.seen.has(`${key}:${stage}`)) return null;
    for (const s of STAGES) if (RANK[s] <= RANK[stage]) this.seen.add(`${key}:${s}`); // 건너뛴 먼 단계도 본 것으로
    return stage;
  }

  /** 지금 범위 안에 있는 키의 이력만 남긴다. 멀어진 시설은 잊어서, 나중에 다시 지나면 다시 알린다. */
  retainOnly(activeKeys: ReadonlySet<string>): void {
    const keyOf = (entry: string) => entry.slice(0, entry.lastIndexOf(':'));
    for (const e of [...this.seen]) if (!activeKeys.has(keyOf(e))) this.seen.delete(e);
    for (const k of [...this.passed]) if (!activeKeys.has(k)) this.passed.delete(k);
  }

  reset(): void {
    this.seen.clear();
    this.passed.clear();
  }
}

// ───────────── 표시 방식 ─────────────

export interface PresentationPolicy {
  /** 이보다 느리면(정체·서행) 터널 안내를 내지 않는다. */
  minSpeedKmh: number;
  /** 음성이 시작될 때 입구까지 최소 이 시간은 남아야 한다(음성 3~5초 + 반응 2.5초 가정). */
  ttsMinLeadS: number;
  /** 너무 이른 음성은 잊힌다. 이보다 멀면 음성은 다음 단계로 미룬다. */
  ttsMaxLeadS: number;
  /** 비만 올 때(caution)는 이보다 짧은 터널을 알리지 않는다. */
  cautionMinTunnelLenM: number;
  /** 터널 음성 사이 최소 간격(ms). */
  ttsCooldownMs: number;
  /** 진동은 이 단계에서만. */
  hapticStage: TunnelStage;
}

export const PRESENTATION_POLICY: PresentationPolicy = {
  minSpeedKmh: 20,
  ttsMinLeadS: 8,
  ttsMaxLeadS: 30,
  cautionMinTunnelLenM: 200,
  ttsCooldownMs: 90_000,
  hapticStage: 'final',
};

export interface TunnelPresentation {
  banner: boolean;
  tts: boolean;
  haptic: boolean;
  /** 왜 이렇게 정했는지(테스트·진단용). */
  reason: string;
}

export interface PresentationState {
  ttsSpent: Set<string>;
  lastTtsMs: number | null;
}

export const createPresentationState = (): PresentationState => ({ ttsSpent: new Set(), lastTtsMs: null });

export interface PresentationInput {
  risk: RoadWeatherRisk;
  stage: TunnelStage;
  /** 입구까지 걸리는 시간(초). */
  tteS: number;
  speedKmh: number;
  lengthM: number;
  /** 시설(그룹) 키: 음성은 시설당 한 번. */
  key: string;
  /** 앞 터널을 막 지나 이어지는 두 번째 이후 터널이면 배너만. */
  followInCluster: boolean;
  nowMs: number;
}

export function decidePresentation(input: PresentationInput, state: PresentationState, policy: PresentationPolicy = PRESENTATION_POLICY): TunnelPresentation {
  const { risk, stage } = input;
  if (risk.level === 'unknown' || risk.level === 'none') return { banner: false, tts: false, haptic: false, reason: `level_${risk.level}_no_alert` };
  if (input.speedKmh < policy.minSpeedKmh) return { banner: false, tts: false, haptic: false, reason: 'too_slow' };
  if (risk.level === 'caution' && input.lengthM < policy.cautionMinTunnelLenM) return { banner: false, tts: false, haptic: false, reason: 'caution_short_tunnel' };

  const p: TunnelPresentation = { banner: true, tts: false, haptic: false, reason: `${risk.level}_banner` };
  if (input.followInCluster) {
    p.reason += '+follow_in_cluster_banner_only';
    return p;
  }
  if (risk.level === 'caution') {
    p.reason += '+caution_banner_only';
    return p;
  }
  // warning: 음성은 시설당 한 번, 입구까지 시간이 적당할 때만
  if (!state.ttsSpent.has(input.key)) {
    if (input.tteS < policy.ttsMinLeadS) p.reason += '+voice_too_late';
    else if (input.tteS > policy.ttsMaxLeadS) p.reason += '+voice_deferred_too_early';
    else if (state.lastTtsMs !== null && input.nowMs - state.lastTtsMs < policy.ttsCooldownMs) p.reason += '+voice_cooldown';
    else {
      p.tts = true;
      state.ttsSpent.add(input.key);
      state.lastTtsMs = input.nowMs;
      p.reason += '+voice';
    }
  }
  if (stage === policy.hapticStage) {
    p.haptic = true;
    p.reason += '+haptic';
  }
  return p;
}
