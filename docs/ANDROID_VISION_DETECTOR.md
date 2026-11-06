# Android 실시간 객체 탐지 (vision-detector)

iOS 에서만 동작하던 전방 위험 객체 탐지(사람·동물·킥보드·자동차·오토바이 5종)를 Android 에서도 쓰기 위한 네이티브 모듈이다.
설계 배경은 [ADR 0002](ADR/0002-vision-yolo-integration.md). 이 문서는 구현 구조, **모델 준비 방법**, **실기기 검증 절차**를 적는다.

## 0. 현재 상태 (2026-11-05) — 먼저 읽을 것

| 항목 | 상태 |
|---|---|
| Kotlin 코드 컴파일 · 앱 전체 Android 빌드(debug) | **성공** (이 PC, JDK 17, Gradle 9.4.1) |
| 앱 전체 Android release 빌드(R8 축소·난독화) | **성공** (비전 모듈·LiteRT·CameraX 클래스 유지, 16KB 정렬 통과). 단, R8 이후 **실행**은 확인하지 못했다 |
| Kotlin 단위 테스트(디코딩·기하·fps·라벨·이벤트 계약 + **실제 모델 출력 텐서**) | **34개 통과** |
| JS 계약 테스트(iOS Swift 소스 ↔ Android 픽스처) | **18개 통과**, 프런트 전체 **536개 통과**, TypeScript 오류 0 |
| 5종 YOLO 원본 `best.pt` | **확보** (`frontend/ml/weights/best.pt`, SHA-256 `F7FE732C…BAED`, Git 제외) |
| FP32 TFLite 변환 · PyTorch 와의 수치 비교 | **완료** — 같은 입력에서 점수 최대오차 1.8e-6, 박스 1.2e-3 px (§3) |
| TFLite 모델 배치 | **완료** — `assets/vision/kickboard_v3.tflite`(FP32, 37.8MB, Git 제외) + `labels.txt`. debug APK 에 포함 확인 |
| INT8 변환 | **하지 않음** — 보정에 쓸 학습 데이터(`v4_colab.yaml`·이미지)가 이 PC 에 없고, 임의 데이터로 보정하지 않는다 |
| 실제 Android 기기 동작(카메라, 추론, FPS, 정확도, 발열, 내비 동시 동작) | **미검증 — 기기가 연결되지 않았다. "동작한다"고 말할 수 없다** |

모델·`labels.txt` 가 없는 빌드에서는 앱이 **정상 실행**되고, Android 비전 탐지만 `onError`("model file not found in app assets: …")를 보내며 카메라는 열지 않는다.
임의의 공개 YOLO 모델로 대체하거나 재학습하지 않았다.

## 1. 구조

```
frontend/modules/vision-detector/
  expo-module.config.json      platforms: apple + android (iOS 항목은 그대로)
  ios/                         ← 변경 없음 (VisionDetectorModule.swift, kickboard_v3.mlpackage 는 Git 제외)
  android/
    build.gradle               CameraX 1.5.3, LiteRT 1.4.2, lifecycle-process 2.10.0
    consumer-rules.pro         LiteRT JNI 클래스 keep (R8 대비)
    src/main/AndroidManifest.xml     CAMERA 권한, camera feature required=false
    src/main/assets/vision/    ← 모델 배치 위치 (kickboard_v3.tflite, labels.txt). tflite 는 Git 제외
    src/main/java/com/tikkeuldata/vision/
      VisionDetectorModule.kt  모듈 이름 "VisionDetector", 이벤트 onDetections/onError, prop targetFps
      VisionDetectorView.kt    CameraX(ImageAnalysis + 선택적 Preview), 권한, 수명 주기, 스로틀, 발열 대응
      YoloTfliteEngine.kt      LiteRT Interpreter, 전처리(회전+letterbox), 추론, 텐서 형식 자동 감지
      YoloDecoder.kt           출력 텐서 → 탐지(클래스별 NMS, 하한 0.25), 순수 Kotlin
      LetterboxGeometry.kt     회전·letterbox 기하와 역변환, 순수 Kotlin
      FpsGovernor.kt           5fps 기준 스로틀 + 추론 시간·발열 기반 자동 하향, 순수 Kotlin
      VisionContract.kt        iOS 와 같은 JS 계약(키·라벨·상수), 이벤트 payload, labels.txt 검증
    src/test/…                 JVM 단위 테스트 + resources/vision-contract.json(JS 테스트와 공유하는 계약 픽스처)
frontend/src/native/visionDetectorView.tsx   Android 분기만 추가 (iOS 분기 그대로)
ml/export_android_tflite.py                  best.pt → FP32 TFLite + labels.txt (Windows 에서 실행·검증함, INT8 경로는 미실행)
ml/verify_android_tflite.py                  PyTorch ↔ TFLite 수치·탐지 비교 + Kotlin 실모델 출력 픽스처 생성
ml/requirements-android-tflite.txt           변환용 격리 venv 요구 패키지(동작 확인한 조합)
```

