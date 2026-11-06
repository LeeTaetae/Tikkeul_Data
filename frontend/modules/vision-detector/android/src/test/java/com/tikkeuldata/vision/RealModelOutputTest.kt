package com.tikkeuldata.vision

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 실제 best.pt 를 FP32 TFLite 로 변환해 얻은 **원시 출력 텐서**([1, 9, 3024], 입력 384x384)를 Kotlin 디코더에 넣어 본다.
 * 픽스처는 ml/verify_android_tflite.py 가 만들었고, 모델 파일이 아니라 출력 텐서와 기대 탐지만 들어 있다.
 *  - expected: 같은 텐서를 독립 구현(torchvision NMS)으로 디코딩한 결과 → Kotlin 결과가 거의 같아야 한다.
 *  - pytorch_predict: ultralytics predict 결과(다른 전처리라 완전히 같지는 않다) → 확신도가 높은 탐지는 느슨하게 겹쳐야 한다.
 * 이 테스트는 디코더·좌표 변환(회전 포함)만 검증한다. 실기기 카메라 프레임 → 모델 입력 전처리(Bitmap/Canvas)는 JVM 에서 돌릴 수 없다.
 */
class RealModelOutputTest {
  private val cases: JSONObject by lazy { JSONObject(resource("real/real-model-cases.json").toString(Charsets.UTF_8)) }
  private val labels: List<String> by lazy { ContractFixture.strings(cases.getJSONArray("labels")) }

  private fun resource(path: String): java.io.ByteArrayOutputStream {
    val s = RealModelOutputTest::class.java.classLoader!!.getResourceAsStream(path) ?: error("$path not found on the test classpath")
    return java.io.ByteArrayOutputStream().also { s.use { input -> input.copyTo(it) } }
  }

  private class Exp(val cls: String, val conf: Double, val x: Double, val y: Double, val w: Double, val h: Double)

  private fun expected(arr: JSONArray) = List(arr.length()) { i ->
    val o = arr.getJSONObject(i); Exp(o.getString("cls"), o.getDouble("conf"), o.getDouble("x"), o.getDouble("y"), o.getDouble("w"), o.getDouble("h"))
  }

  private fun iou(a: Exp, d: Detection): Double {
    val ax2 = a.x + a.w; val ay2 = a.y + a.h; val bx2 = d.x + d.width.toDouble(); val by2 = d.y + d.height.toDouble()
    val iw = minOf(ax2, bx2) - maxOf(a.x, d.x.toDouble()); val ih = minOf(ay2, by2) - maxOf(a.y, d.y.toDouble())
    if (iw <= 0 || ih <= 0) return 0.0
    val inter = iw * ih
    return inter / (a.w * a.h + d.width * d.height - inter)
  }

  private fun decode(case: JSONObject): DecodeResult {
    val bytes = resource("real/" + case.getString("tensor")).toByteArray()
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
    val out = FloatArray(buf.remaining()).also { buf.get(it) }
    val shape = ContractFixture.ints(case.getJSONArray("shape"))
    assertEquals(intArrayOf(1, 9, 3024).toList(), shape.toList())
    assertEquals(shape.fold(1) { a, b -> a * b }, out.size)
    val dst = cases.getInt("dst")
    val layout = YoloDecoder.layoutOf(shape, labels.size)
    assertTrue("실제 출력은 채널 우선 [1, 4+nc, N] 이다", layout.channelsFirst)
    val lb = Letterbox(case.getInt("srcW"), case.getInt("srcH"), case.getInt("rotation"), dst, dst)
    return YoloDecoder.decode(out, layout, labels, dst, dst, lb)
  }

  @Test fun labelOrderMatchesTheModel() {
    assertEquals(listOf("kickboard", "person", "car", "motorcycle", "animal"), labels)
    assertNull(LabelParser.validate(labels))
  }

  @Test fun kotlinDecoderMatchesTheIndependentDecodeOfRealOutput() {
    val arr = cases.getJSONArray("cases")
    assertTrue(arr.length() >= 2)
    for (n in 0 until arr.length()) {
      val c = arr.getJSONObject(n)
      val exp = expected(c.getJSONArray("expected"))
      val got = decode(c).detections
      assertEquals("${c.getString("name")}: 탐지 개수", exp.size, got.size)
      val used = HashSet<Int>()
      for (e in exp) {
        val j = got.indices.filter { it !in used && got[it].label == e.cls }.maxByOrNull { iou(e, got[it]) } ?: error("${c.getString("name")}: ${e.cls} 탐지가 없다")
        used.add(j)
        assertTrue("${c.getString("name")} ${e.cls}: IoU ${iou(e, got[j])}", iou(e, got[j]) >= 0.99)
        assertEquals("${c.getString("name")} ${e.cls} conf", e.conf, got[j].confidence.toDouble(), 2e-3)
      }
    }
  }

  @Test fun confidentDetectionsAgreeWithUltralyticsPredict() {
    val arr = cases.getJSONArray("cases")
    for (n in 0 until arr.length()) {
      val c = arr.getJSONObject(n)
      val got = decode(c).detections
      for (e in expected(c.getJSONArray("pytorch_predict")).filter { it.conf >= 0.40 }) {
        val best = got.filter { it.label == e.cls }.maxOfOrNull { iou(e, it) } ?: 0.0
        assertTrue("${c.getString("name")}: predict 의 ${e.cls}(${e.conf})가 Kotlin 결과와 겹치지 않는다(IoU $best)", best >= 0.6)
      }
    }
  }

  @Test fun allBoxesAreInsideTheUprightFrameAndConfidencesAreProbabilities() {
    val arr = cases.getJSONArray("cases")
    for (n in 0 until arr.length()) {
      for (d in decode(arr.getJSONObject(n)).detections) {
        assertTrue(d.confidence in VisionContract.CONFIDENCE_FLOOR..1f)
        assertTrue(d.x >= 0f && d.y >= 0f && d.x + d.width <= 1.0001f && d.y + d.height <= 1.0001f && d.width > 0f && d.height > 0f)
        assertTrue(d.label in VisionContract.MODEL_LABELS)
      }
    }
  }

  private fun assertNull(v: Any?) = org.junit.Assert.assertNull(v)
}
