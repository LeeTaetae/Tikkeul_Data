# Claude Code 도구 구성

팀이 공유하는 Skill · Plugin · MCP와 에이전트 연동 기록. 검증일: 2026-10-27, Claude Code 2.1.311, Windows 10.

## 1. 설치 완료 목록

| 도구 | 구분 | 출처 · 라이선스 | 용도 | 공유 방식 |
|---|---|---|---|---|
| `systematic-debugging` | Skill | [obra/superpowers](https://github.com/obra/superpowers) · MIT | 원인 분석 후 수정 | `.claude/skills/` (Git) |
| `test-driven-development` | Skill | 위와 동일 | 테스트 먼저 작성 | `.claude/skills/` (Git) |
| `verification-before-completion` | Skill | 위와 동일 | 완료 주장 전 실제 실행 확인 | `.claude/skills/` (Git) |
| `writing-plans` | Skill | 위와 동일 | 여러 단계 작업 계획 | `.claude/skills/` (Git) |
| `context7` | MCP (HTTP) | [upstash/context7](https://github.com/upstash/context7) · MIT | 라이브러리 공식 문서 조회 | `.mcp.json` (Git) |
| `frontend-design@claude-code-plugins` | Plugin | [anthropics/claude-code](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design) · 저장소에 라이선스 표기 없음(미확인) | 새 UI 디자인 가이드 | `.claude/settings.json` (Git) + 팀원 1회 설치 |

Skill 설치에 쓴 CLI: [vercel-labs/skills](https://github.com/vercel-labs/skills) (MIT, v1.7.4).

## 2. 프로젝트 공유 파일 (clone하면 따라오는 것)

| 파일 | 내용 |
|---|---|
| `.claude/skills/` | Skill 4개 |
| `skills-lock.json` | Skill 출처와 해시 (`npx skills` 갱신용) |
| `.mcp.json` | Context7 서버 정의 (키 없음) |
| `.claude/settings.json` | 마켓플레이스 등록, `frontend-design` 활성화 |
| `.claude/agents/` | 에이전트 8개 |

개인 설정 `.claude/settings.local.json`은 `.gitignore` 대상이다.

## 3. 팀원 설치 방법

```bash
git clone https://github.com/LeeTaetae/Tikkeul_Data.git
cd Tikkeul_Data
git switch <작업 브랜치>
claude plugin install frontend-design@claude-code-plugins --scope project   # 1회
claude                                                                       # 폴더 신뢰, Context7 승인
```

| 단계 | 이유 |
|---|---|
| 폴더 신뢰 | 신뢰해야 프로젝트 설정이 적용된다 |
| Context7 승인 | `.mcp.json`의 프로젝트 MCP는 첫 실행 때 각자 승인한다 (`⏸ Pending approval`) |
| 플러그인 1회 설치 | `.claude/settings.json`은 활성화만 공유하고 파일을 내려받지는 않는다 |

설치 확인: `claude plugin list`, `claude mcp list`, 세션에서 `/mcp`.

### 개인 인증이 필요한 항목

현재 없다. Context7은 키 없이 동작했다. 호출 한도에 걸리면 [context7.com/dashboard](https://context7.com/dashboard)에서 무료 키를 받아 환경변수로 쓴다 (아래 문제 해결). 키를 `.mcp.json`에 직접 쓰지 않는다.

## 4. 에이전트별 도구

기존 도구와 역할은 그대로 두고 아래만 추가했다. `Skill`은 Skill 전체 호출 권한이라 skill 단위 제한은 되지 않는다. 쓸 skill은 각 에이전트 본문에 적었다.

| 에이전트 | 추가한 도구 | 권장 Skill |
|---|---|---|
| architect | `Skill`, Context7 2개 | `writing-plans` |
| frontend | `Skill`, Context7 2개 | `frontend-design:frontend-design` |
| backend | `Skill`, Context7 2개 | `test-driven-development` |
| vision-ai | `Skill`, Context7 2개 | `systematic-debugging` |
| traffic-data | Context7 2개 | 없음 |
| integration | `Skill`, Context7 2개 | `verification-before-completion` |
| qa-tester | `Skill` | `test-driven-development`, `systematic-debugging` |
| security-reviewer | 읽기 전용으로 축소: `Read`, `Grep`, `Glob`만 (`Bash`·`PowerShell` 제거) | 없음 |

security-reviewer는 셸이 없어 git을 직접 실행하지 못한다. 변경 범위 검토가 필요하면 메인 세션이 `git status`, `git diff`, `git ls-files` 결과를 프롬프트로 넘긴다.

Context7 2개: `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`. 와일드카드 대신 이름을 명시했다.

`tools`를 명시한 에이전트는 MCP 도구를 상속받지 않는다 (공식 문서). 그래서 위처럼 직접 넣어야 한다.

## 5. Superpowers 수정 내역

4개만 복사하면 원본이 설치하지 않은 skill을 가리킨다. 그대로 두면 `writing-plans`가 끝날 때 없는 skill(`subagent-driven-development`, `executing-plans`)을 REQUIRED로 호출하려 한다. 무시하지 않고 아래와 같이 고쳤다.

| 파일 | 원본 | 수정 |
|---|---|---|
| `writing-plans/SKILL.md` | `superpowers:subagent-driven-development` · `executing-plans` 호출 | 프로젝트 에이전트 위임 또는 현재 세션 구현으로 교체 |
| 〃 | 계획 저장 `docs/superpowers/plans/` | `docs/plans/` |
| 〃 | `superpowers:using-git-worktrees` 언급 | 이 프로젝트는 worktree를 쓰지 않는다는 문장으로 교체 |
| 〃 | 단계 "Commit", "Frequent commits" | 사용자 승인 후에만 커밋 (CLAUDE.md §4) |
| `systematic-debugging/SKILL.md` | `superpowers:test-driven-development` · `superpowers:verification-before-completion` | `superpowers:` 접두사 제거 (설치된 이름으로 호출) |
| `test-driven-development/writing-good-tests.md` | `superpowers:writing-skills` | 일반 문구로 교체 |

주의: `npx skills update`로 갱신하면 이 수정이 덮어써진다. 갱신 후 이 표대로 다시 확인한다. `skills-lock.json`의 해시는 수정 전 원본 기준이다.

## 6. 토큰 최적화 전략

| 전략 | 효과 |
|---|---|
| superpowers 플러그인 전체 대신 Skill 4개만 복사 | skill 15개와 SessionStart hook 로딩을 피함 |
| 에이전트에 `skills:` 미리 주입 대신 `Skill` 도구로 필요할 때 호출 | 호출하지 않으면 본문 비용 없음 |
| Context7은 2개 도구만 허용, 필요한 에이전트에만 부여 | 도구 정의 중복 로딩 최소화 |
| `traffic-data`·`security-reviewer`는 Skill 없음 | 불필요한 도구 제거 |
| `frontend-design` 상시 비용 | 약 80토큰 (`claude plugin details`), 호출 시 약 2.7k |
| Skill 호출 비용 | `SKILL.md` 크기 기준 약 3.6KB(verification) ~ 10KB(writing-plans). 토큰은 추정, 미측정 |
| P1 도구(Expo 플러그인, GitHub·Playwright MCP 등) | 필요해질 때까지 설치하지 않음 |

## 7. 검증 결과

| 항목 | 결과 | 방법 |
|---|---|---|
| Skill 4개 설치와 복사 | 성공 | 파일 존재, 의심 명령 패턴 검색(없음) |
| Skill 인식과 호출 | 성공 | 새 `claude -p --agent` 프로세스에서 `writing-plans`, `systematic-debugging` 호출 |
| Plugin 활성화 | 성공 | `claude plugin list`에 project 스코프 `enabled` |
| 플러그인 skill 호출 | 성공 | `frontend` 에이전트에서 `frontend-design:frontend-design` 로드 |
| Context7 연결 | 성공 | `initialize` 응답, 도구 `resolve-library-id` · `query-docs` 확인 |
| Context7 실제 조회 | 성공 | `expo-router`, `fastapi` 라이브러리 ID 반환 (`/websites/fastapi_tiangolo`). `query-docs` 본문 조회는 호출하지 않음 |
| 에이전트 8개 로드 | 성공 | 8개 모두 `--agent`로 실행됨 |
| architect: Context7 + Skill | 성공 | 실제 호출 성공 |
| qa-tester: Skill 있음, Context7 없음 | 성공 | Skill 호출 성공, Context7은 `TOOL UNAVAILABLE` |
| backend · vision-ai · integration · traffic-data 도구 | 성공 | 도구 목록 자기 보고. traffic-data는 `Skill=no`, 나머지는 `yes` |
| security-reviewer 읽기 전용 | 성공 | `tools`가 `Read, Grep, Glob`뿐이라 쓰기·셸 도구가 없음 |
| Git에 민감정보 없음 | 성공 | 변경·신규 파일 패턴 검색(키·토큰 없음), `.env`·`*.pem`·`*.key` 없음 |
| Windows 호환 | 성공 | `--copy` 설치, HTTP MCP라 `npx`·`cmd /c` 불필요 |
| frontend의 Context7 실제 호출 | 미검증 | 테스트 프로세스가 중간에 종료됨 (exit 255). 설정은 다른 에이전트와 동일 |
| 현재 열린 대화 세션에서 인식 | 미검증 | 세션 시작 시 로드되므로 새 세션에서 확인 필요 |
| 대화형 세션의 Context7 승인 흐름 | 미검증 | `claude mcp list`가 `Pending approval` 표시. 승인 후 상태 확인 필요 |
| 다른 PC에서 clone 후 재현 | 미검증 | 두 번째 환경 필요. `extraKnownMarketplaces`로 마켓플레이스가 자동 등록되는지 포함 |
| 선택 sub-file(`find-polluter.sh`) | 미검증 | bash 스크립트라 Git Bash 필요 |

### 새 세션에서 확인할 것
1. `/agents`에 8개가 보이는지
2. `/mcp`에서 `context7`을 승인하고 `connected`가 되는지
3. `/skills`(또는 `/`)에 Skill 4개와 `frontend-design`이 보이는지
4. `architect`로 "Context7로 fastapi 라우팅 문서 요약"을 시켜 본문 조회가 되는지

## 8. 문제 해결

| 증상 | 조치 |
|---|---|
| Skill이 안 보임 | 새 세션을 연다. `.claude/skills/<이름>/SKILL.md`가 있는지 확인 |
| `Pending approval` | `claude`를 대화형으로 실행해 승인. 초기화는 `claude mcp reset-project-choices` |
| Context7 연결 실패, 한도 초과 | 무료 키 발급 후 환경변수 `CONTEXT7_API_KEY` 설정, `.mcp.json`의 context7에 `"headers": {"Authorization": "Bearer ${CONTEXT7_API_KEY}"}` 추가. 키 값은 커밋하지 않는다 |
| 플러그인이 `enabled`인데 안 불러와짐 | `claude plugin install frontend-design@claude-code-plugins --scope project` 실행 후 `/reload-plugins` |
| 마켓플레이스를 못 찾음 | `claude plugin marketplace add anthropics/claude-code` |
| 에이전트가 Context7을 못 씀 | 에이전트 `tools`에 `mcp__context7__resolve-library-id`, `mcp__context7__query-docs`가 있는지 확인 |
| Skill 갱신 후 동작이 달라짐 | 5절 수정 내역을 다시 적용 |

### Context7 승인과 라이브러리 선택

**승인 상태.** `claude mcp list`에 `⏸ Pending approval`이 보이면 Context7은 아직 연결되지 않은 것이다. 이 상태에서는 대화형 세션의 서브에이전트도 `mcp__context7__*` 도구를 쓰지 못한다 (2026-10-27 확인: `frontend`·`backend`가 `TOOL UNAVAILABLE`). 승인 절차가 없는 `claude -p` 같은 비대화형 실행에서는 승인 없이 로드된다.

**승인 후 재테스트.**
1. 터미널에서 `claude`를 실행한다.
2. `/mcp`를 열어 `context7`을 승인한다. 상태가 `connected`인지 본다. (승인을 되돌리려면 `claude mcp reset-project-choices`)
3. 세션을 종료하고 새 세션을 연다.
4. `architect`(또는 `backend`)에게 "Context7로 FastAPI request body 문서를 조회하고 출처 URL을 알려줘"라고 시킨다. 출처가 `fastapi.tiangolo.com`이고 본문이 나오면 정상이다.

**라이브러리 ID는 공식 문서인지 확인한다.** `resolve-library-id`는 후보를 여러 개 돌려주고 첫 번째가 공식이라는 보장이 없다. 실제로 `expo-router`를 조회했을 때 첫 결과가 개인 데모 프로젝트(`/evanbacon/expo-router-spotify`)였다.
- 제목·설명이 공식 프로젝트이고 출처 평판(Source Reputation)이 높은 후보를 고른다.
- 개인 저장소·데모·튜토리얼 ID는 쓰지 않는다.
- 응답의 `Source:` URL이 공식 도메인인지 본다.
- 공식 문서에 답이 없어 비공식 출처를 쓰면 보고서에 그 사실을 적는다.

**공식 문서 우선 원칙.**

| 대상 | 우선 사용할 출처 | 2026-10-27 조회 시 ID (바뀔 수 있으니 매번 resolve로 재확인) |
|---|---|---|
| Expo · Expo Router | Expo 공식 문서 `docs.expo.dev` | `/websites/expo_dev`, `/expo/expo` |
| FastAPI | FastAPI 공식 문서 `fastapi.tiangolo.com` | `/websites/fastapi_tiangolo` |

## 9. 설치하지 않은 도구

| 도구 | 사유 |
|---|---|
| Expo 공식 플러그인, GitHub MCP, Playwright MCP, Ultralytics skills | P1. 필요해질 때 설치. Ultralytics는 AGPL-3.0이라 라이선스 검토 필요 |
| Karpathy 가이드라인 | 4대 원칙이 `CLAUDE.md` §1에 이미 있음 |
| Ponytail | Simplicity First와 중복, Node hook과 로컬 CSV 기록 |
| FastAPI · OpenCV 전용 skill | 검증된 공식 skill 없음. Context7로 대체 |
