# 즐겨찾기 길안내 플로우 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 즐겨찾기(집/회사/카테고리 커스텀)를 눌렀을 때 바로 턴바이턴 안내로 들어가지 않고, 기존 "주변 장소 선택" 때와 동일하게 경로 스타일(차량/도보/자전거/대중교통) 선택 단계를 먼저 거친다. 즐겨찾기 카테고리로 홈 화면에 들어왔을 땐 기본 인기 장소 패널 대신 그 카테고리 즐겨찾기 목록이 접힌 바텀시트로 뜨고, 닫기 버튼으로 기본 화면으로 돌아갈 수 있다.

**Architecture:** `frontend/app/favorites.tsx`의 `onStart`를 바꿔 홈 화면으로 이동시키고(파라미터로 단일 목적지 전달), `frontend/app/index.tsx`에 그 파라미터를 받아 기존 `searchRoutes`(이미 "주변 장소" 플로우가 쓰는 것과 동일 함수)를 호출하는 effect를 추가한다. 카테고리 플로우도 마커 찍기에 더해 새 바텀시트 상태(`favoriteCategoryView`/`favoriteCategoryPlaces`)를 추가해 목록을 보여주고, 마커·목록 항목 클릭 시 같은 `searchRoutes` 경로로 보낸다. 새 백엔드 변경 없음 — 전부 프론트엔드 작업.

**Tech Stack:** React Native/Expo(frontend), 기존 `searchRoutes`/`BottomSheet`/`showPlaces` 메커니즘 재사용.

**Spec:** `docs/superpowers/specs/2026-11-02-favorite-categories-design.md` ("추가 결정사항" 절)

## Global Constraints

- 새 백엔드 엔드포인트·스키마 변경 없음 — 프론트엔드 전용 작업.
- `nearbyCategory`(내 주변 카테고리) 시트와 새 `favoriteCategoryView`(즐겨찾기 카테고리) 시트는 **반드시 상호 배타적**이어야 한다 — 한쪽을 열 때 다른 쪽을 확실히 닫는다(이전 최종 리뷰에서 이 상호배제를 한 방향만 처리해서 버그가 난 적 있음 — 이번엔 양방향 다 처리).
- `BottomSheet`는 기본값(`draggable` 생략 = true)으로 써야 한다 — `draggable={false}`를 주면 접힘/펼침 동작이 사라진다.
- 길안내 시작은 항상 `searchRoutes(point, label, mode)` 경유 — `setGuidanceRequest`로 바로 턴바이턴에 진입하는 기존 숏컷은 이번 작업으로 안 쓰게 된다(완전히 지우진 않아도 되지만, 즐겨찾기 경로에서는 더 이상 호출하지 않는다).

## Review Focus

- 내 주변 카테고리 시트가 열린 상태에서 즐겨찾기 화면으로 가서 카테고리를 누르고 돌아왔을 때 — 내 주변 시트가 확실히 닫혀 있고, 지도 마커 클릭이 즐겨찾기 쪽으로만 연결되는지(`onPlaceClick`이 올바른 배열을 참조하는지).
- 반대로 즐겨찾기 카테고리 시트가 열린 상태에서 "내 주변(맛집/카페)" 버튼을 눌렀을 때 — 즐겨찾기 시트가 확실히 닫히는지.
- 즐겨찾기 카테고리 닫기(X) 버튼을 눌렀을 때 — 마커가 지워지고 기본 인기 장소 패널로 정상 복귀하는지.
- 집/회사 즐겨찾기를 눌렀을 때 — 바로 길안내가 시작되는 게 아니라 경로 스타일 선택 화면이 먼저 뜨는지, 로그인 안 된 상태에서 접근 시도 시(이미 있는 가드) 깨지지 않는지.
- 카테고리 시트의 목록이 기본 접힌 상태로 뜨는지(펼쳐진 채로 뜨면 요구사항 위반).

---

### Task 1: 즐겨찾기 → 경로 선택 플로우 + 카테고리 바텀시트

**Files:**
- Modify: `frontend/app/favorites.tsx`, `frontend/app/index.tsx`, `frontend/src/i18n/locales/{ko,en,zh}.ts`
- Test: `frontend/tests/*.test.mjs`(해당되는 순수 로직이 있으면 추가, 없으면 수동 확인으로 충분 — 이 플랜의 나머지는 화면 상호작용이라 기존 패턴상 컴포넌트 테스트 프레임워크가 없음)

**Interfaces:**
- Consumes: 기존 `searchRoutes(point: RoutePoint, label: string, mode: TravelMode): Promise<StyledRoute[] | null>`(index.tsx 기존 함수), `favoritesApi.list`, `KakaoMapHandle.showPlaces/clearPlaces`, `BottomSheet` 컴포넌트(기본 `draggable=true`).
- Produces: 없음(화면 전용)

- [ ] **Step 1: `favorites.tsx`의 `onStart` 수정**

지금은 `setGuidanceRequest(...)` + `router.push('/navigation')`로 바로 턴바이턴에 들어간다. 이를 `router.push({ pathname: '/', params: { favLat: String(item.lat), favLng: String(item.lon), favLabel: item.label } })`로 바꾼다(홈 화면으로 이동, 경로 탐색은 거기서). `getCurrentLocation()`/`setGuidanceRequest` 호출은 더 이상 여기서 안 함 — `startingId`/로딩 스피너는 라우팅 전환 자체가 빠르니 유지해도 되고 제거해도 됨(구현자 판단, 과하게 손대지 않는다).

- [ ] **Step 2: `index.tsx`에 단일 즐겨찾기 목적지 파라미터 처리 추가**

