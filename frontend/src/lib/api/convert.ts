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
// school_zone 은 incidentToAlert 가 만들지 않지만(ALERT_TYPE 에 없음), AlertType 전체를 키로 받는 타입이라 채워 둔다.
const BADGE_BY_TYPE: Record<AlertType, AlertSeverity> = { accident: 'danger', construction: 'caution', congestion: 'busy', school_zone: 'caution' };

const ORDER: Record<AlertType, number> = { accident: 0, congestion: 1, construction: 2, school_zone: 3 };

export function incidentToAlert(incident: Incident, fallbackLocation: string): RoadAlert | null {
  const type = ALERT_TYPE[incident.kind];
  if (!type) return null;

  const parts = [incident.message.trim(), incident.lanes_blocked.trim()].filter(Boolean);
  const description = parts.length > 0 ? parts.join(' · ') : incident.event_detail_type.trim();

  const alert: RoadAlert = {
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
  // 아래는 백엔드가 준 값만 옮긴다. 이전 응답(필드 없음)은 결과가 기존과 똑같도록 키를 만들지 않는다.
  // revision 은 일부러 옮기지 않는다: 백엔드 revision 은 종료 시각 연장 같은 사소한 변경에도 바뀌어 같은 위험을 반복 경고하게 만든다.
  if (incident.event_key) alert.eventKey = incident.event_key;
  if (incident.ended_at) alert.endedAt = incident.ended_at;
  if (incident.closure) alert.closure = incident.closure;
  if (incident.direction_scope) alert.directionScope = incident.direction_scope;
  return alert;
}

/** 사고 → 정체 → 공사 순, 같은 유형 안에서는 최근 발생 순. 지원하지 않는 유형은 뺀다. */
export function incidentsToAlerts(incidents: Incident[], fallbackLocation: string): RoadAlert[] {
  return incidents
    .map((i) => incidentToAlert(i, fallbackLocation))
    .filter((a): a is RoadAlert => a !== null)
    .sort((a, b) => ORDER[a.type] - ORDER[b.type] || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/**
 * 어린이보호구역(zone_type: 'child') → 경로 매칭용 RoadAlert.
 * 좌표(center)가 없는 구역은 경로에 매칭할 수 없어 뺀다. 방향이 없는 구역 전체 위험이라 omnidirectional 로 표시한다.
 */
export function protectionZoneToAlert(zone: ProtectionZone): RoadAlert | null {
  if (zone.zone_type !== 'child' || !zone.center) return null;
  return {
    id: zone.id,
    type: 'school_zone',
    severity: 'caution',
    location: zone.road_address || zone.lot_address || zone.name,
    description: zone.name,
    updatedAt: '',
    latitude: zone.center.lat,
    longitude: zone.center.lon,
    omnidirectional: true,
    // headingDeg, translations 는 일부러 넣지 않는다. 방향이 없는 구역 위험이고, 번역은 공공 API 가 주지 않는다.
  };
}

export function childProtectionZonesToAlerts(zones: ProtectionZone[]): RoadAlert[] {
  return zones.map(protectionZoneToAlert).filter((a): a is RoadAlert => a !== null);
}

export function sortCautionZones(zones: CautionZone[]): CautionZone[] {
  // priority 숫자가 작은 것부터. 값이 없으면 뒤로.
  return [...zones].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id));
}

const ZONE_ORDER = { child: 0, senior: 1, disabled: 2, unknown: 3 } as const;

export function sortProtectionZones(zones: ProtectionZone[]): ProtectionZone[] {
  return [...zones].sort((a, b) => ZONE_ORDER[a.zone_type] - ZONE_ORDER[b.zone_type] || a.name.localeCompare(b.name));
}
