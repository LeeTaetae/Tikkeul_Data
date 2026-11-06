package com.tikkeuldata.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class YoloDecoderTest {
  private val labels = ContractFixture.labels
  private val g = ContractFixture.root.getJSONObject("geometry")
  private fun letterbox() = Letterbox(g.getInt("srcW"), g.getInt("srcH"), g.getInt("rotation"), g.getInt("dstW"), g.getInt("dstH"))

  private fun runCase(index: Int): Pair<DecodeResult, org.json.JSONObject> {
    val c = ContractFixture.root.getJSONArray("decodeCases").getJSONObject(index)
    val layout = YoloDecoder.layoutOf(ContractFixture.ints(c.getJSONArray("shape")), labels.size)
    val result = YoloDecoder.decode(ContractFixture.floats(c.getJSONArray("output")), layout, labels, 384, 384, letterbox())
    return Pair(result, c)
  }

  private fun assertMatchesFixture(index: Int) {
    val (result, c) = runCase(index)
    assertEquals(c.getInt("expectedRawCount"), result.rawCount)
    val expected = c.getJSONArray("expectedDetections")
    assertEquals(expected.length(), result.detections.size)
    for (i in 0 until expected.length()) {
      val e = expected.getJSONObject(i)
      val d = result.detections[i]
      val box = e.getJSONObject("box")
      assertEquals(e.getString("class"), d.label)
      assertEquals(e.getDouble("confidence"), d.confidence.toDouble(), 1e-4)
      assertEquals(box.getDouble("x"), d.x.toDouble(), 1e-3)
      assertEquals(box.getDouble("y"), d.y.toDouble(), 1e-3)
      assertEquals(box.getDouble("width"), d.width.toDouble(), 1e-3)
      assertEquals(box.getDouble("height"), d.height.toDouble(), 1e-3)
    }
  }

  @Test fun channelsFirst_normalisedBoxes() = assertMatchesFixture(0)
  @Test fun anchorsFirst_normalisedBoxes() = assertMatchesFixture(1)
  @Test fun channelsFirst_pixelBoxes_areDetectedByValueRange() = assertMatchesFixture(2)

  @Test fun layoutDetection() {
    assertTrue(YoloDecoder.layoutOf(intArrayOf(1, 9, 3024), 5).channelsFirst)
    assertEquals(3024, YoloDecoder.layoutOf(intArrayOf(1, 9, 3024), 5).anchors)
    assertTrue(!YoloDecoder.layoutOf(intArrayOf(1, 3024, 9), 5).channelsFirst)
  }

  @Test fun unsupportedShapesFailLoudly() {
    for (shape in listOf(intArrayOf(1, 300, 6), intArrayOf(1, 9, 9), intArrayOf(2, 9, 100), intArrayOf(9, 100))) {
      try {
        YoloDecoder.layoutOf(shape, 5)
        throw AssertionError("expected UnsupportedModelOutputException for ${shape.contentToString()}")
      } catch (expected: UnsupportedModelOutputException) {
        assertTrue(expected.message!!.isNotEmpty())
      }
    }
  }

  @Test fun belowConfidenceFloorIsDroppedAndAtFloorIsKept() {
    // 한 앵커: person 0.25 → 하한과 같으면 남는다(JS 보호구역 person 임계값 0.25 가 도달해야 한다), 0.2499 는 버려진다.
    fun detect(score: Float): DecodeResult {
      val out = FloatArray(9) // [1, 9, 1] channels-first, 앵커 1개
      out[0] = 0.5f; out[1] = 0.5f; out[2] = 0.3f; out[3] = 0.3f
      out[4 + 1] = score
      return YoloDecoder.decode(out, YoloOutputLayout(true, 9, 1), labels, 384, 384, Letterbox(480, 640, 0, 384, 384))
    }
    assertEquals(1, detect(VisionContract.CONFIDENCE_FLOOR).detections.size)
    assertEquals(0, detect(0.2499f).detections.size)
    assertTrue(VisionContract.CONFIDENCE_FLOOR <= 0.25f)
  }

  @Test fun nanAndInfiniteValuesNeverProduceDetections() {
    val out = FloatArray(9) { Float.NaN }
    assertEquals(0, YoloDecoder.decode(out, YoloOutputLayout(true, 9, 1), labels, 384, 384, Letterbox(480, 640, 0, 384, 384)).detections.size)
    val inf = FloatArray(9); inf[0] = Float.POSITIVE_INFINITY; inf[1] = 0.5f; inf[2] = 0.2f; inf[3] = 0.2f; inf[5] = 0.9f
    assertEquals(0, YoloDecoder.decode(inf, YoloOutputLayout(true, 9, 1), labels, 384, 384, Letterbox(480, 640, 0, 384, 384)).detections.size)
  }

  @Test fun nmsIsPerClass_overlappingDifferentClassesBothSurvive() {
    // 같은 자리 상자 두 개, 서로 다른 클래스(person 0.9, car 0.8) → 클래스별 NMS 라 둘 다 남는다. 같은 클래스 중복은 하나만.
    val n = 3
    val out = FloatArray(9 * n)
    fun put(i: Int, cls: Int, score: Float) {
      out[0 * n + i] = 0.5f; out[1 * n + i] = 0.5f; out[2 * n + i] = 0.3f; out[3 * n + i] = 0.3f
      out[(4 + cls) * n + i] = score
    }
    put(0, 1, 0.9f); put(1, 2, 0.8f); put(2, 1, 0.7f)
    val r = YoloDecoder.decode(out, YoloOutputLayout(true, 9, n), labels, 384, 384, Letterbox(480, 640, 0, 384, 384))
    assertEquals(listOf("person", "car"), r.detections.map { it.label })
  }

  @Test fun maxDetectionsIsRespected() {
    val n = 20
    val out = FloatArray(9 * n)
    for (i in 0 until n) {
      out[0 * n + i] = 0.05f + i * 0.045f; out[1 * n + i] = 0.5f; out[2 * n + i] = 0.02f; out[3 * n + i] = 0.02f; out[(4 + 1) * n + i] = 0.9f - i * 0.01f
    }
    val r = YoloDecoder.decode(out, YoloOutputLayout(true, 9, n), labels, 384, 384, Letterbox(480, 640, 0, 384, 384), maxDetections = 5)
    assertEquals(5, r.detections.size)
    assertEquals(n, r.rawCount)
  }

  @Test fun boxesAreAlwaysInsideTheUnitSquare() {
    val (result, _) = runCase(0)
    for (d in result.detections) {
      assertTrue(d.x >= 0f && d.y >= 0f && d.x + d.width <= 1.0001f && d.y + d.height <= 1.0001f)
    }
  }
}
