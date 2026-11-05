# 자주 가는 목적지 안내 배너 design

## 의도 / 왜
Tesla 등 최신 차량의 "학습형 내비" 기능처럼, 사용자가 자주 가는 목적지를 앱이 기억해서 매번 검색하지 않고 바로 안내를 제안받게 한다.

## 범위
- 홈 화면(`frontend/app/index.tsx`)을 열 때(앱 세션당 1회) 로그인한 사용자의 1위 "자주 가는 목적지"를 조회해, 방문 횟수가 5회 이상이면 배너로 제안한다.
- 배너: "자주 가시는 {장소 이름}으로 안내할까요?" + [경로 안내] [아니오] 버튼.
- [경로 안내]: 기존 `onPickRecent`와 동일하게 `searchRoutes(point, label, mode)`를 호출해 차량/도보/자전거/대중교통 모드 선택 화면으로 넘어간다(턴바이턴 안내로 바로 점프하지 않는다 — 기존 즐겨찾기 설계 결정과 동일한 이유).
- [아니오]: 배너만 닫는다.

## 기존 코드 (재사용 대상)
- `backend/app/trips/service.py`의 `frequent_destinations(session, user_id, days, limit)` — 이미 방문 횟수(`visit_count`) 내림차순으로 반환. 새 백엔드 코드 불필요.
- `backend/app/trips/router.py`의 `GET /api/trips/frequent` (기본 `days=30`, `limit` 쿼리 파라미터).
- `frontend/src/lib/trips/api.ts`의 `tripsApi.frequent(token, { limit })`.
- `frontend/app/index.tsx`의 `searchRoutes(point, label, mode)`와 `onPickRecent`(670번째 줄 근방) — 그대로 재사용.
- `frontend/src/lib/auth/AuthContext`의 `useAuth()` — `authStatus`/`authToken`으로 로그인 여부 확인.

## 결정된 사항
- **최소 방문 횟수: 5회.** `limit=1`로 조회하면 백엔드가 이미 횟수 내림차순으로 정렬해 주므로, 클라이언트는 받은 결과 하나의 `visit_count >= 5`만 확인하면 "가장 많이 간 곳"이 자동으로 보장된다. 추가 정렬·집계 로직 불필요.
- **노출 빈도: 앱 세션당 1회.** 앱을 새로 켤 때(cold start)마다 다시 물어보되, 같은 세션 안에서 탭을 왔다갔다 하다 홈 화면으로 돌아올 때는 다시 뜨지 않는다. [경로 안내]·[아니오] 중 뭘 눌렀는지와 무관하게 그 세션에서는 다시 안 뜬다.
- **로그인하지 않은 사용자에게는 배너를 띄우지 않는다**(`/trips/frequent`는 인증 필요 엔드포인트).
- **시간대(아침=회사, 저녁=집 등) 구분 없음.** 요청 범위는 "카운트 1위 하나"로 한정, 시간대별 추천은 비목표.

## Non-goals / Anti-goals
- 백그라운드에서 GPS를 지켜보며 실시간으로 "지금 이 경로를 타고 있다"를 감지하는 기능은 범위 밖(팀 규칙의 위치정보 최소화 원칙과 충돌 — 별도 논의 필요).
- [경로 안내]를 눌렀을 때 턴바이턴 화면으로 바로 점프하지 않는다(기존 즐겨찾기 설계와 동일하게 모드 선택 단계를 거친다).
- [아니오]를 영구적으로 기억해서 그 목적지를 다시는 제안하지 않는 기능 없음(세션 단위로만 숨김).

## 빌더에게 남기는 것
- 배너의 정확한 비주얼(위치, 색상, 애니메이션)은 구현자 판단, 기존 `StatusBanner`/`Card` 스타일을 따른다.
- "세션당 1회" 플래그는 컴포넌트 로컬 상태(`useState`)로 충분 — 영구 저장(AsyncStorage 등) 불필요(앱을 재시작하면 당연히 다시 물어봐야 하므로).
- `searchRoutes` 호출 시 쓸 `mode`는 현재 화면의 `mode` state(기본값 `driving`)를 그대로 쓴다 — 별도 모드 선택 UI를 배너에 추가하지 않는다.
