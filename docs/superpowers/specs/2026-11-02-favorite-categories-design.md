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

## 추가 결정사항 (1차 출시 후 사용자 피드백 반영, 2026-11-02)

1차 구현(마커만 찍고 끝)을 써본 뒤 나온 추가 요구사항:

- **길안내 전에 경로 선택 단계를 꼭 거친다.** 집/회사든 카테고리 즐겨찾기든, 즐겨찾기를 눌러서 길찾기를 시작할 때 바로 턴바이턴 안내로 들어가면 안 되고, 기존 "주변 장소"를 골랐을 때처럼(`searchRoutes` → `routeStyles` 바텀시트에서 차량/도보/자전거/대중교통·스타일을 고르는 화면)을 먼저 거쳐야 한다. `frontend/app/favorites.tsx`의 `onStart`(지금은 `setGuidanceRequest`+`/navigation`으로 바로 점프)를 바꿔서, 홈 화면으로 이동해 `searchRoutes`를 타게 한다.
- **카테고리 목록은 기본 접힘, 드래그로 펼침.** 다행히 `BottomSheet`가 기본값(`draggable=true`)에서 이미 `COLLAPSED_HEIGHT`로 접힌 채 시작하고 손잡이를 끌면 펼쳐지는 동작을 갖고 있다 — 새 토글 UI를 만들 필요 없이, 카테고리 시트를 그냥 `draggable` 기본값으로 쓰면 된다(로딩/스타일 시트들처럼 `draggable={false}`를 주면 안 됨).
- **카테고리로 들어왔을 때는 기본 패널(이 주변 인기 장소/전국 트렌드)이 아니라 그 카테고리의 즐겨찾기 목록이 바텀시트로 떠야 한다.** 지금은 마커만 찍고 시트 상태를 안 건드려서 기존 `hasPopularSheet`가 그대로 보인다 — `favoriteCategory`로 들어왔을 때 쓸 새 시트 상태(예: `favoriteCategoryView`/`favoriteCategoryPlaces`)를 만들어 `hasPopularSheet` 조건에서 제외하고, 그 시트가 우선순위를 갖게 한다.
- **그 시트엔 닫기(X) 버튼이 있어야 한다.** 홈 화면 자체엔 "같은 카테고리 다시 탭" 같은 토글 UI가 없으므로(그건 즐겨찾기 화면에 있음), 명시적으로 닫을 수 있어야 마커·시트를 지우고 기본 화면(인기 장소 패널)으로 돌아간다.
- **지도 마커를 누르거나 시트의 목록 항목을 누르면** `onPickNearbyPlace`와 동일한 패턴(기존 패널/마커 정리 → `searchRoutes` 호출)으로 그 장소까지의 경로 선택 단계로 넘어간다.
- 기존 "내 주변 카테고리"(`nearbyCategory`) 시트와 이 새 "즐겨찾기 카테고리" 시트는 서로 배타적이어야 한다(한쪽을 열 때 다른 쪽을 반드시 닫는다) — 최종 리뷰에서 이미 한 번 이 상호배제를 놓쳐서 버그가 났던 적 있으니 각별히 신경 쓴다.
