# 소셜 로그인(구글·카카오) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이티브 앱(iOS/Android)에서 구글·카카오 로그인으로 가입/로그인하고, 기존 이메일+비밀번호 로그인과 동일한 JWT를 발급받는다.

**Architecture:** 앱이 각 SDK(Google native sign-in, Kakao Login SDK)로 로그인해 토큰을 받고, 백엔드가 그 토큰을 각 서버(Google/Kakao)에 검증해 `User`를 조회/생성한 뒤 기존 `create_access_token`으로 동일한 `TokenResponse`를 돌려준다. 이메일은 가입 방법과 무관하게 유일 식별자이되, 카카오는 이메일 스코프를 못 받아 `provider_id`로만 식별한다.

**Tech Stack:** FastAPI/SQLModel(backend), `google-auth`(이미 의존성에 있음), React Native/Expo(frontend), `@react-native-google-signin/google-signin`(신규), Kakao Login SDK(네이티브, 신규 config plugin).

**Spec:** `docs/superpowers/specs/2026-11-02-social-login-password-reset-design.md`

## Global Constraints

- 이메일은 가입 방법과 무관하게 유일. 중복이면 `EMAIL_TAKEN`("이미 가입된 이메일입니다.", 기존 `backend/app/errors.py`에 이미 있음) 그대로 재사용.
- 카카오는 이메일 스코프 요청 불가 — `User.email`이 null인 카카오 계정은 이메일 기반 중복검사 대상에서 제외.
- 자동 계정 연결 안 함(범위 밖).
- `backend/data/tikkeul.db`에 실제 데이터(user 3건 + favoriteplace/trip) 있음 — 파괴적 재생성 금지, 반드시 Task 1의 백업+ALTER 절차로만 스키마 변경.
- 새 시크릿은 `backend/.env`에만 저장, 프론트/Git에 올리지 않음. Google Web client secret(`GOCSPX-...`)은 idToken 서명 검증에 불필요해 이번 범위에서 아예 저장하지 않는다(불필요한 시크릿 보관 최소화 — Non-goal).

## Review Focus

- 이미 로컬(이메일) 가입된 이메일로 구글 로그인 시도 — `EMAIL_TAKEN`으로 막혀야 하고, 기존 계정에 조용히 연결되면 안 됨.
- 구글 idToken이 만료되었거나 서명이 유효하지 않은 경우 — `SOCIAL_LOGIN_FAILED`로 명확히 실패해야 하고 500으로 터지면 안 됨.
- 카카오 `access_token`이 유효하지 않거나 `kapi.kakao.com` 호출이 실패(네트워크 등)하는 경우 — 마찬가지로 `SOCIAL_LOGIN_FAILED`.
- 같은 구글 계정으로 두 번째 로그인(이미 가입된 `provider_id`) — 새 계정을 또 만들지 않고 기존 계정으로 로그인되어야 함.
- 마이그레이션 스크립트를 이미 적용한 DB에 다시 실행하는 경우 — 중복 적용으로 컬럼이 깨지거나 예외 없이, 멱등하게 처리되거나 명확한 에러로 막혀야 함.

---

### Task 1: DB 마이그레이션 — User 모델에 provider/provider_id 추가, email/password_hash nullable화

**Files:**
- Modify: `backend/app/auth/models.py` (`User`, `UserPublic`)
- Create: `backend/scripts/migrate_social_login.py`
- Test: `backend/tests/test_migrate_social_login.py`

**Interfaces:**
- Produces: `User` 필드 — `provider: str`(기본 `"local"`), `provider_id: Optional[str]`(nullable, provider별 unique는 애플리케이션 레벨에서 조회로 보장 — SQLite composite unique는 이번 범위에서 생략), `email: Optional[str]`, `password_hash: Optional[str]`. `UserPublic`에 `provider: str`, `nickname: Optional[str]`(카카오 표시용) 추가, `email: Optional[str]`로 변경.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_migrate_social_login.py`:

```python
import sqlite3
from pathlib import Path

