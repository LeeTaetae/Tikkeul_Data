package com.tikkeuldata.vision

import kotlin.math.max
import kotlin.math.min

internal class UnsupportedModelOutputException(message: String) : Exception(message)

/** 출력 텐서 배치: channelsFirst 면 [1, 4+nc, anchors], 아니면 [1, anchors, 4+nc]. */
internal class YoloOutputLayout(val channelsFirst: Boolean, val attributes: Int, val anchors: Int)

internal class DecodeResult(val detections: List<Detection>, val rawCount: Int)

/**
 * ultralytics YOLOv8/11 계열 TFLite 출력 [cx, cy, w, h, class scores...](클래스 점수는 이미 sigmoid 적용, objectness 없음)을 해석한다.
 * 상자 좌표가 정규화(0~1)인지 입력 픽셀인지는 export 경로(onnx2tf 등)마다 달라서 값 범위로 판별한다.
 * NMS 가 모델에 내장된 end2end 출력([1, K, 6])은 지원하지 않고 명확한 오류로 알린다.
 */
internal object YoloDecoder {
  fun layoutOf(shape: IntArray, numClasses: Int): YoloOutputLayout {
    val attrs = 4 + numClasses
    if (shape.size != 3 || shape[0] != 1) throw UnsupportedModelOutputException("unsupported output shape ${shape.contentToString()} (expected [1, ${attrs}, N] or [1, N, ${attrs}])")
    val a = shape[1]
    val b = shape[2]
    return when {
      a == attrs && b != attrs -> YoloOutputLayout(true, attrs, b)
      b == attrs && a != attrs -> YoloOutputLayout(false, attrs, a)
      else -> throw UnsupportedModelOutputException("cannot tell the output layout from shape ${shape.contentToString()} with $numClasses classes (attributes=$attrs)")
    }
  }

  private class Candidate(val cx: Float, val cy: Float, val w: Float, val h: Float, val score: Float, val cls: Int)

  fun decode(
    out: FloatArray,
    layout: YoloOutputLayout,
    labels: List<String>,
    inputW: Int,
    inputH: Int,
    letterbox: Letterbox,
    confidenceFloor: Float = VisionContract.CONFIDENCE_FLOOR,
    iouThreshold: Float = VisionContract.NMS_IOU,
    maxDetections: Int = VisionContract.MAX_DETECTIONS,
    maxCandidates: Int = 300,
  ): DecodeResult {
    val numClasses = labels.size
    require(layout.attributes == 4 + numClasses) { "layout attributes ${layout.attributes} != 4 + ${numClasses}" }
    require(out.size >= layout.attributes * layout.anchors) { "output has ${out.size} values, need ${layout.attributes * layout.anchors}" }

    fun at(attr: Int, i: Int): Float = if (layout.channelsFirst) out[attr * layout.anchors + i] else out[i * layout.attributes + attr]

    val candidates = ArrayList<Candidate>()
    var maxCoord = 0f
    for (i in 0 until layout.anchors) {
      var best = -1
      var bestScore = -Float.MAX_VALUE
      for (c in 0 until numClasses) {
        val s = at(4 + c, i)
        if (s > bestScore) { bestScore = s; best = c }
      }
      if (best < 0 || !(bestScore >= confidenceFloor)) continue // NaN 도 여기서 걸러진다
      val cx = at(0, i); val cy = at(1, i); val w = at(2, i); val h = at(3, i)
      if (!(cx.isFinite() && cy.isFinite() && w.isFinite() && h.isFinite()) || w <= 0f || h <= 0f) continue
      maxCoord = max(maxCoord, max(max(cx, cy), max(w, h)))
      candidates.add(Candidate(cx, cy, w, h, min(bestScore, 1f), best))
    }
    val rawCount = candidates.size
    if (candidates.isEmpty()) return DecodeResult(emptyList(), 0)

    val normalized = maxCoord <= 1.5f
    val sx = if (normalized) inputW.toFloat() else 1f
    val sy = if (normalized) inputH.toFloat() else 1f

    candidates.sortByDescending { it.score }
    val pool = if (candidates.size > maxCandidates) candidates.subList(0, maxCandidates) else candidates

    // 점수 순으로 보면서, 레터박스 여백에만 걸쳐 업라이트 프레임에 보이지 않는 상자는 먼저 버린다(최대 개수 슬롯을 차지하지 않게).
    // 그다음 같은 클래스끼리 NMS 를 한다.
    val kept = ArrayList<Candidate>()
    val detections = ArrayList<Detection>()
    for (c in pool) {
      if (detections.size >= maxDetections) break
      val box = letterbox.toUprightBox((c.cx - c.w / 2f) * sx, (c.cy - c.h / 2f) * sy, (c.cx + c.w / 2f) * sx, (c.cy + c.h / 2f) * sy) ?: continue
      var suppressed = false
      for (k in kept) {
        if (k.cls == c.cls && iou(k, c, sx, sy) > iouThreshold) { suppressed = true; break }
      }
      if (suppressed) continue
      kept.add(c)
      detections.add(Detection(labels[c.cls], c.score, box.x, box.y, box.width, box.height))
    }
    return DecodeResult(detections, rawCount)
  }

  private fun iou(a: Candidate, b: Candidate, sx: Float, sy: Float): Float {
    val ax1 = (a.cx - a.w / 2f) * sx; val ay1 = (a.cy - a.h / 2f) * sy; val ax2 = (a.cx + a.w / 2f) * sx; val ay2 = (a.cy + a.h / 2f) * sy
    val bx1 = (b.cx - b.w / 2f) * sx; val by1 = (b.cy - b.h / 2f) * sy; val bx2 = (b.cx + b.w / 2f) * sx; val by2 = (b.cy + b.h / 2f) * sy
    val iw = min(ax2, bx2) - max(ax1, bx1)
    val ih = min(ay2, by2) - max(ay1, by1)
    if (iw <= 0f || ih <= 0f) return 0f
    val inter = iw * ih
    val union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return if (union <= 0f) 0f else inter / union
  }
}
