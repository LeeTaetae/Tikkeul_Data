package com.tikkeuldata.vision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.os.SystemClock
import androidx.camera.core.ImageProxy
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 모델·라벨 파일이 없거나 형식이 맞지 않을 때. 메시지는 그대로 JS 의 onError 로 전달된다. */
internal class ModelUnavailableException(message: String, cause: Throwable? = null) : Exception(message, cause)

internal class EngineResult(val detections: List<Detection>, val rawCount: Int, val inferenceMs: Double)

/**
 * LiteRT(TFLite) Interpreter 로 YOLO 를 돌린다. 모델은 앱 assets(`vision/kickboard_v3.tflite`)와 같은 폴더의 `labels.txt` 에서 읽는다.
 *  - 입력 크기·자료형·양자화 값과 출력 형태는 모델에서 읽는다(하드코딩 없음). 입력은 NHWC RGB, 비율 유지 letterbox(회색 114) 로 만든다.
 *  - 프레임당 할당을 피하려고 비트맵·버퍼는 한 번만 만든다. detect()/close() 는 같은 스레드(분석 실행기)에서만 부른다.
 */
internal class YoloTfliteEngine private constructor(
  private val interpreter: Interpreter,
  val labels: List<String>,
  val inputW: Int,
  val inputH: Int,
  private val inputType: DataType,
  private val inputScale: Float,
  private val inputZero: Int,
  private val outputType: DataType,
  private val outputScale: Float,
  private val outputZero: Int,
  private val layout: YoloOutputLayout,
  val describe: String,
) : AutoCloseable {
  private val inputBuffer: ByteBuffer = ByteBuffer.allocateDirect(inputW * inputH * 3 * bytesPer(inputType)).order(ByteOrder.nativeOrder())
  private val outputElements = layout.attributes * layout.anchors
  private val outputBuffer: ByteBuffer = ByteBuffer.allocateDirect(outputElements * bytesPer(outputType)).order(ByteOrder.nativeOrder())
  private val outputFloats = FloatArray(outputElements)
  private val pixels = IntArray(inputW * inputH)
  private val inputBitmap: Bitmap = Bitmap.createBitmap(inputW, inputH, Bitmap.Config.ARGB_8888)
  private val inputCanvas = Canvas(inputBitmap)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val matrix = Matrix()

  private var frameBitmap: Bitmap? = null
  private var paddedScratch: ByteBuffer? = null
  private var letterbox: Letterbox? = null

  /** Small upright RGB sample; no disk/network access and no change to YOLO input. */
  fun portalFrame(): Map<String, Any>? {
    val lb = letterbox ?: return null
    val w = (160f * lb.uprightW / max(lb.uprightW, lb.uprightH)).roundToInt().coerceAtLeast(1)
    val h = (160f * lb.uprightH / max(lb.uprightW, lb.uprightH)).roundToInt().coerceAtLeast(1)
    val rgb = ArrayList<Int>(w * h * 3)
    for (y in 0 until h) for (x in 0 until w) {
      val sx = (lb.padX + (x + .5f) * lb.contentW / w).toInt().coerceIn(0, inputW - 1)
      val sy = (lb.padY + (y + .5f) * lb.contentH / h).toInt().coerceIn(0, inputH - 1)
      val pixel = pixels[sy * inputW + sx]
      rgb.add((pixel shr 16) and 255); rgb.add((pixel shr 8) and 255); rgb.add(pixel and 255)
    }
    return mapOf("width" to w, "height" to h, "rgb" to rgb)
  }

  fun detect(image: ImageProxy): EngineResult {
    val t0 = SystemClock.elapsedRealtimeNanos()
    val w = image.width
    val h = image.height
    val plane = image.planes[0]
    check(plane.pixelStride == 4) { "unexpected RGBA pixel stride ${plane.pixelStride}" }
    val bufferWidth = plane.rowStride / 4
    var frame = frameBitmap
    if (frame == null || frame.width != bufferWidth || frame.height != h) {
      frame?.recycle()
      frame = Bitmap.createBitmap(bufferWidth, h, Bitmap.Config.ARGB_8888)
      frameBitmap = frame
    }
    val bytes = plane.buffer
    bytes.rewind()
    val needed = bufferWidth * h * 4
    if (bytes.remaining() >= needed) {
      frame.copyPixelsFromBuffer(bytes)
    } else {
      // 일부 기기는 마지막 행의 패딩을 뺀 rowStride*(h-1)+w*4 크기로 준다. copyPixelsFromBuffer 는 비트맵 전체 크기를 요구하므로
      // 부족분(오른쪽 패딩, 어차피 clip 되어 그려지지 않는다)을 채운 임시 버퍼로 복사한다.
      var pad = paddedScratch
      if (pad == null || pad.capacity() < needed) {
        pad = ByteBuffer.allocateDirect(needed).order(ByteOrder.nativeOrder())
        paddedScratch = pad
      }
      pad.clear()
      pad.put(bytes)
      pad.limit(needed)
      pad.position(0)
      frame.copyPixelsFromBuffer(pad)
    }

    val rotation = image.imageInfo.rotationDegrees
    var lb = letterbox
    if (lb == null || lb.srcW != w || lb.srcH != h || lb.rotation != ((rotation % 360) + 360) % 360) {
      lb = Letterbox(w, h, rotation, inputW, inputH)
      letterbox = lb
    }
    matrix.setValues(lb.matrixValues())
    inputCanvas.drawColor(PAD_COLOR)
    inputCanvas.save()
    inputCanvas.clipRect(lb.padX, lb.padY, lb.padX + lb.contentW, lb.padY + lb.contentH) // stride 패딩 열이 보이지 않게 내용 영역만 그린다
    inputCanvas.drawBitmap(frame, matrix, paint)
    inputCanvas.restore()

    fillInput()
    outputBuffer.rewind()
    interpreter.run(inputBuffer, outputBuffer)
    readOutput()

    val decoded = YoloDecoder.decode(outputFloats, layout, labels, inputW, inputH, lb)
    val ms = (SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000.0
    return EngineResult(decoded.detections, decoded.rawCount, ms)
  }

  private fun fillInput() {
    inputBitmap.getPixels(pixels, 0, inputW, 0, 0, inputW, inputH)
    inputBuffer.rewind()
    when (inputType) {
      DataType.FLOAT32 -> {
        val fb = inputBuffer.asFloatBuffer()
        for (p in pixels) {
          fb.put(((p shr 16) and 0xFF) / 255f)
          fb.put(((p shr 8) and 0xFF) / 255f)
          fb.put((p and 0xFF) / 255f)
        }
      }
      DataType.UINT8, DataType.INT8 -> {
        val signed = inputType == DataType.INT8
        val lo = if (signed) -128 else 0
        val hi = if (signed) 127 else 255
        val scale = if (inputScale > 0f) inputScale else 1f / 255f
        for (p in pixels) {
          for (shift in intArrayOf(16, 8, 0)) {
            val v = ((p shr shift) and 0xFF) / 255f
            inputBuffer.put(min(hi, max(lo, (v / scale + inputZero).roundToInt())).toByte())
          }
        }
      }
      else -> throw ModelUnavailableException("unsupported input type $inputType")
    }
    inputBuffer.rewind()
  }

  private fun readOutput() {
    outputBuffer.rewind()
    when (outputType) {
      DataType.FLOAT32 -> outputBuffer.asFloatBuffer().get(outputFloats)
      DataType.UINT8 -> for (i in 0 until outputElements) outputFloats[i] = ((outputBuffer.get(i).toInt() and 0xFF) - outputZero) * outputScale
      DataType.INT8 -> for (i in 0 until outputElements) outputFloats[i] = (outputBuffer.get(i).toInt() - outputZero) * outputScale
      else -> throw ModelUnavailableException("unsupported output type $outputType")
    }
  }

  override fun close() {
    interpreter.close()
    frameBitmap?.recycle()
    frameBitmap = null
    paddedScratch = null
    inputBitmap.recycle()
  }

  companion object {
    private val PAD_COLOR = Color.rgb(114, 114, 114) // ultralytics letterbox 패딩 색

    private fun bytesPer(t: DataType) = when (t) {
      DataType.FLOAT32 -> 4
      DataType.UINT8, DataType.INT8 -> 1
      else -> throw ModelUnavailableException("unsupported tensor type $t")
    }

    /**
     * 모델(수십 MB)을 JVM 힙에 사본을 만들지 않고 읽는다. 압축 없이 저장된 에셋이면 파일을 메모리 매핑하고(복사 0),
     * 압축 저장이면 64KB 청크로 direct 버퍼에 채운다. 어느 쪽이든 Interpreter 가 요구하는 native order 의 direct 버퍼다.
     * 에셋이 없으면 IOException.
     */
    private fun loadAssetBuffer(assets: android.content.res.AssetManager, path: String): ByteBuffer {
      try {
        assets.openFd(path).use { fd ->
          java.io.FileInputStream(fd.fileDescriptor).use { fis ->
            return fis.channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength).order(ByteOrder.nativeOrder())
          }
        }
      } catch (e: java.io.FileNotFoundException) {
        // 압축 저장된 에셋은 openFd 가 FileNotFoundException 을 던진다. 진짜로 없는 경우는 아래 open() 이 다시 던진다.
      }
      assets.open(path).use { input ->
        var buf = ByteBuffer.allocateDirect(max(input.available(), 1 shl 20)).order(ByteOrder.nativeOrder())
        val chunk = ByteArray(64 * 1024)
        while (true) {
          val n = input.read(chunk)
          if (n < 0) break
          if (buf.remaining() < n) {
            val bigger = ByteBuffer.allocateDirect(max(buf.capacity() * 2, buf.position() + n)).order(ByteOrder.nativeOrder())
            buf.flip()
            bigger.put(buf)
            buf = bigger
          }
          buf.put(chunk, 0, n)
        }
        buf.flip()
        return buf
      }
    }

    /** 모델이 없거나 형식이 맞지 않으면 ModelUnavailableException. 호출은 메인 스레드가 아닌 곳에서 한다. */
    fun create(context: Context, numThreads: Int): YoloTfliteEngine {
      val assets = context.assets
      val model = try {
        loadAssetBuffer(assets, VisionContract.ASSET_MODEL)
      } catch (e: java.io.IOException) {
        throw ModelUnavailableException("model file not found in app assets: ${VisionContract.ASSET_MODEL} (see docs/ANDROID_VISION_DETECTOR.md)", e)
      }
      val labels = try {
        LabelParser.parse(assets.open(VisionContract.ASSET_LABELS).use { String(it.readBytes(), Charsets.UTF_8) })
      } catch (e: java.io.IOException) {
        throw ModelUnavailableException("labels file not found in app assets: ${VisionContract.ASSET_LABELS} (class order must come from the trained model)", e)
      }
      LabelParser.validate(labels)?.let { throw ModelUnavailableException(it) }

      val interpreter = try {
        Interpreter(model, Interpreter.Options().setNumThreads(numThreads))
      } catch (e: Exception) {
        throw ModelUnavailableException("failed to load the TFLite model: ${e.message}", e)
      }
      try {
        if (interpreter.inputTensorCount != 1 || interpreter.outputTensorCount != 1) {
          throw ModelUnavailableException("expected 1 input and 1 output tensor but got ${interpreter.inputTensorCount} / ${interpreter.outputTensorCount}")
        }
        val inT = interpreter.getInputTensor(0)
        val inShape = inT.shape()
        if (inShape.size != 4 || inShape[0] != 1 || inShape[3] != 3) {
          throw ModelUnavailableException("expected an NHWC [1, H, W, 3] input but got ${inShape.contentToString()}")
        }
        val outT = interpreter.getOutputTensor(0)
        val layout = try {
          YoloDecoder.layoutOf(outT.shape(), labels.size)
        } catch (e: UnsupportedModelOutputException) {
          throw ModelUnavailableException(e.message ?: "unsupported output", e)
        }
        val inQ = inT.quantizationParams()
        val outQ = outT.quantizationParams()
        val describe = "input=${inShape[2]}x${inShape[1]} ${inT.dataType()} output=${outT.shape().contentToString()} ${outT.dataType()} labels=${labels.joinToString(",")}"
        return YoloTfliteEngine(
          interpreter, labels, inShape[2], inShape[1], inT.dataType(), inQ.scale, inQ.zeroPoint, outT.dataType(), outQ.scale, outQ.zeroPoint, layout, describe,
        )
      } catch (e: Exception) {
        interpreter.close()
        throw e
      }
    }
  }
}
