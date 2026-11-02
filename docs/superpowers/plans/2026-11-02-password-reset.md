# 비밀번호 재설정(이메일 인증) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 화면에서 "비밀번호를 잊으셨나요?"로 들어가 이메일로 받은 6자리 코드를 확인하고 새 비밀번호를 설정한다.

**Architecture:** 기존 가입 인증번호 흐름(`backend/app/auth/security.py`의 HMAC+JWT challenge 패턴, `ResendCooldown`/`AttemptLimiter`)을 그대로 복제해 비밀번호 재설정용 3단계 엔드포인트를 추가한다.

**Tech Stack:** FastAPI/SQLModel(backend, 기존 패턴 재사용), React Native/Expo(frontend, 기존 가입 코드입력 UI 패턴 재사용).

**Spec:** `docs/superpowers/specs/2026-11-02-social-login-password-reset-design.md`

## Global Constraints

- **선행 조건**: `docs/superpowers/plans/2026-11-02-social-login.md`의 Task 1(DB 마이그레이션, `User.password_hash`를 Optional로 변경)이 먼저 적용돼 있어야 한다 — 소셜 전용 계정(`password_hash is None`) 판별이 이 플랜의 핵심 분기이기 때문.
- 소셜 전용 계정(password_hash 없음)으로 재설정을 시도하면 코드를 보내지 않고 **"구글/카카오로 가입된 계정입니다, 그걸로 로그인하세요"**를 응답한다(사용자가 명시적으로 요청한 UX — 이메일 존재를 드러내는 선택).
- **그 외의 경우(이메일이 아예 존재하지 않음)는 이메일 존재 여부를 드러내지 않는다** — 일반적인 가입 이메일과 똑같이 "sent: true"로 응답하되 실제 발송은 생략한다. 이건 설계 문서에 없던 디테일이라 내 판단으로 정한 것: 보안 권장사항(계정 존재 비노출)과 사용자가 명시한 요구사항(소셜 계정은 알려주기)을 동시에 만족시키는 가장 좁은 범위.
- 코드 검증 로직(challenge/HMAC)은 `email`만으로 동작하고 user_id를 몰라도 된다 — 기존 가입 코드 패턴과 동일.

## Review Focus

- 존재하지 않는 이메일로 재설정 요청 — "sent: true"로 응답하지만 실제 메일은 안 가야 하고, 공격자가 응답 차이로 이메일 존재 여부를 알아낼 수 없어야 함.
- 소셜 전용 계정 이메일로 재설정 요청 — 코드가 아예 발송되지 않고 안내 메시지만 와야 함(코드 입력 화면으로 넘어가면 안 됨).
- 코드를 5번 이상 틀리는 경우 — `TOO_MANY_REQUESTS`로 막혀야 함(기존 `AttemptLimiter` 재사용 확인).
- 재설정 토큰(`reset_password_verified`)을 로그인 토큰이나 이메일 인증 토큰 자리에 재사용하려는 경우 — `purpose` 클레임 불일치로 거부돼야 함(기존 `decode_email_verify_token` 패턴과 동일 원칙).
- 새 비밀번호가 기존 가입 때와 같은 검증 규칙(8자 이상, UTF-8 72바이트 이하)을 안 거치면 — 거쳐야 함(`_validate_password` 재사용).

---

### Task 1: 백엔드 — 비밀번호 재설정 3단계 엔드포인트

**Files:**
- Modify: `backend/app/auth/security.py`, `backend/app/auth/models.py`, `backend/app/auth/mailer.py`, `backend/app/auth/router.py`, `backend/app/main.py`(rate limiter 인스턴스 추가)
- Test: `backend/tests/test_password_reset.py`

