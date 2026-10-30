import type { GuidanceRequest } from './guidanceSession';
import type { NativeNavigationOptions } from '../../native/navigationTypes';

const STYLES = new Set(['recommended', 'shortest', 'major_road', 'toll_free', 'avoid_school_zone']);

export function nativeNavigationRequest(request: GuidanceRequest): NativeNavigationOptions {
  if (request.mode !== 'driving') throw Object.assign(new Error('Native Kakao navigation supports driving'), { code: 'UNSUPPORTED_MODE' });
  for (const point of [request.origin, request.destination]) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw Object.assign(new Error('Invalid navigation coordinates'), { code: 'INVALID_REQUEST' });
    }
  }
  if (!STYLES.has(request.style)) throw Object.assign(new Error('Unsupported route preference'), { code: 'INVALID_REQUEST' });
  return {
    originLatitude: request.origin.lat,
    originLongitude: request.origin.lng,
    destinationLatitude: request.destination.lat,
    destinationLongitude: request.destination.lng,
    destinationLabel: request.destinationLabel.trim().slice(0, 256),
    routeStyle: request.style,
  };
}
