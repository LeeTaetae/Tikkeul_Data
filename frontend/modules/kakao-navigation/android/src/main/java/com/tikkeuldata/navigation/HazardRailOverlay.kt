package com.tikkeuldata.navigation

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

// 카카오 SDK 주행 화면 왼쪽 위험 레일. JS(useNativeHazardRail)가 판단해서 만든 스냅샷(JSON)을 그리기만 한다.
// 위험 판정·우선순위·단계는 JS 로직이고 여기에는 없다. 스냅샷은 매번 전체 상태를 교체한다(통과한 위험은 목록에서 빠지면 사라진다).
// SDK 뷰는 읽기만 하고 수정·제거하지 않는다. 우리 컨테이너에 얹는다. 터치는 아래 SDK 화면으로 그대로 전달된다.
//
// 배치: SDK 가 왼쪽 열에 속도 → 단속 표지 1 → 단속 표지 2 를 위에서 아래로 쌓는다. 레일은 그 열의 다음 칸이다.
//   레일 시작 = 보이는 왼쪽 열 요소의 실제 하단 + 16dp (표지가 사라지면 위로 올라온다).
//   차량 아이콘 버튼은 평소 자리(세로 중앙)에 두고, 레일이 닿을 때만 레일 바로 아래로 민다. 레일이 없어지면 원래 자리로 돌아간다.
//   아래쪽은 차선 안내·하단 바 등 보이는 요소의 상단이 한계이고, 차량 버튼까지 그 안에 들어오도록 레일 칸 수를 먼저 줄인다.
//   SDK 뷰 id 를 못 찾으면 상단 기준 고정 위치(최악의 쌓임 아래)로 대체한다. 하단 고정은 쓰지 않는다.

/** JS → 네이티브 스냅샷의 보관소. 오버레이가 아직 없을 때 온 마지막 스냅샷은 오버레이가 붙을 때 그려진다 */
internal object HazardRail {
  const val MAX_JSON = 16_384
  private var overlay: HazardRailOverlay? = null
  private var last: String? = null

  @Synchronized fun attach(target: HazardRailOverlay) { overlay = target; last?.let { target.render(it) } }
  /** 주행 화면이 닫히면 오버레이와 마지막 스냅샷을 버린다(다음 주행에 지난 위험이 남지 않게) */
  @Synchronized fun detach(target: HazardRailOverlay) { if (overlay === target) { overlay = null; last = null } }
  @Synchronized fun set(json: String) {
    if (json.length > MAX_JSON) { Log.w("TikkeulRail", "snapshot too large: ${json.length}"); return }
    last = json
    overlay?.render(json)
  }
  @Synchronized fun clear() { last = null; overlay?.render(null) }
  /** 디버그 주입(SpikeProbe)용 */
  @Synchronized fun current(): HazardRailOverlay? = overlay
}

internal class HazardRailOverlay(private val activity: Activity, private val language: String) {
  private class Item(val key: String, val type: String, val zoneType: String?, val emphasis: String, val distanceM: Int, val detail: String)
  /** JS(useHazardWarning)가 단계마다 한 번만 만든 안내. 같은 key 는 한 번만 보여 준다 */
  private class Warning(val key: String, val text: String)
  private class Data(val items: List<Item>, val overflow: Int, val warning: Warning?)
  /** tiles==0 이면 숨김. pill=+N 알약, badge=마지막 칸 위의 +N 배지(알약이 안 들어갈 때). top=컨테이너 기준 레일 시작, carShift=차량 버튼을 밀 거리 */
  private data class Plan(val tiles: Int, val pill: Boolean, val badge: Boolean, val top: Int, val carShift: Int, val level: Int = 0)

  private data class Tone(val tint: Int, val accent: Int, val strong: Int)
  /** 카드 치수(dp). nameH=이름 영역 높이(영어는 2줄), distH=거리 줄 높이 */
  private data class Size(
    val icon: Int, val nameSp: Int, val distSp: Float, val padTop: Int, val padBottom: Int,
    val nameH: Int, val distH: Int, val gap: Int, val moreH: Int, val lines: Int,
  ) { val tileH: Int get() = padTop + icon + 2 + nameH + 1 + distH + padBottom }