**Interfaces:**
- Consumes: Task 1(social-login plan)의 `User.password_hash: Optional[str]`, 기존 `_validate_password`, `hash_password`, `ResendCooldown`, `AttemptLimiter`, `mailer._send`
- Produces:
  - `create_reset_code_token(email: str, code: str, settings) -> str`, `verify_reset_code(challenge: str, email: str, code: str, settings) -> None`, `create_reset_verified_token(email: str, settings) -> str`, `check_reset_verified(token: str, email: str, settings) -> None` — `backend/app/auth/security.py` (각각 `create_signup_code_token`/`verify_signup_code`/`create_signup_verified_token`/`check_signup_verified`와 동일 구조, `purpose`만 `"reset_password_code"`/`"reset_password_verified"`로 다름)
  - `send_reset_code_email(to_email: str, code: str, settings, client=None) -> bool` — `backend/app/auth/mailer.py`
  - `PasswordResetSendCodeRequest(email)`, `PasswordResetSendCodeResponse(sent: bool, challenge: Optional[str]=None, social_only: bool=False)`, `PasswordResetVerifyRequest(email, code, challenge)`, `PasswordResetVerifyResponse(verified: bool, token: str)`, `PasswordResetRequest(token: str, new_password: str)` — `backend/app/auth/models.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_password_reset.py`:
- `POST /password-reset/send-code`로 일반 가입 계정(password_hash 있음) 이메일 → `sent: true`, `challenge` 있음, `social_only: false`. (mailer는 기존 테스트처럼 monkeypatch로 실제 발송 안 함.)
- 존재하지 않는 이메일 → `sent: true`, `challenge`는 **없음**(`None`), `social_only: false` — 실제로는 아무것도 안 보냈지만 응답 모양은 "성공"과 구분 안 되게.
- 소셜 전용 계정(password_hash=None) 이메일 → `sent: false`, `social_only: true`, `challenge: None`.
- 전체 흐름: send-code → verify-code(올바른 코드) → 받은 토큰으로 `POST /password-reset`(new_password) → 그 뒤 새 비밀번호로 `POST /api/auth/login` 성공.
- verify-code에 틀린 코드 5번 → `TOO_MANY_REQUESTS`.
- `/password-reset`에 만료/위조 토큰 → `UNAUTHORIZED`.

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_password_reset.py -v`
Expected: FAIL

- [ ] **Step 3: `security.py`에 4개 함수 추가**

기존 `create_signup_code_token`/`verify_signup_code`/`create_signup_verified_token`/`check_signup_verified`를 그대로 복제하되 `purpose`만 각각 `"reset_password_code"`, `"reset_password_verified"`로 바꾼다. 만료 시간은 기존 `signup_code_expires_minutes`/`signup_verified_expires_minutes` 설정값을 그대로 재사용(새 설정 안 늘림).

- [ ] **Step 4: `mailer.py`에 `send_reset_code_email` 추가**

`send_signup_code_email`과 동일한 구조, 제목만 "비밀번호 재설정 인증번호 - 티끌모아Data"로.

- [ ] **Step 5: `models.py`에 요청/응답 스키마 추가** (위 Interfaces 참고)

- [ ] **Step 6: `main.py`에 레이트리밋 인스턴스 추가**

```python
app.state.reset_code_cooldown = ResendCooldown(cooldown_s=30.0)
app.state.reset_code_attempts = AttemptLimiter(max_attempts=5, window_s=settings.signup_code_expires_minutes * 60.0)
```

- [ ] **Step 7: `router.py`에 3개 엔드포인트 추가**

```
POST /api/auth/password-reset/send-code  (PasswordResetSendCodeRequest) -> PasswordResetSendCodeResponse
POST /api/auth/password-reset/verify-code (PasswordResetVerifyRequest) -> PasswordResetVerifyResponse
POST /api/auth/password-reset  (PasswordResetRequest) -> UserPublic
```
`send-code` 핸들러: 이메일로 `User` 조회. 없으면 `sent=True, challenge=None, social_only=False`(아무것도 안 보냄). `password_hash is None`이면 `sent=False, social_only=True`. 있으면 기존 `send_signup_code`와 동일한 쿨다운/발송 로직으로 `send_reset_code_email` 호출, `sent=True, challenge=..., social_only=False`.
`verify-code`: `verify_reset_code` + `reset_code_attempts` 체크, 성공 시 `create_reset_verified_token`.
`password-reset`: 토큰에서 email 추출(`check_reset_verified`로 검증) → 해당 유저의 `password_hash = hash_password(new_password)` 갱신 → `UserPublic` 반환. `new_password`는 `SignupRequest.password`와 같은 `_validate_password` 검증을 `field_validator`로 건다.

- [ ] **Step 8: 테스트 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_password_reset.py -v`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
cd backend
git add app/auth/security.py app/auth/models.py app/auth/mailer.py app/auth/router.py app/main.py tests/test_password_reset.py
git commit -m "feat: 비밀번호 재설정(이메일 인증코드) 백엔드"
```

---

### Task 2: 프론트 — 비밀번호 재설정 화면

**Files:**
- Modify: `frontend/app/login.tsx`(진입점 링크), `frontend/src/lib/auth/api.ts`, `frontend/src/lib/auth/errorMessage.ts`(필요시), `frontend/src/i18n/locales/{ko,en,zh}.ts`
- Create: `frontend/app/forgot-password.tsx`
- Test: `frontend/tests/api-client.test.mjs`(기존 파일에 `authApi` 신규 함수 요청 조립 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 3개 엔드포인트
- Produces: `authApi.sendPasswordResetCode`, `authApi.verifyPasswordResetCode`, `authApi.resetPassword` — `frontend/src/lib/auth/api.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`api-client.test.mjs`(또는 패턴에 맞는 별도 파일)에 세 함수가 올바른 경로/바디로 요청하는지 확인하는 테스트 추가(기존 `sendSignupCode`/`verifySignupCode` 테스트와 동일 패턴).

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `cd frontend && node --test tests/*.test.mjs`
Expected: FAIL

