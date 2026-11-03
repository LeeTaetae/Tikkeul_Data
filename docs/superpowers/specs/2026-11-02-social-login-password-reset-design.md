# 소셜 로그인(구글/카카오) + 비밀번호 재설정 design

## 의도 / 왜
현재 가입/로그인은 이메일+비밀번호만 있고 비밀번호를 잊으면 복구 수단이 없다. 네이티브 앱(Kakao Navi SDK가 이미 들어간 커스텀 dev client 구조)에 구글·카카오 소셜 로그인을 추가하고, 비밀번호 재설정(이메일 인증)도 넣는다.

## 범위
- **Part A — 소셜 로그인**: 구글, 카카오. 네이티브 SDK 방식(브라우저 리다이렉트 아님).
- **Part B — 비밀번호 재설정**: 이메일로 6자리 코드 발송 → 검증 → 새 비밀번호 설정. 기존 가입 인증코드 흐름(`backend/app/auth/security.py`의 challenge/HMAC 패턴, `rate_limit.py`의 `ResendCooldown`/`AttemptLimiter`)을 그대로 재사용.

## 기존 코드 (재사용 대상)
- `backend/app/auth/models.py` — `User`, 비밀번호 검증 규칙
- `backend/app/auth/security.py` — `hash_password`/`verify_password`, JWT 발급/검증(purpose 클레임 패턴), 6자리 코드 challenge 패턴
- `backend/app/auth/mailer.py` — Resend 기반 `_send()` 헬퍼 (비밀번호 재설정 메일도 같은 패턴으로 함수 추가)
- `backend/app/auth/rate_limit.py` — `ResendCooldown`, `AttemptLimiter`
- `frontend/src/lib/auth/` — AuthContext, api.ts, storage.ts, errorMessage.ts
- `frontend/src/lib/api/client.ts` — `CODE_TO_KIND` 에러코드 매핑 테이블
- `frontend/plugins/withKakaoNavigation.cjs` — 네이티브 모듈을 config plugin으로 심는 기존 패턴 (카카오 로그인 모듈도 같은 패턴 참고)

## 결정된 사항

### 공통
- **이메일은 가입 방법과 무관하게 유일 식별자.** 이미 가입된 이메일로 다른 방법(이메일가입↔구글↔카카오) 가입/로그인 시도 시 **"이미 가입된 이메일입니다"**로 막는다(자동 계정 연결 안 함).
- **예외: 카카오.** 카카오계정(이메일) 동의항목은 비즈 앱 전환(사업자등록번호 필요) 후에만 요청 가능해 이번 범위에서 못 받는다. 그래서 카카오 로그인은:
  - 이메일 없이 **카카오 고유 user id**로만 식별
  - 이메일 기반 중복 검사 대상에서 제외(카카오 계정끼리는 중복 체크 자체가 불가능 — id 자체가 유일하므로 문제 없음)
  - 화면에는 실명/이메일 대신 **"카카오 사용자"**로 표시
- `User` 모델 변경: `provider`(local/google/kakao), `provider_id`(nullable, provider별 unique), `email`은 카카오 계정에 한해 nullable, `password_hash`는 소셜 전용 계정에 한해 nullable.
- 마이그레이션 도구(Alembic 등) 없음. `backend/data/tikkeul.db`에 실제 사용자 데이터(user 3건 + 연결된 favoriteplace/trip)가 있어 재생성 금지(팀 규칙 6번). **일회성 마이그레이션 스크립트**(`backend/scripts/migrate_social_login.py`)로 처리:
  1. 실행 전 `tikkeul.db`를 타임스탬프 붙여 백업 복사
  2. SQLite 표준 절차(새 스키마로 테이블 생성 → 기존 데이터를 `provider='local', provider_id=NULL`로 채워 복사 → 테이블 교체)로 `user` 테이블에 `provider`/`provider_id` 추가, `email`/`password_hash` nullable로 변경
  3. 실행 전후 row 수를 출력해 데이터 유실 여부 바로 확인
  - 앱 시작 시 자동 실행 안 함 — 팀원이 이 브랜치 받은 뒤 수동 1회 실행(`backend/README.md`에 안내 추가).

