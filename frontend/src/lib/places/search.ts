import { API_BASE_URL } from '../config';
import type { RoutePoint } from '../../map/types';

export interface PlaceSearchResult {
  name: string;
  address: string;
  point: RoutePoint;
}

export async function searchPlaces(query: string, near?: RoutePoint, lang?: string): Promise<PlaceSearchResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({ query });
  if (lang) {
    params.set('lang', lang);
  }
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lng', String(near.lng));
  }
  const res = await fetch(`${API_BASE_URL}/places/search?${params.toString()}`);
  if (!res.ok) throw new Error(`place search failed: ${res.status}`);
  const data: { places: { name: string; address: string; lat: number; lng: number }[] } = await res.json();
  return data.places.map((p) => ({ name: p.name, address: p.address, point: { lat: p.lat, lng: p.lng } }));
}
