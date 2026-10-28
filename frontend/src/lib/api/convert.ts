// 백엔드 응답 → 화면용 타입 변환. 다른 모듈을 import 하지 않는 순수 함수라 Node 로도 테스트한다.
import type { AlertSeverity, AlertType, RoadAlert } from '../../types/alert';
import type { CautionZone, Incident, IncidentKind, ProtectionZone } from '../../types/traffic';

// 알림 목록에 올리는 돌발 유형: 사고, 공사, ITS 가 직접 '차량증가/정체'로 분류한 정체.
// 기상·재난·기타는 이 화면의 사고·공사·정체 모델에 맞지 않아 목록에 올리지 않는다.
const ALERT_TYPE: Partial<Record<IncidentKind, AlertType>> = {
  accident: 'accident',
  construction: 'construction',
  congestion: 'congestion',
};

// 배지 문구(위험/주의/혼잡)는 유형별 화면 표기다. 공공 API 가 준 심각도 값이 아니다.
const BADGE_BY_TYPE: Record<AlertType, AlertSeverity> = { accident: 'danger', construction: 'caution', congestion: 'busy' };

const ORDER: Record<AlertType, number> = { accident: 0, congestion: 1, construction: 2 };

export function incidentToAlert(incident: Incident, fallbackLocation: string): RoadAlert | null {
  const type = ALERT_TYPE[incident.kind];
  if (!type) return null;

  const parts = [incident.message.trim(), incident.lanes_blocked.trim()].filter(Boolean);
  const description = parts.length > 0 ? parts.join(' · ') : incident.event_detail_type.trim();

  return {
    id: incident.id,
    type,
    severity: BADGE_BY_TYPE[type],
    location: incident.road_name.trim() || fallbackLocation,
    description,
    // 표시할 시각: 돌발정보에는 갱신 시각이 없고 발생 시각만 있다(timeKind 로 구분)
    updatedAt: incident.started_at ?? '',
    timeKind: 'started',
    latitude: incident.location.lat,
    longitude: incident.location.lon,
    // headingDeg, translations 는 일부러 넣지 않는다.
    // 방향은 ITS 원문 문자열(direction_text)뿐이라 경로 매칭에 쓸 수 없고, 번역은 공공 API 가 주지 않는다.
  };
}

/** 사고 → 정체 → 공사 순, 같은 유형 안에서는 최근 발생 순. 지원하지 않는 유형은 뺀다. */
export function incidentsToAlerts(incidents: Incident[], fallbackLocation: string): RoadAlert[] {
  return incidents
    .map((i) => incidentToAlert(i, fallbackLocation))
    .filter((a): a is RoadAlert => a !== null)
    .sort((a, b) => ORDER[a.type] - ORDER[b.type] || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function sortCautionZones(zones: CautionZone[]): CautionZone[] {
  // priority 숫자가 작은 것부터. 값이 없으면 뒤로.
  return [...zones].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id));
}

const ZONE_ORDER = { child: 0, senior: 1, disabled: 2, unknown: 3 } as const;

export function sortProtectionZones(zones: ProtectionZone[]): ProtectionZone[] {
  return [...zones].sort((a, b) => ZONE_ORDER[a.zone_type] - ZONE_ORDER[b.zone_type] || a.name.localeCompare(b.name));
}
