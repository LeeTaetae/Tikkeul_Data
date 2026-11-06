package com.tikkeuldata.vision

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DetectionEventContractTest {
  private val contract = ContractFixture.root.getJSONObject("contract")

  /** iOS 와 같은 키로 만들어지는가. 키 목록의 출처는 vision-contract.json 이고, JS 테스트가 이 목록을 Swift 소스와 대조한다. */
  @Test fun payloadHasExactlyTheIosEventKeys() {
    val detections = listOf(Detection("person", 0.9f, 0.4f, 0.35f, 0.2f, 0.3f))
    val payload = DetectionEvent.payload(detections, 3)
    assertEquals(ContractFixture.strings(contract.getJSONArray("eventKeys")).toSet(), payload.keys)
    @Suppress("UNCHECKED_CAST")
    val first = (payload["detections"] as List<Map<String, Any>>)[0]
    assertEquals(ContractFixture.strings(contract.getJSONArray("detectionKeys")).toSet(), first.keys)
    @Suppress("UNCHECKED_CAST")
    assertEquals(ContractFixture.strings(contract.getJSONArray("boxKeys")).toSet(), (first["box"] as Map<String, Any>).keys)
    assertEquals(3, payload["debugRawCount"]); assertEquals(1, payload["debugRecognizedCount"])
  }

  /** 숫자 타입: iOS 는 confidence·상자를 Double, debug 개수를 Int 로 보낸다. */
  @Test fun valueTypesMatchIos() {
    val payload = DetectionEvent.payload(listOf(Detection("car", 0.5f, 0.1f, 0.2f, 0.3f, 0.4f)), 1)
    @Suppress("UNCHECKED_CAST")
    val d = (payload["detections"] as List<Map<String, Any>>)[0]
    assertTrue(d["confidence"] is Double)
    assertTrue(d["class"] is String)
    @Suppress("UNCHECKED_CAST")
    assertTrue((d["box"] as Map<String, Any>).values.all { it is Double })
    assertTrue(payload["debugRawCount"] is Int && payload["debugRecognizedCount"] is Int && payload["debugRawType"] is String)
  }

  @Test fun fixtureEventEqualsTheBuilderOutput() {
    val expected = ContractFixture.root.getJSONObject("event")
    val detections = expected.getJSONArray("detections").let { arr ->
      List(arr.length()) { i ->
        val o = arr.getJSONObject(i); val b = o.getJSONObject("box")
        Detection(o.getString("class"), o.getDouble("confidence").toFloat(), b.getDouble("x").toFloat(), b.getDouble("y").toFloat(), b.getDouble("width").toFloat(), b.getDouble("height").toFloat())
      }
    }
    val built = JSONObject(DetectionEvent.payload(detections, expected.getInt("debugRawCount")))
    assertEquals(expected.getString("debugRawType"), built.getString("debugRawType"))
    assertEquals(expected.getInt("debugRecognizedCount"), built.getInt("debugRecognizedCount"))
    val a = expected.getJSONArray("detections"); val b = built.getJSONArray("detections")
    assertEquals(a.length(), b.length())
    for (i in 0 until a.length()) {
      assertEquals(a.getJSONObject(i).getString("class"), b.getJSONObject(i).getString("class"))
      assertEquals(a.getJSONObject(i).getDouble("confidence"), b.getJSONObject(i).getDouble("confidence"), 1e-4)
    }
  }

  @Test fun errorPayloadIsJustMessage() {
    assertEquals(mapOf("message" to "camera permission denied"), DetectionEvent.errorPayload("camera permission denied"))
  }

  @Test fun contractLabelsAreTheFiveClassesAndDefaultsMatchTheJsSide() {
    assertEquals(VisionContract.MODEL_LABELS, ContractFixture.labels.toSet())
    assertEquals(contract.getDouble("defaultTargetFps"), VisionContract.DEFAULT_TARGET_FPS, 0.0)
    assertEquals(contract.getDouble("confidenceFloor"), VisionContract.CONFIDENCE_FLOOR.toDouble(), 1e-6)
    assertEquals(5, ContractFixture.labels.size)
  }
}

