package com.tikkeuldata.navigation

import android.app.Activity
import android.content.Context
import android.widget.FrameLayout
import com.kakaomobility.knsdk.guidance.knguidance.KNSimulGuidance

/** No receivers, simulation, diagnostic events or summaries ship in Release. */
@Suppress("UNUSED_PARAMETER")
internal object NavigationDiagnostics {
  const val enabled = false
  var simGuidance: KNSimulGuidance?
    get() = null
    set(value) {}
  fun init(context: Context) {}
  fun simulationRequested() = false
  fun attachDiag(activity: Activity, container: FrameLayout) {}
  fun observe(event: Map<String, Any?>) {}
  fun ack(session: Int, id: Int) = "disabled"
  fun summary(): Map<String, Any?>? = null
  fun dispose() {}
}
