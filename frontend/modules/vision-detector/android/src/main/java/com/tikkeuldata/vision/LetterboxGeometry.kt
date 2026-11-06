package com.tikkeuldata.vision

import kotlin.math.min

/** 정규화된 업라이트 상자(좌상단 원점, 0~1). */
internal data class NormBox(val x: Float, val y: Float, val width: Float, val height: Float)

/**
 * 카메라 프레임(srcW x srcH, 시계방향 rotationDegrees 만큼 돌리면 업라이트)을 모델 입력(dstW x dstH)에 비율 유지(letterbox)로 맞추는 기하.
 * iOS 는 Vision 의 `.right` 방향 + `.scaleFit` 으로 같은 일을 한다(VisionDetectorModule.swift). 여기서는 직접 계산하고 역변환으로
 * 모델 좌표를 업라이트 정규화 좌표로 되돌린다. 순수 계산이라 JVM 에서 테스트한다.
 */
internal class Letterbox(val srcW: Int, val srcH: Int, rotationDegrees: Int, val dstW: Int, val dstH: Int) {
  init {
    require(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0) { "sizes must be positive: src=${srcW}x$srcH dst=${dstW}x$dstH" }
    require(rotationDegrees % 90 == 0) { "rotation must be a multiple of 90: $rotationDegrees" }
  }

  val rotation: Int = ((rotationDegrees % 360) + 360) % 360
  val uprightW: Int = if (rotation % 180 == 0) srcW else srcH
  val uprightH: Int = if (rotation % 180 == 0) srcH else srcW
  val scale: Float = min(dstW.toFloat() / uprightW, dstH.toFloat() / uprightH)
  val contentW: Float = uprightW * scale
  val contentH: Float = uprightH * scale
  val padX: Float = (dstW - contentW) / 2f
  val padY: Float = (dstH - contentH) / 2f

  /** android.graphics.Matrix.setValues 순서: [scaleX, skewX, transX, skewY, scaleY, transY, 0, 0, 1]. 소스 픽셀 → 모델 입력 픽셀. */
  fun matrixValues(): FloatArray {
    val s = scale
    return when (rotation) {
      0 -> floatArrayOf(s, 0f, padX, 0f, s, padY, 0f, 0f, 1f)
      90 -> floatArrayOf(0f, -s, s * srcH + padX, s, 0f, padY, 0f, 0f, 1f)
      180 -> floatArrayOf(-s, 0f, s * srcW + padX, 0f, -s, s * srcH + padY, 0f, 0f, 1f)
      else -> floatArrayOf(0f, s, padX, -s, 0f, s * srcW + padY, 0f, 0f, 1f)
    }
  }

  /** 테스트·진단용: 소스 픽셀 한 점이 모델 입력의 어디로 가는가. */
  fun mapSourcePoint(x: Float, y: Float): Pair<Float, Float> {
    val m = matrixValues()
    return Pair(m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5])
  }

  /** 모델 입력 픽셀의 상자(x1,y1,x2,y2) → 업라이트 정규화 상자. 내용 영역 밖은 잘라내고, 면적이 없으면 null. */
  fun toUprightBox(x1: Float, y1: Float, x2: Float, y2: Float): NormBox? {
    val nx1 = ((x1 - padX) / contentW).coerceIn(0f, 1f)
    val ny1 = ((y1 - padY) / contentH).coerceIn(0f, 1f)
    val nx2 = ((x2 - padX) / contentW).coerceIn(0f, 1f)
    val ny2 = ((y2 - padY) / contentH).coerceIn(0f, 1f)
    val w = nx2 - nx1
    val h = ny2 - ny1
    if (!(w > 0f) || !(h > 0f)) return null
    return NormBox(nx1, ny1, w, h)
  }
}