### 동작 흐름
`CameraX ImageAnalysis(RGBA, 640x480 요청, 최신 프레임만)` → fps 스로틀 → 프레임을 `rotationDegrees` 로 세로로 돌리며 모델 입력 크기에 비율 유지(letterbox, 회색 114) → LiteRT 추론
→ 출력 해석(클래스 최고 점수 ≥ 0.25, 클래스별 NMS IoU 0.45, 최대 50개) → 모델 좌표를 **세로 프레임 기준 0~1, 좌상단 원점**으로 역변환 → `onDetections`.

### iOS 와 같은 이벤트 계약 (JS 는 그대로)
```
onDetections.nativeEvent = {
  detections: [{ class: "person"|"kickboard"|"car"|"motorcycle"|"animal", confidence: Double,
                 box: { x, y, width, height } /* 0~1, 좌상단 원점, y 는 위→아래, 세로 프레임 */ }],
  debugRawType: String, debugRawCount: Int, debugRecognizedCount: Int }
onError.nativeEvent = { message: String }
```
- 클래스별 confidence 임계값(기본 0.8, 보호구역 person 0.25)은 **JS 가 적용**한다(`sensitivityProfile.ts`, 변경 없음). 네이티브는 JS 의 가장 낮은 임계값(0.25) 이하인 하한(0.25)까지 내보낸다. 이 하한이 0.25 보다 커지면 보호구역 person 이 JS 에 도달하지 못하므로 테스트가 막는다.
- 모델 라벨 `car` → 앱의 `vehicle` 변환은 기존 `fromModelDetections` 가 한다.
- 기본 추론 빈도는 JS 가 넘기는 `targetFps`(기본 5, 보호구역 10; iOS 와 같음). 기기가 못 따라가면 `FpsGovernor` 가 낮춘다(추론 시간×1.25 가 간격보다 길면 하향, 최소 1fps).
- 계약은 iOS `VisionDetectorModule.swift` 소스에서 키를 읽어 Android 픽스처와 대조하는 JS 테스트(`tests/vision-android-contract.test.mjs`)로 고정한다.

### iOS 와 다른 점
| | iOS | Android |
|---|---|---|
| 카메라 | AVCaptureSession | CameraX. 카메라를 **앱 프로세스 수명(ProcessLifecycleOwner)** 에 묶는다 |
| 내비 동시 동작 | 카카오 내비가 모달 → RN 화면이 계속 살아 있음 | 카카오 내비는 **별도 Activity** → MainActivity 가 stop 된다. Activity 수명에 묶으면 탐지가 끊겨서 프로세스 수명에 묶음. 앱이 백그라운드로 가면 CameraX 가 카메라를 닫는다 |
| 모델 | CoreML `kickboard_v3.mlpackage` (Vision 이 NMS 처리) | TFLite `kickboard_v3.tflite` + `labels.txt`. 디코딩·NMS·좌표 변환을 직접 한다 |
| 회전 | Vision `.right` | `ImageInfo.rotationDegrees` 로 회전 |
| 미리보기 | 1x1 숨김 | 뷰 크기 ≥ 64px 일 때만 Preview 를 묶는다(1x1 숨김이면 분석만) |
| 발열 | 미구현 | `PowerManager` thermal status: SEVERE 2fps, CRITICAL 이상 일시 중지 (ADR 0002 §4) |

