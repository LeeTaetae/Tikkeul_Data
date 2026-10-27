# Tikkeul_Data (티끌모아Data) 팀 규칙

4인 팀, 7일 개발. AI 기반 모바일 교통안전 보조 서비스.
이 문서는 사람과 Claude Code(모든 에이전트 포함)가 함께 따르는 규칙이다. 미확정 항목은 `TBD`.

## 1. 4대 코딩 원칙

### Think Before Coding
- 가정하지 말고 확인한다.
- 불확실한 요구사항은 질문한다.
- 해석이 여러 개라면 선택지를 제시한다.
- 더 단순한 해결책이 있다면 설명한다.
- 이해하지 못한 부분을 숨기지 않는다.

### Simplicity First
- 요청받지 않은 기능을 추가하지 않는다.
- 한 번만 쓰는 코드를 불필요하게 추상화하지 않는다.
- 요구되지 않은 확장성·설정 기능을 추가하지 않는다.
- 실제로 불가능한 상황에 대한 과도한 예외 처리를 피한다.
- 더 짧고 명확하게 쓸 수 있다면 단순화한다.

### Surgical Changes
- 필요한 파일과 코드만 수정한다.
- 관련 없는 코드·주석·포맷을 임의로 정리하지 않는다.
- 기존 프로젝트의 코딩 스타일을 존중한다.
- 자신의 변경으로 쓰이지 않게 된 코드만 정리한다.
- 기존에 있던 미사용 코드는 요청 없이 삭제하지 않는다.
- 모든 변경은 사용자 요구사항과 연결되어야 한다.

### Goal-Driven Execution
- 구현 전에 검증 가능한 완료 기준을 정의한다.
- 버그 수정 시 가능하면 재현 테스트를 먼저 작성한다.
- 리팩터링 전후 테스트 결과를 비교한다.
- 여러 단계 작업은 간단한 계획을 세운다.
- 테스트가 실패하면 원인을 분석하고 수정한다.
- 실행하지 않은 테스트를 성공했다고 보고하지 않는다.
- 단순한 작업에는 과도한 계획을 강제하지 않는다.

## 2. 프로젝트 개요

### 기술 스택
| 영역 | 기술 |
|---|---|
| Frontend | React Native, Expo, TypeScript, Expo Router |
| Web Demo | Expo Web, Vercel |
| Backend | Python, FastAPI, Pydantic |
| Computer Vision | YOLO, OpenCV |
| Location | GPS |
| External Data | 국내 교통 공공데이터 API (구체 API: TBD) |
| i18n | i18next (한국어·영어·중국어) |
| Alerts | TTS, 화면 경고, 진동 |

### 기능 우선순위
- **P0**: 후면 카메라 YOLO 탐지 · ROI 기반 안전 경고 · GPS·시간·보호구역 결합 상황 적응형 경고 · 교통 정체·공사·통제 정보 · 어린이보호구역 및 주변 위험지역 안내 · 한/영/중 · 네트워크 장애 및 데이터 갱신 시각 표시
- **P1**: AI 시야 상태 평가 · 동의 기반 경고 관측 이벤트 지도
- **P2**: 사이렌·경적 오디오 분류 · 청각 약자용 화면·진동 안내
- **제외**: 포트홀 탐지 · 졸음 감지 · 전·후면 동시 카메라 촬영

## 3. 실행법
TBD — 코드 추가 시 채워넣기 (예: `npx expo start` / `uvicorn app.main:app --reload`). 실제 프로젝트 설정이 생기기 전에는 명령어를 확정하지 않는다.

## 4. Git 규칙

### 브랜치
| 브랜치 | 용도 | 누가 | 규칙 |
|---|---|---|---|
| `main` | 항상 돌아가는 안정 버전 | Git 관리자(PR 머지) | 직접 push 금지 |
| `feat/기능명` | 기능 개발 | 각자 | 기능별 브랜치 |
| `fix/버그명` | 버그 수정 | 각자 | 버그별 브랜치 |

