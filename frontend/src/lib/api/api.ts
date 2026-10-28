import type {
  CautionZonesResponse,
  IncidentsResponse,
  PredictionsResponse,
  ProtectionZonesResponse,
  TrafficFlowResponse,
} from '../../types/traffic';
import type { Region } from '../../types/geo';
import { API_BASE_URL } from '../config';
import type { BBox } from '../location/geo';
import { createApiClient, type RequestOptions } from './client';

const client = createApiClient({ baseUrl: API_BASE_URL });

const bboxParams = (b: BBox) => ({ min_lon: b.minLon, max_lon: b.maxLon, min_lat: b.minLat, max_lat: b.maxLat });

/** 좌표 → 시군구(보호구역 조회용 sgg_cd). 좌표는 소수 3자리로 반올림해서 보낸다(regionQueryFor). */
export const geoApi = {
  region: (lat: number, lon: number, options?: RequestOptions) =>
    client.get<Region>('/api/geo/region', { lat, lon }, options),
};

// 백엔드 /api/traffic/* 5종. 요청 영역 크기 제한(돌발·주의운전 0.3도, 소통 0.05도)은 백엔드가 검증한다.
export const trafficApi = {
  incidents: (bbox: BBox, options?: RequestOptions) =>
    client.get<IncidentsResponse>('/api/traffic/incidents', bboxParams(bbox), options),

  cautionZones: (bbox: BBox, options?: RequestOptions) =>
    client.get<CautionZonesResponse>('/api/traffic/caution-zones', bboxParams(bbox), options),

  protectionZones: (sggCd: string, options?: RequestOptions & { includeGeometry?: boolean }) =>
    client.get<ProtectionZonesResponse>(
      '/api/traffic/protection-zones',
      { sgg_cd: sggCd, include_geometry: options?.includeGeometry },
      options,
    ),

  flow: (bbox: BBox, options?: RequestOptions) =>
    client.get<TrafficFlowResponse>('/api/traffic/flow', bboxParams(bbox), options),

  predictions: (params: { sectionId: string; routeNo: string; forecastFor?: string }, options?: RequestOptions) =>
    client.get<PredictionsResponse>(
      '/api/traffic/predictions',
      { section_id: params.sectionId, route_no: params.routeNo, forecast_for: params.forecastFor },
      options,
    ),
};
