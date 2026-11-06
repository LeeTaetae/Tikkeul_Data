package com.tikkeuldata.navigation

import android.app.Activity
import android.content.Context
import android.widget.FrameLayout
import com.kakaomobility.knsdk.guidance.knguidance.KNSimulGuidance

/** Debug-only adapter. Product events do not depend on this observer. */
internal object NavigationDiagnostics {
  val enabled: Boolean get() = SpikeProbe.enabled
  var simGuidance: KNSimulGuidance?
    get() = SpikeProbe.simGuidance
    set(value) { SpikeProbe.simGuidance = value }
  fun init(context: Context) { SpikeProbe.init(context); SpikeProbe.registerSimReceiver(context) }
  fun simulationRequested() = SpikeProbe.simulationRequested()
  fun attachDiag(activity: Activity, container: FrameLayout) = SpikeProbe.attachDiag(activity, container)
  fun observe(event: Map<String, Any?>) = SpikeProbe.observe(event)
  fun ack(session: Int, id: Int) = SpikeProbe.ack(session, id)
  fun summary() = SpikeProbe.summary()
  fun dispose() = SpikeProbe.dispose()
}
