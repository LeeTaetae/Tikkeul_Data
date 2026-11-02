import ExpoModulesCore
import KakaoSDKCommon
import KakaoSDKAuth
import KakaoSDKUser

public final class KakaoLoginModule: Module {
  private static var sdkInitialized = false

  private static func nativeAppKey() -> String? {
    guard let key = Bundle.main.object(forInfoDictionaryKey: "KakaoNaviNativeAppKey") as? String, !key.isEmpty else {
      return nil
    }
    return key
  }

  // shortcut: initialize lazily on first login instead of in AppDelegate, so this module needs no
  // AppDelegate edits (this app key is reused from the KakaoNavi config, which already writes it into
  // Info.plist). Kakao's SDK only requires initSDK() before the first API call, not at launch.
  private static func ensureInitialized() -> Bool {
    guard let key = nativeAppKey() else { return false }
    if !sdkInitialized {
      KakaoSDK.initSDK(appKey: key)
      sdkInitialized = true
    }
    return true
  }

  public func definition() -> ModuleDefinition {
    Name("KakaoLogin")

    Function("getStatus") {
      ["configured": Self.nativeAppKey() != nil]
    }

    // Kakao Talk 앱으로 전환하는 loginWithKakaoTalk() 은 구현하지 않는다(AppDelegate/SceneDelegate 오픈 URL 처리가
    // 더 필요해 범위를 줄였다 — Kakao 계정(웹) 로그인만으로도 로그인 기능 자체는 완전하다).
    AsyncFunction("login") { (promise: Promise) in
      guard Self.ensureInitialized() else {
        promise.reject("NOT_CONFIGURED", "Native Kakao application key is missing")
        return
      }
      UserApi.shared.loginWithKakaoAccount { oauthToken, error in
        if let error = error {
          let description = "\(error)".lowercased()
          if description.contains("cancel") || description.contains("denied") {
            promise.reject("KAKAO_LOGIN_CANCELLED", "User cancelled Kakao login")
          } else {
            promise.reject("LOGIN_FAILED", error.localizedDescription)
          }
          return
        }
        guard let accessToken = oauthToken?.accessToken else {
          promise.reject("LOGIN_FAILED", "No access token returned")
          return
        }
        promise.resolve(["accessToken": accessToken])
      }
    }.runOnQueue(.main)
  }
}
