// 위험 알림 카드용 타입. 추후 FastAPI 응답(필드명 변환 후)으로 그대로 교체할 수 있게 둔다.
export type AlertType = 'accident' | 'construction' | 'congestion' | 'school_zone';
export type AlertSeverity = 'danger' | 'caution' | 'busy';

/** 원문(한국어) 외 언어로 번역된 표시 문구. */
export interface AlertTranslation {
  location: string;
  description: string;
}

export interface RoadAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  /** 발생 위치(도로명·주소). 한국어 원문. 다른 언어는 translations 로 제공한다. */
  location: string;
  description: string;
  /** ISO 8601 (+09:00). 카드에 표시할 시각. 없으면 빈 문자열(시각을 보여주지 않는다). */
  updatedAt: string;
  /** updatedAt 이 무엇의 시각인지. 기본은 'updated'(갱신), 실제 돌발정보는 발생 시각이라 'started'. */
  timeKind?: 'updated' | 'started';
  /** 위험 위치. 경로 매칭(src/lib/routeHazards.ts)과 추후 지도 마커에 쓴다. */
  latitude: number;
  longitude: number;
  /** true 면 카드에 "예시 데이터" 태그를 보여 실시간 정보로 오인되지 않게 한다. */
  isSample?: boolean;

  /** 위험이 영향을 주는 진행 방향(방위각, 북=0, 시계 방향). 없으면 경로 방향을 판단할 수 없어 경로상 위험으로 보지 않는다. */
  headingDeg?: number;
  /** true 면 headingDeg 와 무관하게 경로상 위험으로 본다(차로 방향이 아니라 구역 전체에 적용되는 위험, 예: 보호구역). */
  omnidirectional?: boolean;
  /** 도로 구간 ID. API 연동용 자리이며 현재 경로 매칭은 쓰지 않는다(routeHazards.ts 의 확장 지점 참고). */
  roadLinkId?: string;
  /** 상행/하행. API 연동용 자리이며 현재 경로 매칭은 쓰지 않는다. */
  direction?: 'up' | 'down';
  /** 정보 개정 번호. 같은 위험의 내용이 중요하게 바뀌면 값을 바꿔 보내면 단계별 경고를 다시 받을 수 있다. */
  revision?: string | number;
  /** ISO 8601. 돌발정보의 종료 예정 시각(백엔드 ended_at). 지났으면 이미 끝난 위험이다. 없으면 종료 시각 미정. */
  endedAt?: string;
  /** 같은 사건을 가리키는 안정 키(백엔드 event_key). id 와 달리 문구가 바뀌어도 그대로라 중복 판정에 쓴다(routeHazards.hazardKey). 없으면 id 로 구분한다. */
  eventKey?: string;
  /** 통제 정도(백엔드 closure). 'full'(전면 통제)은 ITS 명세로 확인되지 않은 값이다. */
  closure?: 'none' | 'partial' | 'full' | 'unknown';
  /** 방향 범위(백엔드 direction_scope). 'both'(양방향)여도 headingDeg 가 없으면 경로 방향 판정은 하지 않는다. */
  directionScope?: 'both' | 'single' | 'unknown';
  /** 언어별 표시 문구. 없는 언어는 원문(한국어)으로 대체한다. */
  translations?: Partial<Record<'en' | 'zh', AlertTranslation>>;
}