## 2. 빌드 (Windows)

```powershell
cd frontend\android
$env:JAVA_HOME = "$env:USERPROFILE\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2"   # 또는 JDK 17
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :tikkeul-vision-detector:testDebugUnitTest     # Kotlin 컴파일 + 단위 테스트 (약 10~30초)
.\gradlew.bat :app:assembleDebug                              # 앱 전체 (처음 10분 이상)
```
- 새 네이티브 모듈이므로 **Android 앱은 반드시 다시 빌드**해야 한다(JS 만 새로 불러서는 안 된다). 모듈이 없는 예전 APK 에 새 JS 가 올라가도 앱은 죽지 않고 탐지만 꺼진다(`visionDetectorView.tsx` 가 모듈 존재를 확인).
- 모델이 없으면 빌드 로그에 `[vision-detector] WARNING: … is missing …` 이 두 번 찍힌다(빌드는 실패하지 않는다).
- 빌드 후 APK 에서 확인한 것: `CAMERA` 권한 병합, 비전/CameraX/LiteRT 클래스 포함, 카카오 내비 클래스 유지, `libtensorflowlite_jni.so` 4개 ABI(arm64 4.5MB), 16KB 페이지 정렬(zipalign `-P 16`, ELF `p_align=0x4000`) 통과.

## 3. 모델 준비 (팀 필독)

### 현재 어디에 있나
- 원본 `best.pt`: `frontend/ml/weights/best.pt` (18.3MB). `*.pt` 규칙으로 **Git 에서 제외**된다. 변환 과정에서 수정·덮어쓰지 않았다(실행 전후 SHA-256 동일).
- 확인한 메타데이터: Ultralytics 8.4.198 로 학습, `task=detect`, YOLO11s(파라미터 9.41M), `nc=5`, 클래스 `0 kickboard, 1 person, 2 car, 3 motorcycle, 4 animal`(ADR 기록·앱 JS 라벨과 일치), 표준 `Detect` 헤드(NMS 내장 아님), 학습 해상도 640.
- **출처 주의**: `train_args` 가 `data=/content/proj/datasets/v4_colab.yaml`, `model=…/train_v5_aug/weights/last.pt` 로 나온다. ADR 0002 와 iOS 모델 이름(`kickboard_v3`, `train_v3_5cls`)은 v3 계열이다. 즉 이 `best.pt` 는 ADR 시점(v3)보다 **새로 이어서 학습한 가중치**일 수 있고, iOS 의 `kickboard_v3.mlpackage` 가 정확히 이 파일에서 나온 것인지는 이 PC 에서 확인할 수 없다(mlpackage 가 없다). iOS 와 Android 결과가 일치해야 하면 같은 이미지를 두 기기에서 돌려 대조하거나, iOS 모델을 이 `best.pt` 로 다시 export 해야 한다.
- iOS 용 `kickboard_v3.mlpackage` 는 Git 에 없고(`ios/kickboard_v3.mlpackage` 는 `.gitignore`) 이 PC 에도 없다. 건드리지 않았다.

