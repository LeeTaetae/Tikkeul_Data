# 즐겨찾기 카테고리 design

## 의도 / 왜
지금 커스텀 즐겨찾기는 평평한 목록이라 많아지면 찾기 어렵다. 사용자가 자유롭게 이름 붙인 카테고리로 커스텀 즐겨찾기를 묶고, 카테고리를 누르면 홈 화면 지도에 그 카테고리의 장소들이 마커로 뜨게 한다.

## 범위
- 커스텀(`kind='custom'`) 즐겨찾기에만 선택적 `category`(자유 텍스트) 필드 추가. 집/회사는 범위 밖(이미 1개씩만 허용되는 특별 슬롯이라 카테고리 묶음이 필요 없음).
- 즐겨찾기 화면에서 커스텀 즐겨찾기를 카테고리별로 묶어서 보여줌.
- 카테고리를 누르면 홈 화면으로 이동, 기존 "주변 카테고리(맛집/카페 등) 누르면 지도에 마커" 메커니즘(`mapRef.showPlaces`/`clearPlaces`)을 그대로 재사용해 그 카테고리의 즐겨찾기를 마커로 표시.

## 기존 코드 (재사용 대상)
- `backend/app/favorites/models.py` — `FavoriteKind`(home/work/custom), `FavoritePlace`(id, user_id, kind, label, lat, lon, address_text, created_at), home/work 1개 제한용 partial unique index.
- `backend/app/favorites/router.py` — `GET/POST /api/favorites`, `PATCH/DELETE /api/favorites/{id}`. `update_favorite`는 "명시적 null = 안 바꿈"으로 처리(모든 필드가 NOT NULL이라 가능했던 방식 — `category`가 Optional이 되면 이 가정이 깨짐, 아래 Non-goal 참고).
- `frontend/app/favorites.tsx` — 평평한 목록(`FavoriteRow`), 카테고리 선택 칩(`kind`만, home/work/custom), 추가 폼(`AddFavoriteCard`).
- `frontend/app/index.tsx`의 `onPressCategory`/`closeNearby`(599~625줄) — 카테고리 누르면 `getCurrentLocation` → 장소 조회 → `mapRef.current?.showPlaces(places.map(p => ({point, label})), color)`. 즐겨찾기 카테고리는 장소 조회 없이 이미 가진 좌표로 바로 `showPlaces` 호출.
- `frontend/src/map/types.ts`의 `KakaoMapHandle.showPlaces(places: {point: RoutePoint; label: string}[], color: string)`, `clearPlaces()`.

## 결정된 사항
- **카테고리는 자유 텍스트**(사용자가 직접 이름 지음), 고정 목록 아님. 커스텀 즐겨찾기 생성/수정 시 선택 입력.
- **카테고리 클릭 시 동작**: 즐겨찾기 화면에 지도를 새로 안 만든다 — 홈 화면(`index.tsx`, 지도가 있는 화면)으로 이동해서 거기서 마커를 보여준다. 기존 주변 카테고리 버튼과 동일한 `showPlaces`/`clearPlaces` 메커니즘 재사용.
- **DB 마이그레이션**: `User` 때와 달리 단순하다 — `category`는 새 nullable 컬럼 추가일 뿐 기존 제약(NOT NULL·UNIQUE)을 안 건드리므로, 테이블 재생성 없이 `ALTER TABLE favoriteplace ADD COLUMN category TEXT`로 충분하다. FK를 가진 자식 테이블이 없어서(즐겨찾기 자체가 자식) 이전처럼 FK 깨짐 위험도 없다. 그래도 백업은 뜬다(팀 규칙).

## Non-goals / Anti-goals
- `PATCH`로 카테고리를 다시 `null`로 "지우기"는 이번 범위 밖(기존 "명시적 null = 안 바꿈" 동작을 건드리지 않음 — 카테고리를 다른 문자열로 바꾸는 건 되지만, 완전히 없애는 기능은 나중에).
- 즐겨찾기 화면 자체에 지도를 넣지 않는다(홈 화면으로 이동하는 방식으로 확정).
- 카테고리의 사전 관리 화면(이름 변경·삭제 전용 UI) 없음 — 카테고리는 즐겨찾기에 붙은 문자열일 뿐, 별도 엔티티로 안 만든다.
- 홈/회사 즐겨찾기는 카테고리 대상이 아니다.

## 빌더에게 남기는 것
- 카테고리별 그룹 UI(섹션 헤더 vs 칩 목록)의 정확한 비주얼은 구현자 판단, 기존 `Card`/`Chip` 컴포넌트 스타일을 따른다.
- 홈 화면으로 이동할 때 정확한 파라미터 전달 방식(route param으로 카테고리 이름만 넘기고 index.tsx에서 목록 재조회 vs 다른 방식)은 구현자 판단, 다만 새 백엔드 엔드포인트는 만들지 않는다(기존 `GET /api/favorites`로 충분).
