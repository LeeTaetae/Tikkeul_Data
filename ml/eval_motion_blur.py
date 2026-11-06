"""빠르게 움직이는 객체(모션 블러)에서 모델이 얼마나 놓치는지 잰다.

실제 주행 영상이 없어서, 정지 이미지에 가로 모션 블러를 길이별로 입혀 "빠른 차"를 흉내 낸다.
블러 길이(px)가 길수록 노출 시간 동안 더 많이 움직인 것이다. 이미지마다 라벨의 정답 박스와
IoU>=0.5로 맞는 탐지를 찾고, 그 신뢰도가 앱의 기준값(sensitivityProfile.ts)을 넘는지 센다.

backend 런타임과는 분리된 1회성 스크립트다(export_yolo.py 와 같은 가상환경을 쓴다).

사용법:
    python ml/eval_motion_blur.py --weights best.pt --images path/to/val/images --labels path/to/val/labels
    (labels 는 YOLO txt 형식: "class cx cy w h" 정규화 좌표)
"""

import argparse
import csv
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

BLUR_LENGTHS = [0, 9, 15, 25, 35, 50]
THRESHOLDS = [0.25, 0.3, 0.4, 0.5, 0.6, 0.8]


def motion_blur(img: np.ndarray, length: int) -> np.ndarray:
    if length <= 1:
        return img
    kernel = np.zeros((length, length), np.float32)
    kernel[length // 2, :] = 1.0 / length
    return cv2.filter2D(img, -1, kernel)


def shift(img: np.ndarray, dx: int) -> np.ndarray:
    m = np.float32([[1, 0, dx], [0, 1, 0]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), borderMode=cv2.BORDER_REPLICATE)


def evaluate_policy(weights: str, images: str, labels: str, cls_name: str, imgsz: int, min_height: float, label_id,
                    candidate: float, instant: float, old: float, csv_path=None) -> None:
    """앱의 경고 규칙(useVisionHazardWarning.ts)을 연속 2프레임으로 흉내 내서 잰다.

    프레임 A = 블러 이미지, 프레임 B = 객체가 블러 길이의 절반만큼 옆으로 움직인 뒤의 블러 이미지.
    경고 = 어느 프레임이든 instant 이상, 또는 두 프레임 모두 candidate 이상(같은 객체).
    기존 규칙 = 어느 프레임이든 old 이상. 오탐은 정답과 안 맞는 탐지로 경고가 뜬 2프레임 구간 수다(100구간당).
    ROI(도로 사다리꼴)는 적용하지 않는다 - COCO는 차량 전방 시점이 아니라서 위치 판정이 의미가 없다.
    """
    model = YOLO(weights)
    cls_id = next(k for k, v in model.names.items() if v == cls_name)
    label_id = cls_id if label_id is None else label_id
    image_paths = sorted(p for p in Path(images).iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})

    def detect(frame):
        res = model.predict(frame, imgsz=imgsz, conf=0.01, verbose=False)[0]
        return [(b.xyxy[0].tolist(), float(b.conf)) for b in res.boxes if int(b.cls) == cls_id]

    def best(dets, gt):
        return max((c for box, c in dets if iou(box, gt) >= 0.5), default=0.0)

    def unmatched(dets, gts):
        return [c for box, c in dets if all(iou(box, g) < 0.5 for g in gts)]

    stats = {b: {"gt": 0, "new_hit": 0, "old_hit": 0, "new_fp": 0, "old_fp": 0} for b in BLUR_LENGTHS}
    n_images = 0
    for path in image_paths:
        img = cv2.imread(str(path))
        if img is None:
            continue
        n_images += 1
        label_path = Path(labels) / f"{path.stem}.txt"
        h, w = img.shape[:2]
        gts = load_boxes(label_path, w, h, label_id, min_height)
        all_gts = load_boxes(label_path, w, h, label_id, 0.0)
        for blur in BLUR_LENGTHS:
            dx = max(4, blur // 2)
            moved = lambda boxes: [(x1 + dx, y1, x2 + dx, y2) for x1, y1, x2, y2 in boxes]
            dets_a = detect(motion_blur(img, blur))
            dets_b = detect(motion_blur(shift(img, dx), blur))
            st = stats[blur]
            for gt, gt_b in zip(gts, moved(gts)):
                ca, cb = best(dets_a, gt), best(dets_b, gt_b)
                st["gt"] += 1
                st["new_hit"] += ca >= instant or cb >= instant or (ca >= candidate and cb >= candidate)
                st["old_hit"] += ca >= old or cb >= old
            fa, fb = unmatched(dets_a, all_gts), unmatched(dets_b, moved(all_gts))
            # 앱은 클래스 단위로 이어 본다: A에 이 클래스 후보가 하나라도 있으면 B의 후보는 확정된다.
            a_has_candidate = any(candidate <= c < instant for _, c in dets_a)
            # 같은 오탐이 두 프레임에 다 잡혀도 앱 경고는 한 번이다 - 오탐 경고가 뜬 2프레임 구간 수로 센다.
            st["new_fp"] += any(c >= instant for c in fa) or any(c >= instant or (c >= candidate and a_has_candidate) for c in fb)
            st["old_fp"] += any(c >= old for c in fa + fb)

    print(f"[policy] class={cls_name} gt_boxes={stats[0]['gt']} images={n_images} candidate={candidate} instant={instant} old={old}")
    print("blur_px  recall_new  recall_old  fp_new/100  fp_old/100")
    for blur in BLUR_LENGTHS:
        st = stats[blur]
        if st["gt"] == 0:
            continue
        print(f"{blur:>7}  {st['new_hit'] / st['gt']:>10.2f}  {st['old_hit'] / st['gt']:>10.2f}"
              f"  {st['new_fp'] * 100 / n_images:>10.1f}  {st['old_fp'] * 100 / n_images:>10.1f}")
    if csv_path:
        new = not Path(csv_path).exists()
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            if new:
                wr.writerow(["cls", "gt_boxes", "images", "blur_px", "rule", "recall", "fp_per_100"])
            for blur in BLUR_LENGTHS:
                st = stats[blur]
                if st["gt"] == 0:
                    continue
                for rule, hit, fp in (("new", st["new_hit"], st["new_fp"]), ("old", st["old_hit"], st["old_fp"])):
                    wr.writerow([cls_name, st["gt"], n_images, blur, rule, round(hit / st["gt"], 4), round(fp * 100 / n_images, 2)])


def load_boxes(label_path: Path, w: int, h: int, cls_id: int, min_height: float) -> list:
    if not label_path.exists():
        return []
    boxes = []
    for line in label_path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5 or int(parts[0]) != cls_id or float(parts[4]) < min_height:
            continue
        cx, cy, bw, bh = (float(p) for p in parts[1:5])
        boxes.append(((cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h))
    return boxes


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def evaluate(weights: str, images: str, labels: str, cls_name: str, imgsz: int, min_height: float, label_id, csv_path=None) -> None:
    model = YOLO(weights)
    cls_id = next(k for k, v in model.names.items() if v == cls_name)
    label_id = cls_id if label_id is None else label_id
    image_paths = sorted(p for p in Path(images).iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})

    # best_conf[blur] = 정답 박스마다 매칭된 탐지의 최고 신뢰도(못 찾으면 0)
    # false_conf[blur] = 어떤 정답 박스와도 안 맞는 탐지(오탐)의 신뢰도. 모든 이미지에서 모은다.
    best_conf = {b: [] for b in BLUR_LENGTHS}
    false_conf = {b: [] for b in BLUR_LENGTHS}
    n_images = 0
    for path in image_paths:
        img = cv2.imread(str(path))
        if img is None:
            continue
        n_images += 1
        # 오탐 판정에는 크기 필터를 걸지 않은 정답 전체를 쓴다 - 작은 진짜 객체를 잡은 걸 오탐으로 세지 않도록.
        label_path = Path(labels) / f"{path.stem}.txt"
        gts = load_boxes(label_path, img.shape[1], img.shape[0], label_id, min_height)
        all_gts = load_boxes(label_path, img.shape[1], img.shape[0], label_id, 0.0)
        for blur in BLUR_LENGTHS:
            res = model.predict(motion_blur(img, blur), imgsz=imgsz, conf=0.01, verbose=False)[0]
            dets = [(b.xyxy[0].tolist(), float(b.conf)) for b in res.boxes if int(b.cls) == cls_id]
            for gt in gts:
                best_conf[blur].append(max((c for box, c in dets if iou(box, gt) >= 0.5), default=0.0))
            false_conf[blur].extend(c for box, c in dets if all(iou(box, gt) < 0.5 for gt in all_gts))

    total = len(best_conf[0])
    print(f"class={cls_name} gt_boxes={total} images={n_images} imgsz={imgsz} min_height={min_height}")
    if total == 0:
        return
    print("recall (정답 중 기준 이상으로 잡은 비율)")
    print("blur_px  mean_conf  " + "  ".join(f"{t:>6}" for t in THRESHOLDS))
    for blur in BLUR_LENGTHS:
        confs = np.array(best_conf[blur])
        recalls = "  ".join(f"{(confs >= t).mean():>6.2f}" for t in THRESHOLDS)
        print(f"{blur:>7}  {confs.mean():>9.2f}  {recalls}")
    print("오탐 (이미지 100장당 기준 이상 오탐 수)")
    print("blur_px             " + "  ".join(f"{t:>6}" for t in THRESHOLDS))
    for blur in BLUR_LENGTHS:
        confs = np.array(false_conf[blur])
        fps = "  ".join(f"{(confs >= t).sum() * 100 / n_images:>6.1f}" for t in THRESHOLDS)
        print(f"{blur:>7}             {fps}")

    if csv_path:
        # 그래프용: 한 행 = (클래스, 블러, 기준값). 파일이 이미 있으면 이어 쓴다(클래스별로 여러 번 돌려 한 파일에 모은다).
        new = not Path(csv_path).exists()
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["cls", "gt_boxes", "images", "blur_px", "threshold", "recall", "fp_per_100"])
            for blur in BLUR_LENGTHS:
                hit, false = np.array(best_conf[blur]), np.array(false_conf[blur])
                for t in THRESHOLDS:
                    w.writerow([cls_name, total, n_images, blur, t, round(float((hit >= t).mean()), 4),
                                round(float((false >= t).sum() * 100 / n_images), 2)])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--cls", default="car", help="평가할 모델 클래스명 (기본 car)")
    # 앱은 박스 높이 0.18 이상부터 접근 경고를 올린다(visionHazardStage.ts). 그보다 훨씬 작은 먼 차는 경고와 무관하다.
    parser.add_argument("--min-height", type=float, default=0.1, help="이보다 작은(정규화 높이) 정답 박스는 뺀다")
    # 다른 데이터셋(예: COCO person=0)으로 잴 때 라벨 파일의 클래스 번호가 모델과 다르면 지정한다.
    parser.add_argument("--label-id", type=int, default=None, help="라벨 파일에서 이 클래스의 번호 (기본: 모델 번호와 같음)")
    parser.add_argument("--imgsz", type=int, default=384, help="기기 추론 해상도와 맞춘다 (export_yolo.py 기본 384)")
    parser.add_argument("--csv", default=None, help="결과를 이 CSV에 이어 쓴다 (그래프용)")
    # --policy: 기준값별 표 대신 앱 경고 규칙(후보+연속 2프레임, 즉시 경고) 대 기존 단일 기준을 비교한다.
    # 기본값은 frontend/src/lib/vision/sensitivityProfile.ts 와 맞춘다.
    parser.add_argument("--policy", action="store_true", help="앱 경고 규칙(연속 2프레임)으로 잰다")
    parser.add_argument("--candidate", type=float, default=0.4)
    parser.add_argument("--instant", type=float, default=0.6)
    parser.add_argument("--old", type=float, default=0.8)
    args = parser.parse_args()
    if args.policy:
        evaluate_policy(args.weights, args.images, args.labels, args.cls, args.imgsz, args.min_height, args.label_id,
                        args.candidate, args.instant, args.old, args.csv)
        return
    evaluate(args.weights, args.images, args.labels, args.cls, args.imgsz, args.min_height, args.label_id, args.csv)


if __name__ == "__main__":
    main()
