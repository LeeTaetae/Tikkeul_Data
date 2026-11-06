"""best.pt 를 Android 앱용 FP32 TFLite + labels.txt 로 변환한다. (INT8 은 학습 데이터가 있을 때만, 아래 참고)

확인된 사실 (2026-11-05, Windows 11, Python 3.11, ultralytics 8.4.202, tensorflow 2.19.0, onnx2tf 1.28.8):
  - ultralytics 8.4.x 의 format="tflite" 는 LiteRT 통합 포맷으로 바뀌었고 **Linux x86 / macOS 에서만** 동작한다
    (Windows: "LiteRT export only supported on Linux x86 and macOS"). 그래서 Windows 에서는 format="saved_model" 로 export 하면
    onnx2tf 가 `<이름>_saved_model/<이름>_float32.tflite` 를 함께 만든다. 이 스크립트는 그 경로를 쓴다.
  - 결과 모델: 입력 `images` [1,H,W,3] float32 NHWC, 출력 `Identity` [1,4+nc,N] float32 (박스는 입력 픽셀 단위 cx,cy,w,h, 클래스 점수는 sigmoid 적용됨),
    단일 입출력, NMS 내장 아님 -> Android YoloDecoder 가 그대로 읽는다.

원본 best.pt 는 읽기만 한다. 산출물이 원본 옆에 생기지 않도록 작업 폴더(--out)에 사본을 두고 거기서 export 한다.

INT8: 보정 데이터(학습에 쓴 데이터 yaml + 이미지)가 있어야 한다. 이 PC 에는 없어서 INT8 은 만들지 않았고, 이 스크립트의 --int8 경로는 **실행해 보지 못했다**.
      임의의 이미지로 INT8 보정을 하지 않는다. --int8 은 --data 가 없으면 거부한다.

사용 (frontend/ml/.venv 처럼 ml/requirements-android-tflite.txt 를 설치한 격리 환경에서):
    python ml/export_android_tflite.py --weights frontend/ml/weights/best.pt --out build/android_model --imgsz 384
    python ml/verify_android_tflite.py --weights frontend/ml/weights/best.pt --tflite build/android_model/kickboard_v3.tflite
결과 kickboard_v3.tflite 와 labels.txt 를 frontend/modules/vision-detector/android/src/main/assets/vision/ 에 복사한다. docs/ANDROID_VISION_DETECTOR.md 참고.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
EXPECTED_LABELS = {"kickboard", "person", "car", "motorcycle", "animal"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_labels(names: dict[int, str], out: Path) -> list[str]:
    if sorted(names) != list(range(len(names))):
        sys.exit(f"클래스 인덱스가 0..n-1 연속이 아니다: {names}")
    ordered = [names[i] for i in sorted(names)]
    if set(ordered) != EXPECTED_LABELS or len(ordered) != len(EXPECTED_LABELS):
        sys.exit(f"best.pt 클래스가 예상한 5종이 아니다: {ordered} (기대: {sorted(EXPECTED_LABELS)})")
    (out / "labels.txt").write_text(
        "# 줄 순서 = 모델 출력 클래스 인덱스 (best.pt 의 model.names 에서 생성, ml/export_android_tflite.py)\n" + "\n".join(ordered) + "\n",
        encoding="utf-8", newline="\n",
    )
    return ordered


def export_float32(weights_copy: Path, imgsz: int) -> Path:
    from ultralytics import YOLO

    saved_model = Path(YOLO(str(weights_copy)).export(format="saved_model", imgsz=imgsz, batch=1, half=False, int8=False))
    found = sorted(saved_model.glob("*_float32.tflite"))
    if not found:
        sys.exit(f"{saved_model} 에 *_float32.tflite 가 없다. 내용: {[p.name for p in saved_model.iterdir()]}")
    return found[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", required=True, type=Path, help="학습된 best.pt (읽기만 한다)")
    ap.add_argument("--out", required=True, type=Path, help="작업·결과 폴더(원본 옆이 아니라 여기에 만든다)")
    ap.add_argument("--imgsz", type=int, default=384, help="추론 입력 해상도. 프로젝트 관례는 384(ml/export_yolo.py 와 같다)")
    ap.add_argument("--int8", action="store_true", help="INT8 도 만든다(미실행 경로). --data 필수")
    ap.add_argument("--data", type=Path, default=None, help="INT8 보정에 쓸 학습 데이터 yaml(학습에 쓴 것). 없으면 --int8 을 거부한다")
    a = ap.parse_args()

    if a.int8 and not a.data:
        sys.exit("--int8 은 학습에 쓴 데이터 yaml(--data)이 있어야 한다. 임의 데이터로 INT8 보정을 하지 않는다.")
    if not a.weights.exists():
        sys.exit(f"{a.weights} 가 없다")

    from ultralytics import YOLO

    a.weights, a.out = a.weights.resolve(), a.out.resolve()
    a.out.mkdir(parents=True, exist_ok=True)
    before = sha256(a.weights)
    work = a.out / "work"
    work.mkdir(exist_ok=True)
    copy = work / "best.pt"
    shutil.copyfile(a.weights, copy)
    assert sha256(copy) == before
    # onnx2tf 가 현재 폴더에 보정 샘플(calibration_image_sample_data_*.npy)을 내려받아 두므로, 저장소가 더러워지지 않게 작업 폴더로 옮겨 실행한다.
    os.chdir(work)

    names = YOLO(str(copy)).names
    labels = write_labels(names, a.out)
    print("labels.txt:", labels)

    tflite = export_float32(copy, a.imgsz)
    final = a.out / "kickboard_v3.tflite"
    shutil.copyfile(tflite, final)
    print("FP32 TFLite:", final, f"{final.stat().st_size / 1e6:.2f}MB")

    if a.int8:
        print("INT8 경로는 이 PC 에서 실행하지 못했다. 직접 확인하고, 반드시 verify_android_tflite.py 로 FP32 와 비교할 것.")

    print("== 해시 (docs/ANDROID_VISION_DETECTOR.md 의 모델 기록표에 적는다) ==")
    for f in (a.weights, final, a.out / "labels.txt"):
        print(f"  {sha256(f)}  {f.name}")
    after = sha256(a.weights)
    print("best.pt 실행 전후 동일:", before == after)
    if before != after:
        sys.exit("원본 best.pt 가 바뀌었다!")


if __name__ == "__main__":
    main()
