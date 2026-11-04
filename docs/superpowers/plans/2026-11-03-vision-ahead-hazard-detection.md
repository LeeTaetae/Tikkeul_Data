# 전방 비전(YOLO) 위험 탐지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거치대에 꽂은 핸드폰의 후면(전방 도로) 카메라로 YOLO 탐지를 돌려, 전방 ROI에 킥보드·사람·차량·오토바이·동물이 들어오면 단계별 경고 배너·TTS·진동을 울리고, 보호구역에서는 민감도를, 저사양·발열 상황에서는 성능을 자동으로 조정한다.

**Architecture:** 기기 내(on-device) YOLO 추론(Android TFLite / iOS CoreML) → 순수 TS 로직(ROI/단계 판정, 보호구역 민감도, 발열 정책, 진동 edge-trigger)이 탐지 결과를 해석 → 기존 교통 경고와는 별도의 `VisionHazardAlert` 배너(시각 패턴만 `NavigationHazardAlert`에서 차용)로 표시. 평상시엔 지도+배너만 보이고, 라이브 카메라 오버레이는 정차/설정 화면 전용이다.

**Tech Stack:** React Native(Expo bare) + TypeScript, Node 테스트 러너(`npm test`, `tests/*.test.mjs`), Android Kotlin(TFLite), iOS Swift(CoreML), Python/ultralytics(모델 export, 백엔드 런타임과 분리된 1회성 스크립트).

**Spec:** [ADR 0002](../../ADR/0002-vision-yolo-integration.md)

## Global Constraints

- 카메라 원본 영상은 서버로 전송하지 않는다 — 추론은 전부 기기 내에서 수행한다.
- 운전 중에는 raw 카메라 화면을 띄우지 않는다. 라이브 오버레이는 정차/설정 화면 전용, 기본 OFF.
- 공용 `AlertType`(`frontend/src/types/alert.ts:2`, 교통·ITS 경로 경고 전용)은 수정하지 않는다. 비전 탐지 클래스는 별도 `HazardClass` 체계로 관리한다.
- 진동은 탐지(detection) 자체가 아니라 ROI 진입/단계 상승(edge)에만 발생한다. 같은 단계에 머무는 동안 재진동하지 않는다.
- 보호구역 민감도 조정은 `person` 클래스 confidence threshold만 낮춘다(기본 0.45 → 0.25). 다른 클래스는 그대로 둔다.
- 비전 추론이 중단되어도 GPS 기반 교통·보호구역 경고(`NavigationHazardAlert`)는 독립적으로 계속 동작해야 한다.
- 사용자 문구는 i18next 키로 관리하고 ko/en/zh 3개 언어 모두 채운다(`tests/i18n-coverage.test.mjs`가 누락을 잡는다).
- AI 탐지 결과를 "위험 가능성"으로만 표현한다 — 미탐지를 "위험 없음"으로 읽히게 하지 않는다.

## Review Focus

- **단계 하락 후 재상승**: 객체가 `final`까지 왔다가 ROI를 벗어나(`advance`로 하락) 다시 들어오면, 두 번째 진입에서도 다시 진동해야 한다(한 번 울렸다고 계속 억제되면 안 됨) → Task 4
- **한 프레임에 여러 객체**: 같은 프레임에 `person`(final)과 `kickboard`(caution)가 동시에 ROI 안에 있을 때, 더 위험한 단계가 진동·표시를 이긴다 → Task 1
- **confidence 경계값**: 탐지 confidence가 프로파일 threshold와 정확히 같을 때(예: person 0.25 == threshold 0.25) 포함되는지 배제되는지 일관돼야 한다 → Task 2
- **박스 크기 경계값**: box-height ratio가 approach/final 임계값과 정확히 같을 때 어느 단계로 판정되는지 경계가 명확해야 한다 → Task 1
- **3개 언어 동시 누락 방지**: 새 비전 문구 키가 ko/en/zh 중 하나라도 빠지면 자동으로 잡혀야 한다 → Task 5

---

### Task 1: ROI/단계 판정 (순수 함수)

