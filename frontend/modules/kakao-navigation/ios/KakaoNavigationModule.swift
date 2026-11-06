import ExpoModulesCore

public final class KakaoNavigationModule: Module {
  private var activeController: KakaoNavigationController?

  public func definition() -> ModuleDefinition {
    Name("KakaoNavigation")
    // Product SDK feed, independent of Android's optional debug diagnostics.
    Events("onGuidance")

    Function("getStatus") {
      KakaoNavigationController.configuration()
    }

    // 위험 레일 스냅샷(JSON). 판단은 JS 가 하고 네이티브는 그리기만 한다.
    Function("setHazardRail") { (json: String) in KakaoNavigationController.setHazardRailJSON(json) }
    Function("clearHazardRail") { KakaoNavigationController.clearHazardRail() }
    Function("setWeatherSafetyBanner") { (text: String) in KakaoNavigationController.setWeatherSafetyBanner(text) }

    AsyncFunction("openNavigation") { (options: [String: Any], promise: Promise) in
      guard self.activeController == nil else {
        promise.reject("NAVIGATION_BUSY", "Navigation is already open")
        return
      }
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("NO_ACTIVITY", "No foreground view controller")
        return
      }
      let controller = KakaoNavigationController(options: options) { [weak self] code, message in
        self?.activeController = nil
        if let code {
          promise.reject(code, message ?? "Navigation failed")
        } else {
          promise.resolve(["status": "closed"])
        }
      }
      controller.eventHandler = { [weak self] event in
        if let body = event as? [String: Any] { self?.sendEvent("onGuidance", body) }
      }
      self.activeController = controller
      controller.modalPresentationStyle = .fullScreen
      controller.isModalInPresentation = true
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async { self.activeController?.cancelNavigation() }
    }
  }
}
