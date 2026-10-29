# backend (FastAPI)

티끌모아Data 백엔드. 공공 교통정보 API 5종을 어댑터로 감싸 **정규화된 JSON만** 프런트엔드에 전달한다. 인증키는 이 서버에만 있다.

## 환경

- **Python 3.9.13 (Anaconda) 고정.** 3.10 이상으로 올리지 않는다.
- 가상환경: `backend/.venv` (Git 제외). 기존 Anaconda base 환경과 시스템 PATH는 변경하지 않는다.
- 의존성은 `requirements.txt`(운영), `requirements-dev.txt`(+pytest)에 버전을 고정한다.
  - 이 파일들은 **ASCII 문자만** 쓴다. 한글이 들어가면 한국어 Windows의 pip가 cp949로 읽다가 `UnicodeDecodeError`가 난다.

## 설치

Anaconda의 `python.exe`를 그대로 써서 가상환경을 만든다. 먼저 아래 "SSL 오류 해결"의 PATH 설정을 해당 터미널에 적용한다.

```powershell
cd backend
& "$env:USERPROFILE\anaconda3\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pip check
```

## SSL 오류 해결

증상(둘 중 하나):

- `pip`: `Can't connect to HTTPS URL because the SSL module is not available`
- Python: `ImportError: DLL load failed while importing _ssl`
  - `import httpx`는 되지만 `httpx.Client()`나 실제 요청에서 실패한다.

원인: Anaconda를 활성화하지 않고 `python.exe`를 직접 실행하면 OpenSSL DLL이 있는 `anaconda3\Library\bin`이 PATH에 없다. 가상환경의 Python도 같은 DLL을 쓴다.

해결: **서버·pytest·pip를 실행하는 터미널마다** 아래 중 하나를 적용한다. 시스템 PATH를 영구로 바꿀 필요는 없다.

1. **Anaconda Prompt**에서 실행한다. (가장 간단)
2. PowerShell 세션에서 임시로 PATH를 추가한다.
   ```powershell
   $a = "$env:USERPROFILE\anaconda3"
   $env:PATH = "$a;$a\Library\mingw-w64\bin;$a\Library\usr\bin;$a\Library\bin;$a\Scripts;" + $env:PATH
   ```
3. Git Bash 세션에서 임시로 PATH를 추가한다.
   ```bash
   A="/c/Users/$USERNAME/anaconda3"
   export PATH="$A:$A/Library/mingw-w64/bin:$A/Library/usr/bin:$A/Library/bin:$A/Scripts:$PATH"
   ```

확인: `.\.venv\Scripts\python.exe -c "import ssl; print(ssl.OPENSSL_VERSION)"`

Python 출력의 한글이 깨지면 `PYTHONIOENCODING=utf-8`을 설정한다.

## 환경변수와 인증키

```powershell
copy .env.example .env   # 그 다음 .env 에 키를 직접 입력한다
```

| 변수 | 용도 |
|---|---|
| `ITS_TRAFFIC_API_KEY` | ITS 교통소통정보 |
| `ITS_EVENT_API_KEY` | ITS 돌발상황정보 |
| `ITS_PREDICTION_API_KEY` | ITS 교통예측정보 |
| `ITS_CAUTION_API_KEY` | ITS 주의운전구간정보 |
| `PROTECTION_ZONE_SERVICE_KEY` | 공공데이터포털 경찰청 전국 보호구역 현황 |
| `KAKAO_REST_API_KEY` | Kakao Local 좌표→시군구 변환. **REST API 키**이며 지도용 JavaScript 키와 다르다. 서버에서만 쓴다 |
| `CORS_ALLOW_ORIGINS` (선택) | 허용할 웹 출처(쉼표 구분). 비우면 `localhost:8081` 등 로컬 개발 주소만 |

- `.env`는 Git에 올리지 않는다. `.env.example`에는 **변수명만** 쓴다(`tests/test_environment.py`가 값이 비어 있는지 검사한다).
- 키는 프런트엔드(`EXPO_PUBLIC_*`)에 넣지 않는다. 키가 없는 API는 서버가 `NOT_CONFIGURED` 오류를 내고 나머지는 정상 동작한다.
- ITS는 키를 URL 쿼리로 받는다. 그래서 httpx 로그(URL 전체 기록)를 꺼 두었고, 예외·응답 메시지에도 URL을 넣지 않는다(`tests/test_api.py::test_secrets_never_appear_in_logs_or_responses`).

## 실행

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --no-access-log
```

- **`--no-access-log`를 붙인다.** 접속 로그에는 요청 URL이 그대로 찍혀서 사용자가 보고 있는 영역(좌표)이 남는다.
- 자동 문서: `http://127.0.0.1:8000/docs` (운영 노출 여부는 API_SPEC.md의 TBD)
- 프런트엔드는 `EXPO_PUBLIC_API_BASE_URL`(기본 `http://localhost:8000`)로 접속한다.

## 내부 API

