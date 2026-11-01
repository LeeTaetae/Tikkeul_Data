export interface NativeNavigationOptions {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  destinationLabel: string;
  routeStyle: 'recommended' | 'shortest' | 'major_road' | 'toll_free' | 'avoid_school_zone';
  /** 네이티브 주행 화면의 아이콘 선택 문구 언어. 없으면 한국어 */
  language?: 'ko' | 'en' | 'zh';
}

// 네이티브 주행 화면의 차량 마커. default 는 카카오 SDK 기본 마커 그대로다.
export const CAR_ICONS = ['default', 'taxi', 'sports', 'character'] as const;
export type CarIconId = (typeof CAR_ICONS)[number];

export interface NativeNavigationStatus {
  available: boolean;
  configured: boolean;
  sdkVersion?: string;
  platform?: string;
}

export interface NativeNavigationResult { status: 'closed' }
