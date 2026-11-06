package com.tikkeuldata.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class LetterboxGeometryTest {
  private val eps = 1e-3f

  @Test fun fixtureGeometry_portraitFrameFromLandscapeSensor() {
    val g = ContractFixture.root.getJSONObject("geometry")
    val e = g.getJSONObject("expect")
    val lb = Letterbox(g.getInt("srcW"), g.getInt("srcH"), g.getInt("rotation"), g.getInt("dstW"), g.getInt("dstH"))
    assertEquals(e.getInt("uprightW"), lb.uprightW)
    assertEquals(e.getInt("uprightH"), lb.uprightH)
    assertEquals(e.getDouble("scale").toFloat(), lb.scale, eps)
    assertEquals(e.getDouble("padX").toFloat(), lb.padX, eps)
    assertEquals(e.getDouble("padY").toFloat(), lb.padY, eps)
  }

  /** 센서 프레임의 네 모서리가 시계방향 회전 후 업라이트 프레임의 올바른 모서리로 가는지(90°: 좌상단 → 우상단). */
  @Test fun rotation90_cornersLandOnTheExpectedUprightCorners() {
    val lb = Letterbox(640, 480, 90, 384, 384) // 업라이트 480x640, 내용 288x384, padX 48
    fun p(x: Float, y: Float) = lb.mapSourcePoint(x, y)
    assertEquals(Pair(48f + 288f, 0f), p(0f, 0f).round())      // 센서 좌상단 → 업라이트 우상단
    assertEquals(Pair(48f + 288f, 384f), p(640f, 0f).round())  // 센서 우상단 → 업라이트 우하단
    assertEquals(Pair(48f, 0f), p(0f, 480f).round())           // 센서 좌하단 → 업라이트 좌상단
    assertEquals(Pair(48f, 384f), p(640f, 480f).round())       // 센서 우하단 → 업라이트 좌하단
  }

  @Test fun rotation270_and180_andZero() {
    val r270 = Letterbox(640, 480, 270, 384, 384)
    assertEquals(Pair(48f, 384f), r270.mapSourcePoint(0f, 0f).round())            // 좌상단 → 좌하단
    assertEquals(Pair(48f + 288f, 0f), r270.mapSourcePoint(640f, 480f).round())   // 우하단 → 우상단
    val r180 = Letterbox(640, 480, 180, 384, 384)
    assertEquals(r180.scale, 0.6f, eps)                                           // 640x480 → 384 폭에 맞춤
    val a = r180.mapSourcePoint(0f, 0f)
    val b = r180.mapSourcePoint(640f, 480f)
    assertEquals(r180.padX + r180.contentW, a.first, eps)
    assertEquals(r180.padY + r180.contentH, a.second, eps)
    assertEquals(r180.padX, b.first, eps)
    assertEquals(r180.padY, b.second, eps)
    val r0 = Letterbox(640, 480, 0, 384, 384)
    assertEquals(Pair(0f, 48f), r0.mapSourcePoint(0f, 0f).round())                // 가로 프레임: 위아래 패딩
  }

  @Test fun negativeAndFullTurnRotationsAreNormalised() {
    assertEquals(90, Letterbox(10, 20, -270, 8, 8).rotation)
    assertEquals(0, Letterbox(10, 20, 360, 8, 8).rotation)
  }

  @Test fun toUprightBox_mapsBackAndClampsToTheContentArea() {
    val lb = Letterbox(640, 480, 90, 384, 384)
    val full = lb.toUprightBox(48f, 0f, 336f, 384f)
    assertNotNull(full)
    assertEquals(0f, full!!.x, eps); assertEquals(0f, full.y, eps); assertEquals(1f, full.width, eps); assertEquals(1f, full.height, eps)
    val clipped = lb.toUprightBox(0f, -20f, 100f, 100f)!! // 패딩 영역(왼쪽 48px)과 위쪽 밖은 잘린다
    assertEquals(0f, clipped.x, eps); assertEquals(0f, clipped.y, eps)
    assertEquals((100f - 48f) / 288f, clipped.width, eps)
    assertNull(lb.toUprightBox(0f, 0f, 40f, 40f)) // 전부 패딩 안 → 상자 없음
    assertNull(lb.toUprightBox(100f, 100f, 100f, 200f)) // 폭 0
  }

  @Test(expected = IllegalArgumentException::class) fun rejectsNonRightAngleRotation() { Letterbox(10, 10, 45, 8, 8) }
  @Test(expected = IllegalArgumentException::class) fun rejectsZeroSize() { Letterbox(0, 10, 0, 8, 8) }

  private fun Pair<Float, Float>.round() = Pair(Math.round(first * 10f) / 10f, Math.round(second * 10f) / 10f)
}
