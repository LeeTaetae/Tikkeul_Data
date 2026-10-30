import ExpoModulesCore

public final class KakaoNavigationModule: Module {
  private var activeController: KakaoNavigationController?

  public func definition() -> ModuleDefinition {
    Name("KakaoNavigation")

    Function("getStatus") {
      KakaoNavigationController.configuration()
    }

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