from app.scripts_lib... # 아래 Step 3에서 만들 함수를 import
```

(구현자 판단: 스크립트를 `python -m` 실행형으로만 둘지, `migrate(db_path: Path) -> None` 함수로 분리해 테스트에서 직접 호출할지는 Step 3에서 정한다. 테스트는 임시 SQLite 파일에 기존 스키마(id/email/password_hash/created_at/email_verified, NOT NULL)로 `user` 테이블을 만들고 2~3개 row를 넣은 뒤 `migrate()`를 호출해 다음을 검증한다:
- 마이그레이션 후 row 수가 그대로다(유실 없음).
- 기존 row들의 `provider`가 `"local"`, `provider_id`가 `NULL`이다.
- `email`/`password_hash`가 NOT NULL 제약 없이 새 row(둘 다 NULL, `provider='kakao'`)를 받을 수 있다.
- 원본 이메일/비밀번호 해시 값이 마이그레이션 전후로 동일하다(데이터 보존).
- 백업 파일(`<db_path>.bak-*`)이 생성됐다.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_migrate_social_login.py -v`
Expected: FAIL (`migrate_social_login` 모듈/함수 없음)

- [ ] **Step 3: `backend/scripts/migrate_social_login.py`에 `migrate(db_path: Path) -> None` 구현**

SQLite 표준 테이블 재생성 절차: `db_path`를 타임스탬프 붙여 복사(백업) → `ALTER TABLE user RENAME TO user_old` → 새 스키마로 `CREATE TABLE user(...)` (provider TEXT NOT NULL DEFAULT 'local', provider_id TEXT, email TEXT, password_hash TEXT, email_verified BOOLEAN NOT NULL DEFAULT 0, created_at DATETIME NOT NULL) → `INSERT INTO user SELECT id, 'local', NULL, email, password_hash, email_verified, created_at FROM user_old` → `DROP TABLE user_old`. 트랜잭션으로 묶는다. 마이그레이션 전후 row 수를 세어 다르면 `RuntimeError`로 중단(커밋 전). 스크립트 하단에 `if __name__ == "__main__":` 로 `get_settings().database_url`에서 경로를 뽑아 실행하는 CLI 진입점도 둔다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_migrate_social_login.py -v`
Expected: PASS

- [ ] **Step 5: `backend/app/auth/models.py`의 `User`/`UserPublic` 수정**

`User`에 `provider: str = Field(default="local")`, `provider_id: Optional[str] = Field(default=None, index=True)` 추가. `email: Optional[str] = Field(default=None, index=True)`, `password_hash: Optional[str] = Field(default=None)`로 변경(SQLModel 메타데이터 — 실제 DB 컬럼은 Task 1에서 이미 nullable로 맞춰짐, 여기선 Python 타입만 맞춘다). `UserPublic`에 `provider: str`, `nickname: Optional[str] = None` 추가, `email: Optional[str]`로 변경.

- [ ] **Step 6: 기존 인증 테스트 회귀 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_auth_api.py -v` (파일명은 실제 기존 테스트 파일명으로 구현자가 확인)
Expected: PASS (기존 로그인/가입 흐름이 `email`/`password_hash` Optional 변경으로 깨지지 않아야 함 — 깨지면 해당 핸들러에 None 체크 보강)

- [ ] **Step 7: 커밋**

```bash
cd backend
git add app/auth/models.py scripts/migrate_social_login.py tests/test_migrate_social_login.py
git commit -m "feat: User 모델에 소셜 로그인용 provider/provider_id 추가, 마이그레이션 스크립트"
```

---

### Task 2: 백엔드 — 구글 로그인 엔드포인트

**Files:**
- Modify: `backend/app/config.py` (설정 추가), `backend/app/errors.py`(`SOCIAL_LOGIN_FAILED` 추가), `backend/app/auth/router.py`
- Create: `backend/app/auth/social.py` (구글·카카오 토큰 검증 + find-or-create 공용 로직)
- Test: `backend/tests/test_social_login.py`

