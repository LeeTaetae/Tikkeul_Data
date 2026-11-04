import { createApiClient, type RequestOptions } from '../api/client';
import { API_BASE_URL } from '../config';

const client = createApiClient({ baseUrl: API_BASE_URL });

export interface TripCreateInput {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number; label: string; address_text?: string };
}

export interface RecentDestination {
  label: string;
  lat: number;
  lon: number;
  address_text: string;
  last_used_at: string;
}

export interface FrequentDestination extends RecentDestination {
  visit_count: number;
}

export const tripsApi = {
  create: (body: TripCreateInput, token: string, options?: RequestOptions) =>
    client.post<{ id: number }>('/api/trips', body, { ...options, token }),
  recent: (token: string, params: { days?: number; limit?: number; lang?: string } = {}, options?: RequestOptions) =>
    client.get<RecentDestination[]>('/api/trips/recent', params, { ...options, token }),
  frequent: (token: string, params: { days?: number; limit?: number; lang?: string } = {}, options?: RequestOptions) =>
    client.get<FrequentDestination[]>('/api/trips/frequent', params, { ...options, token }),
  // 로그인 없이도 쓴다 - 전체 유저 집계(누가 갔는지는 안 드러남). 홈 화면 기본 패널용.
  popular: (params: { lat: number; lng: number; radius_km?: number; limit?: number; lang?: string }, options?: RequestOptions) =>
    client.get<FrequentDestination[]>('/api/trips/popular', params, options),
  // 내 이동 기록(최근/자주 간 곳 집계용 원본)을 전부 지운다.
  clear: (token: string, options?: RequestOptions) => client.del<void>('/api/trips', { ...options, token }),
};
