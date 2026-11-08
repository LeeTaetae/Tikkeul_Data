package com.tikkeuldata.navigation

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.ScrollView

/** Separate top banner. Never inserts weather icons into the hazard rail. */
internal object WeatherSafetyOverlay {
  private val handler = Handler(Looper.getMainLooper())
  private var label: TextView? = null
  private var panel: ScrollView? = null
  private var pending = ""
  private val expire = Runnable { panel?.visibility=View.GONE;pending="" }
  fun attach(activity: Activity, host: FrameLayout) {
    val previous = pending
    detach()
    val density = activity.resources.displayMetrics.density
    fun dp(n: Int) = (n*density).toInt()
    label = TextView(activity).apply {
      textSize = 15f; setTextColor(Color.rgb(50, 40, 20)); setTypeface(typeface, Typeface.BOLD)
      setPadding(dp(12),dp(10),dp(12),dp(10))
    }
    // Wrap short notices; bound long ones without cutting off wrapped risk text.
    panel = object : ScrollView(activity) {
      override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxHeight = (activity.resources.displayMetrics.heightPixels * 0.30f).toInt()
        super.onMeasure(widthMeasureSpec, View.MeasureSpec.makeMeasureSpec(maxHeight, View.MeasureSpec.AT_MOST))
      }
    }.apply {
      addView(label)
      background = GradientDrawable().apply { setColor(Color.rgb(255,250,230)); cornerRadius=dp(12).toFloat(); setStroke(dp(2),Color.rgb(213,139,0)) }
      visibility = View.GONE
    }
    host.addView(panel,FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.WRAP_CONTENT,Gravity.TOP).apply {
      leftMargin=dp(16);rightMargin=dp(16);topMargin=dp(96)
    })
    set(previous)
  }
  fun set(text: String) {
    handler.post {
      handler.removeCallbacks(expire)
      if(pending!=text)panel?.scrollTo(0,0)
      pending=text;label?.text=pending;panel?.visibility=if(pending.isBlank())View.GONE else View.VISIBLE
      if(pending.isNotBlank())handler.postDelayed(expire,20_000)
    }
  }
  /** 화면에 보이는 배너의 하단(px, 호스트 기준). 안 보이면 0. 다른 상단 배너가 그 아래에 놓이도록 쓴다 */
  fun visibleBottomPx(): Int = panel?.takeIf { it.visibility == View.VISIBLE && it.height > 0 }?.let { it.top + it.height } ?: 0
  fun detach() { handler.removeCallbacks(expire);panel?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) };panel=null;label=null;pending="" }
}
