export interface NativeNavigationOptions {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  destinationLabel: string;
  routeStyle: 'recommended' | 'shortest' | 'major_road' | 'toll_free' | 'avoid_school_zone';
}

export interface NativeNavigationStatus {
  available: boolean;
  configured: boolean;
  sdkVersion?: string;
  platform?: string;
}

export interface NativeNavigationResult { status: 'closed' }
