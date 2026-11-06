package com.tikkeuldata.vision

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android 구현. 모듈 이름과 뷰 이벤트·prop 은 iOS(`ios/VisionDetectorModule.swift`)와 같아서
 * JS(`src/native/visionDetectorView.tsx`, `VisionHazardController`)가 플랫폼을 가리지 않고 같은 코드로 쓴다.
 * 클래스별 confidence 임계값은 여기서 적용하지 않는다 - sensitivityProfile.ts 가 JS 에서 필터링한다.
 */
class VisionDetectorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VisionDetector")

    View(VisionDetectorView::class) {
      Events("onDetections", "onError", "onPortalFrame")
      Prop("portalCandidatesEnabled") { view: VisionDetectorView, enabled: Boolean ->
        view.portalCandidatesEnabled = enabled
      }

      Prop("targetFps") { view: VisionDetectorView, fps: Double ->
        view.targetFps = fps
      }

      OnViewDestroys { view: VisionDetectorView ->
        view.shutdown()
      }
    }
  }
}
