"""영상에 앱 경고 로직을 그대로 돌려 보고, 결과를 그린 영상과 경고 기록 CSV를 만든다.

앱(frontend/src/lib/vision/)과 같은 규칙을 Python으로 옮겼다:
- ROI 사다리꼴·단계 판정: visionHazardStage.ts
- 후보(0.4)·즉시(0.6) 기준, 연속 2프레임 확인, 단계 하락 hold: sensitivityProfile.ts, useVisionHazardWarning.ts
- 진동(최종 경고)은 final 단계에 막 들어온 순간: visionAlertTrigger.ts
같은 탐지 결과에 기존 규칙(0.8 단일 기준)도 나란히 돌려 비교한다. 앱 코드를 바꾸면 여기도 맞춰야 한다.

정답 라벨이 없는 영상용이라 recall을 계산하지 않는다 - 결과 영상을 보며 놓친 장면·잘못된 경고를 직접 확인한다.

사용법:
    python ml/eval_video.py --weights best.pt --video drive.mp4 --out out_dir
"""

import argparse
import csv
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

# visionHazardStage.ts
ROI = {"top_y": 0.55, "top_half": 0.05, "bottom_y": 1.0, "bottom_half": 0.25}
BOX_HEIGHT = {"approach": 0.18, "final": 0.32}
RANK = {"advance": 0, "caution": 1, "approach": 2, "final": 3}
# useVisionHazardWarning.ts
STAGE_DROP_HOLD_FRAMES = 3
IMPLAUSIBLE_BOX_WIDTH = 0.85  # 이 폭 이상인 박스는 즉시 기준 미만이면 버린다
NEAR_MARGIN = 0.5  # 직전 박스를 폭·높이의 이 비율만큼 넓혀 겹치면 같은 객체로 본다


def in_roi(x: float, y: float, w: float, h: float) -> bool:
    cx = x + w / 2
    cy = min(y + h, ROI["bottom_y"])
    if cy < ROI["top_y"]:
        return False
    t = (cy - ROI["top_y"]) / (ROI["bottom_y"] - ROI["top_y"])
    half = ROI["top_half"] + t * (ROI["bottom_half"] - ROI["top_half"])
    return 0.5 - half <= cx <= 0.5 + half


def stage_of(d: dict) -> str:
    if not in_roi(*d["box"]):
        return "advance"
    if d["box"][3] >= BOX_HEIGHT["final"]:
        return "final"
    if d["box"][3] >= BOX_HEIGHT["approach"]:
        return "approach"
    return "caution"


def is_near_prev(box, prev_boxes) -> bool:
    x, y, w, h = box
    for px, py, pw, ph in prev_boxes:
        mx, my = pw * NEAR_MARGIN, ph * NEAR_MARGIN
        if x < px + pw + mx and x + w > px - mx and y < py + ph + my and y + h > py - my:
            return True
    return False


def most_severe(stages) -> str:
    return max(stages, key=lambda s: RANK[s], default="advance")


@dataclass
class Rule:
    name: str
    candidate: float
    instant: float  # candidate == instant 이면 2프레임 확인이 없는 단일 기준이다
    stage: str = "advance"
    top_class: str = None
    miss: int = 0
    prev_boxes: list = field(default_factory=list)

    def step(self, dets: list) -> bool:
        """한 프레임을 반영하고, 최종 경고(진동)가 울려야 하면 True. reduceVisionFrame 과 같은 순서다."""
        plausible = [d for d in dets if d["box"][2] < IMPLAUSIBLE_BOX_WIDTH or d["conf"] >= self.instant]
        in_roi_dets = [d for d in plausible if d["conf"] >= self.candidate and stage_of(d) != "advance"]
        new_prev_boxes = [d["box"] for d in in_roi_dets]
        confirmed = [d for d in in_roi_dets if d["conf"] >= self.instant or is_near_prev(d["box"], self.prev_boxes)]
        raw_stage = most_severe(stage_of(d) for d in confirmed)
        raw_top = next((d["cls"] for d in confirmed if stage_of(d) == raw_stage), None) if raw_stage != "advance" else None
        prev = self.stage
        self.prev_boxes = new_prev_boxes
        if RANK[raw_stage] >= RANK[prev]:
            self.stage, self.top_class, self.miss = raw_stage, raw_top, 0
        else:
            self.miss += 1
            if self.miss < STAGE_DROP_HOLD_FRAMES:
                return False
            self.stage, self.top_class, self.miss = raw_stage, raw_top, 0
        return self.stage == "final" and prev != "final"