| 경로 | 데이터 | 종류(`meta.data_kind`) | 입력 |
|---|---|---|---|
| `GET /api/health` | 서버 상태, 키 설정 여부(true/false) | - | - |
| `GET /api/traffic/incidents` | 돌발상황(사고·공사·정체 등) | `realtime` | 영역 `min_lon,max_lon,min_lat,max_lat` (한 변 0.3도 이하) |
| `GET /api/traffic/caution-zones` | 주의운전구간(고속도로) | `realtime` | 영역 (0.3도 이하) |
| `GET /api/traffic/protection-zones` | 어린이·노인·장애인 보호구역 | `registry` | `sgg_cd`(시군구코드 5자리), `include_geometry` |
| `GET /api/traffic/flow` | 링크별 통행 속도 | `realtime` | 영역 (**0.05도 이하**) |
| `GET /api/geo/region` | 좌표 → 시군구(`sgg_cd` = 현행 법정동코드 앞 5자리) | - | `lat`, `lon` (국내 범위 밖이면 Kakao 를 호출하지 않고 `REGION_NOT_FOUND` 404) |
| `GET /api/traffic/predictions` | 우회도로 구간 예측 속도 | **`forecast`(실시간 아님)** | `section_id`, `route_no`(예: 0010), `forecast_for` |

모든 응답은 `{ "meta": {...}, "items": [...] }` 형태다. `meta`에는 `source`, `data_kind`, `updated_at`(공공 API가 준 기준 시각, 없으면 null), `fetched_at`(서버가 받아온 시각), `stale`이 있다. **실시간과 예측을 화면에서 반드시 구분해서 표시한다.**

- 돌발·주의운전은 사고, 공사, 정체 등과 **다른 모델**이다(`IncidentKind`, `CautionKind`, `ZoneType`). `incidents`의 `congestion`은 ITS 돌발정보가 붙인 `차량증가/정체` 분류이고 우리가 속도로 판정한 것이 아니다.
- `direction_text`는 ITS 원문(`종점`, `양방향`, `목포방향` 등)이다. **방위각이 아니므로 진행 방향 판정에 쓰지 않는다.** 그래서 이 데이터로는 `routeHazards`의 `headingDeg`를 채우지 않고, 경로상 동일 방향 위험이라고 단정하지 않는다.
- `flow`는 링크 ID와 속도만 주고 좌표가 없다(`geometry_available: false`). 지도에 그리거나 "정체"를 판정하려면 표준노드링크 자료가 필요하다. 정체 판정 기준은 공식 문서에 없어서 만들지 않았다.
- `predictions`는 ITS가 제공하는 고속도로·국도 우회도로 구간(`section_id`)에서만 쓸 수 있다. 가능한 `section_id` 전체 목록은 아직 없다(2026-10-28에 1, 10, 20과 `route_no=0010`에서 응답을 확인했다).

### 오류 형식

HTTP 상태와 함께 `{ "error": { "code", "message" } }`를 돌려준다. **빈 결과는 오류가 아니라 `200` + 빈 `items`다.**

| code | HTTP | 의미 |
|---|---|---|
| `NOT_CONFIGURED` | 503 | 서버에 해당 키가 없음 |
| `UPSTREAM_AUTH` | 502 | 공공 API 인증 실패(키 오류·미승인) |
| `UPSTREAM_RATE_LIMIT` | 503 | 공공 API 사용량 제한 |
| `UPSTREAM_TIMEOUT` | 504 | 공공 API 응답 지연 |
| `UPSTREAM_UNAVAILABLE` | 503 | 공공 API 연결 실패 |
| `UPSTREAM_BAD_REQUEST` | 502 | 공공 API가 요청을 거부(우리 쪽 버그 가능) |
| `UPSTREAM_BAD_RESPONSE` | 502 | 응답을 해석하지 못함 |
| `UPSTREAM_ERROR` | 502 | 그 밖의 공공 API 오류 |
| `REGION_NOT_FOUND` | 404 | 좌표의 시군구를 확인할 수 없음(국외, 바다 등) |

입력 검증 실패는 FastAPI 기본 `422`다.

## 캐시와 호출 주기

공식 문서에 갱신 주기가 없어 **2026-10-28 실측**으로 정했다. TTL은 `app/config.py`에서 조정한다.

| 데이터 | TTL | 근거 |
|---|---|---|
| 돌발, 주의운전 | 60초 | 7분 동안 항목 변화 없음. 호출이 가벼움(55~780ms) |
| 소통 | 120초 | `createdDate`가 5분 간격으로 갱신(16:55 → 17:00 → 17:05) |
| 예측 | 600초 | 예측 시각 단위(정시)로 응답 |
| 보호구역 | 24시간 | 등록 현황. 시군구 단위로 전체 페이지를 받아 캐시 |

- 영역은 0.01도 격자에 바깥쪽으로 맞춰서 호출한다. 근처 사용자는 같은 업스트림 호출을 공유하고, 서버가 받는 좌표 정밀도도 낮아진다. 응답은 요청한 영역으로 다시 걸러서 돌려준다(소통은 좌표가 없어 격자 전체).
- 같은 키의 동시 요청은 업스트림을 한 번만 호출한다.
- **업스트림이 실패하면** 마지막 성공 결과를 `meta.stale: true`와 원래 `fetched_at`으로 `MAX_STALE`(30분)까지 대신 내준다. 그 뒤에는 오류를 낸다.
- 호출 제한: ITS는 현재 인증키당 일일 제한이 없다고 안내돼 있고(공식 매뉴얼, 추후 적용 가능), 사용량 초과는 코드 4001이다. 경찰청 보호구역은 개발계정 300건(단위 미기재)이라 24시간 캐시로 호출을 줄인다.

