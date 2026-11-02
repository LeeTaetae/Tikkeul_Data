# 홈 화면 주변 인기 장소 콜드스타트 fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면 "인기 장소 ▸ nearby 탭"이 트립 데이터가 없어 비어 있을 때, 기존 카카오 로컬 카테고리 검색(음식점+카페)으로 대체 목록을 보여준다.

**Architecture:** `frontend/app/index.tsx`의 기존 popular 조회 `useEffect` 안에서, `tripsApi.popular()` 결과가 비면 이미 있는 `fetchNearbyPlaces()`(음식점 FD6, 카페 CE7)를 호출해 거리순으로 합친 뒤 기존 `FrequentDestination` 모양으로 변환해 같은 state(`popularPlaces`)에 넣는다. 새 백엔드 코드 없음, 새 UI 없음.

**Tech Stack:** React Native / Expo (TypeScript), 기존 `src/lib/places/api.ts`, `src/lib/trips/api.ts`.

**Spec:** `docs/superpowers/specs/2026-11-02-nearby-popular-fallback-design.md`

## Global Constraints

- trending 탭(`PLACEHOLDER_TRENDS`)은 수정하지 않는다.
- 새 백엔드 엔드포인트를 만들지 않는다 — 기존 `GET /places/nearby`만 쓴다.
- `visit_count`/`last_used_at`는 화면에 쓰이지 않는 필드이므로 임의 채움값만 넣는다(꾸며낸 의미 부여 금지).
- 카카오 결과를 "인기순"이라 표현하지 않는다(거리순 그대로).

## Review Focus

- 위치 권한 거부/`getCurrentLocation()` 실패 시 — fallback 호출 자체가 트리거되지 않아야 함(현재도 `.catch(() => setPopularPlaces(null))`로 처리됨, 회귀 없는지 확인).
- `fetchNearbyPlaces` 두 호출이 모두 실패(네트워크 오류)하는 경우 — 빈 화면이 아니라 기존 `places.empty` 문구가 그대로 보여야 함.
- 음식점+카페 모두 0건인 외곽 지역 — 빈 배열로 떨어져 `places.empty`가 보여야 하며 크래시가 나면 안 됨.
- 음식점/카페 중 하나만 결과가 있는 경우 — 병합 로직이 한쪽이 비어도 정상 동작해야 함.
- 중복 좌표(같은 장소가 두 카테고리에 다 걸리는 경우는 없음 — 카카오 카테고리가 배타적이라 사실상 발생하지 않음, 별도 dedup 불필요).

---

### Task 1: nearby 탭 콜드스타트 fallback

**Files:**
- Modify: `frontend/app/index.tsx:282-290` (popular 조회 `useEffect`)
- Test: `frontend/tests/*.test.mjs` (기존 테스트 러너 패턴에 맞춰 새 파일 추가, 예: `frontend/tests/popularFallback.test.mjs`)

**Interfaces:**
- Consumes:
  - `tripsApi.popular({lat, lng, limit}): Promise<FrequentDestination[]>` (`frontend/src/lib/trips/api.ts`, 기존)
  - `fetchNearbyPlaces(category: PlaceCategory, origin: RoutePoint, radiusM?: number): Promise<NearbyPlace[]>` (`frontend/src/lib/places/api.ts`, 기존) — `NearbyPlace = { name: string; address: string; distanceM: number; point: { lat: number; lng: number } }`
  - `FrequentDestination = { label: string; lat: number; lon: number; address_text: string; visit_count: number; last_used_at: string }` (`frontend/src/lib/trips/api.ts` 또는 타입 정의 위치, 기존)
- Produces:
  - `toFallbackPopular(places: NearbyPlace[], limit: number): FrequentDestination[]` — 새 순수 함수(파일 내 또는 같은 디렉토리의 작은 유틸). 테스트가 직접 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`frontend/tests/popularFallback.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { toFallbackPopular } from '../src/lib/places/popularFallback.ts';

test('merges and sorts by distance, maps to FrequentDestination shape', () => {
  const restaurants = [{ name: '김밥천국', address: '서울시 종로구', distanceM: 300, point: { lat: 37.1, lng: 127.1 } }];
  const cafes = [{ name: '스타벅스', address: '서울시 종로구', distanceM: 100, point: { lat: 37.2, lng: 127.2 } }];
  const result = toFallbackPopular([...restaurants, ...cafes], 20);
  assert.equal(result.length, 2);
  assert.equal(result[0].label, '스타벅스'); // 더 가까운 것 먼저
  assert.equal(result[0].lat, 37.2);
  assert.equal(result[0].lon, 127.2);
  assert.equal(result[0].address_text, '서울시 종로구');
  assert.equal(result[1].label, '김밥천국');
});

test('limit 보다 많으면 상위 N개만 남긴다', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    name: `place-${i}`, address: 'addr', distanceM: i, point: { lat: 0, lng: 0 },
  }));
  const result = toFallbackPopular(many, 20);
  assert.equal(result.length, 20);
  assert.equal(result[0].label, 'place-0');
});

test('빈 배열을 넣으면 빈 배열을 돌려준다', () => {
  assert.deepEqual(toFallbackPopular([], 20), []);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && node --test tests/popularFallback.test.mjs`
Expected: FAIL — `popularFallback.js` 모듈이 없어 import 에러.

- [ ] **Step 3: `toFallbackPopular(places: NearbyPlace[], limit: number): FrequentDestination[]`를 `frontend/src/lib/places/popularFallback.ts`에 구현**

거리(`distanceM`) 오름차순 정렬 후 `slice(0, limit)`, 각 항목을 `{ label: name, lat: point.lat, lon: point.lng, address_text: address, visit_count: 0, last_used_at: new Date().toISOString() }`로 매핑.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && node --test tests/popularFallback.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: `frontend/app/index.tsx`의 popular 조회 `useEffect`(282~290줄)를 수정**

```ts
useEffect(() => {
  getCurrentLocation()
    .then(async (point) => {
      const popular = await tripsApi.popular({ lat: point.lat, lng: point.lng, limit: 20 });
      if (popular.length > 0) return popular;
      const [restaurants, cafes] = await Promise.all([
        fetchNearbyPlaces('restaurant', point, 1000).catch(() => []),
        fetchNearbyPlaces('cafe', point, 1000).catch(() => []),
      ]);
      return toFallbackPopular([...restaurants, ...cafes], 20);
    })
    .then(setPopularPlaces)
    .catch(() => setPopularPlaces(null));
}, []);
```

`fetchNearbyPlaces`, `toFallbackPopular` import 추가. (`places.empty` 문구는 변경 없이 그대로 — `popularPlaces`가 빈 배열이면 기존 로직대로 보여짐.)

- [ ] **Step 6: 수동 확인**

Run: 프론트엔드 실행(`npm run start` 또는 이미 켜져 있는 Expo 서버), 트립 기록이 없는 좌표에서 홈 화면 nearby 탭을 열어 음식점/카페 카드가 뜨는지 확인. (자동화 테스트로 커버되지 않는 통합 확인.)

- [ ] **Step 7: 커밋**

```bash
cd frontend
git add src/lib/places/popularFallback.ts tests/popularFallback.test.mjs app/index.tsx
git commit -m "feat: 인기 장소 탭에 콜드스타트 fallback(주변 음식점·카페) 추가"
```