### 변환 (실제로 실행해 확인한 절차)
별도 격리 환경 `frontend/ml/.venv`(Git 제외)에서만 실행한다. 터널 PoC venv(numpy 2.x)·conda `py311` 은 건드리지 않는다 — Ultralytics 8.4 의 TF 변환이 `numpy<2`·`tensorflow<=2.19` 를 요구하기 때문이다.
```powershell
python -m venv frontend\ml\.venv                       # Python 3.11
frontend\ml\.venv\Scripts\python -m pip install -r ml\requirements-android-tflite.txt   # 약 2.7GB
frontend\ml\.venv\Scripts\python ml\export_android_tflite.py --weights frontend\ml\weights\best.pt --out build\android_model --imgsz 384
frontend\ml\.venv\Scripts\python ml\verify_android_tflite.py --weights frontend\ml\weights\best.pt --tflite build\android_model\kickboard_v3.tflite
```
- **Windows 에서는 `format="tflite"` 가 막혀 있다.** Ultralytics 8.4.x 가 이 포맷을 LiteRT 통합 포맷으로 바꿨고 Linux x86/macOS 에서만 동작한다(`LiteRT export only supported on Linux x86 and macOS`). 스크립트는 `saved_model` 로 export 해 onnx2tf 가 함께 만드는 `*_float32.tflite` 를 쓴다.
- 입력 크기 384 는 프로젝트 관례(`ml/export_yolo.py` 기본값)다. iOS 모델의 실제 입력 크기는 mlpackage 가 없어 확인하지 못했다.
- 변환 결과 파일 해시는 실행마다 달라질 수 있다(변환기가 메타데이터를 새로 쓴다). 같은 입력에서 출력이 비트까지 같음을 확인했다(배치 모델 vs 재생성 모델 최대 차이 0.0). 해시가 아니라 `verify_android_tflite.py` 결과로 판단한다.
- **클래스 순서는 추측하지 않는다.** `labels.txt` 는 `best.pt` 의 `model.names` 에서 만들고, 앱은 그 줄 순서를 클래스 인덱스로 쓰며 5종 집합이 다르면 로드를 거부한다. 출력 속성 수(9) = 4 + 라벨 개수(5) 도 확인했다.

#### 실제 텐서 구조 (변환 결과)
| | 값 |
|---|---|
| 입력 | `images` `[1, 384, 384, 3]` float32 NHWC, RGB 0~1, 양자화 없음 |
| 출력 | `Identity` `[1, 9, 3024]` float32 (채널 우선: `cx, cy, w, h` + 클래스 5개 점수), 입출력 각 1개 |
| 박스 단위 | **입력 픽셀**(0~384). 클래스 점수는 sigmoid 적용된 0~1 |
| 앵커 수 | 3024 = 48² + 24² + 12² (stride 8/16/32) |
| 연산자 | 표준 내장 연산자만(CONV_2D v6, RESIZE_NEAREST_NEIGHBOR v3 등), Flex·커스텀 없음. `min_runtime_version` 2.9.0 |
| Android 호환 | `YoloDecoder.layoutOf` 가 `[1,9,3024]` 를 채널 우선으로 읽고, 값 범위로 픽셀 단위를 판별한다. **실제 출력 텐서를 Kotlin 디코더에 넣는 단위 테스트 통과**. LiteRT 1.4.2 런타임으로 이 모델을 로드·실행한 것은 아직 못 했다(기기 필요) |