**Files:**
- Create: `frontend/src/lib/vision/visionTypes.ts`
- Create: `frontend/src/lib/vision/visionHazardStage.ts`
- Test: `frontend/tests/vision-hazard-stage.test.mjs`

**Interfaces:**
- Consumes: `HazardStage` type from `frontend/src/lib/hazardStage.ts` (`'advance' | 'caution' | 'approach' | 'final'`)
- Produces:
  - `type HazardClass = 'kickboard' | 'motorcycle' | 'vehicle' | 'person' | 'animal'`
  - `interface Box { x: number; y: number; width: number; height: number }` (0~1 정규화 좌표, y는 위에서 아래로)
  - `interface Detection { class: HazardClass; confidence: number; box: Box }`
  - `interface RoiTrapezoid { topY: number; topHalfWidth: number; bottomY: number; bottomHalfWidth: number }` (화면 가로 중심 0.5 기준 좌우 대칭)
  - `const DEFAULT_ROI: RoiTrapezoid` — 화면 하단-중앙 사다리꼴. 값: `{ topY: 0.55, topHalfWidth: 0.12, bottomY: 1.0, bottomHalfWidth: 0.45 }`
  - `const BOX_HEIGHT_RATIO = { approach: 0.18, final: 0.32 } as const` — MVP 임시 기준(실측 보정 전까지)
  - `function isInRoi(box: Box, roi: RoiTrapezoid): boolean` — box 바닥-중앙점((x + width/2), (y + height))이 trapezoid 안에 있는지 판정
  - `function stageOfDetection(detection: Detection, roi?: RoiTrapezoid): HazardStage` — ROI 밖이면 `'advance'`, 안이면 `box.height`를 `BOX_HEIGHT_RATIO`와 비교해 `'caution' | 'approach' | 'final'`
  - `function mostSevereStage(stages: HazardStage[]): HazardStage` — 한 프레임의 여러 탐지 중 가장 심각한 단계 1개를 고름(빈 배열이면 `'advance'`)

- [ ] **Step 1: Write the failing tests**

```js
// isInRoi: 사다리꼴 중심/바깥 경계
test('ROI 사다리꼴 안쪽 바닥-중앙점은 true, 화면 가장자리는 false', () => { ... });

// stageOfDetection: ROI 밖
test('ROI 밖 탐지는 advance', () => {
  const d = { class: 'person', confidence: 0.9, box: { x: 0.0, y: 0.1, width: 0.1, height: 0.1 } };
  assert.equal(stageOfDetection(d), 'advance');
});

// stageOfDetection: 경계값 포함 여부
test('box height가 approach 임계값과 같으면 approach, 그보다 1 작으면 caution', () => {
  const base = { class: 'vehicle', confidence: 0.9, box: { x: 0.4, y: 0.8, width: 0.2, height: BOX_HEIGHT_RATIO.approach } };
  assert.equal(stageOfDetection(base), 'approach');
  assert.equal(stageOfDetection({ ...base, box: { ...base.box, height: BOX_HEIGHT_RATIO.approach - 0.01 } }), 'caution');
});
test('box height가 final 임계값과 같거나 크면 final', () => { ... });

// mostSevereStage: 다중 탐지 중 가장 위험한 단계
test('final과 caution이 섞이면 final', () => {
  assert.equal(mostSevereStage(['caution', 'final', 'approach']), 'final');
});
test('빈 배열은 advance', () => { assert.equal(mostSevereStage([]), 'advance'); });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/vision-hazard-stage.test.mjs` (frontend 디렉터리에서)
Expected: FAIL — 모듈이 없어 import 에러

- [ ] **Step 3: Implement `visionTypes.ts`와 `visionHazardStage.ts`**

