// 백엔드(FastAPI) 응답 스키마. backend/app/models.py 와 /openapi.json 에서 확인한 필드만 둔다.
// 필드명은 백엔드 그대로(snake_case)이며, 화면용 타입(RoadAlert 등)으로의 변환은 lib/api/convert.ts 가 맡는다.

export type DataKind = 'realtime' | 'forecast' | 'registry';

export interface Meta {
  source: string;
  data_kind: DataKind;
  /** 공공 API 가 준 기준 시각. 없으면 null (돌발·주의운전·보호구역은 기준 시각이 없다) */
  updated_at: string | null;
  /** 서버가 공공 API 에서 받아온 시각 */
  fetched_at: string;
  /** 공공 API 호출이 실패해 마지막 성공 결과를 대신 준 경우 true */
  stale: boolean;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface ListResponse<T> {
  meta: Meta;
  items: T[];
}

// --- 돌발상황 ---
export type IncidentKind = 'accident' | 'construction' | 'congestion' | 'weather' | 'disaster' | 'other';

export interface Incident {
  id: string;
  kind: IncidentKind;
  road_type: string;
  event_type: string;
  event_detail_type: string;
  road_name: string;
  road_no: string;
  /** ITS 원문 도로 방향. 방위각이 아닌 자유 문자열이라 진행 방향 판정에 쓸 수 없다 */
  direction_text: string;
  lanes_blocked: string;
  message: string;
  link_id: string;
  location: GeoPoint;
  started_at: string | null;
  ended_at: string | null;
}

// --- 주의운전구간 ---
export type CautionKind =
  | 'accident_prone'
  | 'congestion'
  | 'lane_blocked'
  | 'tunnel_glare'
  | 'work'
  | 'rest_area'
  | 'other';

export interface CautionPoint {
  location: GeoPoint;
  link_id: string;
  route_no: string;
  route_name: string;
  direction_text: string;
}

export interface CautionZone {
  id: string;
  kind: CautionKind;
  outbrk_type: string;
  message: string;
  priority: number | null;
  step_type: string;
  start: CautionPoint;
  notice: CautionPoint | null;
}

// --- 보호구역 ---
export type ZoneType = 'child' | 'senior' | 'disabled' | 'unknown';

export interface ProtectionZone {
  id: string;
  name: string;
  zone_type: ZoneType;
  facility_detail_code: string;
  parent_id: string;
  in_use: boolean;
  sgg_code: string;
  emdong_code: string;
  std_code: string;
  /** priority(우선지정대상) / designated(지정대상) / unknown */
  assignment: string;
  road_address: string;
  road_address_detail: string;
  lot_address: string;
  lot_address_detail: string;
  registered_on: string | null;
  center: GeoPoint | null;
  /** GeoJSON(WGS84). include_geometry=true 일 때만 들어 있다 */
  geometry: Record<string, unknown> | null;
}

// --- 교통소통 ---
export interface TrafficFlowItem {
  link_id: string;
  road_name: string;
  speed_kmh: number | null;
  travel_time_s: number | null;
  start_node_id: string;
  end_node_id: string;
  observed_at: string | null;
}

export interface TrafficFlowResponse extends ListResponse<TrafficFlowItem> {
  /** ITS 소통정보는 링크 좌표를 주지 않는다 */
  geometry_available: boolean;
}

// --- 교통예측 ---
export interface PredictionItem {
  link_id: string;
  section_id: string;
  section_type: string;
  detour_id: string;
  length: number | null;
  speed_kmh: number | null;
}

export interface PredictionsResponse extends ListResponse<PredictionItem> {
  forecast_for: string;
}

export type IncidentsResponse = ListResponse<Incident>;
export type CautionZonesResponse = ListResponse<CautionZone>;
export type ProtectionZonesResponse = ListResponse<ProtectionZone>;

/** 백엔드 오류 응답 본문 */
export interface ApiErrorBody {
  error: { code: string; message: string };
}