- [ ] **Step 3: `src/lib/auth/api.ts`에 3개 함수 추가**

```ts
sendPasswordResetCode: (email: string, options?: RequestOptions) =>
  client.post<{ sent: boolean; challenge?: string; social_only: boolean }>('/api/auth/password-reset/send-code', { email }, options),
verifyPasswordResetCode: (email: string, code: string, challenge: string, options?: RequestOptions) =>
  client.post<{ verified: boolean; token: string }>('/api/auth/password-reset/verify-code', { email, code, challenge }, options),
resetPassword: (token: string, newPassword: string, options?: RequestOptions) =>
  client.post<AuthUser>('/api/auth/password-reset', { token, new_password: newPassword }, options),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && node --test tests/*.test.mjs`
Expected: PASS

- [ ] **Step 5: `frontend/app/forgot-password.tsx` 작성**

`frontend/app/signup.tsx`의 이메일 인증코드 UI 블록(`verifyState`, `codeBlock` 등)을 참고해 3단계로 구성: (1) 이메일 입력 → `sendPasswordResetCode` → `social_only`면 안내 문구("구글/카카오로 가입된 계정입니다, 그걸로 로그인하세요") 보여주고 종료, 아니면 (2) 코드 입력 → `verifyPasswordResetCode` → (3) 새 비밀번호 입력(+확인, `signup.tsx`의 `PASSWORD_MIN`/`PASSWORD_MAX_BYTES` 검증 재사용) → `resetPassword` → 성공하면 로그인 화면으로 이동, 성공 토스트/안내.

- [ ] **Step 6: `login.tsx`에 진입점 추가**

비밀번호 입력 필드 아래 "비밀번호를 잊으셨나요?" 링크 → `router.push('/forgot-password')`.

- [ ] **Step 7: i18n 문구 추가**

`ko/en/zh` 로케일 파일에 이번 화면에서 쓰는 새 키 추가(제목, 안내문, 버튼, 소셜전용 안내문구 등). 기존 `auth.*` 네임스페이스 패턴을 따른다.

- [ ] **Step 8: 수동 확인**

Run: 프론트 실행(`npm run start` 또는 `npm run web`) 후 로그인 화면 → "비밀번호를 잊으셨나요?" → 실제 이메일로 코드 받아 재설정까지 한 번 통과.

- [ ] **Step 9: 커밋**

```bash
cd frontend
git add app/forgot-password.tsx app/login.tsx src/lib/auth/api.ts src/i18n/locales tests/
git commit -m "feat: 비밀번호 재설정 화면"
```
