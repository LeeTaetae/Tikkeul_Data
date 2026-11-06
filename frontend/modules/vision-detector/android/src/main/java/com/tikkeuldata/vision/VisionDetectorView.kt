package com.tikkeuldata.vision

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.ProcessLifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * 후면 카메라 + 기기 내 YOLO. iOS `VisionDetectorView`(VisionDetectorModule.swift)와 같은 JS 계약이다:
 * `targetFps` prop, `onDetections` / `onError` 이벤트. JS(VisionHazardController)는 이 뷰를 1x1 로 숨겨 마운트만 유지한다.
 *
 * 수명 주기
 *  - 카메라는 Activity 가 아니라 **앱 프로세스**(ProcessLifecycleOwner)에 묶는다. 카카오 내비 SDK 화면은 별도 Activity 라서
 *    MainActivity 가 stop 되는데, Activity 수명에 묶으면 내비 중에 탐지가 끊긴다(iOS 는 모달이라 계속 돈다).
 *    앱이 백그라운드로 가면 ProcessLifecycleOwner 가 STOPPED 가 되어 CameraX 가 카메라를 닫는다.
 *  - 뷰가 화면에서 떨어지거나(onDetachedFromWindow) 파괴되면 unbind, 분석기 해제, 인터프리터 close, 실행기 종료까지 한다.
 *    다시 붙으면 새로 시작한다. 비동기 콜백은 세대 번호(generation)로 낡은 것을 무시한다.
 *  - 프레임은 KEEP_ONLY_LATEST 로 쌓이지 않고, 목표 fps 보다 이른 프레임은 추론 없이 바로 닫는다.
 */