  private val tag = "TikkeulRail"
  private val density = activity.resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()
  private val handler = Handler(Looper.getMainLooper())
  // 배지가 칸 바깥(오른쪽 위)에 걸치므로 자식 그리기를 자르지 않는다
  // 컨테이너가 열 폭으로 자식 그리기를 자르므로, 배지가 걸치는 위·오른쪽에 여유 폭(BADGE_PAD_DP)을 둔다. 위쪽 여유는 배치 때 위치를 빼서 보정한다.
  private val column = LinearLayout(activity).apply {
    orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false
    setPadding(0, dp(BADGE_PAD_DP), dp(BADGE_PAD_DP), 0)
  }
  private var container: FrameLayout? = null
  private var carButton: View? = null
  private var data: Data? = null
  private var applied: Plan? = null
  private var appliedKey: String? = null
  private var alive = false
  private var layoutListener: android.view.ViewTreeObserver.OnGlobalLayoutListener? = null
  private val idCache = HashMap<String, Int>()
  private var commitPending = false
  private val commitRunnable = Runnable { commitPending = false; commit(false) }
  private val ticker = object : Runnable {
    override fun run() {
      if (!alive) return
      relayout(false) // SDK 표시 상태가 레이아웃 변화 없이 바뀐 경우를 위한 안전망
      handler.postDelayed(this, TICK_MS)
    }
  }

  // ── 디버그 주입(SpikeProbe, 디버그 빌드 전용) ───────────────────────────────────────────
  private enum class DebugKind { SIGN, BOTTOM }
  private class DebugObstacle(val kind: DebugKind, val view: View)
  private val debugIgnored = mutableSetOf<String>()
  private val debugObstacles = mutableListOf<DebugObstacle>()

