"""변환한 TFLite 가 원본 best.pt(PyTorch)와 같은 결과를 내는지 검증하고, Android Kotlin 디코더용 실모델 픽스처를 만든다.

검증 3가지 (모두 같은 입력으로 비교):
  1. 텐서 수치: PyTorch Detect 헤드 원시 출력 [1,9,N] 과 TFLite 출력의 최대 절대 오차.
  2. 탐지 결과: TFLite 출력 -> (독립 구현) torchvision NMS -> 업라이트 정규화 좌표  vs  ultralytics predict 결과(원본 이미지 좌표 -> 정규화).
  3. 픽스처: Kotlin 단위 테스트(RealModelOutputTest)가 읽을 원시 출력 텐서(.f32)와 기대 탐지(JSON)를 쓴다.
Android 전처리와 같은 방식(센서 프레임 -> 시계방향 회전 -> 비율 유지 letterbox 회색 114 -> RGB/255 -> NHWC)으로 입력을 만든다.
샘플 이미지는 ultralytics 패키지에 번들된 bus.jpg(세로, 센서 가로 + 회전 90 으로 모사)와 zidane.jpg(가로, 회전 0). 정확도(mAP) 검증이 아니라
**변환이 원본과 수치적으로 같은지** 보는 것이다. 원본 best.pt 는 읽기만 한다.

사용:  python ml/verify_android_tflite.py --weights frontend/ml/weights/best.pt --tflite <best_float32.tflite> --out <픽스처 폴더>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
import cv2
import numpy as np
import torch
import torchvision
from ai_edge_litert.interpreter import Interpreter
from ultralytics import YOLO
import ultralytics

CONF_FLOOR = 0.25  # 앱 네이티브 하한(VisionContract.CONFIDENCE_FLOOR)
IOU = 0.45
INPUT = 384


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def affine_for(src_w: int, src_h: int, rotation: int, dst: int):
    """Kotlin Letterbox.matrixValues() 와 같은 소스->모델 아핀(2x3). 업라이트 크기, scale, pad 도 돌려준다."""
    up_w, up_h = (src_w, src_h) if rotation % 180 == 0 else (src_h, src_w)
    s = min(dst / up_w, dst / up_h)
    pad_x, pad_y = (dst - up_w * s) / 2, (dst - up_h * s) / 2
    m = {
        0: [[s, 0, pad_x], [0, s, pad_y]],
        90: [[0, -s, s * src_h + pad_x], [s, 0, pad_y]],
        180: [[-s, 0, s * src_w + pad_x], [0, -s, s * src_h + pad_y]],
        270: [[0, s, pad_x], [-s, 0, s * src_w + pad_y]],
    }[rotation]
    return np.array(m, dtype=np.float32), up_w, up_h, s, pad_x, pad_y


def make_input(sensor_rgb: np.ndarray, rotation: int) -> tuple[np.ndarray, dict]:
    h, w = sensor_rgb.shape[:2]
    m, up_w, up_h, s, pad_x, pad_y = affine_for(w, h, rotation, INPUT)
    out = cv2.warpAffine(sensor_rgb, m, (INPUT, INPUT), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(114, 114, 114))
    x = out.astype(np.float32)[None] / 255.0  # NHWC RGB
    return x, dict(up_w=up_w, up_h=up_h, scale=s, pad_x=pad_x, pad_y=pad_y)


def decode_independent(out: np.ndarray, g: dict) -> list[dict]:
    """out: [1, 4+nc, N] (cx,cy,w,h px + class scores). torchvision NMS 로 독립 구현, 업라이트 정규화 좌표로 변환."""
    t = torch.from_numpy(out[0])  # [9, N]
    boxes_cxcywh, scores_all = t[:4].T, t[4:].T
    conf, cls = scores_all.max(dim=1)
    keep = conf >= CONF_FLOOR
    b, c, k = boxes_cxcywh[keep], conf[keep], cls[keep]
    xyxy = torch.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 0] + b[:, 2] / 2, b[:, 1] + b[:, 3] / 2], dim=1)
    idx = torchvision.ops.batched_nms(xyxy, c, k, IOU)
    res = []
    cw, ch = g["up_w"] * g["scale"], g["up_h"] * g["scale"]
    for i in idx.tolist():
        x1, y1, x2, y2 = xyxy[i].tolist()
        nx1, ny1 = np.clip((x1 - g["pad_x"]) / cw, 0, 1), np.clip((y1 - g["pad_y"]) / ch, 0, 1)
        nx2, ny2 = np.clip((x2 - g["pad_x"]) / cw, 0, 1), np.clip((y2 - g["pad_y"]) / ch, 0, 1)
        if nx2 > nx1 and ny2 > ny1:
            res.append(dict(cls=int(k[i]), conf=float(c[i]), x=float(nx1), y=float(ny1), w=float(nx2 - nx1), h=float(ny2 - ny1)))
    return sorted(res, key=lambda d: -d["conf"])


def iou_xywh(a: dict, b: dict) -> float:
    ax2, ay2, bx2, by2 = a["x"] + a["w"], a["y"] + a["h"], b["x"] + b["w"], b["y"] + b["h"]
    iw, ih = min(ax2, bx2) - max(a["x"], b["x"]), min(ay2, by2) - max(a["y"], b["y"])
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a["w"] * a["h"] + b["w"] * b["h"] - inter)


def match(ref: list[dict], got: list[dict], min_iou: float = 0.85):
    used, pairs = set(), []
    for r in ref:
        best, bj = 0.0, -1
        for j, g in enumerate(got):
            if j in used or g["cls"] != r["cls"]:
                continue
            v = iou_xywh(r, g)
            if v > best:
                best, bj = v, j
        if best >= min_iou:
            used.add(bj)
            pairs.append((r, got[bj], best))
    return pairs


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", required=True, type=Path)
    ap.add_argument("--tflite", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=None, help="Kotlin 테스트 픽스처를 쓸 폴더(없으면 쓰지 않는다)")
    a = ap.parse_args()

    before = sha256(a.weights)
    yolo = YOLO(str(a.weights))
    names = {int(k): v for k, v in yolo.names.items()}
    net = yolo.model.float().eval()
    it = Interpreter(model_path=str(a.tflite))
    it.allocate_tensors()
    i_d, o_d = it.get_input_details()[0], it.get_output_details()[0]
    print(f"TFLite 입력 {i_d['shape'].tolist()} {i_d['dtype'].__name__} | 출력 {o_d['shape'].tolist()} {o_d['dtype'].__name__} | 클래스 {names}")

    assets = Path(ultralytics.__file__).parent / "assets"
    cases = [
        ("bus_portrait_rot90", cv2.cvtColor(cv2.resize(cv2.imread(str(assets / "bus.jpg")), (480, 640), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB), 90),
        ("zidane_landscape_rot0", cv2.cvtColor(cv2.resize(cv2.imread(str(assets / "zidane.jpg")), (640, 360), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB), 0),
    ]
    fixture = {"version": 1, "model_sha256_note": "fixture 는 모델 파일이 아니라 모델 출력 텐서만 담는다", "labels": [names[i] for i in sorted(names)], "dst": INPUT, "cases": []}
    worst_tensor = 0.0
    for name, upright_rgb, rotation in cases:
        # 센서 프레임 = 업라이트를 반시계 90° 돌린 것(시계방향 rotation 만큼 돌리면 업라이트). rotation 0 이면 그대로.
        k = {0: 0, 90: 1, 180: 2, 270: 3}[rotation]
        sensor = np.ascontiguousarray(np.rot90(upright_rgb, k))
        assert np.array_equal(np.rot90(sensor, {0: 0, 90: 3, 180: 2, 270: 1}[rotation]), upright_rgb)
        x, g = make_input(sensor, rotation)

        it.set_tensor(i_d["index"], x)
        it.invoke()
        tfl = it.get_tensor(o_d["index"]).copy()  # [1,9,N]
        with torch.no_grad():
            pt = net(torch.from_numpy(x).permute(0, 3, 1, 2).contiguous())
        pt = (pt[0] if isinstance(pt, (list, tuple)) else pt).numpy()
        diff = np.abs(pt - tfl)
        scores_diff = diff[:, 4:, :].max()
        box_diff = diff[:, :4, :].max()
        worst_tensor = max(worst_tensor, float(diff.max()))
        print(f"[{name}] 텐서 비교 PyTorch vs TFLite: 점수 최대오차 {scores_diff:.2e}, 박스(px) 최대오차 {box_diff:.2e}")

        got = decode_independent(tfl, g)
        up_h, up_w = upright_rgb.shape[:2]
        res = yolo.predict(cv2.cvtColor(upright_rgb, cv2.COLOR_RGB2BGR), imgsz=INPUT, conf=CONF_FLOOR, iou=IOU, verbose=False)[0]
        ref = []
        for b in res.boxes:
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            ref.append(dict(cls=int(b.cls[0]), conf=float(b.conf[0]), x=x1 / up_w, y=y1 / up_h, w=(x2 - x1) / up_w, h=(y2 - y1) / up_h))
        ref.sort(key=lambda d: -d["conf"])
        pairs = match(ref, got)
        loose = match(ref, got, 0.6)
        # 같은 텐서에서 PyTorch 헤드 출력을 같은 독립 디코더로 디코딩한 결과: 변환 오차만 보는 기준(전처리 차이 없음)
        got_pt = decode_independent(pt, g)
        same = match(got_pt, got, 0.99)
        print(f"[{name}] 같은 텐서 디코딩(PyTorch 헤드 vs TFLite): {len(got_pt)}개 vs {len(got)}개, IoU≥0.99·같은 클래스로 일치 {len(same)}개, 점수 차 최대 {max([abs(p[0]['conf'] - p[1]['conf']) for p in same] or [0]):.1e}")
        print(f"[{name}] ultralytics predict 와 비교(전처리가 다름: predict 는 직사각형 letterbox): predict {len(ref)}개 / TFLite {len(got)}개 / IoU≥0.85 일치 {len(pairs)}개 / IoU≥0.6 일치 {len(loose)}개")
        for r, g_, v in pairs:
            print(f"    {names[r['cls']]:10s} conf PyTorch {r['conf']:.3f} / TFLite {g_['conf']:.3f}  IoU {v:.3f}  box(x,y,w,h)=({r['x']:.3f},{r['y']:.3f},{r['w']:.3f},{r['h']:.3f})")
        for r in ref:
            if all(r is not p[0] for p in pairs):
                print(f"    [PyTorch 에만] {names[r['cls']]} conf {r['conf']:.3f}")
        for g_ in got:
            if all(g_ is not p[1] for p in pairs):
                print(f"    [TFLite 에만] {names[g_['cls']]} conf {g_['conf']:.3f}")

        if a.out:
            a.out.mkdir(parents=True, exist_ok=True)
            fname = f"real-output-{name}.f32"
            (a.out / fname).write_bytes(tfl.astype("<f4").tobytes())
            fixture["cases"].append(dict(
                name=name, srcW=int(sensor.shape[1]), srcH=int(sensor.shape[0]), rotation=rotation, tensor=fname, shape=list(tfl.shape),
                # expected: 같은 텐서를 독립 디코더(torchvision NMS)로 디코딩한 결과. Kotlin YoloDecoder 가 이것과 일치해야 한다.
                expected=[dict(cls=names[r["cls"]], conf=round(r["conf"], 4), x=round(r["x"], 5), y=round(r["y"], 5), w=round(r["w"], 5), h=round(r["h"], 5)) for r in got],
                # ultralytics predict 결과(원본 이미지 기준). 전처리가 달라 완전히 같지는 않으므로 느슨한 확인용.
                pytorch_predict=[dict(cls=names[r["cls"]], conf=round(r["conf"], 4), x=round(r["x"], 5), y=round(r["y"], 5), w=round(r["w"], 5), h=round(r["h"], 5)) for r in ref],
            ))
    if a.out:
        (a.out / "real-model-cases.json").write_text(json.dumps(fixture, ensure_ascii=False, indent=1), encoding="utf-8")
        print("픽스처 저장:", a.out)
    after = sha256(a.weights)
    print(f"전체 텐서 최대 절대오차: {worst_tensor:.2e}")
    print("best.pt SHA-256:", after, "| 실행 전후 동일:", before == after)


if __name__ == "__main__":
    main()
