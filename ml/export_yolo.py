"""best.pt를 기기 내 추론용 TFLite(Android)·CoreML(iOS)로 export한다.

backend 런타임과는 분리된 1회성 스크립트다 - 서버는 이 모델을 쓰지 않는다
(docs/ADR/0002-vision-yolo-integration.md 참고). 실행하려면 별도 가상환경에
ml/requirements-export.txt 를 설치해야 한다(torch·ultralytics는 무거워서
backend/requirements.txt 에 넣지 않는다).

사용법:
    python ml/export_yolo.py --weights /path/to/best.pt --out frontend/assets/models
"""

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO


def export_yolo(weights: str, out_dir: str, imgsz: int = 384, name: str = "kickboard_v3") -> None:
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    model = YOLO(weights)

    tflite_src = model.export(format="tflite", int8=True, imgsz=imgsz)
    shutil.move(tflite_src, out_path / f"{name}.tflite")

    coreml_src = model.export(format="coreml", half=True, imgsz=imgsz)
    shutil.move(coreml_src, out_path / f"{name}.mlpackage")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True, help="학습된 best.pt 경로")
    parser.add_argument("--out", required=True, help="export 결과물을 저장할 디렉터리")
    parser.add_argument("--imgsz", type=int, default=384, help="추론 입력 해상도 (기본 384)")
    parser.add_argument("--name", default="kickboard_v3", help="출력 파일 베이스 이름")
    args = parser.parse_args()

    export_yolo(args.weights, args.out, args.imgsz, args.name)


if __name__ == "__main__":
    main()