**Interfaces:**
- Consumes: Task 1의 `User(provider, provider_id, email, password_hash=None, ...)`, 기존 `create_access_token(user_id, settings)`, `app.errors.api_error`
- Produces: `verify_google_id_token(id_token: str, settings: Settings) -> dict`(검증된 payload, `sub`=구글 user id, `email` 포함) — `backend/app/auth/social.py`. `find_or_create_social_user(session, provider: str, provider_id: str, email: Optional[str], nickname: Optional[str]) -> User` — 이후 Task 3(카카오)도 이 함수를 재사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_social_login.py`에 `POST /api/auth/social/google` 테스트:
- 유효한(mock된) idToken으로 첫 로그인 → 201 또는 200, `TokenResponse` 반환, DB에 `provider='google'` row 생성 확인
- 같은 `provider_id`로 재로그인 → 새 row 안 만들고 같은 user_id로 토큰 발급
- 이미 로컬 이메일로 가입된 이메일과 같은 이메일의 구글 idToken → `EMAIL_TAKEN`(409)
- 검증 실패하는 idToken(mock이 `ValueError` 던지게) → `SOCIAL_LOGIN_FAILED`(502)

(테스트에서는 `backend/app/auth/social.py`의 `verify_google_id_token`을 monkeypatch/dependency override로 모킹한다 — 실제 구글 서버 호출은 하지 않는다. 기존 테스트 파일의 FastAPI TestClient·fixture 패턴을 따른다.)

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_social_login.py -v`
Expected: FAIL (엔드포인트 없음)

- [ ] **Step 3: `backend/app/config.py`에 `google_web_client_id: str = ""` 추가**

- [ ] **Step 4: `backend/app/errors.py`에 추가**

```python
"SOCIAL_LOGIN_FAILED": (502, "소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."),
```

- [ ] **Step 5: `backend/app/auth/social.py` 구현**

`verify_google_id_token(id_token: str, settings: Settings) -> dict`: `google.oauth2.id_token.verify_oauth2_token(id_token, google.auth.transport.requests.Request(), audience=settings.google_web_client_id)` 호출, `ValueError`(서명/만료/audience 불일치) 잡아서 `api_error("SOCIAL_LOGIN_FAILED")`로 변환. 반환 payload에서 `sub`(구글 user id), `email` 사용.

`find_or_create_social_user(session: Session, provider: str, provider_id: str, email: Optional[str], nickname: Optional[str]) -> User`: 1) `provider`+`provider_id`로 기존 유저 조회, 있으면 반환. 2) `email`이 있으면 다른 provider의 같은 이메일이 이미 있는지 조회 — 있으면 `api_error("EMAIL_TAKEN")`. 3) 없으면 `User(provider=provider, provider_id=provider_id, email=email, password_hash=None, email_verified=True)` 생성(소셜 로그인은 공급자가 이미 이메일을 확인했다고 간주) 후 반환. `nickname`은 이번 스키마에 저장 컬럼이 없으므로 `UserPublic` 응답 조립 시에만 쓰고 DB엔 저장하지 않는다(구현자 판단: 필요하면 저장 컬럼 추가는 범위 밖으로 남긴다).

- [ ] **Step 6: `backend/app/auth/router.py`에 `POST /api/auth/social/google` 추가**

`SocialLoginRequest`(id_token: str) 스키마를 `models.py`에 추가. 핸들러는 `verify_google_id_token` → `find_or_create_social_user(provider="google", ...)` → `create_access_token` → 기존 `/login`과 동일한 `TokenResponse` 조립(단 `UserPublic.email`은 Optional이니 그대로 넘긴다).

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_social_login.py -v`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
cd backend
git add app/config.py app/errors.py app/auth/social.py app/auth/router.py app/auth/models.py tests/test_social_login.py
git commit -m "feat: 구글 소셜 로그인 백엔드 엔드포인트"
```

---

### Task 3: 백엔드 — 카카오 로그인 엔드포인트

**Files:**
- Modify: `backend/app/auth/social.py`, `backend/app/auth/router.py`
- Test: `backend/tests/test_social_login.py` (Task 2에서 만든 파일에 추가)

**Interfaces:**
- Consumes: Task 2의 `find_or_create_social_user`
- Produces: `verify_kakao_access_token(access_token: str, settings: Settings) -> dict`(`id`만 보장, `email` 없음) — `backend/app/auth/social.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`test_social_login.py`에 `POST /api/auth/social/kakao` 테스트 추가:
- 유효한(mock) accessToken 첫 로그인 → `User(provider='kakao', email=None)` 생성, `UserPublic.email`이 `None`
- 같은 카카오 `id`로 재로그인 → 같은 user_id
- accessToken 검증 실패(mock이 예외) → `SOCIAL_LOGIN_FAILED`(502)

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_social_login.py -v -k kakao`
Expected: FAIL

- [ ] **Step 3: `verify_kakao_access_token` 구현**

