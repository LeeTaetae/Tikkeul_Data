# 하이브리드 내비게이션 라우팅 PoC (실험 코드, MVP 범위 아님)

7일 MVP 일정과 무관한 별도 실험 코드입니다. `docs/REQUIREMENTS.md`·일정표·ADR은 건드리지 않았고, 이 폴더 바깥의 앱 코드와도 연결돼 있지 않습니다.

## 뭘 보여주는 PoC인가

출발지/도착지 사이 직선거리로 Tmap(장거리)과 Naver(단거리)를 분기 호출하고, 한쪽이 실패하면 다른 쪽으로 폴백하는 라우팅 서비스 구조입니다.

- `app/schemas.py` — 요청/응답 Pydantic 모델
- `app/providers.py` — Tmap/Naver를 같은 인터페이스로 감싸는 어댑터 (실제 API 응답 필드는 미검증 — 아래 "검증 안 된 것" 참고)
- `app/service.py` — 거리 계산 + 분기(`choose_provider_order`) + 폴백(`get_best_route`)
- `app/routers.py`, `app/main.py` — FastAPI 엔드포인트 `POST /navigation/route`

## 실행

```bash
cd poc/hybrid_navigation_backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # TMAP_APP_KEY, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 채우기
uvicorn app.main:app --reload
```

키 없이 분기/폴백 로직만 확인하려면 테스트만 돌리면 됩니다 (실제 네트워크 호출 없음):

```bash
python -m pytest
```

## 검증 상태 (2026-10-28)

실제 키로 두 provider 모두 호출해서 확인했습니다.

- **Tmap**: 정상 동작. 서울시청→강남역(단거리), 서울→부산(장거리) 둘 다 실제 경로·거리·시간 반환 확인.
- **Naver**: 처음에 구 엔드포인트(`naveropenapi.apigw.ntruss.com`)를 썼다가 `401 Permission Denied`가 났는데, 콘솔에서 Directions 5는 이미 체크돼 있었음 — 원인은 **구 AI NAVER API 엔드포인트가 아니라 신규 Maps 엔드포인트(`maps.apigw.ntruss.com`)를 써야 했던 것**. 이걸로 바꾸니 정상 동작.
- 단거리(11km)는 Naver, 장거리(400km)는 Tmap으로 분기·호출되는 것까지 실제 API로 end-to-end 확인 완료.