## 보호구역 좌표계

`fturGeomVl`은 WKT이고 값이 위·경도가 아니라 TM 좌표(미터)다. 공식 문서에 좌표계가 없어서 종로구 9곳을 OSM 지오코딩 위치와 대조해 **EPSG:5181(KGD2002 중부원점)**로 확인했다(중앙값 오차: 5181 = 41m, 5174 = 317m, 2097 = 359m, 5186 = 약 100km). `app/geo.py`가 WGS84 GeoJSON으로 변환한다. 대조 기준이 지오코더라 수십 m 오차는 남을 수 있고, 다른 지역에서 확인된 것은 아니다.

## 좌표 → 시군구코드 (Kakao Local)

`GET /api/geo/region?lat=&lon=`는 Kakao Local `coord2regioncode`(`Authorization: KakaoAK {REST 키}`)를 서버에서 호출해 법정동(`region_type: "B"`)의 10자리 `code` 앞 5자리를 `sgg_cd`로 돌려준다. 행정동(`H`)은 코드 체계가 달라 쓰지 않는다. 코드 형식이 10자리 숫자가 아니면 추측하지 않고 `UPSTREAM_BAD_RESPONSE`로 실패한다.

- **경찰청 `sggCd`가 현행 법정동 시군구 코드를 쓴다는 것은 실제 호출로 확인했다**(2026-10-28): 서울 종로 11110·중구 11140, 일반구가 있는 시는 **구 코드**(수원 장안 41111, 영통 41117 → 데이터 있음. 시 코드 41110은 `ERR_03`), 개편 지역은 **현행 코드**(강원 춘천 51110, 전북 전주 완산 52111, 대구 군위 27720 → 데이터 있음. 구 코드 42110·45111·47720은 `ERR_03`).
  - 주의: 군위군(27720)의 응답 주소 문자열은 아직 "경상북도 군위군"이다(원본 데이터 불일치). 주소 문자열로 시군구를 검증하면 이 경우 틀린다.
- **Kakao 응답이 이 코드 체계와 일치하는지는 `scripts/verify_sgg_codes.py`로 확인한다.** `.env`에 `KAKAO_REST_API_KEY`를 넣고 실행하면 전국 18개 지점 + 국외·바다 2곳에서 `Kakao 지역명/코드 → 경찰청 API 응답`을 표로 대조한다(경찰청 API 약 18회 호출). 불일치가 나오면 변환 방법을 따로 마련해야 한다.
- 좌표는 캐시하지 않고 로그에도 남기지 않는다(예외 메시지에도 넣지 않는다). 호출은 프런트가 위치를 새로 읽었을 때만 발생한다.
- Kakao 호출 한도는 공식 문서(좌표로 행정구역정보 받기)에 수치가 없다. 429는 `UPSTREAM_RATE_LIMIT`로 처리한다.

## 휴대폰·에뮬레이터에서 접속

- 개발 중 휴대폰(실기기)이 PC 의 백엔드에 접속하려면 서버를 `--host 0.0.0.0`으로 실행하고 Windows 방화벽에서 8000 포트를 허용해야 한다(기본값은 `127.0.0.1`이라 PC 밖에서 접속할 수 없다). 프런트의 `EXPO_PUBLIC_API_BASE_URL` 설정은 `frontend/.env.example`를 참고한다.
- 운영은 HTTPS 여야 한다(웹 혼합 콘텐츠, iOS ATS, Android 기본 설정이 HTTP 를 막는다). 웹은 `CORS_ALLOW_ORIGINS`에 웹 주소를 넣는다. 네이티브 앱은 CORS 와 무관하다.

## 테스트

```powershell
.\.venv\Scripts\python.exe -m pytest
```

- `tests/test_adapters.py`: 유형 매핑, 시각 변환, WKT 파싱, 좌표 변환, 영역 격자.
- `tests/test_api.py`: 정상, 빈 응답, 인증·한도·파라미터·타임아웃·연결·해석 오류, 키 미설정, 입력 검증, 캐시와 stale, 키 비노출.
- 테스트 데이터는 실제 응답의 필드 구조를 따라 직접 만든 것이고, 실제 키와 네트워크를 쓰지 않는다(`httpx.MockTransport`).
- 실제 API 호출 검증은 자동 테스트가 아니라 수동 확인이다.

## Python 3.9 코드 규칙

- Pydantic 모델에서 `X | None` 대신 `Optional[X]`를 쓴다(3.9에서는 런타임 평가가 안 된다).
- `match` 문을 쓰지 않는다.
- 시간대는 `zoneinfo` 대신 KST 고정 오프셋(`timezone(timedelta(hours=9))`)을 쓴다(Windows에서 `tzdata`가 따로 필요하다).
