package com.tikkeuldata.navigation

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.os.Build
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.Log
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.kakaomobility.knsdk.guidance.knguidance.KNSimulAction
import com.kakaomobility.knsdk.guidance.knguidance.KNSimulGuidance

// Debug-only diagnostics: observes product events without providing the rail's input.
// ACK summaries, mock overlays and simulation are not compiled into Release.
internal object SpikeProbe {
  private const val TAG = "TikkeulSpike"
  private var seq = 0

  // ── JS 이벤트 전달 진단(디버그 빌드 전용) ─────────────────────────────────────────────
  // 위치 이벤트마다 (session, id) 를 붙여 보내고, JS 가 같은 번호를 spikeAck 로 돌려보낸 수를 센다.
  // 좌표는 여기 기록하지 않는다. 번호·건수·시각만 쓴다. Release 빌드에서는 enabled 가 false 라 아무것도 하지 않는다.
  @Volatile var enabled = false
    private set
  private var session = 0
  private var emitted = 0
  private var lastEmitAt = 0L
  private var maxEmitGapMs = 0L
  private val acked = java.util.BitSet()
  private var ackCount = 0
  private var dupAck = 0
  private var badAck = 0
  private var lastAckId = 0
  private var lastAckAtWallMs = 0L
  private var lastAckAtElapsed = 0L
  private var beganAt = 0L

  fun init(context: Context) {
    enabled = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  }

  /** 새 주행 시작: 번호와 집계를 처음부터 다시 센다. 이전 주행 요약은 이때 사라진다 */
  @Synchronized fun begin() {
    if (!enabled) return
    session++
    seq = 0; emitted = 0; lastEmitAt = 0L; maxEmitGapMs = 0L
    acked.clear(); ackCount = 0; dupAck = 0; badAck = 0
    lastAckId = 0; lastAckAtWallMs = 0L; lastAckAtElapsed = 0L
    beganAt = android.os.SystemClock.elapsedRealtime()
  }

  /** 이벤트 한 건을 발생으로 기록하고 그 번호를 돌려준다 */
  @Synchronized private fun recordEmit(now: Long): Int {
    if (emitted > 0) maxEmitGapMs = maxOf(maxEmitGapMs, now - lastEmitAt)
    lastEmitAt = now
    emitted++
    return ++seq
  }

  /** JS 가 돌려준 ACK 를 검증하고 센다. 다른 주행의 번호, 보낸 적 없는 번호는 잘못된 값, 이미 받은 번호는 중복이다 */
  @Synchronized fun ack(sessionNo: Int, id: Int): String {
    if (!enabled) return "disabled"
    if (sessionNo != session || id < 1 || id > seq) { badAck++; return "invalid" }
    if (acked.get(id)) { dupAck++; return "duplicate" }
    acked.set(id)
    ackCount++
    lastAckId = id
    lastAckAtElapsed = android.os.SystemClock.elapsedRealtime()
    lastAckAtWallMs = System.currentTimeMillis()
    return "ok"
  }

  /** 주행 종료 후 JS 가 읽어 가는 요약. 디버그 빌드가 아니거나 주행이 한 번도 없었으면 null */
  @Synchronized fun summary(): Map<String, Any?>? {
    if (!enabled || session == 0) return null
    return mapOf(
      "session" to session, "emitted" to emitted, "acked" to ackCount, "dupAck" to dupAck, "badAck" to badAck,
      "lastEventId" to seq, "lastAckId" to lastAckId, "maxEmitGapMs" to maxEmitGapMs, "lastAckAtMs" to lastAckAtWallMs,
    )
  }

  /** 오버레이에 보일 문구와 상태(true 면 정상). 마지막 ACK 가 5초 넘게 없으면 이상으로 본다 */
  @Synchronized private fun overlayState(): Pair<String, Boolean> {
    val now = android.os.SystemClock.elapsedRealtime()
    val ackAge = if (ackCount == 0) "없음" else "${(now - lastAckAtElapsed) / 1000}초 전"
    val healthy = emitted == 0 || (ackCount > 0 && now - lastAckAtElapsed <= 5000) || (ackCount == 0 && now - beganAt <= 5000)
    return "JS 진단 #$session\n발생 $emitted · ACK $ackCount\n마지막 ACK $ackAge\n이벤트 ID $seq" to healthy
  }

