# 자주 가는 목적지 안내 배너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인한 사용자가 홈 화면을 열면(세션당 1회), 5회 이상 방문한 1위 목적지를 "자주 가시는 {장소}로 안내할까요?" 배너로 제안하고, 확인하면 기존 경로 검색 흐름(모드 선택 화면)으로 넘어가게 한다.

**Architecture:** 백엔드는 변경 없음(`GET /api/trips/frequent`가 이미 방문 횟수 내림차순으로 반환). 프론트에 (1) "배너를 띄울지" 판단하는 순수 함수, (2) 그 판단 결과를 보여주는 배너 컴포넌트, (3) 홈 화면(`app/index.tsx`)에서 마운트 시 1회 조회해 연결하는 배선, 이렇게 세 조각을 추가한다.

**Tech Stack:** React Native(Expo), TypeScript, react-i18next, 기존 `tripsApi`(`frontend/src/lib/trips/api.ts`).

**Spec:** `docs/superpowers/specs/2026-11-05-frequent-destination-banner-design.md`

## Global Constraints
- 최소 방문 횟수 5회 미만이면 배너를 띄우지 않는다.
- 배너는 앱 세션당(= `HomeScreen` 마운트당) 1회만 판단한다. 탭을 옮겼다가 돌아와도 다시 조회하지 않는다.
- 로그인하지 않은 사용자(`authToken` 없음)에게는 아예 조회하지 않는다.
- [경로 안내]를 눌러도 턴바이턴 안내로 바로 점프하지 않는다 — 기존 `onPickRecent`와 동일하게 `searchRoutes(point, label, mode)`를 호출해 모드 선택 화면으로 보낸다.
- 새 백엔드 코드·새 의존성 없음.

## Review Focus
- `visit_count`가 정확히 5인 경우 배너가 떠야 한다(경계값, "5회 이상"이므로 포함).
- `/api/trips/frequent` 응답이 빈 배열(아직 기록 없는 신규 사용자)일 때 배너를 안 띄우고 에러도 안 나야 한다.
- `/api/trips/frequent` 호출이 실패(네트워크 오류 등)해도 홈 화면 자체가 깨지지 않고 배너만 안 뜨면 된다.
- [아니오]를 누른 뒤 같은 세션에서 다시 홈 화면에 포커스가 와도(`useFocusEffect` 트리거) 배너가 재조회·재노출되지 않아야 한다.
- 로그인하지 않은 상태(`authToken`이 없거나 `authStatus !== 'authenticated'`)에서는 `/api/trips/frequent`를 호출하지 않아야 한다.

---

## 파일 구조

- `frontend/src/lib/trips/frequentBanner.ts` (신규) — "배너에 띄울 목적지를 고른다"는 순수 로직만 담당. `MIN_FREQUENT_VISITS`, `pickFrequentDestination(destinations)`.
- `frontend/src/components/FrequentDestinationBanner.tsx` (신규) — props(`label`, `onConfirm`, `onDismiss`)만 받는 순수 표시 컴포넌트. 비즈니스 로직 없음.
- `frontend/src/i18n/locales/{ko,en,zh}.ts` (수정) — `map.frequentBannerTitle`/`frequentBannerConfirm`/`frequentBannerDismiss` 키 추가.
- `frontend/app/index.tsx` (수정) — state 2개(`frequentDestination`, 조회용 `useEffect`) + 핸들러 2개(`onConfirmFrequent`, `onDismissFrequent`) + JSX에 배너 렌더링 한 줄.

---

### Task 1: 배너 노출 판단 로직 (`pickFrequentDestination`)

**Files:**
- Create: `frontend/src/lib/trips/frequentBanner.ts`
- Test: `frontend/tests/frequent-banner.test.mjs`

**Interfaces:**
- Consumes: `FrequentDestination`(`frontend/src/lib/trips/api.ts`에 이미 있음 — `{ label, lat, lon, address_text, last_used_at, visit_count }`).
- Produces: `MIN_FREQUENT_VISITS: number`(값 5), `pickFrequentDestination(destinations: FrequentDestination[]): FrequentDestination | null` — Task 3(`app/index.tsx`)이 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// frontend/tests/frequent-banner.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_FREQUENT_VISITS, pickFrequentDestination } from '../src/lib/trips/frequentBanner.ts';

const dest = (visit_count) => ({ label: '회사', lat: 1, lon: 2, address_text: '', last_used_at: '', visit_count });

test('방문 횟수가 5 미만이면 null', () => {
  assert.equal(pickFrequentDestination([dest(4)]), null);
});

test('방문 횟수가 정확히 5면 그 목적지를 돌려준다(경계값 포함)', () => {
  assert.equal(pickFrequentDestination([dest(5)])?.visit_count, 5);
});

