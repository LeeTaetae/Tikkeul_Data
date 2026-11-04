// 기기 발열 단계별 비전 추론 성능 정책. 지연시간 악화보다 OS 발열 신호를 먼저 본다. docs/ADR/0002 참고.
export type ThermalTier = 'nominal' | 'fair' | 'serious' | 'critical';

export interface VisionRuntimePolicy {
  overlayAllowed: boolean;
  targetFps: number;
  inferencePaused: boolean;
}

export function policyForThermalTier(tier: ThermalTier, baseFps: number): VisionRuntimePolicy {
  switch (tier) {
    case 'nominal':
    case 'fair':
      return { overlayAllowed: true, targetFps: baseFps, inferencePaused: false };
    case 'serious':
      return { overlayAllowed: false, targetFps: Math.min(baseFps, 2), inferencePaused: false };
    case 'critical':
      return { overlayAllowed: false, targetFps: 0, inferencePaused: true };
  }
}
