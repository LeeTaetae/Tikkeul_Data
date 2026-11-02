# 홈 화면 주변 인기 장소 — 콜드스타트 fallback (short design)

## 의도 / 왜
홈 화면 "인기 장소" 바텀시트의 `nearby` 탭은 `GET /api/trips/popular`(우리 앱 사용자들의 실제 방문 기록 기반)을 쓴다. 서비스 초기라 방문 기록이 거의 없어, 처음 가는 동네에서는 거의 항상 빈 목록(`places.empty`)만 보인다. 목표는 "그 지역 처음 가거나 그 날 뭐 할지 모를 때 참고할 거리"를 끊김 없이 보여주는 것.

## 범위
- **In scope:** `nearby` 탭이 비었을 때(응답 `length === 0`, 또는 실패해 `null`일 때) 카카오 로컬 카테고리 검색으로 대체 데이터를 채운다.
- **Out of scope:** `trending` 탭(전국 더미 데이터, `PLACEHOLDER_TRENDS`)은 건드리지 않는다. 새 백엔드 엔드포인트를 만들지 않는다 — 기존 `GET /places/nearby`(`frontend/src/lib/places/api.ts`의 `fetchNearbyPlaces`)를 그대로 재사용한다.

## Non-goals / Anti-goals
- 카카오 결과를 "인기순"으로 재해석하지 않는다(카카오는 인기순 정렬을 지원하지 않음 — 거리순 그대로 둔다).
- `visit_count`/`last_used_at` 등 트립 기반 메타데이터를 꾸며내지 않는다 — 화면에 쓰이지 않는 필드는 임의 채움값만 넣는다.

## 접근 (검토한 방법)
1. **(선택)** `nearby` 비었을 때 기존 `/places/nearby`(음식점 FD6 + 카페 CE7)로 fallback — 추가 연동 없이 지금 코드로 바로 됨. 거리순 리스트.
2. 한국관광공사 TourAPI 등 신규 연동으로 `trending` 탭을 실데이터로 교체 — 범위가 더 크고 API 키 신청이 필요해 보류(이번 작업 범위 밖).

사용자가 1번 선택.

## 결정된 동작
- `frontend/app/index.tsx`의 popular 조회 `useEffect`(약 285~290줄)에서 `tripsApi.popular(...)` 결과가 빈 배열이거나 실패하면, `fetchNearbyPlaces('restaurant', point, 1000)`과 `fetchNearbyPlaces('cafe', point, 1000)`를 병렬 호출.
- 두 결과를 합쳐 `distanceM` 오름차순으로 정렬, 상위 20개만 취함.
- 각 항목을 기존 `FrequentDestination` 모양으로 매핑해 `setPopularPlaces`에 그대로 넣는다(UI 변경 없음):
  - `label` = `NearbyPlace.name`
  - `lat`/`lon` = `NearbyPlace.point.lat`/`.lng`
  - `address_text` = `NearbyPlace.address`
  - `visit_count` = `0` (화면에 쓰이지 않음)
  - `last_used_at` = 호출 시점 ISO 문자열 (화면에 쓰이지 않음)
- 둘 다 비거나 실패하면 기존처럼 `places.empty` 문구를 그대로 보여준다(변경 없음).

## 빌더에게 남기는 것
- 매핑 함수 이름, 두 fetch를 합치는 정확한 코드 형태(Promise.all vs 순차)는 구현자 판단.
