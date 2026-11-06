package com.tikkeuldata.navigation

import android.os.SystemClock
import android.util.Log
import com.kakaomobility.knsdk.KNSDK
import com.kakaomobility.knsdk.guidance.knguidance.locationguide.KNGuide_Location
import com.kakaomobility.knsdk.trip.kntrip.knroute.KNRoute

/** Product SDK feed. Available in both Debug and Release; no diagnostic gate. */
internal object GuidanceEventFeed {
  private var lastLocation: Long? = null

  fun begin() { lastLocation = null }

  fun emitLocation(location: KNGuide_Location) {
    val emit = NavigationSession.guidance ?: return
    val now = SystemClock.elapsedRealtime()
    if (lastLocation?.let { now - it < 1000 } == true) return
    runCatching {
      val gps = location.gpsMatched
      val point = KNSDK.convertKATECToWGS84(gps.pos.x.toInt(), gps.pos.y.toInt())
      val origin = location.gpsOrigin
      lastLocation = now
      emit(mapOf(
        "kind" to "location", "lat" to point.y, "lng" to point.x,
        "speedKmh" to gps.speed, "angle" to gps.angle,
        "hdop" to origin.hdop, "posTrust" to origin.posTrust, "valid" to gps.valid,
        "timestampMs" to origin.timestamp.timeInMillis, "timestampSource" to "sdk_origin",
        "distFromS" to (location.location?.distFromS ?: -1),
      ))
    }.onFailure { Log.w("TikkeulGuidance", "Location event failed: ${it.javaClass.simpleName}") }
  }

  fun emitRoute(reason: String, route: KNRoute?) {
    val emit = NavigationSession.guidance ?: return
    runCatching {
      val points = route?.routePolylineWGS84() ?: emptyList()
      emit(mapOf(
        "kind" to "route", "reason" to reason, "count" to points.size,
        "keys" to (points.firstOrNull()?.keys?.toList() ?: emptyList<String>()),
        "points" to points.take(6000).map { point -> point.mapValues { it.value.toDouble() } },
      ))
    }.onFailure { Log.w("TikkeulGuidance", "Route event failed: ${it.javaClass.simpleName}") }
  }
}