class LabelParserTest {
  @Test fun parsesLinesIgnoringBlanksAndComments() {
    assertEquals(listOf("kickboard", "person"), LabelParser.parse("# order = class index\nkickboard\n\n  person  \n"))
  }

  @Test fun validatesExactlyTheFiveLabels() {
    assertNull(LabelParser.validate(listOf("kickboard", "person", "car", "motorcycle", "animal")))
    assertNull(LabelParser.validate(listOf("animal", "motorcycle", "car", "person", "kickboard"))) // 순서는 모델이 정한다
    assertNotNull(LabelParser.validate(emptyList()))
    assertNotNull(LabelParser.validate(listOf("kickboard", "person", "vehicle", "motorcycle", "animal"))) // 앱 이름(vehicle)이 아니라 모델 이름(car)
    assertNotNull(LabelParser.validate(listOf("kickboard", "kickboard", "car", "motorcycle", "animal")))
    assertNotNull(LabelParser.validate(listOf("kickboard", "person", "car", "motorcycle")))
  }
}

class FpsGovernorTest {
  @Test fun defaultIsFiveFpsLikeIos() {
    val g = FpsGovernor()
    assertEquals(5.0, g.targetFps, 0.0)
    assertTrue(g.shouldProcess(0))
    assertFalse(g.shouldProcess(100))   // 200ms 간격 안
    assertFalse(g.shouldProcess(199))
    assertTrue(g.shouldProcess(200))
    assertFalse(g.shouldProcess(300))
  }

  @Test fun protectionZoneTenFps() {
    val g = FpsGovernor(); g.targetFps = 10.0
    assertTrue(g.shouldProcess(0)); assertFalse(g.shouldProcess(99)); assertTrue(g.shouldProcess(100))
  }

  @Test fun invalidTargetFallsBackToDefault() {
    val g = FpsGovernor()
    for (bad in listOf(0.0, -3.0, Double.NaN, Double.POSITIVE_INFINITY)) { g.targetFps = bad; assertEquals(5.0, g.targetFps, 0.0) }
    g.targetFps = 500.0
    assertEquals(30.0, g.targetFps, 0.0)
  }

  @Test fun slowInferenceLowersTheRateToKeepDutyCycleBelowEightyPercent() {
    val g = FpsGovernor(10.0)
    repeat(30) { g.recordInference(400.0) } // 400ms * 1.25 = 500ms → 2fps
    assertEquals(2.0, g.effectiveFps(), 0.05)
    val fast = FpsGovernor(5.0); repeat(30) { fast.recordInference(20.0) }
    assertEquals(5.0, fast.effectiveFps(), 0.0) // 빠르면 목표 그대로
    val verySlow = FpsGovernor(5.0); repeat(30) { verySlow.recordInference(5000.0) }
    assertEquals(1.0, verySlow.effectiveFps(), 0.0) // 최소 1fps
  }

  @Test fun thermalCapsAndPause() {
    assertNull(FpsGovernor.thermalCapFor(0)); assertNull(FpsGovernor.thermalCapFor(2))
    assertEquals(2.0, FpsGovernor.thermalCapFor(3)!!, 0.0)
    assertEquals(0.0, FpsGovernor.thermalCapFor(4)!!, 0.0); assertEquals(0.0, FpsGovernor.thermalCapFor(6)!!, 0.0)
    val g = FpsGovernor(10.0)
    g.thermalCapFps = 2.0; assertEquals(2.0, g.effectiveFps(), 0.0)
    g.thermalCapFps = 0.0; assertEquals(0.0, g.effectiveFps(), 0.0); assertFalse(g.shouldProcess(10_000))
    g.thermalCapFps = null; assertEquals(10.0, g.effectiveFps(), 0.0); assertTrue(g.shouldProcess(20_000))
  }

  @Test fun resetClearsHistory() {
    val g = FpsGovernor(); g.shouldProcess(0); repeat(10) { g.recordInference(900.0) }
    g.reset()
    assertEquals(5.0, g.effectiveFps(), 0.0)
    assertTrue(g.shouldProcess(1))
  }
}