  /** SDK 주행 화면 위 우측 상단의 작은 진단 문구. 터치는 아래 SDK 화면으로 그대로 전달된다. 디버그 빌드 전용 */
  fun attachDiag(activity: Activity, container: FrameLayout) {
    if (!enabled) return
    begin()
    val d = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * d).toInt()
    val view = TextView(activity).apply {
      setTextColor(Color.WHITE); textSize = 11f; typeface = Typeface.MONOSPACE
      setPadding(dp(8), dp(6), dp(8), dp(6))
      background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(Color.parseColor("#B3000000")) }
      isClickable = false; isFocusable = false
    }
    container.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.END or Gravity.TOP).apply {
      marginEnd = dp(8); topMargin = dp(150)
    })
    val railReceiver = registerDebugRailReceiver(activity)
    val tick = object : Runnable {
      override fun run() {
        if (activity.isFinishing || activity.isDestroyed) {
          runCatching { activity.unregisterReceiver(railReceiver) }
          return
        }
        val (text, healthy) = overlayState()
        view.text = text
        view.setTextColor(if (healthy) Color.parseColor("#7CFC9A") else Color.parseColor("#FF6B6B"))
        view.postDelayed(this, 1000)
      }
    }
    view.post(tick)
    Log.i(TAG, "diag overlay attached session=$session")
  }

  // ── 위험 레일 Mock 주입(디버그 빌드 전용) ───────────────────────────────────────────────
  // 백엔드 위험 API 와 실제 위치 없이 오버레이를 확인한다. 예:
  //   adb shell am broadcast -a com.tikkeuldata.app.DEBUG_RAIL -p com.tikkeuldata.app --es scenario all
  //   --es scenario 값: all | three | five | neutral | one | clear   (--es json '<스냅샷 JSON>' 도 가능)
  private const val RAIL_ACTION = "com.tikkeuldata.app.DEBUG_RAIL"
  private fun railItem(key: String, type: String, zone: String?, p: String, emphasis: String, dist: Int, stage: String) =
    """{"key":"$key","type":"$type","zoneType":${if (zone == null) "null" else "\"$zone\""},"priority":"$p","emphasis":"$emphasis","distanceM":$dist,"stage":"$stage"}"""
  private val RAIL_ACCIDENT = railItem("acc", "accident", null, "P0", "strong", 450, "caution")
  private val RAIL_WORKS = railItem("con", "construction", null, "P1", "normal", 1200, "advance")
  private val RAIL_ZONE = railItem("zone", "school_zone", "child", "P2", "normal", 300, "approach")
  private val RAIL_PRONE = railItem("prone", "accident_prone", null, "P2", "normal", 1500, "advance")
  private val RAIL_JAM = railItem("jam", "congestion", null, "P3", "neutral", 1800, "advance")
  private val RAIL_SCENARIOS = mapOf(
    "all" to """{"v":1,"items":[$RAIL_ACCIDENT,$RAIL_WORKS,$RAIL_ZONE],"overflow":2}""",
    "three" to """{"v":1,"items":[$RAIL_ACCIDENT,$RAIL_WORKS,$RAIL_ZONE],"overflow":0}""",
    "five" to """{"v":1,"items":[$RAIL_ACCIDENT,$RAIL_WORKS,$RAIL_ZONE,$RAIL_PRONE,$RAIL_JAM],"overflow":0}""",
    "neutral" to """{"v":1,"items":[$RAIL_JAM],"overflow":0}""",
    // 이름 표시 검증: 보호구역 subtype(노인·장애인), 사고다발구역·정체 이름
    "senior" to """{"v":1,"items":[${railItem("zone", "school_zone", "senior", "P2", "normal", 800, "advance")}],"overflow":0}""",
    "disabled" to """{"v":1,"items":[${railItem("zone", "school_zone", "disabled", "P2", "normal", 800, "advance")}],"overflow":0}""",
    "mix" to """{"v":1,"items":[$RAIL_PRONE,$RAIL_JAM,${railItem("zone", "school_zone", "disabled", "P2", "normal", 800, "advance")}],"overflow":0}""",
    "one" to """{"v":1,"items":[$RAIL_WORKS],"overflow":0}""",
    "clear" to """{"v":1,"items":[],"overflow":0}""",
  )

  private fun registerDebugRailReceiver(activity: Activity): BroadcastReceiver {
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        // 배치 검증: --es signs real|0|1|2 (단속 표지 흉내), --es lane on|off (차선 안내 흉내)
        intent.getStringExtra("signs")?.let { v ->
          Log.i(TAG, "debug signs=$v")
          HazardRail.current()?.debugSetSigns(if (v == "real") null else v.toIntOrNull()?.coerceIn(0, 2))
        }
        // 시뮬레이션 제어: --es simctl speed --ei v <배속> | jump --ef rate <0~1 경로 진행률> | pause | resume | next | prev
        intent.getStringExtra("simctl")?.let { cmd ->
          val g = simGuidance
          if (g == null) { Log.w(TAG, "simctl $cmd: 시뮬레이션 안내가 아님"); return@let }
          when (cmd) {
            "speed" -> g.setSimulationSpeed(intent.getIntExtra("v", 1))
            "jump" -> g.jumpSimulWithRate(intent.getFloatExtra("rate", 0f))
            "pause" -> g.pauseSimul()
            "resume" -> g.resumeSimul()
            "next" -> g.jumpSimulWithAction(KNSimulAction.KNSimulAction_Next)
            "prev" -> g.jumpSimulWithAction(KNSimulAction.KNSimulAction_Previous)
            else -> Log.w(TAG, "simctl: unknown '$cmd'")
          }
          Log.i(TAG, "simctl $cmd v=${intent.getIntExtra("v", -1)} rate=${intent.getFloatExtra("rate", -1f)} speedNow=${g.simulSpeed}")
        }
        intent.getStringExtra("lane")?.let { v ->
          Log.i(TAG, "debug lane=$v")
          HazardRail.current()?.debugSetLane(v == "on")
        }
        val name = intent.getStringExtra("scenario")
        val json = intent.getStringExtra("json") ?: name?.let { RAIL_SCENARIOS[it] }
        if (json == null) { if (name != null) Log.w(TAG, "debug rail: unknown scenario '$name'. use ${RAIL_SCENARIOS.keys}"); return }
        Log.i(TAG, "debug rail: ${name ?: "json"}")
        HazardRail.set(json)
      }
    }
    val filter = IntentFilter(RAIL_ACTION)
    // adb(shell)에서 보내려면 export 되어야 한다. 이 코드는 디버그 빌드(enabled)에서만 실행된다.
    if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else activity.registerReceiver(receiver, filter)
    return receiver
  }

  // ── 주행 시뮬레이션(디버그 빌드 전용) ─────────────────────────────────────────────────
  // 실내처럼 실제로 움직일 수 없을 때 카카오 SDK 의 공식 시뮬레이션 안내(KNSDK.sharedSimulGuidance)로 주행을 시작한다.
  // SDK 지도·차량·회전 안내가 실제처럼 움직이고, 그 위치가 그대로 JS 위험 로직(→ 위험 레일)에 들어간다.
  // 다음 안내 시작부터 적용된다(진행 중인 안내는 바뀌지 않는다). 켜기/끄기:
  //   adb shell am broadcast -a com.tikkeuldata.app.DEBUG_SIM -p com.tikkeuldata.app --es mode on|off
  @Volatile private var simulate = false
  private var simReceiver: BroadcastReceiver? = null
  private var simContext: Context? = null

  fun simulationRequested(): Boolean = enabled && simulate

  /** 지금 진행 중인 SDK 시뮬레이션 안내(Activity 가 넣고 빼는다). 속도·위치 점프·일시정지를 adb 로 제어한다 */
  @Volatile var simGuidance: KNSimulGuidance? = null

  /** 앱 프로세스 단위로 한 번 등록한다(모듈이 다시 만들어지면 이전 것을 해제하고 다시 등록) */
  fun registerSimReceiver(context: Context) {
    if (!enabled) return
    simReceiver?.let { receiver -> simContext?.let { old -> runCatching { old.unregisterReceiver(receiver) } } }
    simContext = context.applicationContext
    val receiverContext = context.applicationContext
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context, intent: Intent) {
        simulate = intent.getStringExtra("mode") == "on"
        Log.i(TAG, "simulation " + (if (simulate) "ON" else "OFF") + " (다음 안내 시작부터)")
      }
    }
    val filter = IntentFilter("com.tikkeuldata.app.DEBUG_SIM")
    if (Build.VERSION.SDK_INT >= 33) receiverContext.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else receiverContext.registerReceiver(receiver, filter)
    simReceiver = receiver
  }

  fun observe(event: Map<String, Any?>) {
    if (!enabled || NavigationSession.spike == null) return
    if (session == 0) begin()
    if (event["kind"] == "location") {
      val id = recordEmit(android.os.SystemClock.elapsedRealtime())
      NavigationSession.spike?.invoke(mapOf(
        "kind" to "location", "session" to session, "id" to id,
        "speedKmh" to event["speedKmh"], "hdop" to event["hdop"], "valid" to event["valid"],
      ))
    } else if (event["kind"] == "route") {
      NavigationSession.spike?.invoke(mapOf(
        "kind" to "route", "reason" to event["reason"], "count" to event["count"], "keys" to event["keys"],
      ))
    }
  }

  fun dispose() {
    simReceiver?.let { receiver -> simContext?.let { context -> runCatching { context.unregisterReceiver(receiver) } } }
    simReceiver = null
    simContext = null
    simGuidance = null
    simulate = false
  }

  // 왼쪽 세로 레일 모양의 더미 오버레이. SDK UI·차량 아이콘 버튼과 겹치는지 화면 캡처로 확인한다.
  fun attachRail(activity: Activity, container: FrameLayout) {
    if (activity.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE == 0) return // 디버그 빌드 전용
    val d = activity.resources.displayMetrics.density
    fun dp(v: Int) = (v * d).toInt()
    val rail = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    listOf("#DC2626" to "사고", "#F59E0B" to "공사", "#6B7280" to "?").forEach { (color, label) ->
      rail.addView(TextView(activity).apply {
        text = label; setTextColor(Color.WHITE); textSize = 12f; gravity = Gravity.CENTER
        background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(Color.parseColor(color)); setStroke(dp(2), Color.WHITE) }
      }, LinearLayout.LayoutParams(dp(48), dp(48)).apply { bottomMargin = dp(8) })
    }
    container.addView(rail, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.START or Gravity.TOP).apply {
      marginStart = dp(12); topMargin = dp(150)
    })
    Log.i(TAG, "spike rail attached")
  }
}
