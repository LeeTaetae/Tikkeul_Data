import { createApiClient, type RequestOptions } from '../api/client';
import { API_BASE_URL } from '../config';

const client = createApiClient({ baseUrl: API_BASE_URL });

export type FavoriteKind = 'home' | 'work' | 'custom';

export interface FavoritePlace {
  id: number;
  kind: FavoriteKind;
  label: string;
  lat: number;
  lon: number;
  address_text: string;
  category: string | null;
}

export interface FavoritePlaceInput {
  kind: FavoriteKind;
  label: string;
  lat: number;
  lon: number;
  address_text?: string;
  category?: string | null;
}

export const favoritesApi = {
  list: (token: string, options?: RequestOptions) => client.get<FavoritePlace[]>('/api/favorites', {}, { ...options, token }),
  create: (body: FavoritePlaceInput, token: string, options?: RequestOptions) =>
    client.post<FavoritePlace>('/api/favorites', body, { ...options, token }),
  update: (id: number, body: Partial<FavoritePlaceInput>, token: string, options?: RequestOptions) =>
    client.patch<FavoritePlace>(`/api/favorites/${id}`, body, { ...options, token }),
  remove: (id: number, token: string, options?: RequestOptions) =>
    client.del<void>(`/api/favorites/${id}`, { ...options, token }),
};
