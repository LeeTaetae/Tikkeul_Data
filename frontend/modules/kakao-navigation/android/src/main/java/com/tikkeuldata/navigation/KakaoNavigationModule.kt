package com.tikkeuldata.navigation

import android.content.Context
import android.content.Intent
import android.app.Activity
import android.content.pm.PackageManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.lang.ref.WeakReference

internal const val NATIVE_KEY = "com.tikkeuldata.kakao.NATIVE_APP_KEY"

class NavigationOptions : Record {
  @Field var originLatitude: Double = Double.NaN
  @Field var originLongitude: Double = Double.NaN
  @Field var destinationLatitude: Double = Double.NaN
  @Field var destinationLongitude: Double = Double.NaN
  @Field var destinationLabel: String = ""
  @Field var routeStyle: String = "recommended"

  fun valid(): Boolean = originLatitude.isFinite() && originLatitude in -90.0..90.0 &&
    destinationLatitude.isFinite() && destinationLatitude in -90.0..90.0 &&
    originLongitude.isFinite() && originLongitude in -180.0..180.0 &&
    destinationLongitude.isFinite() && destinationLongitude in -180.0..180.0 &&
    routeStyle in setOf("recommended", "shortest", "major_road", "toll_free", "avoid_school_zone")
}

internal fun nativeKey(context: Context): String = context.packageManager
  .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
  .metaData?.getString(NATIVE_KEY)?.trim().orEmpty()

// One SDK instance owns navigation. Resolve the JS call only after its UI closes.
internal object NavigationSession {
  private var promise: Promise? = null
  private var activity: WeakReference<Activity>? = null
  @Synchronized fun begin(value: Promise): Boolean {
    if (promise != null) return false
    promise = value
    return true
  }
  @Synchronized fun active() = promise != null
  @Synchronized fun attach(owner: Activity) { activity = WeakReference(owner) }
  @Synchronized fun close(code: String? = null, message: String? = null) {
    val pending = promise ?: return
    promise = null
    activity = null
    if (code == null) pending.resolve(mapOf("status" to "closed"))
    else pending.reject(code, message ?: "Navigation failed", null)
  }
  @Synchronized fun dispose() {
    val owner = activity?.get()
    close("MODULE_DESTROYED", "Navigation context was closed")
    owner?.runOnUiThread { owner.finish() }
  }
}

class KakaoNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KakaoNavigation")
    OnDestroy { NavigationSession.dispose() }

    Function("getStatus") {
      val context = appContext.reactContext
      mapOf("configured" to (context != null && nativeKey(context).isNotEmpty()),
        "sdkVersion" to "1.12.8-hotfix05", "platform" to "android")
    }

    AsyncFunction("openNavigation") { options: NavigationOptions, promise: Promise ->
      val activity = appContext.currentActivity
      when {
        activity == null -> promise.reject("NO_ACTIVITY", "No foreground activity", null)
        !options.valid() -> promise.reject("INVALID_REQUEST", "Invalid destination or route option", null)
        nativeKey(activity).isEmpty() -> promise.reject("NOT_CONFIGURED", "Native Kakao application key is missing", null)
        !NavigationSession.begin(promise) -> promise.reject("NAVIGATION_BUSY", "Navigation is already open", null)
        else -> {
          try {
            activity.startActivity(Intent(activity, KakaoNavigationActivity::class.java).apply {
              putExtra("originLatitude", options.originLatitude)
              putExtra("originLongitude", options.originLongitude)
              putExtra("destinationLatitude", options.destinationLatitude)
              putExtra("destinationLongitude", options.destinationLongitude)
              putExtra("destinationLabel", options.destinationLabel.take(256))
              putExtra("routeStyle", options.routeStyle)
            })
          } catch (error: Exception) {
            NavigationSession.close("OPEN_FAILED", error.localizedMessage)
          }
        }
      }
    }.runOnQueue(Queues.MAIN)
  }
}
