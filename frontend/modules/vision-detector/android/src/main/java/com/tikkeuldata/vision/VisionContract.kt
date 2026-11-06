package com.tikkeuldata.vision

/**
 * iOS(`ios/VisionDetectorModule.swift`)와 같은 JS 계약. JS 의 fromModelDetections·sensitivityProfile·reduceVisionFrame 이 이 형식에 기대므로
 * 키 이름과 좌표계를 임의로 바꾸지 않는다. 계약 테스트(`vision-contract.json`)가 키와 숫자를 고정한다.
 */
internal object VisionContract {
  /** 모델 라벨(ultralytics `names`). 앱의 HazardClass 변환은 JS(modelLabels.ts)가 한다. */
  val MODEL_LABELS: Set<String> = setOf("kickboard", "person", "car", "motorcycle", "animal")

  /** iOS와 같은 prop 미전달 fallback. 앱은 최신 JS 정책(기본 10, 보호구역 15fps)을 명시적으로 넘긴다. */
  const val DEFAULT_TARGET_FPS = 5.0

  /**
   * 네이티브가 내보내는 최소 confidence. 최신 후보·2프레임·즉시 기준은 iOS와 마찬가지로 JS가 적용한다.
   * 이 값은 JS 가 쓰는 가장 낮은 임계값(0.25)보다 높으면 안 된다(그러면 보호구역 person 이 JS 에 도달하지 못한다).
   */
  const val CONFIDENCE_FLOOR = 0.25f
  const val NMS_IOU = 0.45f
  const val MAX_DETECTIONS = 50

  const val ASSET_MODEL = "vision/kickboard_v3.tflite"
  const val ASSET_LABELS = "vision/labels.txt"

  const val DEBUG_RAW_TYPE = "LiteRtYolo"
}

/** 상자는 업라이트(세로 보기) 프레임 기준 0~1, 원점은 좌상단, y 는 위에서 아래로(visionTypes.ts Box). */
internal data class Detection(
  val label: String,
  val confidence: Float,
  val x: Float,
  val y: Float,
  val width: Float,
  val height: Float,
)

internal object DetectionEvent {
  /** `onDetections` 의 nativeEvent. iOS 와 키·타입이 같다(confidence 와 상자는 Double). */
  fun payload(detections: List<Detection>, rawCount: Int, rawType: String = VisionContract.DEBUG_RAW_TYPE): Map<String, Any> = mapOf(
    "detections" to detections.map { d ->
      mapOf(
        "class" to d.label,
        "confidence" to d.confidence.toDouble(),
        "box" to mapOf("x" to d.x.toDouble(), "y" to d.y.toDouble(), "width" to d.width.toDouble(), "height" to d.height.toDouble()),
      )
    },
    "debugRawType" to rawType,
    "debugRawCount" to rawCount,
    "debugRecognizedCount" to detections.size,
  )

  fun errorPayload(message: String): Map<String, String> = mapOf("message" to message)
}

internal object LabelParser {
  /** labels.txt: 한 줄에 라벨 하나, 빈 줄과 `#` 주석은 무시한다. 줄 순서가 모델 출력 클래스 인덱스다. */
  fun parse(text: String): List<String> =
    text.lineSequence().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }.toList()

  /** 문제가 있으면 사람이 읽을 메시지, 없으면 null. 조용히 기본 순서로 대체하지 않는다. */
  fun validate(labels: List<String>): String? {
    if (labels.isEmpty()) return "labels.txt is empty"
    if (labels.toSet().size != labels.size) return "labels.txt has duplicate labels: $labels"
    if (labels.toSet() != VisionContract.MODEL_LABELS) {
      return "labels.txt must contain exactly ${VisionContract.MODEL_LABELS.sorted()} but has ${labels.sorted()}"
    }
    return null
  }
}
