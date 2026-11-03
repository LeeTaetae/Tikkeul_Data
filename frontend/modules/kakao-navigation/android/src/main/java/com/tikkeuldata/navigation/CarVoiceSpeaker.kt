package com.tikkeuldata.navigation

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

// Owned exclusively by the native car activity, never shared with Expo/transit speech.
internal class CarVoiceSpeaker(context: Context, private val onFailure: () -> Unit) {
  private var ready = false
  private var closed = false
  private var generation = 0
  private var language = "ko"
  private var pending: String? = null
  private var engine: TextToSpeech? = null

  init {
    engine = TextToSpeech(context.applicationContext) { status ->
      if (!closed) {
        ready = status == TextToSpeech.SUCCESS
        Log.i("TikkeulVoice", "stage=tts-init ready=$ready")
        if (ready) {
          engine?.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          configure()
          pending?.also { pending = null; speak(it) }
        } else if (language != "ko") onFailure()
      }
    }
    engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(id: String?) { Log.i("TikkeulVoice", "stage=tts-start id=$id") }
      override fun onDone(id: String?) { Log.i("TikkeulVoice", "stage=tts-done id=$id") }
      @Deprecated("Android legacy callback")
      override fun onError(id: String?) { Log.e("TikkeulVoice", "stage=tts-error id=$id"); onFailure() }
    })
  }

  fun setLanguage(value: String) {
    generation++
    engine?.stop()
    pending = null
    language = value
    if (ready && value != "ko") configure()
    Log.i("TikkeulVoice", "stage=tts-language requested=$value generation=$generation ready=$ready")
  }

  private fun configure(): Boolean {
    if (language == "ko") return true
    val locale = if (language == "zh") Locale.SIMPLIFIED_CHINESE else Locale.US
    val tts = engine ?: return false
    val result = tts.setLanguage(locale)
    val voice = tts.voices?.filter { it.locale.language == locale.language && !it.isNetworkConnectionRequired }
      ?.sortedByDescending { if (it.locale.country == locale.country) 1 else 0 }?.firstOrNull()
    val voiceResult = if (voice != null) tts.setVoice(voice) else TextToSpeech.ERROR
    val actual = tts.voice?.locale?.language
    val valid = result >= TextToSpeech.LANG_AVAILABLE && voiceResult == TextToSpeech.SUCCESS && actual == locale.language
    Log.i("TikkeulVoice", "stage=tts-config requested=$language actual=$actual offline=${voice != null} result=$result valid=$valid")
    if (!valid) onFailure()
    return valid
  }

  fun speak(text: String) {
    if (closed || language == "ko") return
    if (!ready) { pending = text; return }
    if (!configure()) return
    val id = "car-$language-$generation-${System.nanoTime()}"
    val result = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), id)
    Log.i("TikkeulVoice", "stage=tts-submit language=$language id=$id result=$result")
    if (result != TextToSpeech.SUCCESS) onFailure()
  }

  fun stop() { pending = null; engine?.stop() }
  fun close() { closed = true; stop(); engine?.shutdown(); engine = null }
}