#### PyTorch 와의 비교 결과 (`ml/verify_android_tflite.py`)
같은 입력(Android 와 같은 회전·letterbox 전처리)에서:
| 비교 | 결과 |
|---|---|
| 원시 출력 텐서, PyTorch vs TFLite | 점수 최대오차 **1.8e-6**, 박스 최대오차 **1.2e-3 px** → 변환은 수치적으로 동일 |
| 같은 텐서를 같은 디코더로 디코딩 | bus 4개 vs 4개, zidane 3개 vs 3개, **전부 IoU≥0.99·같은 클래스**, 점수 차 ≤ 7.5e-7 |
| `ultralytics predict` 와 비교 | 박스·클래스는 대부분 겹치고(IoU≥0.6 일치 7/7, IoU≥0.85 일치 5/7) 점수가 0.01~0.05 다르다. 원인은 변환이 아니라 **전처리 차이**(predict 는 직사각형 letterbox, Android 는 정사각형 letterbox) |
- 샘플 이미지는 Ultralytics 패키지 번들(bus.jpg, zidane.jpg) 두 장뿐이라 **정확도(mAP) 검증이 아니다**. 라벨 있는 검증 데이터가 이 PC 에 없다.
- Kotlin 쪽 확인: 위 두 케이스의 원시 출력 텐서(`android/src/test/resources/real/*.f32`, 모델이 아니라 출력만 담음)를 `RealModelOutputTest` 가 읽어 독립 구현(torchvision NMS) 결과와 비교한다(IoU≥0.99, 점수 ±0.002). 센서 가로 프레임 + 회전 90°(세로 사람), 회전 0° 두 방향을 모두 쓴다.

#### INT8 은 만들지 않았다
- INT8 보정에는 학습에 쓴 데이터(`v4_colab.yaml` 과 이미지)가 필요하다. 이 PC 에는 없고, **임의의 이미지로 보정하지 않았다**. `export_android_tflite.py --int8` 은 `--data` 없이는 거부하며 이 경로는 실행해 보지 못했다.
- FP16(`*_float16.tflite`, 18.9MB, 입출력은 float32)은 변환 부산물로 생겼지만 Android 에서 시험하지 않았다. 크기·속도가 문제면 후속 후보다.
- FP32(YOLO11s, 7.7 GFLOPs)가 5fps 를 내는지는 기기에서 재야 한다(미측정). 부족하면 `FpsGovernor` 가 스스로 낮추고, 그래도 느리면 INT8/FP16/더 작은 모델을 검토한다.

### 배치
```
frontend/modules/vision-detector/android/src/main/assets/vision/kickboard_v3.tflite
frontend/modules/vision-detector/android/src/main/assets/vision/labels.txt
```
`*.tflite` 는 `.gitignore` 로 Git 에서 제외된다. `labels.txt` 는 작아서 추적할 수 있지만 **반드시 같은 best.pt 에서 나온 것**이어야 하므로 모델과 함께 받는다.

> **Git 규칙 주의**: 루트 `.gitignore` 의 `android/` 규칙 때문에 비전 모듈의 `android/` 소스 전체가 무시되고 있었다(카카오·iOS 모듈은 `!…` 예외가 있었다). 같은 방식의 예외 2줄(`!frontend/modules/vision-detector/android/`, `…/**`)을 추가했다. 빌드 산출물(`android/build`, `android/.gradle`)과 `*.tflite` 는 `frontend/modules/vision-detector/.gitignore` 가 다시 제외한다. 이 예외가 없으면 팀원이 커밋·pull 로 Android 소스를 받지 못한다(테스트 `vision-android-contract.test.mjs` 가 확인).

### 팀원에게 배포하는 방법 (Git 을 쓰지 않는다)
`*.pt`·`*.tflite` 는 모두 Git 에서 제외되므로 팀원이 받는 방법은 둘 중 하나다.
- **A. 변환 결과를 받는다(권장, 빠름)**: 모델 담당자가 `kickboard_v3.tflite` + `labels.txt` + 아래 표의 해시를 팀 공유 저장소(비공개 드라이브 등)에 올린다. 팀원은 위 경로에 복사하고 해시를 대조한다: `Get-FileHash kickboard_v3.tflite -Algorithm SHA256`.
- **B. 원본에서 다시 만든다**: 팀 공유 저장소에서 `best.pt` 를 받아 `frontend/ml/weights/best.pt` 에 두고 위 §변환 절차(약 2.7GB 격리 venv, 변환 몇 분)를 실행한 뒤 `verify_android_tflite.py` 결과가 §모델 기록과 같은지(텐서 오차 ~1e-6) 확인한다. 파일 해시는 달라도 된다.

