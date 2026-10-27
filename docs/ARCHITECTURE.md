# 시스템 구조

초안. 확정되지 않은 항목은 `TBD`. 확정되면 갱신한다.

## 1. 구성 요소

| 구성 요소 | 기술 | 역할 |
|---|---|---|
| 모바일 앱 | React Native, Expo, Expo Router, TypeScript | 카메라 입력, 경고 표시(화면·TTS·진동), 다국어 UI |
| 웹 데모 | Expo Web, Vercel | 앱의 웹 시연 버전. 카메라·센서 제약은 TBD |
| 비전 모듈 | YOLO, OpenCV | 객체 탐지, ROI 판정. 실행 위치(기기/서버)는 TBD |
| 백엔드 | Python, FastAPI, Pydantic | 교통 정보 제공, 경고 컨텍스트 계산, (P1) 관측 이벤트 수집 |
| 교통 데이터 | 국내 교통 공공데이터 API | 정체·공사·통제, 보호구역. 구체 API는 TBD |
| 위치 | GPS | 현재 위치 → 보호구역·교통 정보 조회 |

## 2. 전체 구조

```mermaid
flowchart LR
    subgraph Device["모바일 앱 (Expo / React Native)"]
        CAM[후면 카메라]
        VIS["비전 모듈<br/>YOLO + OpenCV<br/>(실행 위치 TBD)"]
        CTX[상황 판단<br/>ROI · 위치 · 시간 · 보호구역]
        ALERT["경고 출력<br/>화면 · TTS · 진동"]
        I18N[i18next ko/en/zh]
        GPS[GPS]
    end
    subgraph Server["백엔드 (FastAPI)"]
        API[API 라우터]
        SVC[서비스 로직]
    end
    PUB[(국내 교통<br/>공공데이터 API)]

    CAM -->|프레임| VIS
    VIS -->|탐지 결과| CTX
    GPS -->|좌표 · 시간| CTX
    CTX --> ALERT
    I18N --> ALERT
    CTX <-->|교통 · 보호구역 조회| API
    API --> SVC
    SVC -->|조회 · 정규화| PUB
```

카메라 원본 영상은 서버로 보내지 않는다. 서버로 가는 것은 위치 기반 조회 요청과 (P1) 동의한 사용자의 경고 관측 이벤트뿐이다.

## 3. 경고 흐름

```mermaid
sequenceDiagram
    participant C as 카메라
    participant V as 비전 모듈
    participant X as 상황 판단
    participant B as 백엔드
    participant U as 사용자

    C->>V: 프레임
    V->>X: 탐지 객체 · ROI 진입 여부
    X->>B: 현재 위치 기준 교통 · 보호구역 조회
    B-->>X: 정보 + 갱신 시각
    Note over X,B: 실패 시 마지막 성공 데이터와 갱신 시각 표시
    X->>U: 상황에 맞는 경고 (화면 · TTS · 진동)
```

## 4. 설계 원칙

- 경고는 "위험 가능성" 표현만 쓰고 사고·충돌을 확정하지 않는다.
- 네트워크가 끊겨도 비전 기반 경고는 동작해야 한다. (가능 여부는 비전 모듈 실행 위치 결정에 따라 달라짐: TBD)
- 교통 데이터는 항상 "갱신 시각"과 함께 보여준다.
- 사용자 문구는 모두 i18next 키로 관리한다.

## 5. 미결정 사항 (TBD)

| 항목 | 선택지 | 비고 |
|---|---|---|
| YOLO 실행 위치 | 기기 내 / 서버 | 영상 비전송 원칙과 성능에 영향 |
| YOLO 모델·버전 | TBD | 7일 일정 내 가능한 규모로 |
| 교통 공공데이터 API | TBD | 호출 한도·이용 조건 확인 필요 |
| 백엔드 저장소 | 없음 / DB | P1 이벤트 지도 도입 시 필요. [ERD](ERD.md) 참고 |
| 웹 데모 범위 | TBD | 카메라 접근 가능 범위 확인 필요 |
| 오디오 분류(P2) 방식 | TBD | |
