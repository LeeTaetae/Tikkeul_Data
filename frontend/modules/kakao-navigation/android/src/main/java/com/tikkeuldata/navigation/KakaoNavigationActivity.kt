package com.tikkeuldata.navigation

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import android.widget.Button
import androidx.appcompat.app.AlertDialog
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.kakaomobility.knsdk.KNLanguageType
import com.kakaomobility.knsdk.KNRouteAvoidOption
import com.kakaomobility.knsdk.KNRoutePriority
import com.kakaomobility.knsdk.KNSDK
import com.kakaomobility.knsdk.common.soundplayer.KNSoundPlayer
import com.kakaomobility.knsdk.common.objects.KNError
import com.kakaomobility.knsdk.common.objects.KNPOI
import com.kakaomobility.knsdk.guidance.knguidance.*
import com.kakaomobility.knsdk.guidance.knguidance.citsguide.KNGuide_Cits
import com.kakaomobility.knsdk.guidance.knguidance.common.KNLocation
import com.kakaomobility.knsdk.guidance.knguidance.locationguide.KNGuide_Location
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.KNGuide_Route
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.objects.KNMultiRouteInfo
import com.kakaomobility.knsdk.guidance.knguidance.routeguide.objects.KNDirection
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
    private var authenticatedLanguage: KNLanguageType? = null

    // SDK UI/map language is independent of the recorded voice container.
    private fun sdkLanguage(code: String?): KNLanguageType = when (code) {
      "en" -> KNLanguageType.KNLanguageType_ENGLISH
      "zh" -> KNLanguageType.KNLanguageType_CHINESE
      else -> KNLanguageType.KNLanguageType_KOREAN
    }
  }

  private var naviView: KNNaviView? = null
  private var guidance: KNGuidance? = null
  private var sessionFinished = false
  private var picker: CarIconPicker? = null
  private var voiceSpeaker: CarVoiceSpeaker? = null
  private var voiceLanguage = "ko"
  private var voiceFailureShown = false
  private lateinit var container: FrameLayout
  private var railOverlay: HazardRailOverlay? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    GuidanceEventFeed.begin()
    if (!NavigationSession.active()) { finish(); return }
    NavigationSession.attach(this)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    container = FrameLayout(this)
    container.addView(ProgressBar(this), FrameLayout.LayoutParams(80, 80, Gravity.CENTER))
    setContentView(container)
    voiceLanguage = intent.getStringExtra("language") ?: "ko"
    voiceSpeaker = CarVoiceSpeaker(this) {
      runOnUiThread {
        if (!isFinishing && !voiceFailureShown) {
          voiceFailureShown = true
          val message = if (voiceLanguage == "zh") "无法使用中文离线语音。请在系统文字转语音设置中安装中文语音。" else "Offline English voice is unavailable. Install it in Android text-to-speech settings."
          AlertDialog.Builder(this).setMessage(message).setPositiveButton(android.R.string.ok, null).show()
        }
      }
    }.also { it.setLanguage(voiceLanguage) }
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (picker?.isOpen == true) { picker?.close(); return }
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
      val appLanguage = intent.getStringExtra("language") ?: "ko"
      val language = sdkLanguage(appLanguage)
      // 진단 로그(키·좌표 없음): adb logcat -s TikkeulVoice
      Log.i("TikkeulVoice", "navigationMode=car appLanguage=$appLanguage sdkLanguage=$language initializedLanguage=$authenticatedLanguage")
      // 같은 키라도 언어가 바뀌었으면 SDK 를 새 언어로 다시 초기화한다.
      if (authenticatedKey == appKey && authenticatedLanguage == language) {
        requestTrip()
        return
      }
      val preferences = getSharedPreferences("kakao-navigation", MODE_PRIVATE)
      val userId = preferences.getString("installation-id", null) ?: UUID.randomUUID().toString().also {
        preferences.edit().putString("installation-id", it).apply()
      }
      val version = packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
      // Positional arguments match the pinned SDK binary (csId, appUserId, language).
      KNSDK.initializeWithAppKey(appKey, version, null, userId, language) { error ->
        runOnUiThread {
          if (isFinishing || isDestroyed) return@runOnUiThread
          if (error != null) fail("SDK_AUTH_FAILED", "Kakao SDK authentication failed: ${error.code}")
          else { authenticatedKey = appKey; authenticatedLanguage = language; requestTrip() }
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
        // 디버그 빌드에서 시뮬레이션을 켰으면(SpikeProbe, adb) SDK 공식 시뮬레이션 안내로 시작한다. 평소(Release 포함)는 기존 그대로다.
        val simulated = NavigationDiagnostics.simulationRequested()
        val active: KNGuidance? = if (simulated) KNSDK.sharedSimulGuidance() else KNSDK.sharedGuidance()
        if (simulated) Log.i("TikkeulSpike", "guidance=simulation")
        if (active == null) { fail("GUIDANCE_UNAVAILABLE", "Kakao guidance is unavailable"); return@runOnUiThread }
        guidance = active
        NavigationDiagnostics.simGuidance = active as? KNSimulGuidance // SPIKE(임시): 디버그 시뮬레이션 제어
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
        // The car icon is cosmetic: any failure keeps the SDK marker and must never block guidance.
        runCatching { CarIcons.apply(view, CarIcons.get(this)) }
        view.initWithGuidance(active, trip, priority, avoid)
        Log.i("TikkeulVoice", "stage=guidance-init build=car-tts-v1 appLanguage=$voiceLanguage recordedLanguage=${active.sndContainer?.langType} engine=${if (voiceLanguage == "ko") "sdk" else "android-tts"}")
        attachVoiceLanguageButton()
        // 위험 레일: JS 가 보낸 스냅샷을 왼쪽 위에 그린다. 실패해도 길안내를 막지 않는다.
        runCatching { railOverlay = HazardRailOverlay(this, intent.getStringExtra("language") ?: "ko").also { it.attach(container) } }
        runCatching { NavigationDiagnostics.attachDiag(this, container) } // SPIKE(임시): 디버그 빌드 전용 JS 전달 진단 오버레이
        runCatching {
          picker = CarIconPicker(this, intent.getStringExtra("language") ?: "ko", ::changeCarIcon).also {
            it.attach(container)
            railOverlay?.setCarButton(it.anchorView) // 위험 레일이 닿을 때만 버튼을 아래로 민다
          }
        }
      }
    }
  }

  private fun attachVoiceLanguageButton() {
    val button = Button(this).apply {
      text = "한국어 / EN / 中文"
      contentDescription = "Voice language / 안내 언어 / 语音语言"
      setOnClickListener {
        AlertDialog.Builder(this@KakaoNavigationActivity)
          .setTitle("안내 언어 / Voice language / 语音语言")
          .setSingleChoiceItems(arrayOf("한국어", "English", "中文"), listOf("ko", "en", "zh").indexOf(voiceLanguage)) { dialog, index ->
            changeVoiceLanguage(listOf("ko", "en", "zh")[index])
            dialog.dismiss()
          }.show()
      }
    }
    container.addView(button, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, (48 * resources.displayMetrics.density).toInt(), Gravity.END or Gravity.CENTER_VERTICAL))
  }

  internal fun changeVoiceLanguage(language: String) {
    if (language !in listOf("ko", "en", "zh") || language == voiceLanguage) return
    runCatching { KNSoundPlayer.stopAllSound() }
    voiceLanguage = language
    intent.putExtra("language", language)
    voiceFailureShown = false
    voiceSpeaker?.setLanguage(language)
    KNSDK.setLanguageType(sdkLanguage(language))
    authenticatedLanguage = sdkLanguage(language)
    NavigationSession.languageChanged?.invoke(language)
    Log.i("TikkeulVoice", "stage=language-change appLanguage=$language recordedLanguage=${guidance?.sndContainer?.langType}")
  }

  // Changing the icon only swaps the marker images; the trip, guidance and route state are untouched.
  private fun changeCarIcon(id: String) {
    val view = naviView ?: return
    val current = picker ?: return
    CarIcons.set(this, id)
    current.select(id)
    current.close()
    val applied = runCatching {
      val before = view.mapComponent.mapView.userLocation?.icon
      CarIcons.apply(view, id)
      // Re-setting the same documented useDarkMode value re-renders the components (and the car marker)
      // without changing day/night or guidance state. Detect whether the marker bitmap was actually replaced.
      view.useDarkMode = view.useDarkMode
      view.mapComponent.mapView.userLocation?.icon !== before
    }.getOrDefault(false)
    Toast.makeText(this, current.label(if (applied) "changed" else "nextTrip"), Toast.LENGTH_SHORT).show()
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
    voiceSpeaker?.close()
    guidance?.apply {
      guideStateDelegate = null
      locationGuideDelegate = null
      routeGuideDelegate = null
      safetyGuideDelegate = null
      voiceGuideDelegate = null
      citsGuideDelegate = null
      stop()
    }
    // 시뮬레이션 안내였다면 SDK 가 들고 있는 시뮬레이션 안내 객체를 비워, 다음 실제 안내가 영향받지 않게 한다.
    NavigationDiagnostics.simGuidance = null
    if (guidance is KNSimulGuidance) runCatching { KNSDK.removeSharedSimulGuidance() }
    naviView?.guideStateDelegate = null
    railOverlay?.detach()
    railOverlay = null
    if (::container.isInitialized) container.removeAllViews()
    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    if (!isChangingConfigurations && !sessionFinished) NavigationSession.close()
    super.onDestroy()
  }

  override fun naviViewGuideState(state: KNGuideState) = Unit
  override fun naviViewGuideEnded() = closeSession()

  // Forward all guidance delegates to the official UI; do not run the JS guidance engine in parallel.
  override fun guidanceGuideStarted(g: KNGuidance) { Log.i("TikkeulVoice", "stage=guide-start language=$voiceLanguage"); naviView?.guidanceGuideStarted(g); GuidanceEventFeed.emitRoute("started", g.routesOnGuide?.firstOrNull()) /* SPIKE(임시) */ }
  override fun guidanceCheckingRouteChange(g: KNGuidance) { naviView?.guidanceCheckingRouteChange(g) }
  override fun guidanceRouteUnchanged(g: KNGuidance) { naviView?.guidanceRouteUnchanged(g) }
  override fun guidanceRouteUnchangedWithError(g: KNGuidance, error: KNError) { naviView?.guidanceRouteUnchangedWithError(g, error) }
  override fun guidanceOutOfRoute(g: KNGuidance) { naviView?.guidanceOutOfRoute(g) }
  override fun guidanceRouteChanged(g: KNGuidance, fromRoute: KNRoute, fromLocation: KNLocation, toRoute: KNRoute, toLocation: KNLocation, reason: KNGuideRouteChangeReason) { voiceSpeaker?.stop(); Log.i("TikkeulVoice", "stage=reroute language=$voiceLanguage reason=$reason"); naviView?.guidanceRouteChanged(g); GuidanceEventFeed.emitRoute("changed:$reason", toRoute) /* SPIKE(임시) */ }
  override fun guidanceGuideEnded(g: KNGuidance) { naviView?.guidanceGuideEnded(g, true) }
  override fun guidanceDidUpdateRoutes(g: KNGuidance, routes: List<KNRoute>, info: KNMultiRouteInfo?) { naviView?.guidanceDidUpdateRoutes(g, routes, info) }
  override fun guidanceDidUpdateIndoorRoute(g: KNGuidance, route: KNRoute?) { naviView?.guidanceDidUpdateIndoorRoute(g, route) }
  override fun guidanceDidUpdateLocation(g: KNGuidance, location: KNGuide_Location) {
    naviView?.guidanceDidUpdateLocation(g, location)
    GuidanceEventFeed.emitLocation(location) // SPIKE(임시)
    LocationDebug.log(this, location, intent.getDoubleExtra("originLatitude", Double.NaN), intent.getDoubleExtra("originLongitude", Double.NaN))
  }
  override fun guidanceDidUpdateRouteGuide(g: KNGuidance, route: KNGuide_Route) { naviView?.guidanceDidUpdateRouteGuide(g, route) }
  override fun guidanceDidUpdateSafetyGuide(g: KNGuidance, safety: KNGuide_Safety?) { naviView?.guidanceDidUpdateSafetyGuide(g, safety) }
  override fun guidanceDidUpdateAroundSafeties(g: KNGuidance, safeties: List<KNSafety>?) { naviView?.guidanceDidUpdateAroundSafeties(g, safeties) }
  override fun shouldPlayVoiceGuide(g: KNGuidance, voice: KNGuide_Voice, data: MutableList<ByteArray>): Boolean {
    val allowed = naviView?.shouldPlayVoiceGuide(g, voice, data) ?: false
    if (voiceLanguage == "ko" || !allowed) return allowed
    val event = voice.voiceCode.name
    val text = CarVoiceText.text(voiceLanguage, event, (voice.guideObj as? KNDirection)?.rgCode?.name,
      (voice.guideObj as? KNSafety)?.code?.name, voice.voiceDist.name == "KNVoiceDist_AtPos")
    Log.i("TikkeulVoice", "stage=voice-event language=$voiceLanguage event=$event distance=${voice.voiceDist} translated=${text != null} sdkSpeech=false")
    if (text != null) voiceSpeaker?.speak(text)
    return event in listOf("KNVoiceCode_Alram", "KNVoiceCode_Alert", "KNVoiceCode_LinkSound")
  }
  override fun willPlayVoiceGuide(g: KNGuidance, voice: KNGuide_Voice) { naviView?.willPlayVoiceGuide(g, voice) }
  override fun didFinishPlayVoiceGuide(g: KNGuidance, voice: KNGuide_Voice) { naviView?.didFinishPlayVoiceGuide(g, voice) }
  override fun didUpdateCitsGuide(g: KNGuidance, cits: KNGuide_Cits) { naviView?.didUpdateCitsGuide(g, cits) }
}