공통:
1. 두 파일을 위 경로에 둔다.
2. 빌드한다. 두 파일이 모두 있으면 `[vision-detector] WARNING` 이 사라진다(없으면 빌드 로그에 경고가 찍힌다).
3. APK 에는 모델이 **무압축**으로 들어가며(디버그 APK 에서 확인) 앱이 파일 매핑으로 읽는다. 모델을 바꾸면 `labels.txt` 도 같은 `best.pt` 에서 다시 만든다.
4. **EAS 클라우드 빌드는 `.gitignore` 된 파일을 업로드하지 않는다.** EAS 로 빌드하려면 빌드 전에 모델을 내려받는 pre-install 스크립트(비공개 URL + EAS secret)가 따로 필요하다 — 아직 구현하지 않았다. 로컬 빌드는 위 방법으로 충분하다.

### 모델 기록 (2026-11-05)
| 항목 | 값 |
|---|---|
| 원본 | `frontend/ml/weights/best.pt`, 19,161,882바이트 (18.3MB) |
| best.pt SHA-256 | `F7FE732C5F918AFDA845E26141848F6FE873803D9CC8DCCBFB67473B3231BAED` |
| 학습 | Ultralytics 8.4.198, YOLO11s, `data=/content/proj/datasets/v4_colab.yaml`, 학습 imgsz 640, 5 클래스 |
| export 도구 | ultralytics 8.4.202 · tensorflow 2.19.0 · onnx2tf 1.28.8 · torch 2.15.0 (Windows 11, Python 3.11) |
| imgsz / 입력 / 출력 | 384 / `[1,384,384,3]` float32 / `[1,9,3024]` float32 |
| `kickboard_v3.tflite` (FP32) | 37,778,139바이트, SHA-256 `CE0F8FE185023C568259AE1B28C19C3DD7385CD141892870E8C21ABA01B54002` (다시 만들면 해시가 달라질 수 있다: 출력은 동일) |
| `labels.txt` | `kickboard, person, car, motorcycle, animal` — SHA-256 `68AC5BF813AA8D5F9CEAD32C153E698A4D8768E2762F9EA90BF0EA31EF0A4FF3` |
| PyTorch ↔ FP32 | 수치 일치(점수 1.8e-6, 박스 1.2e-3 px), 디코딩 결과 일치 |
| INT8 | 미생성(보정 데이터 없음) |

## 4. Android 실기기 테스트 절차

> 아래는 **아직 아무것도 실행하지 않은 체크리스트**다. 결과를 §4.2 표에 기록하기 전에는 "동작함"으로 보고하지 않는다.

### 4.1 준비
1. Android 기기(API 26+, arm64 권장), USB 디버깅 켜기, 케이블 연결. `"$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices` 에 기기가 보여야 한다.
2. 모델·`labels.txt` 를 §3 의 위치에 배치(해시 대조).
3. 설치: `cd frontend` → `npx expo run:android --device`(또는 `:app:assembleDebug` 후 `adb install -r`). Metro: `npm run native:start`.
4. 로그 보기: `adb logcat -s VisionDetector:* ReactNativeJS:*` (추론 시간·유효 fps 가 50프레임마다 찍힌다).

