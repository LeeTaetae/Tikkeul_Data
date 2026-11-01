package com.tikkeuldata.navigation

import android.content.Context
import android.graphics.RectF
import com.kakaomobility.knsdk.common.util.FloatPoint
import com.kakaomobility.knsdk.ui.view.KNNaviView

// User-selected car marker for the official navigation UI. "default" keeps the SDK's own marker.
// setCustomCarImages is public on KNComponentMapView but not in Kakao's guide (checked against 1.12.8-hotfix05):
// each list is [on, off] ("off" = weak GPS), day list first, and all-null arguments restore the SDK images.
internal object CarIcons {
  const val DEFAULT = "default"
  private const val KEY = "car-icon"

  private val images = mapOf(
    "taxi" to (listOf(R.drawable.tikkeul_car_taxi_day_on, R.drawable.tikkeul_car_taxi_day_off) to
      listOf(R.drawable.tikkeul_car_taxi_night_on, R.drawable.tikkeul_car_taxi_night_off)),
    "sports" to (listOf(R.drawable.tikkeul_car_sports_day_on, R.drawable.tikkeul_car_sports_day_off) to
      listOf(R.drawable.tikkeul_car_sports_night_on, R.drawable.tikkeul_car_sports_night_off)),
    "character" to (listOf(R.drawable.tikkeul_car_character_day_on, R.drawable.tikkeul_car_character_day_off) to
      listOf(R.drawable.tikkeul_car_character_night_on, R.drawable.tikkeul_car_character_night_off)),
  )
  val ids = listOf(DEFAULT) + images.keys

  // Picker preview: the SDK's own day marker for default, otherwise the day "on" image.
  fun preview(id: String): Int = images[id]?.first?.get(0) ?: com.kakaomobility.knsdk.R.drawable.navi_car_on

  fun get(context: Context): String = context.getSharedPreferences("kakao-navigation", Context.MODE_PRIVATE)
    .getString(KEY, DEFAULT)?.takeIf { it in ids } ?: DEFAULT

  fun set(context: Context, id: String) {
    require(id in ids) { "Unknown car icon: $id" }
    context.getSharedPreferences("kakao-navigation", Context.MODE_PRIVATE).edit().putString(KEY, id).apply()
  }

  fun apply(view: KNNaviView, id: String) {
    val (day, night) = images[id] ?: run {
      view.mapComponent.setCustomCarImages(null, null, null, null)
      return
    }
    // The SDK's Kotlin signature takes MutableList<Int>?; pass copies so our constants stay unchanged.
    view.mapComponent.setCustomCarImages(RectF(0f, 0f, 168f, 184f), FloatPoint(0.5f, 0.5f), day.toMutableList(), night.toMutableList())
  }
}