  fun attach(target: FrameLayout) {
    container = target
    alive = true
    target.addView(column, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.START or Gravity.TOP).apply {
      marginStart = dp(LEFT_DP)
    })
    column.visibility = View.GONE
    layoutListener = android.view.ViewTreeObserver.OnGlobalLayoutListener { relayout(false) }.also { target.viewTreeObserver.addOnGlobalLayoutListener(it) }
    handler.postDelayed(ticker, TICK_MS)
    HazardRail.attach(this)
  }

  /** 차량 아이콘 버튼. 레일이 닿을 때만 아래로 민다(translationY 만 바꾼다. 클릭 동작·레이아웃은 그대로) */
  fun setCarButton(view: View?) { carButton = view; relayout(true) }

  fun detach() {
    alive = false
    handler.removeCallbacksAndMessages(null)
    HazardRail.detach(this)
    carButton?.animate()?.cancel(); carButton?.translationY = 0f
    layoutListener?.let { container?.viewTreeObserver?.removeOnGlobalLayoutListener(it) }
    layoutListener = null
    container?.removeView(column)
    hideDetail(); hideWarning()
    debugObstacles.forEach { container?.removeView(it.view) }
    debugObstacles.clear()
    container = null
  }

  /** null 이면 비운다. 어느 스레드에서 불러도 UI 스레드에서 처리한다 */
  fun render(json: String?) {
    val parsed = runCatching { parse(json) }.onFailure { Log.w(tag, "parse failed: ${it.javaClass.simpleName} ${it.message}") }.getOrNull()
    activity.runOnUiThread { data = parsed; relayout(true); showWarning(parsed?.warning); refreshDetail() }
  }

  private fun parse(json: String?): Data? {
    if (json == null) return null
    val root = JSONObject(json)
    if (root.optInt("v") != 1) return null
    val arr = root.optJSONArray("items") ?: return null
    val items = (0 until arr.length()).map { arr.getJSONObject(it).let { o -> Item(o.optString("key"), o.optString("type"), if (o.isNull("zoneType")) null else o.optString("zoneType").ifEmpty { null }, o.optString("emphasis", "normal"), o.optInt("distanceM", 0), o.optString("detail")) } }
    val warning = root.optJSONObject("warning")?.let { w -> Warning(w.optString("key"), w.optString("text")).takeIf { it.key.isNotEmpty() && it.text.isNotEmpty() } }
    return Data(items, root.optInt("overflow", 0), warning)
  }

  // ── 배치 ─────────────────────────────────────────────────────────────────────────────
  /** immediate: 데이터가 바뀐 경우. SDK 레이아웃 변화는 잠깐 흔들릴 수 있어 짧게 모아서(디바운스) 반영한다 */
  private fun relayout(immediate: Boolean) {
    if (!alive) return
    val c = container ?: return
    if (c.width <= 0 || c.height <= 0) return
    if (immediate) { handler.removeCallbacks(commitRunnable); commitPending = false; commit(true); return }
    if (planFor(c) == applied) { handler.removeCallbacks(commitRunnable); commitPending = false; return }
    if (!commitPending) { commitPending = true; handler.postDelayed(commitRunnable, DEBOUNCE_MS) }
  }

  /** force: 데이터가 바뀐 경우(같은 배치여도 내용을 다시 그린다) */
  private fun commit(force: Boolean) {
    val c = container ?: return
    if (!alive || c.width <= 0 || c.height <= 0) return
    val plan = planFor(c)
    val previous = applied
    if (plan == previous && !force) return
    applied = plan
    val d = data
    val key = if (d == null || plan.tiles == 0) "" else "${d.items.take(plan.tiles).joinToString { "${it.key}/${it.type}/${it.zoneType}/${it.emphasis}/${it.distanceM}/${it.detail.hashCode()}" }}|${plan.level}|${plan.pill}|${plan.badge}|${d.items.size - plan.tiles + d.overflow}"
    if (key != appliedKey) { appliedKey = key; rebuild(d, plan) }
    column.visibility = if (plan.tiles == 0) View.GONE else View.VISIBLE
    val firstShow = previous == null || previous.tiles == 0
    move(column, (plan.top - dp(BADGE_PAD_DP)).toFloat(), animate = !firstShow)
    carButton?.let { move(it, plan.carShift.toFloat(), animate = true) }
    if (plan != previous) Log.i(tag, "plan tiles=${plan.tiles} level=${plan.level} pill=${plan.pill} badge=${plan.badge} topDp=${plan.top / density} carShiftDp=${plan.carShift / density}")
  }

  private fun move(view: View, y: Float, animate: Boolean) {
    if (Math.abs(view.translationY - y) < dp(2)) return
    view.animate().cancel()
    if (animate) view.animate().translationY(y).setDuration(MOVE_MS).start() else view.translationY = y
  }

  private fun planFor(c: FrameLayout): Plan {
    val d = data
    if (d == null || d.items.isEmpty()) return Plan(0, false, false, 0, 0)
    val strip = Rect(dp(LEFT_DP), 0, dp(LEFT_DP + TILE_W_DP), 0)
    val stackBottom = stackBottom(c, strip)
    val limit = bottomLimit(c, strip, stackBottom ?: 0)
    val car = carButton?.takeIf { it.height > 0 }
    val carTop = car?.top
    val carH = car?.height ?: 0
    val candidate = place(d, stackBottom, limit, carTop, carH, 0, MAX_TILES, 0)
    val prev = applied
    if (prev == null || prev.tiles == 0) return candidate
    // 칸 수가 늘거나 카드가 다시 커질 때는 여유(8dp)를 두고 판단한다: 한계 근처에서 번갈아 바뀌며 흔들리지 않게 한다
    val growing = candidate.tiles > prev.tiles || (candidate.tiles == prev.tiles && candidate.level < prev.level)
    if (!growing) return candidate
    val safe = place(d, stackBottom, limit, carTop, carH, dp(GROW_MARGIN_DP), MAX_TILES, 0)
    val safeGrows = safe.tiles > prev.tiles || (safe.tiles == prev.tiles && safe.level < prev.level)
    return if (safeGrows) safe else place(d, stackBottom, limit, carTop, carH, 0, prev.tiles, prev.level)
  }

  /**
   * 가장 많이 들어가는 칸 수를 고른다. 위에서부터(우선순위 순) 자르므로 우선순위 높은 위험이 남는다.
   * 칸 수를 줄이기 전에 카드를 먼저 압축(작은 글자·아이콘)해 본다. minLevel 이상의 크기만 쓴다.
   */
  private fun place(d: Data, stackBottom: Int?, limit: Int, carTop: Int?, carH: Int, margin: Int, maxTiles: Int, minLevel: Int): Plan {
    val fallback = stackBottom == null
    val sizes = sizes()
    var top = if (fallback) dp(FALLBACK_TOP_DP) else stackBottom!! + dp(STACK_GAP_DP)
    // 대체 모드: 차량 버튼은 밀지 않으므로, 버튼이 원래 자리에서 레일과 겹치면 그 아래에서 시작한다
    if (fallback && carTop != null && top < carTop + carH + dp(CAR_GAP_DP) && top + dp(sizes[0].tileH) > carTop) top = carTop + carH + dp(CAR_GAP_DP)
    val k = minOf(d.items.size, maxTiles)
    for (n in k downTo 1) {
      for (level in minLevel until sizes.size) {
        val s = sizes[level]
        val needMore = d.overflow > 0 || d.items.size > n
        val variants = if (needMore) listOf(true to false, false to true) else listOf(false to false)
        for ((pill, badge) in variants) {
          val height = n * dp(s.tileH + s.gap) - dp(s.gap) + (if (pill) dp(s.gap + s.moreH) else 0)
          val bottom = top + height
          val shift = if (fallback || carTop == null) 0 else maxOf(0, bottom + dp(CAR_GAP_DP) - carTop)
          val carBottom = if (carTop == null) 0 else carTop + shift + carH
          // 차량 버튼이 밀릴 때만 버튼의 새 위치가 한계 안에 들어와야 한다(안 밀리면 기존 위치는 우리 책임이 아니다)
          val fits = bottom <= limit - margin && (shift == 0 || carBottom <= limit - margin)
          if (fits) return Plan(n, pill, badge, top, shift, level)
        }
      }
    }
    return Plan(0, false, false, top, 0, minLevel)
  }

  private fun visible(v: View) = v.isShown && v.width > 0 && v.height > 0 && v.alpha > 0.05f

  /** 컨테이너 기준 영역 */
  private fun rectOf(c: View, v: View): Rect {
    val a = IntArray(2); val b = IntArray(2)
    v.getLocationInWindow(a); c.getLocationInWindow(b)
    val left = a[0] - b[0]; val top = a[1] - b[1]
    return Rect(left, top, left + v.width, top + v.height)
  }

  private fun sdkView(c: FrameLayout, name: String): View? {
    if (name in debugIgnored) return null
    val id = idCache.getOrPut(name) { activity.resources.getIdentifier(name, "id", activity.packageName) }
    return if (id == 0) null else c.findViewById(id)
  }

  /** 보이는 자손까지 포함한 실제 하단(표지 안의 카메라 잔여 거리 같은 부속 요소가 영역 밖으로 나올 수 있다) */
  private fun deepBottom(c: View, v: View, depth: Int = 0): Int {
    var bottom = rectOf(c, v).bottom
    if (v is ViewGroup && depth < 4) for (i in 0 until v.childCount) {
      val child = v.getChildAt(i)
      if (visible(child)) bottom = maxOf(bottom, deepBottom(c, child, depth + 1))
    }
    return bottom
  }

  /** SDK 왼쪽 열(속도·단속 표지 등) 중 보이는 요소의 가장 큰 하단. SDK 뷰를 하나도 못 찾으면 null(대체 배치) */
  private fun stackBottom(c: FrameLayout, strip: Rect): Int? {
    var found = false
    var bottom = Int.MIN_VALUE
    for (name in LEFT_STACK) {
      val v = sdkView(c, name) ?: continue
      found = true
      if (!visible(v)) continue
      val r = rectOf(c, v)
      if (r.right <= strip.left || r.left >= strip.right) continue
      bottom = maxOf(bottom, if (name.startsWith("component_sign")) deepBottom(c, v) else r.bottom)
    }
    for (o in debugObstacles) if (o.kind == DebugKind.SIGN && visible(o.view)) { found = true; bottom = maxOf(bottom, rectOf(c, o.view).bottom) }
    return if (!found || bottom == Int.MIN_VALUE) null else bottom
  }

  /** 아래쪽 한계: 레일 아래로 보이는 요소(차선 안내·하단 바·열린 패널 등)의 가장 높은 상단 − 8dp */
  private fun bottomLimit(c: FrameLayout, strip: Rect, above: Int): Int {
    var limit = Int.MAX_VALUE
    var any = false
    for (name in BOTTOM_BLOCKERS) {
      val v = sdkView(c, name) ?: continue
      if (!visible(v)) continue
      val r = rectOf(c, v)
      if (r.right <= strip.left || r.left >= strip.right || r.top < above) continue
      limit = minOf(limit, r.top); any = true
    }
    for (o in debugObstacles) if (o.kind == DebugKind.BOTTOM && visible(o.view)) {
      val r = rectOf(c, o.view)
      if (r.right > strip.left && r.left < strip.right) { limit = minOf(limit, r.top); any = true }
    }
    // 우리 컨테이너의 다른 뷰(차량 아이콘 선택 패널 등). 레일·차량 버튼·SDK 전체 뷰·디버그 뷰는 제외한다.
    for (i in 0 until c.childCount) {
      val child = c.getChildAt(i)
      if (child === column || child === carButton || !visible(child)) continue
      if (child.width >= c.width && child.height >= c.height) continue
      if (debugObstacles.any { it.view === child }) continue
      val r = rectOf(c, child)
      if (r.right <= strip.left || r.left >= strip.right || r.top < above) continue
      limit = minOf(limit, r.top); any = true
    }
    val screenLimit = c.height - dp(NO_BLOCKER_RESERVE_DP)
    return (if (any) minOf(limit - dp(CAR_GAP_DP), c.height) else screenLimit)
  }

  // ── 그리기 ───────────────────────────────────────────────────────────────────────────
  private fun rebuild(d: Data?, plan: Plan) {
    column.removeAllViews()
    if (d == null || plan.tiles == 0) return
    val size = sizes()[plan.level]
    val more = d.overflow + (d.items.size - plan.tiles)
    for (i in 0 until plan.tiles) column.addView(itemView(d.items[i], size, if (plan.badge && i == plan.tiles - 1) more else 0))
    if (plan.pill) column.addView(moreView(more, size))
  }

  /** 카드 크기 두 단계: 0=보통, 1=압축. 영어는 이름이 길어 2줄 높이를 둔다. dp 로 정해 사용자 글꼴 배율에 카드가 커지지 않게 한다 */
  private fun sizes(): List<Size> {
    val lines = if (language == "en") 2 else 1
    return listOf(
      Size(icon = 22, nameSp = 10, distSp = 10f, padTop = 6, padBottom = 5, nameH = 13 * lines, distH = 13, gap = 8, moreH = 28, lines = lines),
      Size(icon = 18, nameSp = 9, distSp = 9f, padTop = 4, padBottom = 4, nameH = 12 * lines, distH = 12, gap = 6, moreH = 24, lines = lines),
    )
  }

  // ── 아이콘 선택 상세 / 단계 안내 배너 ─────────────────────────────────────────────────────
  // 둘 다 JS 가 보낸 문장을 보여 줄 뿐이다. 터치를 가로채는 것은 카드·상세·배너 자신뿐이고 나머지는 SDK 화면으로 간다.
  private var detailKey: String? = null
  private var detailTop = 0
  private var detailView: View? = null
  private var warningView: View? = null
  private var shownWarningKey: String? = null
  private val hideDetailRunnable = Runnable { hideDetail() }
  private val hideWarningRunnable = Runnable { hideWarning() }

  private fun toggleDetail(key: String, tile: View) {
    if (detailKey == key) { hideDetail(); return }
    detailKey = key
    showDetail(tile, detailTop)
  }

  private fun showDetail(tile: View, keepTop: Int? = null) {
    val c = container ?: return
    val item = data?.items?.firstOrNull { it.key == detailKey } ?: return hideDetail()
    detailView?.let { c.removeView(it) }
    // 갱신 때는 방금 다시 만든 카드가 아직 배치되기 전이라 위치를 처음 열 때 값으로 유지한다
    val top = keepTop ?: rectOf(c, tile).top.coerceIn(0, maxOf(0, c.height - dp(200)))
    detailTop = top
    val panel = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.WHITE); setStroke(dp(2), (TONES[item.type] ?: TONES.getValue("accident")).accent) }
      isClickable = true
      setOnClickListener { hideDetail() }
      addView(TextView(activity).apply {
        text = "${nameOf(item)} · ${formatDistance(item.distanceM)}"; setTextColor(INK); textSize = 15f; typeface = Typeface.DEFAULT_BOLD
      })
      if (item.detail.isNotEmpty()) addView(TextView(activity).apply {
        text = item.detail; setTextColor(INK); textSize = 13f
      }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
    }
    val maxW = minOf(dp(280), c.width - dp(LEFT_DP + TILE_W_DP + 16 + 12))
    c.addView(panel, FrameLayout.LayoutParams(maxW, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.START or Gravity.TOP).apply {
      marginStart = dp(LEFT_DP + TILE_W_DP + 8)
      topMargin = top
    })
    detailView = panel
    handler.removeCallbacks(hideDetailRunnable)
    handler.postDelayed(hideDetailRunnable, DETAIL_MS)
  }

  /** 스냅샷이 바뀌었을 때: 선택한 위험이 지나갔거나(목록에서 빠짐) 가려졌으면 닫고, 아니면 거리·문장을 갱신한다 */
  private fun refreshDetail() {
    val key = detailKey ?: return
    val index = data?.items?.indexOfFirst { it.key == key } ?: -1
    val tile = if (index in 0 until column.childCount) column.getChildAt(index) else null
    if (index < 0 || tile == null) { hideDetail(); return }
    showDetail(tile)
  }

  private fun hideDetail() {
    handler.removeCallbacks(hideDetailRunnable)
    detailView?.let { (it.parent as? ViewGroup)?.removeView(it) }
    detailView = null; detailKey = null
  }

  private fun showWarning(w: Warning?) {
    if (w == null) { return } // 같은 안내는 사라질 때까지 두지 않는다: 표시는 일정 시간 뒤 스스로 닫힌다
    if (w.key == shownWarningKey) return // 같은 위험의 같은 단계는 한 번만
    val c = container ?: return
    shownWarningKey = w.key
    hideWarning()
    val directionBottom = listOf("component_cur_direction", "component_next_direction").mapNotNull { sdkView(c, it)?.takeIf { v -> visible(v) } }.maxOfOrNull { rectOf(c, it).bottom } ?: 0
    val top = maxOf(directionBottom, WeatherSafetyOverlay.visibleBottomPx(), dp(FALLBACK_BANNER_TOP_DP)) + dp(8)
    val banner = TextView(activity).apply {
      text = w.text; setTextColor(Color.WHITE); textSize = 16f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
      contentDescription = w.text
      setPadding(dp(14), dp(10), dp(14), dp(10))
      background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.parseColor("#DC2626")) }
      isClickable = true
      setOnClickListener { hideWarning() }
    }
    c.addView(banner, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
      topMargin = top; marginStart = dp(16); marginEnd = dp(16)
    })
    warningView = banner
    handler.postDelayed(hideWarningRunnable, WARNING_MS)
  }

  private fun hideWarning() {
    handler.removeCallbacks(hideWarningRunnable)
    warningView?.let { (it.parent as? ViewGroup)?.removeView(it) }
    warningView = null
  }

  private fun itemView(item: Item, size: Size, badgeCount: Int): FrameLayout {
    val type = item.type
    val tone = TONES[type] ?: TONES.getValue("accident")
    val (fill, fg, stroke) = when (item.emphasis) {
      "strong" -> Triple(tone.strong, Color.WHITE, Color.WHITE)
      "normal" -> Triple(tone.tint, tone.accent, tone.accent)
      else -> Triple(NEUTRAL_FILL, NEUTRAL_FG, NEUTRAL_FG)
    }
    val distance = formatDistance(item.distanceM)
    val name = nameOf(item)
    return FrameLayout(activity).apply {
      clipChildren = false; clipToPadding = false
      background = GradientDrawable().apply {
        cornerRadius = dp(12).toFloat(); setColor(fill)
        if (item.emphasis == "neutral" || item.emphasis.isEmpty()) setStroke(dp(2), stroke, dp(4).toFloat(), dp(3).toFloat()) else setStroke(dp(2), stroke)
      }
      contentDescription = "$name $distance"
      isClickable = true; isFocusable = true
      setOnClickListener { toggleDetail(item.key, this) }
      // 위에서부터 아이콘 → 위험 유형 이름 → 거리
      addView(LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(2), dp(size.padTop), dp(2), dp(size.padBottom))
        addView(ImageView(activity).apply {
          setImageResource(iconOf(type)); imageTintList = ColorStateList.valueOf(fg)
        }, LinearLayout.LayoutParams(dp(size.icon), dp(size.icon)))
        addView(TextView(activity).apply {
          text = name; setTextColor(fg); typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
          includeFontPadding = false; maxLines = size.lines
          // 카드 폭 안에 들어가도록 글자를 줄인다(긴 이름: 어린이보호구역, Accident-prone area 등). 작은 글자는 7dp 까지.
          setAutoSizeTextTypeUniformWithConfiguration(7, size.nameSp, 1, TypedValue.COMPLEX_UNIT_DIP)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(size.nameH)).apply { topMargin = dp(2) })
        addView(TextView(activity).apply {
          text = distance; setTextColor(fg); setTextSize(TypedValue.COMPLEX_UNIT_DIP, size.distSp); typeface = Typeface.DEFAULT_BOLD
          gravity = Gravity.CENTER; includeFontPadding = false; maxLines = 1
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(size.distH)).apply { topMargin = dp(1) })
      }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
      if (badgeCount > 0) addView(TextView(activity).apply {
        text = "+$badgeCount"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_DIP, 10f); typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER; includeFontPadding = false
        background = GradientDrawable().apply { cornerRadius = dp(9).toFloat(); setColor(INK); setStroke(dp(1), Color.WHITE) }
        setPadding(dp(4), 0, dp(4), 0)
        contentDescription = "+$badgeCount"
      }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, dp(18), Gravity.TOP or Gravity.END).apply { topMargin = -dp(6); marginEnd = -dp(4) })
      layoutParams = LinearLayout.LayoutParams(dp(TILE_W_DP), dp(size.tileH)).apply { bottomMargin = dp(size.gap) }
    }
  }

  private fun moreView(count: Int, size: Size) = TextView(activity).apply {
    text = "+$count"; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_DIP, if (size.moreH >= 28) 14f else 12f); typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
    background = GradientDrawable().apply { cornerRadius = dp(size.moreH / 2).toFloat(); setColor(INK) }
    contentDescription = "+$count"
    layoutParams = LinearLayout.LayoutParams(dp(TILE_W_DP), dp(size.moreH))
  }

  /** 보호구역은 실제 subtype(어린이·노인·장애인)에 맞는 이름을, 나머지는 유형 이름을 쓴다. subtype 을 모르면 "보호구역" */
  private fun nameOf(item: Item): String {
    if (item.type == "school_zone") {
      val names = ZONE_NAMES[language] ?: ZONE_NAMES.getValue("ko")
      return names[item.zoneType ?: "unknown"] ?: names.getValue("unknown")
    }
    return label(item.type)
  }

  private fun iconOf(type: String) = when (type) {
    "construction" -> R.drawable.tikkeul_hazard_construction
    "congestion" -> R.drawable.tikkeul_hazard_congestion
    "school_zone" -> R.drawable.tikkeul_hazard_school_zone
    else -> R.drawable.tikkeul_hazard_accident // accident, accident_prone: 프로젝트 JS 아이콘과 같이 같은 모양, 색으로 구분한다
  }

  private fun formatDistance(m: Int) = if (m >= 1000) String.format(java.util.Locale.US, "%.1fkm", m / 1000.0) else "${m}m"

  private fun label(type: String): String = (LABELS[language] ?: LABELS.getValue("ko"))[type] ?: type

  // ── 디버그: SDK 가 띄우는 상태(표지 개수·차선 안내)를 흉내 내 배치를 검증한다. SPIKE(임시, 디버그 빌드 전용) ────────────────
  /** signs: null=SDK 실제 표지 사용, 0/1/2=실제 표지를 무시하고 그 개수만큼 가짜 표지(86dp)를 SDK 규칙(속도 아래 16dp 간격)대로 쌓는다 */
  fun debugSetSigns(count: Int?) {
    val c = container ?: return
    activity.runOnUiThread {
      debugObstacles.filter { it.kind == DebugKind.SIGN }.forEach { c.removeView(it.view) }
      debugObstacles.removeAll { it.kind == DebugKind.SIGN }
      debugIgnored.removeAll(setOf("component_sign_first", "component_sign_second"))
      if (count != null) {
        debugIgnored.addAll(setOf("component_sign_first", "component_sign_second"))
        val speed = sdkView(c, "component_speed")?.takeIf { visible(it) }
        var top = (speed?.let { rectOf(c, it).bottom } ?: dp(182)) + dp(STACK_GAP_DP)
        repeat(count) { i ->
          val box = debugBox(c, "debug-sign-${i + 1}", "표지${i + 1}", "#B3DB2777")
          c.addView(box, FrameLayout.LayoutParams(dp(86), dp(86), Gravity.START or Gravity.TOP).apply { marginStart = dp(8); topMargin = top })
          debugObstacles.add(DebugObstacle(DebugKind.SIGN, box))
          top += dp(86 + STACK_GAP_DP)
        }
      }
      relayout(true)
    }
  }

  /** 차선 안내를 흉내 낸다: SDK 규칙대로 전체폭 73dp, 하단은 주변 메뉴 하단에 맞춘다 */
  fun debugSetLane(on: Boolean) {
    val c = container ?: return
    activity.runOnUiThread {
      debugObstacles.filter { it.kind == DebugKind.BOTTOM }.forEach { c.removeView(it.view) }
      debugObstacles.removeAll { it.kind == DebugKind.BOTTOM }
      if (on) {
        val around = sdkView(c, "component_around_menu")?.takeIf { visible(it) }
        val bottom = around?.let { rectOf(c, it).bottom } ?: (c.height - dp(88))
        val box = debugBox(c, "debug-lane", "차선 안내", "#B30EA5E9")
        c.addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(73), Gravity.BOTTOM).apply { bottomMargin = c.height - bottom })
        debugObstacles.add(DebugObstacle(DebugKind.BOTTOM, box))
      }
      relayout(true)
    }
  }

  private fun debugBox(c: FrameLayout, desc: String, label: String, color: String) = TextView(activity).apply {
    text = label; setTextColor(Color.WHITE); textSize = 11f; gravity = Gravity.CENTER; contentDescription = desc
    background = GradientDrawable().apply { setColor(Color.parseColor(color)); cornerRadius = dp(8).toFloat() }
    isClickable = false
  }

  private companion object {
    // SDK 왼쪽 열(위에서 아래로): 현재·다음 안내, 나침반, 시뮬레이션 바, 속도, 단속 표지 1·2. 이름은 SDK 1.12.8-hotfix05 의 뷰 id 다.
    val LEFT_STACK = listOf(
      "component_cur_direction", "component_next_direction", "component_compass", "component_simul_drive_view",
      "component_speed", "component_sign_first", "component_sign_second",
    )
    // 레일 아래쪽에 나타날 수 있는 SDK 요소
    val BOTTOM_BLOCKERS = listOf(
      "component_lane", "component_hipass_info", "component_cur_position", "component_route_info_container",
      "component_section_info_container", "component_info", "component_custom_toast", "component_bottom", "component_bottom_menu",
    )
    const val LEFT_DP = 12 // 차량 아이콘 버튼과 같은 왼쪽 여백
    const val TILE_W_DP = 76 // 이름(어린이보호구역 등)이 들어가도록 SDK 표지 폭(86dp)에 가깝게 넓힌다
    const val MAX_TILES = 3
    const val STACK_GAP_DP = 16 // SDK 가 왼쪽 열 요소 사이에 두는 간격
    const val CAR_GAP_DP = 8
    const val GROW_MARGIN_DP = 8
    const val BADGE_PAD_DP = 8 // +N 배지가 칸 밖으로 걸치는 폭(위 6dp, 오른쪽 4dp)보다 크게
    const val FALLBACK_TOP_DP = 450 // SDK 뷰를 못 찾을 때: 회전 배너 + 속도 + 표지 2개의 최악의 쌓임 아래(상단 기준, 하단 고정 아님)
    const val NO_BLOCKER_RESERVE_DP = 96
    const val DETAIL_MS = 10_000L
    const val WARNING_MS = 8_000L
    const val FALLBACK_BANNER_TOP_DP = 120 // SDK 상단 안내 뷰를 못 찾을 때의 배너 시작 위치
    const val DEBOUNCE_MS = 120L
    const val MOVE_MS = 150L
    const val TICK_MS = 500L
    val INK = Color.parseColor("#1E293B")
    val NEUTRAL_FILL = Color.parseColor("#E2E8F0")
    val NEUTRAL_FG = Color.parseColor("#64748B")
    // src/theme.ts 의 hazardTone 과 같은 값. 한쪽을 바꾸면 다른 쪽도 맞춘다.
    val TONES = mapOf(
      "accident" to Tone(Color.parseColor("#FEF2F2"), Color.parseColor("#DC2626"), Color.parseColor("#DC2626")),
      "construction" to Tone(Color.parseColor("#FFFBEB"), Color.parseColor("#D97706"), Color.parseColor("#B45309")),
      "congestion" to Tone(Color.parseColor("#FEFCE8"), Color.parseColor("#A16207"), Color.parseColor("#854D0E")),
      "school_zone" to Tone(Color.parseColor("#ECFDF5"), Color.parseColor("#059669"), Color.parseColor("#047857")),
      "accident_prone" to Tone(Color.parseColor("#FDF2F8"), Color.parseColor("#BE185D"), Color.parseColor("#9D174D")),
    )
    // 보호구역 subtype 이름. 프로젝트 i18n(zoneType)과 같은 뜻이며 카드 폭에 맞게 영어만 짧게 줄였다.
    val ZONE_NAMES = mapOf(
      "ko" to mapOf("child" to "어린이보호구역", "senior" to "노인보호구역", "disabled" to "장애인보호구역", "unknown" to "보호구역"),
      "en" to mapOf("child" to "School zone", "senior" to "Senior zone", "disabled" to "Disabled zone", "unknown" to "Protection zone"),
      "zh" to mapOf("child" to "儿童保护区", "senior" to "老年人保护区", "disabled" to "残疾人保护区", "unknown" to "保护区"),
    )
    val LABELS = mapOf(
      "ko" to mapOf("accident" to "사고", "construction" to "공사", "congestion" to "정체", "school_zone" to "보호구역", "accident_prone" to "사고다발구역"),
      "en" to mapOf("accident" to "Accident", "construction" to "Roadwork", "congestion" to "Congestion", "school_zone" to "Protection zone", "accident_prone" to "Accident-prone area"),
      "zh" to mapOf("accident" to "事故", "construction" to "施工", "congestion" to "拥堵", "school_zone" to "保护区", "accident_prone" to "事故多发区"),
    )
  }
}
