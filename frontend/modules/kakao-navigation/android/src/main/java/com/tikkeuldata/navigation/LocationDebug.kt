package com.tikkeuldata.navigation

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.SystemClock
import android.util.Log
import com.kakaomobility.knsdk.KNSDK
import com.kakaomobility.knsdk.common.gps.KNGPSData
import com.kakaomobility.knsdk.guidance.knguidance.locationguide.KNGuide_Location
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

// Development-only GPS diagnostics (debuggable builds; never in release logs). Read-only: nothing here moves the marker.
// The SDK UI draws the car at gpsMatched.pos and shows the grey "off" image while gpsMatched.valid is false
// (KNComponentMapView, knsdk_ui 1.12.8-hotfix05), so we log both the raw fix (gpsOrigin) and the matched one.
internal object LocationDebug {
  private const val TAG = "TikkeulNavGps"
  private var lastLog = 0L

  fun log(context: Context, location: KNGuide_Location, startLatitude: Double, startLongitude: Double) {
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return
    val now = SystemClock.elapsedRealtime()
    if (now - lastLog < 3_000) return
    lastLog = now
    runCatching {
      val origin = location.gpsOrigin
      val matched = location.gpsMatched
      val (originLat, originLng) = wgs84(origin)
      val (matchedLat, matchedLng) = wgs84(matched)
      // NO_GPS: no usable raw fix. NOT_MATCHED: raw fix exists but is not matched to the road/route. MATCHED: both valid.
      val status = when {
        !origin.valid -> "NO_GPS"
        !matched.valid -> "NOT_MATCHED"
        else -> "MATCHED"
      }
      Log.d(TAG, "status=$status" +
        " origin=${fmt(originLat)},${fmt(originLng)} valid=${origin.valid} provider=${origin.provider} hdop=${origin.hdop}" +
        " posTrust=${origin.posTrust} ageMs=${System.currentTimeMillis() - origin.timestamp.timeInMillis}" +
        " matched=${fmt(matchedLat)},${fmt(matchedLng)} valid=${matched.valid}" +
        " originToMatchedM=${meters(originLat, originLng, matchedLat, matchedLng)}" +
        " startToOriginM=${meters(startLatitude, startLongitude, originLat, originLng)}" +
        " startToMatchedM=${meters(startLatitude, startLongitude, matchedLat, matchedLng)}")
    }.onFailure { Log.d(TAG, "location log failed: ${it.javaClass.simpleName}") }
  }

  // SDK positions are KATEC; convert with the SDK's own converter (x = longitude, y = latitude).
  private fun wgs84(data: KNGPSData): Pair<Double, Double> {
    val point = KNSDK.convertKATECToWGS84(data.pos.x.toInt(), data.pos.y.toInt())
    return point.y to point.x
  }

  private fun meters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Long {
    val r = Math.toRadians(1.0)
    val h = sin((lat2 - lat1) * r / 2).pow(2) + cos(lat1 * r) * cos(lat2 * r) * sin((lng2 - lng1) * r / 2).pow(2)
    return Math.round(2 * 6_371_008.8 * asin(sqrt(h)))
  }

  // Five decimals (about 1 m) is enough to compare positions in development.
  private fun fmt(value: Double) = String.format(java.util.Locale.US, "%.5f", value)
}