### 4.2 항목별 확인 (기록표)
| # | 확인 | 방법 | 합격 기준 | 결과 |
|---|---|---|---|---|
| 1 | 권한 | 앱 첫 실행 후 홈 → `[DEV] vision-test 열기` | 권한 창 → 허용하면 미리보기, 거부하면 `camera permission denied` 가 화면 오류 목록에 | 미실행 |
| 2 | 세션 진단 | vision-test 오류 목록 | `session setup: camera=bound preview=true fps=5.0 input=… output=… labels=…` 한 줄 | 미실행 |
| 3 | 모델 누락 | 모델 없는 빌드 | `model file not found in app assets` 오류, 카메라 미사용(상태바 카메라 표시 없음) | 미실행 |
| 4 | 5종 탐지 | 사람·동물(사진/인형)·킥보드·자동차·오토바이를 각각 비춤 | 각 클래스가 `topClass` 로 나타남(`vehicle` = car). 기본 0.8 임계값을 못 넘으면 보호구역 모드(person 0.25)로도 확인 | 미실행 |
| 5 | 좌표 방향 | 세로로 든 채 사람을 화면 **하단 중앙에서 가까이** → 멀리·옆으로 | 하단 중앙에서 가까워지면 caution→approach→final, 위쪽·옆 가장자리에서는 advance. 가로/세로가 뒤집힌 듯하면 회전 처리 오류 | 미실행 |
| 6 | 위험 단계·알림 | final 진입 | 배너 + 진동 1회 + TTS(기존 JS 로직). 4초 안 재진입은 재알림 없음 | 미실행 |
| 7 | 유효 FPS | logcat 의 `effective … fps` | 목표 5fps 를 유지하거나, 못 맞추면 스스로 낮춘다(최소 1). 기기별 추론 시간(ms) 기록 | 미실행 |
| 8 | 내비 동시 동작 | 길안내 시작(카카오 네이티브) 후 주행 | 카카오 화면이 앞에 있는 동안에도 logcat 에 추론 로그가 계속 나오고(카메라 사용 표시), 위험 시 진동·TTS 가 난다 | 미실행 |
| 9 | 백그라운드 해제 | 홈 버튼 → 10초 뒤 `adb shell dumpsys media.camera \| findstr com.tikkeuldata` | 앱 카메라 클라이언트가 없고 추론 로그가 멈춘다. 앱 복귀 시 재개 | 미실행 |
| 10 | 화면 전환 반복 | vision-test ↔ 홈 10회, 길안내 시작/종료 5회 | 크래시 없음. `adb shell dumpsys meminfo com.tikkeuldata.app` 의 Java/Native Heap 이 반복 후 계속 늘지 않음, logcat 에 `Camera`/`Interpreter` 관련 경고 없음 | 미실행 |
| 11 | 발열 | 30분 연속 | `adb shell dumpsys thermalservice` 상태 기록. SEVERE 에서 2fps 로 내려가는지(`effective` 로그) | 미실행 |
| 12 | 모델 정확도·후보 비교 | 같은 장면을 iOS(CoreML)와 Android 에서 비교. INT8 은 보정 데이터가 생기면 FP32/FP16 과 비교 | 같은 장면에서 클래스·박스가 비슷한지, 속도(ms) 기록. 정확도(mAP)는 `yolo val` 로 따로. Android 가 iOS 와 크게 다르면 §3 의 출처 주의(v3 vs v4/v5)를 먼저 의심 | 미실행 |
| 13 | 기존 기능 | Android 에서 길안내·TTS·위험 알림·카카오 내비 | 이번 변경 전과 동일 | 미실행 |

### 4.3 실패 시 보는 곳
- 이벤트가 안 온다: logcat `VisionDetector` 경고, vision-test 오류 목록(모델/권한/카메라).
- 박스가 엉뚱하다: 모델 출력 좌표가 픽셀인지 정규화인지는 값 범위로 자동 판별한다(`YoloDecoder`). `unsupported output shape` 면 export 형식(end2end/NMS 내장 여부)을 확인.
- 너무 느리다: `FpsGovernor` 가 낮추는 중인지 로그 확인. 스레드 수는 `max(2, 코어/2)` 최대 4. GPU delegate 는 아직 쓰지 않는다(CPU/XNNPACK).

## 5. 의존성과 호환성 (이 PC 의 실제 해석 결과)