`httpx.get("https://kapi.kakao.com/v2/user/me", headers={"Authorization": f"Bearer {access_token}"})`. 2xx가 아니거나 응답에 `id`가 없으면 `api_error("SOCIAL_LOGIN_FAILED")`. 닉네임은 `kakao_account.profile.nickname`(동의 안 했으면 없을 수 있음 — 없으면 `None`)에서 꺼낸다. 기존 `backend/app/navigation/providers.py`의 httpx 호출 패턴(타임아웃 등) 참고.

- [ ] **Step 4: `POST /api/auth/social/kakao` 라우터 추가**

Task 2의 `/social/google`과 동일한 구조, `find_or_create_social_user(provider="kakao", provider_id=str(kakao_id), email=None, nickname=nickname)` 호출.

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_social_login.py -v`
Expected: PASS (전체)

- [ ] **Step 6: 커밋**

```bash
cd backend
git add app/auth/social.py app/auth/router.py tests/test_social_login.py
git commit -m "feat: 카카오 소셜 로그인 백엔드 엔드포인트"
```

---

### Task 4: 프론트 — 구글 네이티브 로그인

**Files:**
- Modify: `frontend/app.json`(plugins), `frontend/.env`/`.env.example`, `frontend/package.json`, `frontend/src/lib/auth/api.ts`, `frontend/src/lib/auth/AuthContext.tsx`, `frontend/app/login.tsx`
- Test: 네이티브 SDK 호출은 유닛테스트 대상이 아님(기존 `src/native/kakaoNavigation.*` 패턴과 동일하게 미테스트) — `api.ts`에 추가하는 `loginGoogle`의 요청 바디 조립만 기존 `tests/api-client.test.mjs` 패턴으로 테스트.

**Interfaces:**
- Consumes: 백엔드 `POST /api/auth/social/google` (Task 2)
- Produces: `authApi.loginGoogle(idToken: string, options?: RequestOptions): Promise<TokenResponse>`, `AuthContext`의 `loginWithGoogle(): Promise<void>`

- [ ] **Step 1: 의존성 설치**

Run: `cd frontend && npm install @react-native-google-signin/google-signin`

- [ ] **Step 2: `app.json`에 plugin 추가**

`plugins` 배열에 `["@react-native-google-signin/google-signin"]` 추가(iosUrlScheme 등 플러그인 자체 옵션 필요 여부는 패키지 문서 확인 — 구현 시 `mcp__context7` 또는 패키지 README로 정확한 옵션 확인).

- [ ] **Step 3: `.env`/`.env.example`에 추가**

```
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=505159273471-9umva6fveibq6387ggt2oksu2grbrabs.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=505159273471-cvu6q1b4lih8fnk9d5u17pe8e6vpuibs.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=505159273471-du178go2cvi3b5mqkr5q2ckr9i516ak8.apps.googleusercontent.com
```
(`.env.example`엔 값 없이 변수명만 — 기존 패턴 그대로. 실제 값은 `.env`에만.)

- [ ] **Step 4: 실패하는 테스트 작성** (`authApi.loginGoogle` 요청 조립)

기존 `frontend/tests/api-client.test.mjs` 패턴을 참고해, `loginGoogle('fake-id-token')`이 `POST /api/auth/social/google`에 `{ id_token: 'fake-id-token' }` 바디로 요청하는지 확인하는 테스트 추가.

- [ ] **Step 5: 테스트 실행해 실패 확인**

Run: `cd frontend && node --test tests/api-client.test.mjs`
Expected: FAIL

- [ ] **Step 6: `src/lib/auth/api.ts`에 `loginGoogle` 추가**

```ts
loginGoogle: (idToken: string, options?: RequestOptions) =>
  client.post<TokenResponse>('/api/auth/social/google', { id_token: idToken }, options),
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd frontend && node --test tests/api-client.test.mjs`
Expected: PASS

- [ ] **Step 8: `AuthContext.tsx`에 `loginWithGoogle` 추가, `login.tsx`에 버튼 추가**

`loginWithGoogle`은 `GoogleSignin.configure({ webClientId: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, iosClientId: EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID })` → `GoogleSignin.signIn()`으로 idToken 획득 → `authApi.loginGoogle(idToken)` → 기존 `login`과 동일하게 `setToken`+`setState`. `login.tsx`에 "구글로 로그인" 버튼 추가(기존 `PrimaryButton`/`RoundButton` 컴포넌트 재사용, 정확한 배치는 구현자 판단).

- [ ] **Step 9: 커밋**

```bash
cd frontend
git add app.json package.json package-lock.json .env.example src/lib/auth/api.ts src/lib/auth/AuthContext.tsx app/login.tsx
git commit -m "feat: 구글 네이티브 로그인 프론트엔드 연동"
```

---

### Task 5: 프론트 — 카카오 네이티브 로그인

**Files:**
- Modify: `frontend/plugins/withKakaoNavigation.cjs`(또는 새 `withKakaoLogin.cjs` — 구현자가 기존 파일 구조 보고 판단), `frontend/src/lib/auth/api.ts`, `frontend/src/lib/auth/AuthContext.tsx`, `frontend/app/login.tsx`
- Create: `frontend/src/native/kakaoLogin.native.ts`, `frontend/src/native/kakaoLogin.ts`(웹/미지원 플랫폼 폴백 — 기존 `kakaoNavigation.ts`/`.native.ts` 분리 패턴 그대로)

**Interfaces:**
- Consumes: 백엔드 `POST /api/auth/social/kakao` (Task 3)
- Produces: `authApi.loginKakao(accessToken: string, options?: RequestOptions): Promise<TokenResponse>`, `AuthContext`의 `loginWithKakao(): Promise<void>`

- [ ] **Step 1: 기존 Kakao Navi 네이티브 연동 코드 읽기**

`frontend/plugins/withKakaoNavigation.cjs`, `frontend/src/native/kakaoNavigation.native.ts`, `frontend/src/native/kakaoNavigation.ts`, `frontend/modules/kakao-navigation/`를 전부 읽고 패턴을 파악한다(config plugin이 Podfile/Gradle에 무엇을 추가하는지, JS wrapper가 어떻게 네이티브 모듈을 호출하는지).

- [ ] **Step 2: Kakao Login SDK를 config plugin에 추가**

iOS: `KakaoSDKAuth`, `KakaoSDKUser` Pod 추가(기존 `KakaoSDKCommon`은 이미 있음 — Navi용으로 설치돼 있던 것 재사용). Android: `com.kakao.sdk:v2-user` Gradle 의존성 추가. 기존 `withKakaoNavigation.cjs`에 있는 Realm/RealmSwift 동적 프레임워크 강제 훅(iOS) 로직은 건드리지 않는다(README 체크리스트 5번 — 지우면 크래시).

- [ ] **Step 3: `frontend/src/native/kakaoLogin.native.ts` 구현**

`KakaoSDKUser`의 `loginWithKakaoAccount`(또는 카카오톡 앱 있으면 `loginWithKakaoTalk`) 호출해 `accessToken` 획득하는 네이티브 모듈 래퍼. 기존 `kakaoNavigation.native.ts`의 `requireOptionalNativeModule` 패턴을 따라, 네이티브 모듈이 없는(구 빌드) 경우 조용히 실패하지 않고 명확한 에러를 던지도록 한다(이번엔 챗봇 마이크 때처럼 "조용히 무반응"이 UX를 해치므로, 로그인 버튼은 모듈 없으면 비활성화하거나 에러 토스트를 띄운다 — 구현자 판단).

- [ ] **Step 4: `src/lib/auth/api.ts`에 `loginKakao` 추가**

```ts
loginKakao: (accessToken: string, options?: RequestOptions) =>
  client.post<TokenResponse>('/api/auth/social/kakao', { access_token: accessToken }, options),
```

- [ ] **Step 5: `AuthContext.tsx`에 `loginWithKakao` 추가, `login.tsx`에 버튼 추가**

Task 4의 `loginWithGoogle`과 동일한 구조.

- [ ] **Step 6: iOS 네이티브 재빌드로 수동 확인**

Run: `cd frontend && npx expo prebuild --platform ios && npx expo run:ios --device <기기명>`
Expected: 빌드 성공, 로그인 화면에서 카카오 로그인 버튼 눌러 카카오톡/카카오계정으로 로그인 → 앱으로 복귀 → 로그인 완료 확인(수동 확인, 자동화 테스트 범위 밖).

- [ ] **Step 7: 커밋**

```bash
cd frontend
git add plugins/ src/native/kakaoLogin.native.ts src/native/kakaoLogin.ts src/lib/auth/api.ts src/lib/auth/AuthContext.tsx app/login.tsx
git commit -m "feat: 카카오 네이티브 로그인 프론트엔드 연동"
```
