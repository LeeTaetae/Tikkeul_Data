"""best.pt를 기기 내 추론용 TFLite(Android)·CoreML(iOS)로 export한다.

backend 런타임과는 분리된 1회성 스크립트다 - 서버는 이 모델을 쓰지 않는다
(docs/ADR/0002-vision-yolo-integration.md 참고). 실행하려면 별도 가상환경에
ml/requirements-export.txt 를 설치해야 한다(torch·ultralytics는 무거워서
backend/requirements.txt 에 넣지 않는다).

사용법:
    python ml/export_yolo.py --weights /path/to/best.pt --data /path/to/v3_colab.yaml --out frontend/assets/models
"""

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO


def _replace(dest: Path) -> None:
    # 재실행 시 기존 산출물(.mlpackage는 디렉터리) 위에 move하면 그 안에 중첩돼버린다.
    if dest.is_dir():
        shutil.rmtree(dest)
    elif dest.exists():
        dest.unlink()


def export_yolo(weights: str, data: str, out_dir: str, imgsz: int = 384, name: str = "kickboard_v3") -> None:
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    model = YOLO(weights)

    # data를 안 주면 ultralytics가 int8 캘리브레이션에 기본 데이터셋(coco8)을 쓴다 — 5클래스 킥보드
    # 모델을 엉뚱한 이미지로 양자화하게 돼 정확도가 떨어진다(코드 리뷰 finding 5). 학습 때 쓴 data yaml을 준다.
    tflite_dest = out_path / f"{name}.tflite"
    _replace(tflite_dest)
    tflite_src = model.export(format="tflite", int8=True, imgsz=imgsz, data=data)
    shutil.move(tflite_src, tflite_dest)

    coreml_dest = out_path / f"{name}.mlpackage"
    _replace(coreml_dest)
    coreml_src = model.export(format="coreml", half=True, imgsz=imgsz)
    shutil.move(coreml_src, coreml_dest)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True, help="학습된 best.pt 경로")
    parser.add_argument("--data", required=True, help="int8 캘리브레이션에 쓸 학습 데이터셋 yaml (예: v3_colab.yaml)")
    parser.add_argument("--out", required=True, help="export 결과물을 저장할 디렉터리")
    parser.add_argument("--imgsz", type=int, default=384, help="추론 입력 해상도 (기본 384)")
    parser.add_argument("--name", default="kickboard_v3", help="출력 파일 베이스 이름")
    args = parser.parse_args()

    export_yolo(args.weights, args.data, args.out, args.imgsz, args.name)


if __name__ == "__main__":
    main()