def draw(frame, dets, rules, t):
    h, w = frame.shape[:2]
    roi_pts = [
        (int((0.5 - ROI["top_half"]) * w), int(ROI["top_y"] * h)),
        (int((0.5 + ROI["top_half"]) * w), int(ROI["top_y"] * h)),
        (int((0.5 + ROI["bottom_half"]) * w), int(ROI["bottom_y"] * h) - 1),
        (int((0.5 - ROI["bottom_half"]) * w), int(ROI["bottom_y"] * h) - 1),
    ]
    cv2.polylines(frame, [np.array(roi_pts, np.int32)], True, (0, 200, 255), 2)
    new = rules[0]
    for d in dets:
        x, y, bw, bh = d["box"]
        if d["conf"] >= new.instant:
            color, mark = (0, 0, 255), "OK"
        elif d["conf"] >= new.candidate:
            color, mark = (0, 165, 255), "~"
        else:
            color, mark = (160, 160, 160), "x"
        p1, p2 = (int(x * w), int(y * h)), (int((x + bw) * w), int((y + bh) * h))
        cv2.rectangle(frame, p1, p2, color, 2)
        cv2.putText(frame, f"{mark} {d['cls']} {d['conf']:.2f}", (p1[0], max(14, p1[1] - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    for i, r in enumerate(rules):
        text = f"{r.name}: {r.stage}" + (f" ({r.top_class})" if r.top_class else "")
        color = (0, 0, 255) if r.stage == "final" else (0, 165, 255) if r.stage != "advance" else (255, 255, 255)
        cv2.rectangle(frame, (8, 8 + i * 26), (330, 30 + i * 26), (0, 0, 0), -1)
        cv2.putText(frame, text, (14, 25 + i * 26), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 1, cv2.LINE_AA)
    cv2.putText(frame, f"{t:6.1f}s", (w - 90, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)


def run(weights: str, video: str, out_dir: str, fps: float, imgsz: int, candidate: float, instant: float, old: float, tag: str = "",
        speed: float = 1.0) -> None:
    model = YOLO(weights)
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(f"영상을 열 수 없어요: {video}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    # 앱처럼 초당 fps 장만 추론한다. speed 배속이면 그만큼 더 건너뛰어, 추론 프레임 사이에 객체가 speed 배 더
    # 움직이는 상황(더 빠른 객체)을 흉내 낸다. 프레임 안의 블러는 원본 그대로라 실제 고속 촬영을 대신하지는 못한다.
    step = max(1, round(src_fps * speed / fps))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(str(out / f"{Path(video).stem}{tag}_annotated.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), src_fps / step, (w, h))

    rules = [Rule("new 0.4/0.6", candidate, instant), Rule(f"old {old}", old, old)]
    events = []
    alerts = {r.name: 0 for r in rules}
    staged = {r.name: 0 for r in rules}  # 경고 단계(caution 이상)였던 프레임 수
    frames = 0
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step:
            idx += 1
            continue
        t = idx / src_fps
        idx += 1
        frames += 1
        res = model.predict(frame, imgsz=imgsz, conf=0.1, verbose=False)[0]
        dets = []
        for b in res.boxes:
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            dets.append({"cls": model.names[int(b.cls)], "conf": float(b.conf),
                         "box": (x1 / w, y1 / h, (x2 - x1) / w, (y2 - y1) / h)})
        for r in rules:
            prev = r.stage
            if r.step(dets):
                alerts[r.name] += 1
            if r.stage != "advance":
                staged[r.name] += 1
            if r.stage != prev:
                best = max((d["conf"] for d in dets if d["cls"] == r.top_class), default=0.0)
                events.append([f"{t:.2f}", r.name, prev, r.stage, r.top_class or "", f"{best:.2f}"])
        draw(frame, dets, rules, t)
        writer.write(frame)

    cap.release()
    writer.release()
    with open(out / f"{Path(video).stem}{tag}_events.csv", "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["time_s", "rule", "from", "to", "class", "conf"])
        wr.writerows(events)
    print(f"video={video} speed={speed}x frames_inferred={frames} ({src_fps:.0f}fps 원본에서 {step}장마다 1장)")
    for r in rules:
        print(f"  {r.name:<12} 최종 경고 {alerts[r.name]}회 · 경고 단계였던 시간 {staged[r.name] * step / src_fps:.1f}s")
    print(f"결과: {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--video", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--fps", type=float, default=10, help="초당 추론 장수 (앱 기본 10, 보호구역 15)")
    parser.add_argument("--imgsz", type=int, default=384)
    # 기본값은 frontend/src/lib/vision/sensitivityProfile.ts 와 맞춘다.
    parser.add_argument("--candidate", type=float, default=0.4)
    parser.add_argument("--instant", type=float, default=0.6)
    parser.add_argument("--old", type=float, default=0.8)
    # ROI 사다리꼴 캘리브레이션용. 기본값은 visionHazardStage.ts DEFAULT_ROI.
    parser.add_argument("--roi-top-half", type=float, default=ROI["top_half"])
    parser.add_argument("--roi-bottom-half", type=float, default=ROI["bottom_half"])
    parser.add_argument("--tag", default="", help="결과 파일 이름 뒤에 붙인다 (설정별 비교용)")
    parser.add_argument("--speed", type=float, default=1.0, help="배속. 2면 객체가 2배 빠른 것처럼 프레임을 건너뛴다")
    args = parser.parse_args()
    ROI["top_half"], ROI["bottom_half"] = args.roi_top_half, args.roi_bottom_half
    if args.speed <= 0:
        parser.error("--speed 는 0보다 커야 해요")
    run(args.weights, args.video, args.out, args.fps, args.imgsz, args.candidate, args.instant, args.old, args.tag, args.speed)


if __name__ == "__main__":
    main()
