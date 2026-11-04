// 개발용 임시 테스트 모듈: 후면 카메라 + CoreML(YOLO)로 멀리/가까이 단계가 실제로 바뀌는지 실기기에서
// 확인하기 위한 것. docs/ADR/0002-vision-yolo-integration.md 참고. 클래스별 confidence 임계값은 여기서
// 적용하지 않는다 — frontend/src/lib/vision/sensitivityProfile.ts 가 JS 쪽에서 이미 필터링한다.
import ExpoModulesCore
import AVFoundation
import Vision
import CoreML

public final class VisionDetectorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionDetector")

    View(VisionDetectorView.self) {
      Events("onDetections", "onError")

      Prop("targetFps") { (view: VisionDetectorView, fps: Double) in
        view.targetFps = fps
      }
    }
  }
}

final class VisionDetectorView: ExpoView {
  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let sessionQueue = DispatchQueue(label: "com.tikkeuldata.visiondetector.session")
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private var visionRequest: VNCoreMLRequest?
  // init() 시점엔 JS 쪽 이벤트 리스너가 아직 안 붙어서 onError를 바로 보내면 버려진다 - 세션 설정이 끝나는
  // (리스너가 붙어있을 시점인) 나중 타이밍에 같이 보내기 위해 잠깐 들고 있는다.
  private var modelLoadError: String?
  private var lastInferenceAt: CFTimeInterval = 0
  var targetFps: Double = 5

  let onDetections = EventDispatcher()
  let onError = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
    loadModel()
    AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
      if granted {
        self?.configureSession()
      } else {
        self?.onError(["message": "camera permission denied"])
      }
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
  }

  // 빌드 시점 컴파일(.mlmodelc) 대신 최초 로드 때 기기에서 컴파일한다 - Xcode 프로젝트를 건드리지 않고
  // CocoaPods 리소스(.mlpackage)만으로 동작하게 하기 위한 임시 방법(실기기 캘리브레이션 세션에서 재검토).
  private func loadModel() {
    guard let packageURL = Bundle.main.url(forResource: "kickboard_v3", withExtension: "mlpackage") else {
      modelLoadError = "kickboard_v3.mlpackage not found in bundle"
      return
    }
    do {
      let compiledURL = try MLModel.compileModel(at: packageURL)
      let mlModel = try MLModel(contentsOf: compiledURL)
      let vnModel = try VNCoreMLModel(for: mlModel)
      let request = VNCoreMLRequest(model: vnModel)
      // 학습 때 비율 유지(letterbox) 전처리를 썼다 - scaleFill(강제로 늘려 정사각형화)은 비율을 망가뜨려
      // 인식률을 떨어뜨린다(실기기 테스트에서 오탐 원인 중 하나로 확인). docs/ADR/0002 참고.
      request.imageCropAndScaleOption = .scaleFit
      visionRequest = request
    } catch {
      modelLoadError = "failed to load vision model: \(error.localizedDescription)"
    }
  }

  private func configureSession() {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      self.session.beginConfiguration()
      self.session.sessionPreset = .vga640x480
      guard
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
        let input = try? AVCaptureDeviceInput(device: device),
        self.session.canAddInput(input)
      else {
        self.session.commitConfiguration()
        DispatchQueue.main.async { self.onError(["message": "failed to open back camera"]) }
        return
      }
      self.session.addInput(input)
      self.output.setSampleBufferDelegate(self, queue: self.sessionQueue)
      self.output.alwaysDiscardsLateVideoFrames = true
      let canAddOutput = self.session.canAddOutput(self.output)
      if canAddOutput {
        self.session.addOutput(self.output)
      }
      self.session.commitConfiguration()
      self.session.startRunning()
      let isRunning = self.session.isRunning
      let outputs = self.session.outputs.count
      DispatchQueue.main.async {
        self.previewLayer.session = self.session
        // 임시 진단(docs/ADR/0002): onDetections가 전혀 안 오면 이걸로 세션 구성 중 어디서 끊겼는지 본다.
        self.onError(["message": "session setup: canAddOutput=\(canAddOutput) isRunning=\(isRunning) outputsCount=\(outputs) hasVisionRequest=\(self.visionRequest != nil) modelLoadError=\(self.modelLoadError ?? "none")"])
      }
    }
  }
}

extension VisionDetectorView: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    guard now - lastInferenceAt >= 1.0 / max(targetFps, 1) else { return }
    guard let request = visionRequest, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    lastInferenceAt = now

    // 뒤 카메라 센서는 가로로 눕혀 들어온다(기기를 세로로 들고 쓴다는 전제). docs/ADR/0002 참고.
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:])
    do {
      try handler.perform([request])
      let rawResults = request.results ?? []
      let observations = rawResults as? [VNRecognizedObjectObservation] ?? []
      // 임시 디버그 필드(docs/ADR/0002 실기기 캘리브레이션용, JS 콘솔로 확인). Vision이 이 모델을
      // object detector로 인식 못 하면 rawCount>0인데 recognizedCount만 0으로 나온다.
      let debugRawType = rawResults.first.map { String(describing: type(of: $0)) } ?? "none"
      let debugRawCount = rawResults.count
      let debugRecognizedCount = observations.count
      let detections = observations.compactMap { observation -> [String: Any]? in
        guard let top = observation.labels.first else { return nil }
        let box = observation.boundingBox // origin: bottom-left, 0~1
        return [
          "class": top.identifier,
          "confidence": Double(top.confidence),
          "box": [
            "x": box.origin.x,
            "y": 1 - box.origin.y - box.height, // Detection.box 는 top-left, y는 위에서 아래로(visionTypes.ts)
            "width": box.width,
            "height": box.height,
          ],
        ]
      }
      DispatchQueue.main.async { [weak self] in
        self?.onDetections([
          "detections": detections,
          "debugRawType": debugRawType,
          "debugRawCount": debugRawCount,
          "debugRecognizedCount": debugRecognizedCount,
        ])
      }
    } catch {
      DispatchQueue.main.async { [weak self] in self?.onError(["message": error.localizedDescription]) }
    }
  }
}
