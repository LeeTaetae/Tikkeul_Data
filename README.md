# Tikkeul_Data (티끌모아Data)

AI 기반 모바일 교통안전 보조 서비스. 후면 카메라 영상에서 객체를 탐지하고, GPS·시간·보호구역·교통 정보를 결합해 상황에 맞는 경고(화면·TTS·진동)를 제공한다.

- 팀: 4명 · 개발 기간: 7일
- 상태: 초기 설정 단계 (앱 코드 없음)

> AI 탐지 결과는 "위험 가능성"을 알리는 보조 정보다. 사고·충돌 발생을 확정하지 않는다.

## 주요 기능

| 우선순위 | 기능 |
|---|---|
| P0 | 후면 카메라 YOLO 객체 탐지 · ROI 기반 안전 경고 · GPS·시간·보호구역 결합 상황 적응형 경고 · 교통 정체/공사/통제 정보 · 어린이보호구역 및 주변 위험지역 안내 · 한국어/영어/중국어 · 네트워크 장애 및 데이터 갱신 시각 표시 |
| P1 | AI 시야 상태 평가 · 동의 기반 경고 관측 이벤트 지도 |
| P2 | 사이렌·경적 오디오 분류 · 청각 약자용 화면·진동 안내 |

제외: 포트홀 탐지, 졸음 감지, 전·후면 동시 카메라 촬영.

## 기술 스택

| 영역 | 기술 |
|---|---|
| Frontend | React Native, Expo, TypeScript, Expo Router |
| Web Demo | Expo Web, Vercel |
| Backend | Python, FastAPI, Pydantic |
| Computer Vision | YOLO, OpenCV |
| Location | GPS |
| External Data | 국내 교통 공공데이터 API (TBD) |
| i18n | i18next |
| Alerts | TTS, 화면 경고, 진동 |

선택 배경: [ADR 0001](docs/ADR/0001-tech-stack.md)

## 시작하기

저장소 가져오기:

```bash
git clone https://github.com/LeeTaetae/Tikkeul_Data.git
cd Tikkeul_Data
```

| 항목 | 내용 |
|---|---|
| 설치 (프론트엔드) | `cd frontend && npm install` |
| 프론트엔드 실행 | `npm run web` (웹) · `npm start` (Expo Go/기기) · 타입 검사 `npm run typecheck` |
| 백엔드 실행 | TBD |
| 테스트 실행 | TBD |
| 배포 (Vercel) | Root Directory `frontend` 로 지정. `frontend/vercel.json` 이 `expo export --platform web` → `dist` 배포 |
| 환경변수 | `frontend/.env.example` 을 `frontend/.env` 로 복사. `EXPO_PUBLIC_*` 는 번들에 공개되므로 비밀값 금지. 실제 `.env`는 Git에 올리지 않는다. |

## 문서

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | AI 개발 지침 · 팀 규칙 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 브랜치 · 커밋 · PR · 리뷰 |
| [SECURITY.md](SECURITY.md) | 보안 정책 · 취약점 제보 |
| [CHANGELOG.md](CHANGELOG.md) | 변경 내역 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 시스템 구조 |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 요구사항 |
| [docs/API_SPEC.md](docs/API_SPEC.md) | API 계약 |
| [docs/ERD.md](docs/ERD.md) | 논리 데이터 모델 |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | 테스트 계획 |
