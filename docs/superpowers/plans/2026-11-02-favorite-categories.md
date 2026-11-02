# 즐겨찾기 카테고리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 커스텀 즐겨찾기에 자유 텍스트 카테고리를 붙이고, 즐겨찾기 화면에서 카테고리별로 묶어 보여주며, 카테고리를 누르면 홈 화면 지도에 그 카테고리 장소들이 마커로 뜬다.

**Architecture:** `FavoritePlace`에 nullable `category` 컬럼 추가(custom 전용, 단순 `ALTER TABLE ADD COLUMN` — FK 자식 테이블이 없어 재생성 불필요). 프론트는 즐겨찾기 목록을 카테고리로 그룹핑해 보여주고, 카테고리를 누르면 `router.push`로 홈(index.tsx)에 카테고리 이름을 파라미터로 전달 → 홈 화면이 그 카테고리의 즐겨찾기를 다시 조회해 기존 `showPlaces`/`clearPlaces` 메커니즘으로 지도에 마커 표시.

**Tech Stack:** FastAPI/SQLModel/SQLite(backend, 기존 패턴), React Native/Expo(frontend, 기존 즐겨찾기·지도 패턴 재사용).

**Spec:** `docs/superpowers/specs/2026-11-02-favorite-categories-design.md`

## Global Constraints

- `category`는 `kind='custom'`에만 의미 있음 — home/work는 범위 밖, 항상 `null`.
- 새 백엔드 엔드포인트를 만들지 않는다 — 기존 `GET/POST/PATCH /api/favorites`만 확장.
- `PATCH`로 카테고리를 `null`로 되돌리는 기능은 범위 밖(기존 "명시적 null=안 바꿈" 동작 유지).
- 즐겨찾기 화면 자체엔 지도를 넣지 않는다 — 카테고리 클릭 시 홈 화면으로 이동.
- `backend/data/tikkeul.db`에 실제 데이터 있음 — 마이그레이션 전 백업 필수(단, 이번엔 단순 컬럼 추가라 테이블 재생성/FK 위험 없음).

## Review Focus

- `category`가 빈 문자열(`""`)로 저장되는 경우 — `null`과 구분 없이 "카테고리 없음"으로 취급되는지, 빈 문자열 그룹이 이상하게 안 생기는지.
- home/work 즐겨찾기 생성·수정 시 `category`를 보내도 무시되는지(실수로 집에 카테고리가 붙어 커스텀 그룹에 섞이면 안 됨).
- 홈 화면이 카테고리 파라미터를 받았는데 그 사이 해당 카테고리의 즐겨찾기가 하나도 없어진 경우(다른 데서 전부 삭제됨) — 빈 마커로 조용히 끝나는지, 에러가 나지 않는지.
- 즐겨찾기 화면에서 카테고리 없는 커스텀 즐겨찾기와 카테고리 있는 즐겨찾기가 섞여 있을 때 — "카테고리 없음" 항목들이 그룹 바깥(또는 별도 그룹)에 정상적으로 보이는지.

---

### Task 1: 백엔드 — FavoritePlace에 category 필드 추가

**Files:**
- Modify: `backend/app/favorites/models.py`, `backend/app/favorites/router.py`
- Create: `backend/scripts/migrate_favorite_categories.py`
- Test: `backend/tests/test_migrate_favorite_categories.py`, 기존 `backend/tests/test_favorites_api.py`(파일명은 구현자가 확인)에 케이스 추가

**Interfaces:**
- Produces: `FavoritePlace.category: Optional[str]`, `FavoritePlaceCreate.category: Optional[str] = None`, `FavoritePlaceUpdate.category: Optional[str] = None`, `FavoritePlacePublic.category: Optional[str]`

- [ ] **Step 1: 실패하는 마이그레이션 테스트 작성**

`backend/tests/test_migrate_favorite_categories.py`: 임시 SQLite 파일에 `favoriteplace` 테이블을 기존 스키마(category 컬럼 없음)로 만들고 row 몇 개 넣은 뒤 `migrate(db_path)` 호출 → row 수 유지, 기존 데이터 값 보존, `category` 컬럼이 생겨서 새 row에 NULL/문자열 둘 다 넣을 수 있는지, 백업 파일 생성 확인. `backend/scripts/migrate_social_login.py`의 백업+멱등성 가드 패턴(이미 적용된 스키마면 조용히 스킵) 참고.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_migrate_favorite_categories.py -v`
Expected: FAIL

- [ ] **Step 3: `backend/scripts/migrate_favorite_categories.py`에 `migrate(db_path: Path) -> None` 구현**

`ALTER TABLE favoriteplace ADD COLUMN category TEXT`만 하면 되는 단순 마이그레이션(테이블 재생성 불필요 — `favoriteplace`를 참조하는 자식 테이블이 없어 FK 위험 없음). 그래도 실행 전 백업은 뜬다. `PRAGMA table_info(favoriteplace)`로 이미 `category` 컬럼이 있으면 조용히 스킵(멱등성). `if __name__ == "__main__":`로 `get_settings().database_url` 기반 CLI 진입점.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_migrate_favorite_categories.py -v`
Expected: PASS

- [ ] **Step 5: `models.py` 수정**