@SuppressLint("ViewConstructor")
class VisionDetectorView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onDetections by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, String>>()
  private val onPortalFrame by EventDispatcher<Map<String, Any>>()
  @Volatile var portalCandidatesEnabled = false
  private var lastPortalAt = 0L

  override val shouldUseAndroidLayout: Boolean = true

  private val mainHandler = Handler(Looper.getMainLooper())
  private val governor = FpsGovernor()
  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE // TextureView: RN 뷰 계층 안에서 z-order 문제가 적다
    scaleType = PreviewView.ScaleType.FILL_CENTER // iOS resizeAspectFill
  }

  /** JS 가 prop 으로 넘긴다(기본 5, 보호구역 10). 기기가 못 따라가면 FpsGovernor 가 스스로 낮춘다. */
  var targetFps: Double
    get() = governor.targetFps
    set(value) { governor.targetFps = value }

  // 아래 상태는 모두 메인 스레드에서만 바꾼다(engine 은 분석 스레드에서 쓰되 close 도 같은 스레드에서 한다).
  private var generation = 0
  private var running = false
  private var executor: ExecutorService? = null
  @Volatile private var engine: YoloTfliteEngine? = null
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  private var thermalListener: Any? = null
  private var lastErrorAt = 0L
  private var lastErrorText = ""
  private var frames = 0L

  init {
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    start()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  /** 뷰 정의의 OnViewDestroys 에서 호출한다. onDetachedFromWindow 와 중복 호출돼도 안전하다. */
  fun shutdown() = stop()

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // 숨김(1x1)과 미리보기(전체 화면) 사이가 바뀌면 미리보기 use case 만 다시 묶는다.
    if (running && provider != null && analysis != null && wantsPreview() != (preview != null)) bindCamera(generation)
  }

  private fun wantsPreview() = width >= MIN_PREVIEW_PX && height >= MIN_PREVIEW_PX

  private fun start() {
    if (running) return
    running = true
    val gen = ++generation
    governor.reset()
    frames = 0
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      loadEngine(gen)
      return
    }
    val permissions = appContext.permissions
    if (permissions == null) {
      reportError("camera permission denied")
      return
    }
    permissions.askForPermissions({ result ->
      mainHandler.post {
        if (gen != generation || !running) return@post
        if (result[Manifest.permission.CAMERA]?.status?.name == "GRANTED") loadEngine(gen) else reportError("camera permission denied")
      }
    }, Manifest.permission.CAMERA)
  }

  private fun loadEngine(gen: Int) {
    val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "vision-detector").apply { isDaemon = true } }
    executor = exec
    exec.execute {
      try {
        val threads = max(2, Runtime.getRuntime().availableProcessors() / 2).coerceAtMost(4)
        val created = YoloTfliteEngine.create(context.applicationContext, threads)
        mainHandler.post {
          if (gen != generation || !running) {
            exec.execute { created.close() } // 그 사이 뷰가 사라졌다
            return@post
          }
          engine = created
          registerThermal()
          bindCamera(gen, created.describe)
        }
      } catch (e: Throwable) {
        mainHandler.post { if (gen == generation) reportError(e.message ?: "failed to load the vision model") }
      }
    }
  }

  private fun bindCamera(gen: Int, setupInfo: String? = null) {
    val future = ProcessCameraProvider.getInstance(context.applicationContext)
    future.addListener({
      if (gen != generation || !running) return@addListener
      try {
        val cameraProvider = future.get()
        provider = cameraProvider
        unbindOwnUseCases(cameraProvider)

        val rotation = previewView.display?.rotation ?: Surface.ROTATION_0
        val usePreview = wantsPreview()
        preview = if (usePreview) Preview.Builder().setTargetRotation(rotation).build().also { it.surfaceProvider = previewView.surfaceProvider } else null
        val imageAnalysis = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
              .build(),
          )
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setTargetRotation(rotation)
          .build()
        val exec = executor ?: return@addListener
        imageAnalysis.setAnalyzer(exec) { image -> analyze(gen, image) }
        analysis = imageAnalysis

        val useCases = listOfNotNull<androidx.camera.core.UseCase>(preview, imageAnalysis)
        cameraProvider.bindToLifecycle(ProcessLifecycleOwner.get(), CameraSelector.DEFAULT_BACK_CAMERA, *useCases.toTypedArray())
        if (setupInfo != null) {
          // iOS 의 'session setup: ...' 진단과 같은 자리. JS(vision-test)가 onError 로 찍어 보여 준다.
          sendError("session setup: camera=bound preview=$usePreview fps=${governor.targetFps} $setupInfo")
        }
      } catch (e: Throwable) {
        reportError("failed to open back camera: ${e.message}")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun analyze(gen: Int, image: ImageProxy) {
    try {
      if (gen != generation || !running) return
      val eng = engine ?: return
      if (!governor.shouldProcess(SystemClock.elapsedRealtime())) return
      val result = eng.detect(image)
      governor.recordInference(result.inferenceMs)
      if (++frames % LOG_EVERY == 0L) {
        Log.i(TAG, "inference ${"%.1f".format(result.inferenceMs)}ms, effective ${"%.1f".format(governor.effectiveFps())}fps (target ${governor.targetFps})")
      }
      val payload = DetectionEvent.payload(result.detections, result.rawCount)
      mainHandler.post { if (gen == generation && running) onDetections(payload) }
      val now = SystemClock.elapsedRealtime()
      if (portalCandidatesEnabled && now - lastPortalAt >= 500) {
        lastPortalAt = now
        // Failure in the experimental branch must not interrupt existing detections.
        val sample = runCatching { eng.portalFrame() }.getOrNull()
        if (sample != null) mainHandler.post {
          if (gen == generation && running && portalCandidatesEnabled) onPortalFrame(sample)
        }
      }
    } catch (e: Throwable) {
      mainHandler.post { if (gen == generation) reportError(e.message ?: e.javaClass.simpleName) }
    } finally {
      image.close() // 닫지 않으면 CameraX 가 다음 프레임을 주지 않는다
    }
  }

  private fun unbindOwnUseCases(cameraProvider: ProcessCameraProvider) {
    analysis?.clearAnalyzer()
    val owned = listOfNotNull<androidx.camera.core.UseCase>(preview, analysis)
    if (owned.isNotEmpty()) cameraProvider.unbind(*owned.toTypedArray())
    preview = null
    analysis = null
  }

  private fun stop() {
    if (!running) return
    running = false
    generation++
    unregisterThermal()
    provider?.let { unbindOwnUseCases(it) }
    provider = null
    val exec = executor
    val eng = engine
    engine = null
    executor = null
    if (exec != null) {
      // 인터프리터는 추론 중일 수 있으니 같은 스레드에서 닫고 실행기를 끝낸다.
      exec.execute { eng?.close() }
      exec.shutdown()
    }
    mainHandler.removeCallbacksAndMessages(null)
  }

  @SuppressLint("NewApi")
  private fun registerThermal() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    governor.thermalCapFps = FpsGovernor.thermalCapFor(pm.currentThermalStatus)
    val listener = PowerManager.OnThermalStatusChangedListener { status -> governor.thermalCapFps = FpsGovernor.thermalCapFor(status) }
    pm.addThermalStatusListener(ContextCompat.getMainExecutor(context), listener)
    thermalListener = listener
  }

  @SuppressLint("NewApi")
  private fun unregisterThermal() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val listener = thermalListener as? PowerManager.OnThermalStatusChangedListener ?: return
    (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.removeThermalStatusListener(listener)
    thermalListener = null
    governor.thermalCapFps = null
  }

  /** 같은 오류가 연속으로 쏟아지지 않게 같은 메시지는 5초에 한 번만 보낸다. */
  private fun reportError(message: String) {
    val now = SystemClock.elapsedRealtime()
    if (message == lastErrorText && now - lastErrorAt < 5_000) return
    lastErrorText = message
    lastErrorAt = now
    sendError(message)
  }

  private fun sendError(message: String) {
    Log.w(TAG, message)
    onError(DetectionEvent.errorPayload(message))
  }

  private companion object {
    const val TAG = "VisionDetector"
    const val MIN_PREVIEW_PX = 64
    const val LOG_EVERY = 50L
  }
}