### Part A — 소셜 로그인
- **플로우**: 앱에서 네이티브 SDK로 로그인 → 토큰(구글: idToken, 카카오: accessToken) 획득 → 백엔드가 각 서버에 검증 → 기존 유저 조회/신규 생성 → 기존과 동일한 JWT(`create_access_token`) 발급 → `TokenResponse`로 응답. 프론트는 기존 로그인과 동일하게 토큰 저장(`storage.ts`).
- **백엔드 신규 엔드포인트**: `POST /api/auth/social/google`, `POST /api/auth/social/kakao` (각각 토큰을 받아 검증 후 로그인/가입 처리, 응답은 기존 `/login`과 동일한 `TokenResponse`)
- **구글 토큰 검증**: `google-auth`(이미 의존성에 있음, `google.oauth2.id_token.verify_oauth2_token`)로 idToken 서명 검증, audience = Web client ID.
  - `GOOGLE_WEB_CLIENT_ID = 505159273471-du178go2cvi3b5mqkr5q2ckr9i516ak8.apps.googleusercontent.com` (backend `.env`)
  - Web client secret(`GOCSPX-...`)은 idToken 서명 검증 자체엔 보통 불필요 — 실제로 필요한지는 구현 시 라이브러리 사용법 확인 후 생략 가능. 필요해지면 backend `.env`에만 저장(프론트/Git 금지).
  - 프론트 설정: `GOOGLE_IOS_CLIENT_ID = 505159273471-9umva6fveibq6387ggt2oksu2grbrabs.apps.googleusercontent.com`, `GOOGLE_ANDROID_CLIENT_ID = 505159273471-cvu6q1b4lih8fnk9d5u17pe8e6vpuibs.apps.googleusercontent.com`, `GOOGLE_WEB_CLIENT_ID`(= 위와 동일, `serverClientId`로 네이티브 SDK에 전달)
  - 라이브러리: `@react-native-google-signin/google-signin`
- **카카오 토큰 검증**: `GET https://kapi.kakao.com/v2/user/me`에 `Authorization: Bearer {accessToken}`으로 호출, 응답의 카카오 user id로 식별. 기존 `KAKAO_NAVI_NATIVE_APP_KEY`를 로그인에도 그대로 재사용(앱 단위 키).
  - 카카오 로그인 네이티브 모듈은 `plugins/withKakaoNavigation.cjs`와 같은 패턴으로 config plugin 추가 필요(Podfile/Gradle에 Kakao Login SDK 추가).
- **카카오 콘솔 설정 완료됨**: 앱 설정 → 플랫폼 키에 iOS 번들ID(`com.tikkeuldata.app`), Android 패키지명(`com.tikkeuldata.app`) + 키해시(카카오 전용 base64 포맷 `dd0wjlq1tIIMmbdm+mbPplGvUzg=` — 구글 SHA-1과 다른 포맷이니 혼동 주의) 등록 완료. 동의항목은 닉네임만 사용(이메일은 비즈 앱 전환 필요해 제외).

### Part B — 비밀번호 재설정
- 기존 가입 인증코드 흐름과 동일한 패턴(6자리 코드, HMAC+JWT challenge, 평문 코드 서버 미저장).
- `POST /api/auth/password-reset/send-code` (email)
  - 이메일이 **소셜 전용 계정**(password_hash 없음)이면 코드를 보내지 않고 **"구글/카카오로 가입된 계정입니다, 그걸로 로그인하세요"** 메시지를 그대로 응답한다. (이메일 존재 여부를 노출하는 셈이라 일반적인 보안 권장사항과는 다르지만, 사용자가 명시적으로 이 UX를 선택함.)
  - 존재하지 않는 이메일/일반 계정은 기존 가입 흐름처럼 코드 발송.
  - `ResendCooldown`, `AttemptLimiter` 재사용.
- `POST /api/auth/password-reset/verify-code` (email, code) → challenge 검증 성공 시 `purpose="reset_password"` 토큰 발급.
- `POST /api/auth/password-reset` (reset-token, new_password) → 토큰 검증 후 `password_hash` 갱신.
- 프론트: 로그인 화면에 "비밀번호를 잊으셨나요?" 진입점 → 이메일 입력 → 코드 입력(가입 때 화면 재사용/참고) → 새 비밀번호 입력, 3단계.

## Non-goals / Anti-goals
- 자동 계정 연결(이메일 같으면 합치기) 안 함.
- 카카오 비즈 앱 전환(사업자등록 필요) 범위 밖.
- 소셜 로그인 사용자가 나중에 비밀번호를 추가로 설정하는 기능(계정에 비밀번호 붙이기) 범위 밖.
- 구글/카카오 외 다른 소셜 로그인(애플 등) 범위 밖.
- 연결 해제 웹훅(카카오) 범위 밖.

## 빌더에게 남기는 것
- DB 스키마 변경 방법(수동 ALTER vs 재생성)은 구현 시점에 팀과 확인.
- Google Web client secret이 실제로 필요한지는 `google-auth` 사용법 확인 후 결정.
- Kakao Login 네이티브 모듈을 config plugin에 추가하는 정확한 Podfile/Gradle 코드.
- 비밀번호 재설정 3단계 화면의 정확한 UI는 기존 가입 인증 화면 패턴을 참고해 구현자가 작성.