| 라이브러리 | 선언 | 앱에서 해석된 버전 | 비고 |
|---|---|---|---|
| androidx.camera: core / camera2 / lifecycle / view | 1.5.3 | **1.5.3** (4개 일치) | minSdk 21, 앱 minSdk 26 |
| com.google.ai.edge.litert:litert | 1.4.2 | **1.4.2** (+ litert-api 1.4.2) | `org.tensorflow.lite.Interpreter` API. 2.x 는 API 가 달라 아직 쓰지 않음 |
| androidx.lifecycle:lifecycle-process | 2.10.0 | 2.10.0 | Expo 카탈로그가 이미 2.10.0 고정 |
| androidx.core:core-ktx | 1.17.0 | 1.18.0 | 다른 라이브러리가 올림(다운그레이드 없음) |
| expo-modules-core | 58.0.29 | 그대로 | `ExpoView`, `EventDispatcher`, `OnViewDestroys`, `appContext.permissions` 사용 |
- 컴파일 SDK 37, minSdk 26, Kotlin 2.2.10. 컴파일 경고·오류 없음.
- 이 모듈은 카카오 내비 모듈과 서로 참조하지 않는다(테스트로 확인). 앱 전체 빌드에서 카카오 클래스·SDK 가 그대로 들어간 것을 확인했다.
- Release(R8) 빌드: 성공. `mapping.txt` 에서 비전 모듈 클래스(`VisionDetectorModule`·`YoloTfliteEngine` 등은 이름만 난독화), `org.tensorflow.lite.Interpreter/Tensor/DataType`(keep 규칙으로 이름 유지), CameraX 클래스를 확인했다. release APK 권한은 이전 release 대비 `CAMERA` 하나만 늘었다.
- 코드 리뷰로 찾아 고친 것: ① 레터박스 여백 상자가 최대 개수 슬롯을 차지하던 디코더 결함(단위 테스트가 발견), ② `ImageProxy` 버퍼가 마지막 행 패딩 없이 짧게 올 때 `BufferUnderflowException` 이 날 수 있던 문제(방어 코드 추가, 이 경로는 Bitmap 이 필요해 JVM 단위 테스트가 없고 소스 수준 검사만 있다 — 실기기 확인 필요).

## 6. 알려진 제한 · 미검증

- **실기기 미검증 전부**(§0). 특히 CameraX 프레임 방향(`rotationDegrees`), 1x1 숨김 상태에서의 분석 지속, ProcessLifecycleOwner 바인딩과 카카오 Activity 전환, 권한 요청 콜백, 발열 리스너는 코드 리뷰와 컴파일까지만 확인했다.
- 모델: 실제 `best.pt` 로 만든 FP32 TFLite 를 **Python(ai-edge-litert 2.3.0)** 으로 돌려 PyTorch 와 비교했고, 그 출력 텐서를 Kotlin 디코더로 검증했다. 그러나 **Android 의 LiteRT 1.4.2 런타임으로 이 모델을 로드·추론한 적은 없다**(기기 필요). 연산자는 표준이고 `min_runtime_version` 이 2.9.0 이라 가능성은 높지만 확인은 아니다.
- 카메라 프레임 → 모델 입력 전처리(Bitmap/Canvas 회전·letterbox)는 JVM 에서 돌릴 수 없어, Python 에서 같은 아핀 변환으로 모사해 검증했을 뿐 Android 코드 자체의 실행 결과는 아니다.
- iOS `kickboard_v3.mlpackage` 와 이 `best.pt` 의 동일성은 확인하지 못했다(§3 출처 주의).
- 지원하지 않는 모델 형식: NCHW 입력, NMS 내장(end2end) 출력, 다중 출력.
- GPU/NNAPI delegate 미사용(CPU XNNPACK). 성능이 부족하면 후속 과제.
- 가로 모드·다중 창은 고려하지 않았다(앱이 세로 고정).
- 모델 클래스 순서를 `labels.txt` 로 받는 방식이므로, 모델을 바꿀 때 `labels.txt` 도 같이 바꿔야 한다.
