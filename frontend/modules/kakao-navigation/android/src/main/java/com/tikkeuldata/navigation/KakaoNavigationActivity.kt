package com.tikkeuldata.navigation

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.kakaomobility.knsdk.KNLanguageType
import com.kakaomobility.knsdk.KNRouteAvoidOption
import com.kakaomobility.knsdk.KNRoutePriority
import com.kakaomobility.knsdk.KNSDK
import com.kakaomobility.knsdk.common.objects.KNError
import com.kakaomobility.knsdk.common.objects.KNPOI
import com.kakaomobility.knsdk.guidance.knguidance.*
import com.kakaomobility.knsdk.guidance.knguidance.citsguide.KNGuide_Cits
import com.kakaomobility.knsdk.guidance.knguidance.common.KNLocation
import com.kakaomobility.knsdk.guidance.knguidance.locationguide.KNGuide_Location
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.KNGuide_Route
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.objects.KNMultiRouteInfo
import com.kakaomobility.knsdk.guidance.knguidance.safetyguide.KNGuide_Safety
import com.kakaomobility.knsdk.guidance.knguidance.safetyguide.objects.KNSafety
import com.kakaomobility.knsdk.guidance.knguidance.voiceguide.KNGuide_Voice
import com.kakaomobility.knsdk.trip.kntrip.KNTrip
import com.kakaomobility.knsdk.trip.kntrip.knroute.KNRoute
import com.kakaomobility.knsdk.ui.view.KNNaviView
import com.kakaomobility.knsdk.ui.view.KNNaviView_GuideStateDelegate
import java.util.UUID