`FavoritePlace.category: Optional[str] = Field(default=None)` 추가. `FavoritePlaceCreate.category: Optional[str] = None`, `FavoritePlaceUpdate.category: Optional[str] = None`, `FavoritePlacePublic.category: Optional[str] = None` 추가.

- [ ] **Step 6: `router.py` 수정 — home/work는 category 무시**

`create_favorite`/`update_favorite`에서 `kind`(새로 생성되는 경우) 또는 기존 `place.kind`(수정의 경우)가 `custom`이 아니면 `category`를 강제로 `None`으로 둔다(사용자가 실수로/악의적으로 보내도 무시). 실패하는 테스트 먼저: home 즐겨찾기 생성 시 `category="뭔가"`를 보내도 응답의 `category`가 `null`인지 확인하는 테스트.

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/ -v -k favorite`
Expected: PASS (기존 + 신규 전부)

- [ ] **Step 8: 커밋**

```bash
cd backend
git add app/favorites/models.py app/favorites/router.py scripts/migrate_favorite_categories.py tests/
git commit -m "feat: 즐겨찾기(custom)에 카테고리 필드 추가"
```

---

### Task 2: 프론트 — 카테고리별 그룹 UI + 지도 마커 표시

**Files:**
- Modify: `frontend/src/lib/favorites/api.ts`, `frontend/app/favorites.tsx`, `frontend/app/index.tsx`, `frontend/src/i18n/locales/{ko,en,zh}.ts`
- Test: `frontend/tests/api-client.test.mjs`(기존 파일에 category 필드 포함 요청 조립 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `FavoritePlace.category: string | null`(백엔드 응답), `KakaoMapHandle.showPlaces(places: {point: RoutePoint; label: string}[], color: string)`/`clearPlaces()`(`frontend/src/map/types.ts`, 기존)
- Produces: 없음(화면 전용)

- [ ] **Step 1: `frontend/src/lib/favorites/api.ts` 타입에 `category` 추가**

`FavoritePlace.category: string | null`, `FavoritePlaceInput.category?: string | null` 추가.

- [ ] **Step 2: 실패하는 테스트 작성**

`favoritesApi.create`가 `category`를 바디에 포함해서 보내는지 확인하는 테스트를 기존 `api-client.test.mjs`의 패턴대로 추가.

- [ ] **Step 3: 테스트 실행해 실패 확인**

Run: `cd frontend && node --test tests/api-client.test.mjs`
Expected: FAIL (현재 타입엔 category 없음 — 테스트가 요청 바디에서 category를 못 찾음)

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && node --test tests/api-client.test.mjs`
Expected: PASS

- [ ] **Step 5: `favorites.tsx` — `AddFavoriteCard`에 카테고리 입력 추가**

`kind === 'custom'`일 때만 보이는 `TextField`(카테고리, 선택 입력 — 기존 `label` 필드 밑에 추가). 기존 카테고리 자동완성(과거에 쓴 카테고리 이름 제안)은 이번 범위에서 안 만든다(단순 자유 텍스트 입력). `onSave`에서 `category: category.trim() || undefined`로 `favoritesApi.create`에 전달.

- [ ] **Step 6: `favorites.tsx` — 목록을 카테고리로 그룹핑**

`items`를 `kind==='custom' && category`가 있는 것은 카테고리별로 묶고(카테고리 이름 알파벳/최근순 등 구현자 판단), 나머지(home/work/카테고리 없는 custom)는 기존처럼 평평하게 보여준다. 각 카테고리 그룹 헤더는 `Pressable`로 만들어 탭하면 Step 7의 네비게이션을 호출. 기존 `Card`/`FavoriteRow` 스타일 재사용, 새 컴포넌트를 과하게 쪼개지 않는다.

- [ ] **Step 7: 카테고리 헤더 클릭 → 홈 화면 이동**

`router.push({ pathname: '/', params: { favoriteCategory: category } })` (expo-router 파라미터 전달 — 정확한 타입/문법은 기존 `redirect` 파라미터 쓰는 패턴 참고).

- [ ] **Step 8: `index.tsx` — `favoriteCategory` 파라미터 처리**

`useLocalSearchParams<{ ...; favoriteCategory?: string }>()`로 받는다. `favoriteCategory`가 있으면(마운트 시 1회) `favoritesApi.list(token)` 호출 → `category === favoriteCategory`인 항목만 필터 → `mapRef.current?.showPlaces(filtered.map(f => ({ point: { lat: f.lat, lng: f.lon }, label: f.label })), colors.brand)`. 로그인 안 된 상태(토큰 없음)면 조용히 무시(즐겨찾기 화면 자체가 로그인 필요라 실제로는 안 생기는 경우).

- [ ] **Step 9: i18n 문구 추가**

카테고리 입력 라벨/플레이스홀더 등 ko/en/zh에 추가.

- [ ] **Step 10: 수동 확인**

Run: 프론트 실행 후 커스텀 즐겨찾기에 카테고리 붙여서 저장 → 즐겨찾기 화면에서 그룹으로 묶여 보이는지 → 그룹 탭 → 홈 화면 지도에 마커 뜨는지 확인(자동화 테스트 범위 밖).

- [ ] **Step 11: 커밋**

```bash
cd frontend
git add src/lib/favorites/api.ts app/favorites.tsx app/index.tsx src/i18n/locales tests/
git commit -m "feat: 즐겨찾기 카테고리별 그룹 표시 + 홈 지도 마커"
```
