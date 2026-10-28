// 위험 알림 카드용 타입. 추후 FastAPI 응답(필드명 변환 후)으로 그대로 교체할 수 있게 둔다.
export type AlertType = 'accident' | 'construction' | 'congestion';
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
  /** 도로 구간 ID. API 연동용 자리이며 현재 경로 매칭은 쓰지 않는다(routeHazards.ts 의 확장 지점 참고). */
  roadLinkId?: string;
  /** 상행/하행. API 연동용 자리이며 현재 경로 매칭은 쓰지 않는다. */
  direction?: 'up' | 'down';
  /** 정보 개정 번호. 같은 위험의 내용이 중요하게 바뀌면 값을 바꿔 보내면 단계별 경고를 다시 받을 수 있다. */
  revision?: string | number;
  /** 언어별 표시 문구. 없는 언어는 원문(한국어)으로 대체한다. */
  translations?: Partial<Record<'en' | 'zh', AlertTranslation>>;
}