class KakaoNavigationActivity : AppCompatActivity(),
  KNGuidance_GuideStateDelegate, KNGuidance_LocationGuideDelegate,
  KNGuidance_RouteGuideDelegate, KNGuidance_SafetyGuideDelegate,
  KNGuidance_VoiceGuideDelegate, KNGuidance_CitsGuideDelegate,
  KNNaviView_GuideStateDelegate {

  companion object {
    private var sdkInstalled = false
    private var authenticatedKey: String? = null
  }

  private var naviView: KNNaviView? = null
  private var guidance: KNGuidance? = null
  private var sessionFinished = false
  private lateinit var container: FrameLayout

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (!NavigationSession.active()) { finish(); return }
    NavigationSession.attach(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    container = FrameLayout(this)
    container.addView(ProgressBar(this), FrameLayout.LayoutParams(80, 80, Gravity.CENTER))
    setContentView(container)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        naviView?.guideCancel() ?: closeSession()
      }
    })
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      fail("PRECISE_LOCATION_REQUIRED", "Precise location permission is required")
      return
    }
    try {
      if (!sdkInstalled) {
        KNSDK.install(application, filesDir.resolve("kakao-navigation").absolutePath)
        sdkInstalled = true
      }
      val appKey = nativeKey(this)
      if (authenticatedKey == appKey) {
        requestTrip()
        return
      }
      val preferences = getSharedPreferences("kakao-navigation", MODE_PRIVATE)
      val userId = preferences.getString("installation-id", null) ?: UUID.randomUUID().toString().also {
        preferences.edit().putString("installation-id", it).apply()
      }
      val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
      // Positional arguments match the pinned SDK binary (csId, appUserId, language).
      KNSDK.initializeWithAppKey(appKey, version, null, userId, KNLanguageType.KNLanguageType_KOREAN) { error ->
        runOnUiThread {
          if (isFinishing || isDestroyed) return@runOnUiThread
          if (error != null) fail("SDK_AUTH_FAILED", "Kakao SDK authentication failed: ${error.code}")
          else { authenticatedKey = appKey; requestTrip() }
        }
      }
    } catch (error: Exception) { fail("SDK_INIT_FAILED", error.localizedMessage ?: "SDK initialization failed") }
  }

  private fun poi(label: String, longitude: Double, latitude: Double): KNPOI {
    // SDK POIs use KATEC, whereas the app stores WGS84. Never pass degree values as KATEC.
    val projected = KNSDK.convertWGS84ToKATEC(longitude, latitude)
    return KNPOI(label, projected.x.toInt(), projected.y.toInt(), label)
  }

  private fun requestTrip() {
    try {
      val start = poi("출발지", intent.getDoubleExtra("originLongitude", Double.NaN), intent.getDoubleExtra("originLatitude", Double.NaN))
      val destination = poi(intent.getStringExtra("destinationLabel")?.ifBlank { "목적지" } ?: "목적지",
        intent.getDoubleExtra("destinationLongitude", Double.NaN), intent.getDoubleExtra("destinationLatitude", Double.NaN))
      KNSDK.makeTripWithStart(start, destination, null, null) { error, trip ->
        runOnUiThread {
          if (isFinishing || isDestroyed) return@runOnUiThread
          if (error != null || trip == null) fail("ROUTE_FAILED", "Kakao route calculation failed")
          else route(trip)
        }
      }
    } catch (error: Exception) { fail("ROUTE_FAILED", error.localizedMessage ?: "Route calculation failed") }
  }

  private fun route(trip: KNTrip) {
    val style = intent.getStringExtra("routeStyle") ?: "recommended"
    val priority = when (style) {
      "shortest" -> KNRoutePriority.KNRoutePriority_Distance
      "major_road" -> KNRoutePriority.KNRoutePriority_WideWay
      else -> KNRoutePriority.KNRoutePriority_Recommand
    }
    val avoid = when (style) {
      "toll_free" -> KNRouteAvoidOption.KNRouteAvoidOption_Fare.value
      "avoid_school_zone" -> KNRouteAvoidOption.KNRouteAvoidOption_SZone.value
      else -> KNRouteAvoidOption.KNRouteAvoidOption_None.value
    }
    trip.routeWithPriority(priority, avoid) { error, _ ->
      runOnUiThread {
        if (isFinishing || isDestroyed) return@runOnUiThread
        if (error != null) { fail("ROUTE_FAILED", "Kakao route request failed"); return@runOnUiThread }
        val active = KNSDK.sharedGuidance()
        if (active == null) { fail("GUIDANCE_UNAVAILABLE", "Kakao guidance is unavailable"); return@runOnUiThread }
        guidance = active
        val view = KNNaviView(this)
        naviView = view
        view.guideStateDelegate = this
        active.guideStateDelegate = this
        active.locationGuideDelegate = this
        active.routeGuideDelegate = this
        active.safetyGuideDelegate = this
        active.voiceGuideDelegate = this
        active.citsGuideDelegate = this
        container.removeAllViews()
        container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        view.initWithGuidance(active, trip, priority, avoid)
      }
    }
  }

  private fun fail(code: String, message: String) {
    if (sessionFinished) return
    sessionFinished = true
    NavigationSession.close(code, message)
    finish()
  }

  private fun closeSession() {
    if (sessionFinished) return
    sessionFinished = true
    NavigationSession.close()
    finish()
  }

  override fun onDestroy() {
    guidance?.apply {
      guideStateDelegate = null
      locationGuideDelegate = null
      routeGuideDelegate = null
      safetyGuideDelegate = null
      voiceGuideDelegate = null
      citsGuideDelegate = null
      stop()
    }
    naviView?.guideStateDelegate = null
    if (::container.isInitialized) container.removeAllViews()
    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    if (!isChangingConfigurations && !sessionFinished) NavigationSession.close()
    super.onDestroy()
  }

  override fun naviViewGuideState(state: KNGuideState) = Unit
  override fun naviViewGuideEnded() = closeSession()

  // Forward all guidance delegates to the official UI; do not run the JS guidance engine in parallel.
  override fun guidanceGuideStarted(g: KNGuidance) { naviView?.guidanceGuideStarted(g) }
  override fun guidanceCheckingRouteChange(g: KNGuidance) { naviView?.guidanceCheckingRouteChange(g) }
  override fun guidanceRouteUnchanged(g: KNGuidance) { naviView?.guidanceRouteUnchanged(g) }
  override fun guidanceRouteUnchangedWithError(g: KNGuidance, error: KNError) { naviView?.guidanceRouteUnchangedWithError(g, error) }
  override fun guidanceOutOfRoute(g: KNGuidance) { naviView?.guidanceOutOfRoute(g) }
  override fun guidanceRouteChanged(g: KNGuidance, fromRoute: KNRoute, fromLocation: KNLocation, toRoute: KNRoute, toLocation: KNLocation, reason: KNGuideRouteChangeReason) { naviView?.guidanceRouteChanged(g) }
  override fun guidanceGuideEnded(g: KNGuidance) { naviView?.guidanceGuideEnded(g, true) }
  override fun guidanceDidUpdateRoutes(g: KNGuidance, routes: List<KNRoute>, info: KNMultiRouteInfo?) { naviView?.guidanceDidUpdateRoutes(g, routes, info) }
  override fun guidanceDidUpdateIndoorRoute(g: KNGuidance, route: KNRoute?) { naviView?.guidanceDidUpdateIndoorRoute(g, route) }
  override fun guidanceDidUpdateLocation(g: KNGuidance, location: KNGuide_Location) { naviView?.guidanceDidUpdateLocation(g, location) }
  override fun guidanceDidUpdateRouteGuide(g: KNGuidance, route: KNGuide_Route) { naviView?.guidanceDidUpdateRouteGuide(g, route) }
  override fun guidanceDidUpdateSafetyGuide(g: KNGuidance, safety: KNGuide_Safety?) { naviView?.guidanceDidUpdateSafetyGuide(g, safety) }
  override fun guidanceDidUpdateAroundSafeties(g: KNGuidance, safeties: List<KNSafety>?) { naviView?.guidanceDidUpdateAroundSafeties(g, safeties) }
  override fun shouldPlayVoiceGuide(g: KNGuidance, voice: KNGuide_Voice, data: MutableList<ByteArray>): Boolean = naviView?.shouldPlayVoiceGuide(g, voice, data) ?: false
  override fun willPlayVoiceGuide(g: KNGuidance, voice: KNGuide_Voice) { naviView?.willPlayVoiceGuide(g, voice) }
  override fun didFinishPlayVoiceGuide(g: KNGuidance, voice: KNGuide_Voice) { naviView?.didFinishPlayVoiceGuide(g, voice) }
  override fun didUpdateCitsGuide(g: KNGuidance, cits: KNGuide_Cits) { naviView?.didUpdateCitsGuide(g, cits) }
}
