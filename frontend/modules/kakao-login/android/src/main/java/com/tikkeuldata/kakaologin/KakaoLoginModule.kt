package com.tikkeuldata.kakaologin

import android.content.Context
import android.content.pm.PackageManager
import com.kakao.sdk.common.KakaoSdk
import com.kakao.sdk.common.model.ClientError
import com.kakao.sdk.common.model.ClientErrorCause
import com.kakao.sdk.user.UserApiClient
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val NATIVE_KEY = "com.tikkeuldata.kakao.NATIVE_APP_KEY"
private var sdkInitialized = false

private fun nativeKey(context: Context): String = context.packageManager
  .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
  .metaData?.getString(NATIVE_KEY)?.trim().orEmpty()

// shortcut: initialize lazily on first login instead of in the Application class, so this module needs
// no MainApplication edits (the key is reused from the KakaoNavi config, already in the app manifest).
private fun ensureInitialized(context: Context): Boolean {
  val key = nativeKey(context)
  if (key.isEmpty()) return false
  if (!sdkInitialized) {
    KakaoSdk.init(context.applicationContext, key)
    sdkInitialized = true
  }
  return true
}

class KakaoLoginModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KakaoLogin")

    Function("getStatus") {
      val context = appContext.reactContext
      mapOf("configured" to (context != null && nativeKey(context).isNotEmpty()))
    }

    // Kakao Talk 앱으로 전환하는 loginWithKakaoTalk() 은 구현하지 않는다 — Kakao 계정(웹) 로그인만으로도
    // 로그인 기능 자체는 완전하다(범위를 줄인 결정, task-5-report.md 참고).
    AsyncFunction("login") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null || !ensureInitialized(context)) {
        promise.reject("NOT_CONFIGURED", "Native Kakao application key is missing", null)
      } else {
        UserApiClient.instance.loginWithKakaoAccount(context) { token, error ->
          when {
            error is ClientError && error.reason == ClientErrorCause.Cancelled ->
              promise.reject("KAKAO_LOGIN_CANCELLED", "User cancelled Kakao login", null)
            error != null ->
              promise.reject("LOGIN_FAILED", error.localizedMessage ?: "Kakao login failed", null)
            token != null -> promise.resolve(mapOf("accessToken" to token.accessToken))
            else -> promise.reject("LOGIN_FAILED", "No token returned", null)
          }
        }
      }
    }
  }
}
