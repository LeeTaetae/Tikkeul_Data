package com.tikkeuldata.vision

import kotlin.math.max
import kotlin.math.min

/**
 * 추론 빈도 조절. 기준은 JS 가 넘기는 targetFps(기본 5, 보호구역 10; iOS 와 같다)이고, 기기가 못 따라가면 스스로 낮춘다.
 *  - 추론 시간 이동평균 x 1.25 가 간격보다 길면 빈도를 낮춘다(CPU 점유율 80% 이하 유지, 최소 minFps).
 *  - 발열 단계(PowerManager thermal status)가 SEVERE 면 상한 2fps, CRITICAL 이상이면 일시 중지(ADR 0002 §4).
 * 순수 로직이라 JVM 에서 테스트한다. 스레드 안전: 분석 스레드(shouldProcess/recordInference)와 메인 스레드(setter)를 위해 @Volatile.
 */
internal class FpsGovernor(initialTargetFps: Double = VisionContract.DEFAULT_TARGET_FPS, private val minFps: Double = 1.0) {
  @Volatile var targetFps: Double = sanitize(initialTargetFps)
    set(value) { field = sanitize(value) }

  /** null = 제한 없음, 0 = 일시 중지. */
  @Volatile var thermalCapFps: Double? = null

  @Volatile private var emaMs = 0.0
  @Volatile private var lastStartMs = Long.MIN_VALUE

  fun recordInference(ms: Double) {
    if (!ms.isFinite() || ms < 0) return
    emaMs = if (emaMs == 0.0) ms else emaMs * 0.8 + ms * 0.2
  }

  fun effectiveFps(): Double {
    val cap = thermalCapFps
    if (cap != null && cap <= 0.0) return 0.0
    var fps = targetFps
    if (cap != null) fps = min(fps, cap)
    val ema = emaMs
    if (ema > 0.0) fps = min(fps, max(minFps, 1000.0 / (ema * 1.25)))
    return fps
  }

  /** 이 프레임을 추론에 쓸지. true 를 돌려주면 시작 시각을 갱신한다. */
  fun shouldProcess(nowMs: Long): Boolean {
    val fps = effectiveFps()
    if (fps <= 0.0) return false
    val interval = 1000.0 / fps
    if (lastStartMs != Long.MIN_VALUE && nowMs - lastStartMs < interval) return false
    lastStartMs = nowMs
    return true
  }

  fun reset() {
    emaMs = 0.0
    lastStartMs = Long.MIN_VALUE
  }

  companion object {
    private fun sanitize(v: Double) = if (v.isFinite() && v > 0.0) min(v, 30.0) else VisionContract.DEFAULT_TARGET_FPS

    /** PowerManager.THERMAL_STATUS_* → 빈도 상한. 0..2 제한 없음, 3(SEVERE) 2fps, 4 이상(CRITICAL/EMERGENCY/SHUTDOWN) 중지. */
    fun thermalCapFor(status: Int): Double? = when {
      status >= 4 -> 0.0
      status == 3 -> 2.0
      else -> null
    }
  }
}