### 작업 흐름
```
git status
git switch main
git pull
git switch -c feat/기능명
# ... 작업 · 테스트 ...
git status
git diff
git add <변경 파일>
git commit -m "feat: 설명"
git push -u origin feat/기능명
```
- push 후 PR을 올리고 Git 관리자가 검토·머지한다.
- 충돌이 나면 혼자 풀지 말고 Git 관리자와 함께 해결한다.
- 브랜치 전환 전에 기존 작업물을 확인한다. 다른 팀원의 작업을 덮어쓰지 않는다.
- **Claude Code는 commit · push · PR 생성 · merge 전에 반드시 사용자 승인을 받는다.**
- force push, `reset --hard`, `clean` 등 파괴적 명령은 승인 없이 실행하지 않는다. `--no-verify` 금지.
- GitHub Ruleset으로 `main` 보호 설정을 권장한다.

### 커밋 메시지
`feat:` 기능 추가 · `fix:` 버그 수정 · `docs:` 문서 · `style:` 서식 · `refactor:` 구조 정리

한 줄로, 무엇을 왜 바꿨는지 알아볼 수 있게 쓴다.

## 5. 개발·보안 규칙

### TypeScript
- 타입을 명확히 선언하고 불필요한 `any`를 쓰지 않는다.
- 컴포넌트·함수는 단일 책임을 유지한다.
- API 응답 타입을 명확히 정의한다.

### Python
- PEP 8, 타입 힌트 사용.
- Pydantic으로 요청·응답을 검증한다.
- 라우터와 비즈니스 로직을 분리한다.

### 보안
- API 키·비밀번호·토큰을 코드에 하드코딩하지 않는다.
- `.env`와 실제 인증정보를 Git에 올리지 않는다. `.env.example`에는 비밀값을 넣지 않는다.
- 카메라 원본 영상은 기본적으로 서버로 전송하지 않는다.
- 위치정보 수집은 최소화한다.
- 민감정보를 로그에 기록하지 않는다.
- AI 탐지 결과를 사고·충돌 발생 확정으로 표현하지 않는다. ("위험 가능성", "주의" 등으로 표현)

## 6. 건드리면 안 되는 파일·폴더
- 다른 팀원이 작업 중인 파일 (브랜치·PR 확인 후 협의)
- `.env`, `*.key` 등 실제 비밀키가 든 파일 (읽기·출력·커밋 모두 금지)
- `.git/` 내부
- 자동 생성 파일·폴더: `node_modules/`, `__pycache__/`, `.expo/`, 빌드 산출물 등
- 기존 데이터 및 마이그레이션
- 구체적인 보호 대상 추가: TBD (프로젝트 구조가 생기면 갱신)

## 7. 쓰는 라이브러리 / 쓰지 않는 라이브러리
TBD — 확정되면 갱신. 위 기술 스택 외 새 의존성은 추가 전에 팀과 협의한다.

## 8. Claude Code 에이전트 협업

에이전트는 `.claude/agents/`에 있다. 모든 에이전트는 이 문서의 팀 규칙과 4대 코딩 원칙을 따른다.

| 에이전트 | 역할 |
|---|---|
| `architect` | 전체 시스템 설계 |
| `frontend` | React Native UI |
| `backend` | FastAPI |
| `vision-ai` | YOLO · OpenCV |
| `traffic-data` | 교통 API · GPS |
| `integration` | 시스템 연동 |
| `qa-tester` | 테스트·검증 |
| `security-reviewer` | 보안 검토 |

- 작업에 필요한 에이전트만 호출한다. 8개를 무조건 병렬 실행하지 않는다.
- 같은 파일을 동시에 수정하지 않는다.
- 기존 문서·코드를 먼저 확인한다.
- 결과는 **변경 파일 / 테스트 / 남은 문제** 중심으로 간결하게 보고한다.

## 9. 문서
[README](README.md) · [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md) · [CHANGELOG](CHANGELOG.md)
[CLAUDE_TOOLS](docs/CLAUDE_TOOLS.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [REQUIREMENTS](docs/REQUIREMENTS.md) · [API_SPEC](docs/API_SPEC.md) · [ERD](docs/ERD.md) · [TEST_PLAN](docs/TEST_PLAN.md) · [ADR 0001](docs/ADR/0001-tech-stack.md)

이 문서와 같은 내용을 길게 중복해서 쓰지 않는다. 충돌하면 이 문서가 우선한다.
