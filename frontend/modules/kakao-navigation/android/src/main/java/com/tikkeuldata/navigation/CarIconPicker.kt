package com.tikkeuldata.navigation

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

private val STRINGS = mapOf(
  "ko" to mapOf("title" to "주행 아이콘", "default" to "기본", "taxi" to "택시", "sports" to "스포츠카", "character" to "캐릭터",
    "close" to "닫기", "changed" to "주행 아이콘을 바꿨어요", "nextTrip" to "다음 길안내부터 적용돼요"),
  "en" to mapOf("title" to "Driving icon", "default" to "Default", "taxi" to "Taxi", "sports" to "Sports car", "character" to "Character",
    "close" to "Close", "changed" to "Driving icon changed", "nextTrip" to "Applies from your next trip"),
  "zh" to mapOf("title" to "驾驶图标", "default" to "默认", "taxi" to "出租车", "sports" to "跑车", "character" to "角色",
    "close" to "关闭", "changed" to "已更换驾驶图标", "nextTrip" to "将从下次导航开始生效"),
)

// Small overlay above the official navigation view: a 44dp button and a compact bottom panel.
// It lives in our own container; SDK views are never modified.
internal class CarIconPicker(private val activity: Activity, language: String, private val onSelect: (String) -> Unit) {
  private val strings = STRINGS[language] ?: STRINGS.getValue("ko")
  private val density = activity.resources.displayMetrics.density
  private val button = ImageButton(activity)
  private val panel = LinearLayout(activity)
  private val tiles = LinearLayout(activity)
  private var selected = CarIcons.get(activity)

  fun label(key: String): String = strings.getValue(key)
  val isOpen: Boolean get() = panel.visibility == View.VISIBLE
  /** 읽기 전용: 위험 레일이 충돌할 때 버튼을 밀어내려고 위치를 읽는다(HazardRailOverlay). 버튼 동작은 바뀌지 않는다 */
  val anchorView: View get() = button

  fun attach(container: FrameLayout) {
    button.apply {
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE); setStroke(dp(1), Color.parseColor("#CBD5E1")) }
      elevation = dp(4).toFloat()
      scaleType = ImageView.ScaleType.FIT_CENTER
      setPadding(dp(4), dp(4), dp(4), dp(4))
      contentDescription = label("title")
      setOnClickListener { if (isOpen) close() else open() }
    }
    container.addView(button, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.START or Gravity.CENTER_VERTICAL).apply { marginStart = dp(12) })

    panel.apply {
      orientation = LinearLayout.VERTICAL
      visibility = View.GONE
      isClickable = true // keep taps on the panel from reaching the map
      elevation = dp(8).toFloat()
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#1E293B"))
        cornerRadii = FloatArray(8) { if (it < 4) dp(16).toFloat() else 0f }
      }
    }
    val header = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
    header.addView(TextView(activity).apply {
      text = label("title"); setTextColor(Color.WHITE); textSize = 15f; setTypeface(typeface, Typeface.BOLD)
    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    header.addView(TextView(activity).apply {
      text = label("close"); setTextColor(Color.parseColor("#FFC400")); textSize = 14f; setTypeface(typeface, Typeface.BOLD)
      minHeight = dp(44); gravity = Gravity.CENTER; setPadding(dp(12), 0, dp(4), 0)
      setOnClickListener { close() }
    })
    panel.addView(header)
    panel.addView(tiles)
    container.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    ViewCompat.setOnApplyWindowInsetsListener(panel) { view, insets ->
      val bottom = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
      view.setPadding(dp(16), dp(4), dp(16), dp(12) + bottom)
      insets
    }
    render()
  }

  fun select(id: String) {
    selected = id
    render()
  }

  fun close() { panel.visibility = View.GONE }

  private fun open() {
    selected = CarIcons.get(activity)
    render()
    panel.visibility = View.VISIBLE
  }

  private fun render() {
    button.setImageResource(CarIcons.preview(selected))
    tiles.removeAllViews()
    for (id in CarIcons.ids) {
      val active = id == selected
      val tile = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(4), dp(8), dp(4), dp(8))
        // Selected: yellow road-sign border plus bold label, so it is not color alone.
        background = GradientDrawable().apply {
          cornerRadius = dp(12).toFloat()
          setColor(Color.parseColor(if (active) "#334155" else "#1E293B"))
          if (active) setStroke(dp(3), Color.parseColor("#FFC400"))
        }
        contentDescription = label(id)
        isSelected = active
        setOnClickListener { onSelect(id) }
      }
      tile.addView(ImageView(activity).apply { setImageResource(CarIcons.preview(id)); scaleType = ImageView.ScaleType.FIT_CENTER },
        LinearLayout.LayoutParams(dp(48), dp(52)))
      tile.addView(TextView(activity).apply {
        text = label(id); setTextColor(Color.WHITE); textSize = 12f; gravity = Gravity.CENTER
        setTypeface(typeface, if (active) Typeface.BOLD else Typeface.NORMAL)
      })
      tiles.addView(tile, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(4), 0, dp(4), 0) })
    }
  }

  private fun dp(value: Int): Int = (value * density).toInt()
}