test('목적지가 없으면(빈 배열) null', () => {
  assert.equal(pickFrequentDestination([]), null);
});

test('MIN_FREQUENT_VISITS는 5다', () => {
  assert.equal(MIN_FREQUENT_VISITS, 5);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- tests/frequent-banner.test.mjs` (또는 `npm test`로 전체 실행)
Expected: FAIL — `frequentBanner.ts` 모듈이 없어서 import 에러.

- [ ] **Step 3: `frontend/src/lib/trips/frequentBanner.ts` 구현**

```ts
import type { FrequentDestination } from './api';

export const MIN_FREQUENT_VISITS = 5;

export function pickFrequentDestination(destinations: FrequentDestination[]): FrequentDestination | null {
  const top = destinations[0];
  return top && top.visit_count >= MIN_FREQUENT_VISITS ? top : null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- tests/frequent-banner.test.mjs`
Expected: PASS (4개 테스트)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/trips/frequentBanner.ts frontend/tests/frequent-banner.test.mjs
git commit -m "feat: 자주 가는 목적지 배너 노출 판단 로직 추가"
```

---

### Task 2: 배너 UI 컴포넌트 (`FrequentDestinationBanner`)

**Files:**
- Create: `frontend/src/components/FrequentDestinationBanner.tsx`
- Modify: `frontend/src/i18n/locales/ko.ts`, `frontend/src/i18n/locales/en.ts`, `frontend/src/i18n/locales/zh.ts`

**Interfaces:**
- Consumes: 없음(순수 표시 컴포넌트).
- Produces: `FrequentDestinationBanner({ label, onConfirm, onDismiss }: { label: string; onConfirm: () => void; onDismiss: () => void })` — Task 3이 그대로 쓴다.

이 컴포넌트는 로직이 없는 뷰라 전용 유닛 테스트는 만들지 않는다(이 프로젝트의 다른 `.tsx` 컴포넌트들과 같은 관례 — `tests/*.test.mjs`는 로직·훅만 다룬다). i18n 키 존재 여부는 기존 `tests/i18n-coverage.test.mjs`가 전체 코드베이스를 스캔해서 자동으로 확인한다.

- [ ] **Step 1: `ko.ts`의 `map` 네임스페이스에 키 3개 추가**

`frontend/src/i18n/locales/ko.ts`의 `map.pickedLocation: '지도에서 선택한 위치',` 바로 아래에 추가:

```ts
frequentBannerTitle: '자주 가시는 {{label}}으로 안내할까요?',
frequentBannerConfirm: '경로 안내',
frequentBannerDismiss: '아니요',
```

- [ ] **Step 2: `en.ts`/`zh.ts`의 같은 위치(`map.pickedLocation` 바로 아래)에 대응 키 추가**

영어(예): `frequentBannerTitle: 'Head to {{label}}, a place you often visit?'`, `frequentBannerConfirm: 'Get directions'`, `frequentBannerDismiss: 'No thanks'`.
중국어(예): `frequentBannerTitle: '要前往常去的 {{label}} 吗?'`, `frequentBannerConfirm: '开始导航'`, `frequentBannerDismiss: '不用了'`.
(정확한 문구는 구현자 재량 — 다른 `map.*` 키들의 어조를 따른다.)

- [ ] **Step 3: `frontend/src/components/FrequentDestinationBanner.tsx` 구현**

`frontend/src/components/StatusBanner.tsx`와 `frontend/src/components/alerts/VisionHazardAlert.tsx`의 카드·버튼 스타일 관례(`colors`/`radius`/`space`/`shadow.float`)를 따른다. 버튼 두 개를 가로로 나란히 배치하고(`flexDirection: 'row'`), `onDismiss`는 중립색(`colors.muted`/`colors.paper`), `onConfirm`은 강조색(`colors.brand`)으로 구분한다. `t('map.frequentBannerTitle', { label })`로 장소 이름을 보간한다.

```ts
interface Props {
  label: string;
  onConfirm: () => void;
  onDismiss: () => void;
}
export function FrequentDestinationBanner({ label, onConfirm, onDismiss }: Props) { ... }
```

- [ ] **Step 4: 전체 테스트 실행(회귀 확인)**

Run: `npm test`
Expected: 기존 테스트 전부 PASS, `i18n-coverage` 테스트도 PASS(새 키 3개가 세 언어 다 있으므로).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/FrequentDestinationBanner.tsx frontend/src/i18n/locales/ko.ts frontend/src/i18n/locales/en.ts frontend/src/i18n/locales/zh.ts
git commit -m "feat: 자주 가는 목적지 배너 UI 컴포넌트 추가"
```

---

### Task 3: 홈 화면 배선 (`app/index.tsx`)

**Files:**
- Modify: `frontend/app/index.tsx`

**Interfaces:**
- Consumes: Task 1의 `pickFrequentDestination(destinations: FrequentDestination[]): FrequentDestination | null`, Task 2의 `FrequentDestinationBanner`. 기존 `tripsApi.frequent(token, { limit })`(`frontend/src/lib/trips/api.ts:28`), 기존 `searchRoutes(destinationPoint: RoutePoint, label: string, travelMode: TravelMode)`(`app/index.tsx:496`), 기존 `authToken`/`authStatus`(`app/index.tsx:234`), 기존 `mode` state(`app/index.tsx:254`), 기존 `inRouteView`(`app/index.tsx:909`).
- Produces: 없음(최상위 화면 컴포넌트, 이 변경을 더 쓰는 곳 없음).

이 작업은 로직이 아니라 기존 조각들을 연결하는 배선이라 전용 유닛 테스트를 새로 만들지 않는다 — Task 1의 테스트가 핵심 로직을, 기존 `tests/i18n-coverage.test.mjs`·`npm test` 전체 실행이 회귀를 담당한다. 수동 확인(Step 5)으로 실제 동작을 본다.

- [ ] **Step 1: state와 조회 effect 추가**

`app/index.tsx:254` (`const [mode, setMode] = useState<TravelMode>('driving');`) 근처에 추가:

```ts
const [frequentDestination, setFrequentDestination] = useState<FrequentDestination | null>(null);
```

마운트 시 1회(탭 재방문 시 재실행 안 됨) 조회하는 effect를 추가한다 — 의존성 배열은 `[authToken]`으로, `authToken`이 로그인 전엔 `null`이었다가 로그인 후 값이 생기는 비동기 타이밍을 커버한다:

```ts
useEffect(() => {
  if (authStatus !== 'authenticated' || !authToken) return;
  tripsApi
    .frequent(authToken, { limit: 1 })
    .then((destinations) => setFrequentDestination(pickFrequentDestination(destinations)))
    .catch(() => {}); // 실패해도 배너만 안 뜨면 된다 - 홈 화면 자체를 막지 않는다
}, [authStatus, authToken]);
```

import 추가: `FrequentDestination`은 이미 `tripsApi`와 같은 파일(`../src/lib/trips/api`)에서 export되므로 기존 `tripsApi` import 줄에 타입만 추가하고, `pickFrequentDestination`은 `../src/lib/trips/frequentBanner`에서, `FrequentDestinationBanner`는 `../src/components/FrequentDestinationBanner`에서 가져온다.

- [ ] **Step 2: 핸들러 2개 추가**

`onPickRecent`(`app/index.tsx:670`) 바로 아래에 추가. `onConfirmFrequent`는 그 함수와 완전히 같은 패턴(`setDestination` → `setManualDestination` → `searchRoutes`)을 쓰되, 배너를 먼저 닫는다:

```ts
const onConfirmFrequent = async () => {
  if (!frequentDestination) return;
  const point: RoutePoint = { lat: frequentDestination.lat, lng: frequentDestination.lon };
  setFrequentDestination(null);
  setDestination(frequentDestination.label);
  setManualDestination(point);
  await searchRoutes(point, frequentDestination.label, mode);
};

const onDismissFrequent = () => setFrequentDestination(null);
```

- [ ] **Step 3: JSX에 배너 렌더링**

`app/index.tsx:909`(`const inRouteView = ...`) 아래, `return (` 블록 안 `<ScreenHeader title={<Logo />} />` 바로 다음 줄(약 952번째 줄)에 추가:

```tsx
{frequentDestination && !inRouteView && (
  <FrequentDestinationBanner
    label={frequentDestination.label}
    onConfirm={onConfirmFrequent}
    onDismiss={onDismissFrequent}
  />
)}
```

- [ ] **Step 4: 타입체크 + 전체 테스트**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: 타입 에러 없음, 테스트 전부 PASS.

- [ ] **Step 5: 수동 확인(Review Focus 경계값 포함)**

로컬 백엔드에 테스트 계정으로 같은 목적지 5번 이상 Trip을 만들어(`POST /api/trips` 5회 또는 실제 앱에서 길찾기 5번) 로그인 후 홈 화면을 새로 열어 배너가 뜨는지 확인한다. [아니오]를 누르고 다른 탭을 눌렀다가 홈으로 돌아와도 배너가 다시 안 뜨는지 확인한다. [경로 안내]를 누르면 모드 선택 화면(차량/도보/자전거/대중교통)으로 넘어가는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add frontend/app/index.tsx
git commit -m "feat: 홈 화면에 자주 가는 목적지 안내 배너 연결"
```