`useLocalSearchParams`에 `favLat?: string; favLng?: string; favLabel?: string` 추가. 새 `useEffect`(기존 `favoriteCategory` effect 바로 아래 또는 비슷한 위치): 세 값이 모두 있으면 `searchRoutes({ lat: Number(favLat), lng: Number(favLng) }, favLabel, mode)` 호출 후 `router.setParams({ favLat: undefined, favLng: undefined, favLabel: undefined })`(같은 즐겨찾기를 또 눌러도 재실행되게). `mode`는 기존 state 그대로 사용(기본 'driving').

- [ ] **Step 3: `index.tsx`에 `favoriteCategoryView`/`favoriteCategoryPlaces` 상태 추가**

```ts
const [favoriteCategoryView, setFavoriteCategoryView] = useState<string | null>(null);
const [favoriteCategoryPlaces, setFavoriteCategoryPlaces] = useState<FavoritePlace[] | null>(null);
```
(`FavoritePlace` 타입은 `src/lib/favorites/api.ts`에서 import.) `closeFavoriteCategoryView()` 함수 추가: 두 state를 `null`로, `mapRef.current?.clearPlaces()`.

- [ ] **Step 4: 기존 `favoriteCategory` effect를 확장**

마커만 찍던 걸 `favoriteCategoryView`/`favoriteCategoryPlaces`도 채우도록 바꾼다: `favoritesApi.list` 결과에서 `category === favoriteCategory`로 필터한 배열을 `setFavoriteCategoryPlaces(filtered)`, `setFavoriteCategoryView(favoriteCategory)`로 저장하고, `showPlaces`는 그대로 호출. 이 effect 시작 부분에서 `closeNearby()`(이미 있음)는 유지.

- [ ] **Step 5: 내 주변 카테고리 쪽에서 즐겨찾기 카테고리 시트를 닫도록 양방향 배타성 추가**

`onPressCategory`(내 주변 카테고리 버튼 핸들러) 시작 부분에 `closeFavoriteCategoryView()` 호출 추가. `closeNearby()`가 불리는 다른 지점들(검색창 포커스 등, `onFocus={() => { closeNearby(); ... }}` 패턴)도 함께 `closeFavoriteCategoryView()`를 부르는 게 안전한지 검토 — 최소한 `onPressCategory`는 확실히 추가.

- [ ] **Step 6: `onPickFavoritePlace` 핸들러 추가**

```ts
const onPickFavoritePlace = async (place: FavoritePlace) => {
  closeFavoriteCategoryView();
  await searchRoutes({ lat: place.lat, lng: place.lon }, place.label, mode);
};
```

- [ ] **Step 7: `onPlaceClick`에서 즐겨찾기 마커 클릭 처리**

```ts
onPlaceClick={(i) => {
  if (favoriteCategoryPlaces) { favoriteCategoryPlaces[i] && onPickFavoritePlace(favoriteCategoryPlaces[i]); return; }
  nearbyPlaces?.[i] && onPickNearbyPlace(nearbyPlaces[i]);
}}
```

- [ ] **Step 8: `hasPopularSheet`에서 즐겨찾기 카테고리 시트 제외, 새 시트 렌더링 추가**

`hasPopularSheet`/`hasSheet` 정의에 `favoriteCategoryView` 추가(다른 시트들과 같은 방식으로 `!favoriteCategoryView` 조건 삽입). 시트 렌더링 체인(`chatOpen ? ... : nearbyCategory ? ... : ...`)에 `favoriteCategoryView` 분기를 적당한 우선순위에 추가(예: `nearbyCategory` 다음, 다른 활성 플로우들보다는 먼저 — 정확한 위치는 구현자가 기존 체인을 읽고 판단, 단 `chatOpen`/진행 중인 길안내·경로 조회보다는 낮은 우선순위여야 함). `BottomSheet`는 `draggable` 생략(기본 true, 접힘 상태로 시작). 헤더에 카테고리 이름 + `RoundButton icon={X} onPress={closeFavoriteCategoryView}`, 목록은 `favoriteCategoryPlaces?.map(...)`을 `Pressable`로 감싸 `onPickFavoritePlace` 연결(기존 `nearbyPlaces` 목록 렌더링 블록의 스타일/구조 참고).

- [ ] **Step 9: i18n 문구 추가**

카테고리 시트 제목, 닫기 버튼 접근성 라벨 등 ko/en/zh `favorites.*` 또는 `places.*` 네임스페이스에 추가(기존 네이밍 컨벤션 따름).

- [ ] **Step 10: 수동 확인**

Run: 프론트 실행 후 (a) 집 즐겨찾기 눌러서 경로 스타일 선택 화면이 먼저 뜨는지, (b) 카테고리 즐겨찾기 눌러서 지도에 마커+접힌 시트가 뜨는지, 시트를 끌어올려 목록이 보이는지, 목록/마커 클릭 시 경로 선택으로 넘어가는지, (c) X 버튼으로 닫으면 기본 인기 장소 패널로 돌아가는지, (d) 내 주변 카테고리와 즐겨찾기 카테고리를 번갈아 눌러도 서로 안 겹치는지 확인(자동화 테스트 범위 밖).

- [ ] **Step 11: 테스트 실행**

Run: `cd frontend && node --test tests/*.test.mjs && npx tsc --noEmit`
Expected: 기존 테스트 전부 통과(이 플랜 범위에서 새 로직은 대부분 화면 상호작용이라 신규 유닛테스트 대상이 적음), `tsc` 클린.

- [ ] **Step 12: 커밋**

```bash
cd frontend
git add app/favorites.tsx app/index.tsx src/i18n/locales
git commit -m "feat: 즐겨찾기 길안내 전 경로 선택 단계 추가, 카테고리 바텀시트"
```