`isInRoi`는 `topY`에서 `bottomY`로 갈수록 허용 폭이 `topHalfWidth`→`bottomHalfWidth`로 선형 보간되는 사다리꼴에 대해 점-다각형 포함 판정(또는 y별 선형보간 반폭 비교로 충분, 복잡한 ray-casting 불필요). `mostSevereStage`는 `hazardStage.ts`에 있는 것과 같은 식의 랭크 맵(`advance:0, caution:1, approach:2, final:3`)으로 최댓값을 고른다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/vision-hazard-stage.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/vision/visionTypes.ts frontend/src/lib/vision/visionHazardStage.ts frontend/tests/vision-hazard-stage.test.mjs
git commit -m "feat: ROI 기반 전방 비전 위험 단계 판정 추가"
```

---

### Task 2: 보호구역 상황 적응형 민감도 프로파일

**Files:**
- Create: `frontend/src/lib/vision/sensitivityProfile.ts`
- Test: `frontend/tests/vision-sensitivity-profile.test.mjs`

**Interfaces:**
- Consumes: `HazardClass` from `visionTypes.ts` (Task 1)
- Produces:
  - `interface SensitivityProfile { confidenceByClass: Record<HazardClass, number>; targetFps: number }`
  - `const DEFAULT_SENSITIVITY: SensitivityProfile` — 모든 클래스 confidence 0.45, `targetFps: 5`
  - `const PROTECTION_ZONE_SENSITIVITY: SensitivityProfile` — `person`만 0.25, 나머지는 `DEFAULT_SENSITIVITY`와 동일, `targetFps: 10`
  - `function sensitivityProfileFor(inProtectionZone: boolean): SensitivityProfile`
  - `function passesThreshold(detection: Detection, profile: SensitivityProfile): boolean` — `detection.confidence >= profile.confidenceByClass[detection.class]` (경계값 포함)

- [ ] **Step 1: Write the failing tests**

```js
test('보호구역이 아니면 기본 프로파일(모든 클래스 0.45, 5fps)', () => {
  const p = sensitivityProfileFor(false);
  assert.equal(p.targetFps, 5);
  assert.equal(p.confidenceByClass.person, 0.45);
});
test('보호구역이면 person만 0.25, 나머지는 그대로, 10fps', () => {
  const p = sensitivityProfileFor(true);
  assert.equal(p.confidenceByClass.person, 0.25);
  assert.equal(p.confidenceByClass.vehicle, 0.45);
  assert.equal(p.targetFps, 10);
});
test('confidence가 threshold와 정확히 같으면 통과한다(포함)', () => {
  const d = { class: 'person', confidence: 0.25, box: { x: 0, y: 0, width: 0.1, height: 0.1 } };
  assert.equal(passesThreshold(d, PROTECTION_ZONE_SENSITIVITY), true);
  assert.equal(passesThreshold({ ...d, confidence: 0.24 }, PROTECTION_ZONE_SENSITIVITY), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/vision-sensitivity-profile.test.mjs`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Implement `sensitivityProfile.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/vision-sensitivity-profile.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/vision/sensitivityProfile.ts frontend/tests/vision-sensitivity-profile.test.mjs
git commit -m "feat: 보호구역 person 탐지 민감도 프로파일 추가"
```

---

### Task 3: 발열 3단계 성능 정책

**Files:**
- Create: `frontend/src/lib/vision/thermalPolicy.ts`
- Test: `frontend/tests/vision-thermal-policy.test.mjs`

**Interfaces:**
- Produces:
  - `type ThermalTier = 'nominal' | 'fair' | 'serious' | 'critical'`
  - `interface VisionRuntimePolicy { overlayAllowed: boolean; targetFps: number; inferencePaused: boolean }`
  - `function policyForThermalTier(tier: ThermalTier, baseFps: number): VisionRuntimePolicy`
    - `nominal`/`fair`: `{ overlayAllowed: true, targetFps: baseFps, inferencePaused: false }`
    - `serious`: `{ overlayAllowed: false, targetFps: Math.min(baseFps, 2), inferencePaused: false }`
    - `critical`: `{ overlayAllowed: false, targetFps: 0, inferencePaused: true }`

- [ ] **Step 1: Write the failing tests**

```js
test('nominal/fair는 기본 fps 그대로, 오버레이 허용', () => {
  assert.deepEqual(policyForThermalTier('nominal', 10), { overlayAllowed: true, targetFps: 10, inferencePaused: false });
  assert.equal(policyForThermalTier('fair', 10).targetFps, 10);
});
test('serious는 오버레이 금지, fps를 2 이하로 제한', () => {
  const p = policyForThermalTier('serious', 10);
  assert.equal(p.overlayAllowed, false);
  assert.equal(p.targetFps, 2);
  assert.equal(p.inferencePaused, false);
});
test('critical은 추론 자체를 멈춘다', () => {
  const p = policyForThermalTier('critical', 10);
  assert.equal(p.inferencePaused, true);
  assert.equal(p.targetFps, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/vision-thermal-policy.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement `thermalPolicy.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/vision-thermal-policy.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/vision/thermalPolicy.ts frontend/tests/vision-thermal-policy.test.mjs
git commit -m "feat: 발열 단계별 비전 추론 성능 정책 추가"
```

---

### Task 4: 진동 edge-trigger

**Files:**
- Create: `frontend/src/lib/vision/visionAlertTrigger.ts`
- Test: `frontend/tests/vision-alert-trigger.test.mjs`

**Interfaces:**
- Consumes: `HazardStage` from `frontend/src/lib/hazardStage.ts`
- Produces:
  - `const STAGE_RANK: Record<HazardStage, number>` (`advance:0, caution:1, approach:2, final:3`)
  - `function shouldVibrate(prevStage: HazardStage, nextStage: HazardStage): boolean` — `STAGE_RANK[nextStage] > STAGE_RANK[prevStage] && nextStage !== 'advance'`

- [ ] **Step 1: Write the failing tests**

```js
test('단계가 올라가면(advance→caution) 진동한다', () => {
  assert.equal(shouldVibrate('advance', 'caution'), true);
});
test('같은 단계에 머물면 진동하지 않는다', () => {
  assert.equal(shouldVibrate('approach', 'approach'), false);
});
test('단계가 내려가면 진동하지 않는다', () => {
  assert.equal(shouldVibrate('final', 'caution'), false);
});
test('final에서 벗어났다가(advance) 다시 caution으로 들어오면 재진동한다', () => {
  assert.equal(shouldVibrate('final', 'advance'), false); // 벗어나는 순간은 진동 없음
  assert.equal(shouldVibrate('advance', 'caution'), true); // 재진입은 다시 진동
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/vision-alert-trigger.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement `visionAlertTrigger.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/vision-alert-trigger.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/vision/visionAlertTrigger.ts frontend/tests/vision-alert-trigger.test.mjs
git commit -m "feat: 단계 상승 시에만 울리는 진동 edge-trigger 추가"
```

---

### Task 5: VisionHazardAlert 배너 (UI + i18n)

**Files:**
- Create: `frontend/src/components/alerts/VisionHazardAlert.tsx`
- Modify: `frontend/src/theme.ts` — `hazardTone` 아래에 `visionHazardTone` 맵 추가 (이번 줄 그룹 근처, `hazardTone` 수정 아님)
- Modify: `frontend/src/i18n/locales/ko.ts`, `en.ts`, `zh.ts`
- Test: `frontend/tests/vision-hazard-alert-copy.test.mjs`

**Interfaces:**
- Consumes: `HazardClass`(Task 1), `HazardStage`(기존 `hazardStage.ts`)
- Produces: `VisionHazardAlert({ hazardClass, stage, onClose }: { hazardClass: HazardClass; stage: Exclude<HazardStage,'advance'>; onClose: () => void })` — React 컴포넌트. `'advance'` 단계는 렌더하지 않는다(호출 쪽에서 걸러줌).

**i18n 키(ko/en/zh 모두):**
- `visionHazard.label.kickboard` / `.motorcycle` / `.vehicle` / `.person` / `.animal` — 아이콘 옆 짧은 라벨
  - ko: 전동킥보드 / 오토바이 / 차량 / 보행자 / 동물
  - en: Kickboard / Motorcycle / Vehicle / Pedestrian / Animal
  - zh: 电动滑板车 / 摩托车 / 车辆 / 行人 / 动物
- `visionHazard.message.kickboard` / `.motorcycle` / `.vehicle` / `.person` / `.animal` — 배너 본문(단계는 기존 `hazard.stage.*` pill로 별도 표시하므로 메시지는 단계 불문 동일)
  - ko: 전방에 전동킥보드가 있어요 / 전방에 오토바이가 있어요 / 전방에 차량이 있어요 / 전방에 보행자가 있어요 / 전방에 동물이 있어요
  - en: Kickboard ahead / Motorcycle ahead / Vehicle ahead / Pedestrian ahead / Animal ahead
  - zh: 前方有电动滑板车 / 前方有摩托车 / 前方有车辆 / 前方有行人 / 前方有动物

`visionHazardTone` 색상: 기존 `hazardTone`의 `caution`(파랑 계열)과 구분되는 2색만 쓴다 — `person`/`animal`은 주의 대상(보행자·동물)이라 `construction`과 같은 계열(`#D97706`/`#B45309`), `kickboard`/`motorcycle`/`vehicle`은 차량류라 `accident`와 같은 계열(`#DC2626`)을 재사용한다.

- [ ] **Step 1: Write the failing test**

```js
// ko/en/zh 전부 5개 클래스의 label·message 키가 존재하는지, 그리고 visionHazardTone에 5개 클래스가 다 있는지
import { visionHazardTone } from '../src/theme.ts';
const CLASSES = ['kickboard', 'motorcycle', 'vehicle', 'person', 'animal'];
for (const [name, locale] of [['ko', ko], ['en', en], ['zh', zh]]) {
  test(`${name} 로케일에 비전 라벨·메시지 5개 모두 있다`, () => {
    for (const c of CLASSES) {
      assert.ok(locale.visionHazard.label[c], `${name}.visionHazard.label.${c}`);
      assert.ok(locale.visionHazard.message[c], `${name}.visionHazard.message.${c}`);
    }
  });
}
test('visionHazardTone에 5개 클래스 모두 색이 있다', () => {
  for (const c of CLASSES) assert.ok(visionHazardTone[c]?.accent);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/vision-hazard-alert-copy.test.mjs`
Expected: FAIL — 키 없음

- [ ] **Step 3: Implement `VisionHazardAlert.tsx`, `visionHazardTone`, 3개 로케일 파일 수정**

`VisionHazardAlert`는 `NavigationHazardAlert.tsx`의 `card`/`band` 레이아웃(색 띠 + 아이콘 + 메시지 + 닫기 버튼 + stage pill)을 그대로 따르되, `alert`/`distanceM`/`message.params` 같은 교통 경고 전용 필드는 쓰지 않는다. 아이콘은 `lucide-react-native`에서 클래스별로 구분되는 것을 고른다(예: person→`PersonStanding`, animal→`PawPrint`, vehicle→`Car`, motorcycle/kickboard→구분되는 이동체 아이콘).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/vision-hazard-alert-copy.test.mjs`
Expected: PASS

- [ ] **Step 5: Run full i18n coverage test to make sure nothing else broke**

Run: `npm test -- tests/i18n-coverage.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/alerts/VisionHazardAlert.tsx frontend/src/theme.ts frontend/src/i18n/locales/ko.ts frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/zh.ts frontend/tests/vision-hazard-alert-copy.test.mjs
git commit -m "feat: 전방 비전 위험 배너(VisionHazardAlert) UI·3개 언어 문구 추가"
```

---

### Task 6: YOLO 모델 export (수동 검증)

이 태스크는 이 저장소의 Node/Python 테스트 환경에 없는 무거운 ML 의존성(torch, ultralytics)이 필요해 자동 테스트를 쓸 수 없다. 실행하지 않은 걸 성공했다고 보고하지 않는다 — 검증은 수동 체크리스트로 한다.

**Files:**
- Create: `ml/export_yolo.py` (backend 런타임과 분리된 1회성 스크립트. `backend/requirements.txt`에 추가하지 않는다 — 서버는 이 모델을 쓰지 않는다)
- Create: `ml/requirements-export.txt` (`ultralytics`, `torch` 등 export 전용 의존성)

**Interfaces:**
- Produces: CLI `python ml/export_yolo.py --weights <best.pt path> --out frontend/assets/models` → `frontend/assets/models/kickboard_v3.tflite` (int8), `frontend/assets/models/kickboard_v3.mlpackage`(또는 `.mlmodel`, fp16) 생성

- [ ] **Step 1: `ml/export_yolo.py` 작성**

ultralytics `YOLO(weights).export(format='tflite', int8=True, imgsz=384)`와 `export(format='coreml', half=True, imgsz=384)`를 각각 호출. `argparse`로 `--weights`/`--out`/`--imgsz`(기본 384) 받는다.

- [ ] **Step 2: 별도 가상환경에 `ml/requirements-export.txt` 설치 후 수동 실행**

Run: `python ml/export_yolo.py --weights /Users/jwo/Downloads/runs/kickboard/train_v3_5cls/weights/best.pt --out frontend/assets/models`
확인: `frontend/assets/models/kickboard_v3.tflite`와 `kickboard_v3.mlpackage`가 생성되고, 파일 크기가 0이 아니다(TFLite 보통 수 MB대).

- [ ] **Step 3: 커밋**

```bash
git add ml/export_yolo.py ml/requirements-export.txt frontend/assets/models/kickboard_v3.tflite frontend/assets/models/kickboard_v3.mlpackage
git commit -m "feat: best.pt를 TFLite·CoreML로 export하는 스크립트 및 결과물 추가"
```

---

### Task 7: 기기 내 추론 네이티브 모듈 (인터페이스, 수동 검증)

카메라 프레임을 네이티브 TFLite(Android)/CoreML(iOS) 런타임에 넣는 바인딩은 실기기에서만 검증 가능하다 — `frontend/modules/kakao-login/`과 같은 기존 네이티브 모듈 패턴을 따른다.

**Files:**
- Create: `frontend/src/native/visionDetector.ts` — 공개 TS 인터페이스 + 웹/미지원 환경 기본값(빈 배열 반환)
- Create: `frontend/src/native/visionDetector.native.ts` — 네이티브 브리지 연결
- Create: `frontend/modules/vision-detector/android/...` (Kotlin, TFLite GPU/NNAPI delegate, 저전력 우선 설정)
- Create: `frontend/modules/vision-detector/ios/...` (Swift, CoreML `computeUnits: .cpuAndNeuralEngine`)

**Interfaces:**
- Consumes: `Detection`, `SensitivityProfile`(Task 1, 2), `frontend/assets/models/kickboard_v3.*`(Task 6)
- Produces: `async function detectFrame(frameRef: unknown, profile: SensitivityProfile): Promise<Detection[]>`

- [ ] **Step 1: `visionDetector.ts`에 인터페이스와 웹 기본값(`detectFrame` → `[]`) 작성**
- [ ] **Step 2: Android Kotlin 모듈에서 TFLite 모델 로드 + `detectFrame` 구현, NNAPI delegate 저전력 모드로 설정**
- [ ] **Step 3: iOS Swift 모듈에서 CoreML 모델 로드 + `detectFrame` 구현**
- [ ] **Step 4: 실기기(또는 최소 Android 에뮬레이터 카메라)로 수동 검증**

확인 체크리스트: (a) 알려진 객체(사람·자전거 등)를 카메라에 비췄을 때 `Detection[]`이 비어있지 않게 돌아온다, (b) 평균 추론 소요 시간이 목표 fps(기본 5fps → 200ms 이내)를 벗어나지 않는다, (c) 저전력 delegate 설정이 적용돼 최대 성능 모드보다 발열이 덜하다(체감 비교).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/native/visionDetector.ts frontend/src/native/visionDetector.native.ts frontend/modules/vision-detector
git commit -m "feat: 기기 내 YOLO 추론 네이티브 모듈 인터페이스 추가"
```

---

### Task 8: 통합 — 훅 + 화면 배선 (일부 수동 검증)

**Files:**
- Create: `frontend/src/lib/vision/useVisionHazardWarning.ts`
- Create: `frontend/tests/vision-hazard-warning-hook.test.mjs` (훅의 순수 리듀서 부분만 Node에서 테스트. React 렌더링 자체는 테스트하지 않는다 — 기존 테스트 스위트도 React 컴포넌트 렌더 테스트는 하지 않는 관례를 따른다)
- Modify: `frontend/app/navigation.tsx` — `useVisionHazardWarning()` 결과를 `VisionHazardAlert`로 렌더 (`NavigationHazardAlert`와 같은 레이어, 더 급한 쪽이 우선 — 기존 알림이 떠 있으면 비전 알림을 그 아래에 쌓지 않고 우선순위가 더 높은 단계만 보여준다)
- Create: `frontend/app/vision-preview.tsx` — 정차 중 전용 라이브 오버레이(박스+ROI 시각화) 데모/설정 화면, 기본 진입 경로 없음(설정에서만 진입)

**Interfaces:**
- Consumes: `detectFrame`(Task 7), `sensitivityProfileFor`(Task 2), `policyForThermalTier`(Task 3), `stageOfDetection`/`mostSevereStage`(Task 1), `shouldVibrate`(Task 4)
- Produces: `function reduceVisionFrame(prevStage: HazardStage, detections: Detection[], profile: SensitivityProfile): { stage: HazardStage; vibrate: boolean; topClass: HazardClass | null }` — 한 프레임 처리의 순수 부분(필터→단계 판정→진동 여부)을 훅에서 분리해 테스트 가능하게 한다

- [ ] **Step 1: Write the failing test for `reduceVisionFrame`**

```js
test('여러 탐지 중 통과 threshold를 넘은 것만 보고, 가장 심한 단계로 올라가면 진동한다', () => {
  const profile = sensitivityProfileFor(false);
  const detections = [
    { class: 'animal', confidence: 0.1, box: { x: 0.45, y: 0.85, width: 0.1, height: 0.4 } }, // threshold 미달 → 제외
    { class: 'person', confidence: 0.9, box: { x: 0.45, y: 0.85, width: 0.1, height: 0.4 } }, // final
  ];
  const r = reduceVisionFrame('advance', detections, profile);
  assert.equal(r.stage, 'final');
  assert.equal(r.vibrate, true);
  assert.equal(r.topClass, 'person');
});
test('아무 탐지도 threshold를 못 넘으면 advance로 내려가고 진동하지 않는다', () => {
  const r = reduceVisionFrame('caution', [], sensitivityProfileFor(false));
  assert.equal(r.stage, 'advance');
  assert.equal(r.vibrate, false);
  assert.equal(r.topClass, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/vision-hazard-warning-hook.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement `reduceVisionFrame`과 `useVisionHazardWarning`**

훅은 `policyForThermalTier`로 정한 `targetFps`에 맞춰 `detectFrame`을 주기적으로 호출하고, 매 결과를 `reduceVisionFrame`에 넣어 상태(`stage`, `topClass`)를 갱신하며, `vibrate`가 true일 때만 진동 API를 호출한다. `inferencePaused`면 호출 자체를 건너뛴다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/vision-hazard-warning-hook.test.mjs`
Expected: PASS

- [ ] **Step 5: `app/navigation.tsx`에 배선, `app/vision-preview.tsx` 작성**

- [ ] **Step 6: 실기기 수동 검증**

확인 체크리스트: (a) 정차 중 `vision-preview` 화면에서 박스·ROI가 그려진다, (b) 운전 화면에서는 raw 카메라가 전혀 보이지 않고 배너만 뜬다, (c) 객체가 ROI를 벗어났다 다시 들어오면 다시 진동한다, (d) 보호구역 진입 시 평소보다 먼 거리에서도 person이 더 잘 잡힌다(체감), (e) 발열 유도 후(장시간 구동) critical 단계에서 "전방 탐지 일시 중단" 배너가 뜨고 GPS 교통 경고는 계속 동작한다.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/vision/useVisionHazardWarning.ts frontend/tests/vision-hazard-warning-hook.test.mjs frontend/app/navigation.tsx frontend/app/vision-preview.tsx
git commit -m "feat: 전방 비전 위험 경고 훅과 화면 배선"
```
