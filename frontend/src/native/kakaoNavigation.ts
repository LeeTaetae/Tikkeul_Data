import type { CarIconId, NativeNavigationOptions, NativeNavigationResult, NativeNavigationStatus } from './navigationTypes';

// Browser builds never load the native module or a native application key.
export function getNativeNavigationStatus(): NativeNavigationStatus {
  return { available: false, configured: false };
}

// 브라우저에는 네이티브 주행 화면이 없어 아이콘 설정도 없다.
export function getCarIcon(): CarIconId | null {
  return null;
}

export function setCarIcon(_id: CarIconId): void {}

export async function openNativeNavigation(_options: NativeNavigationOptions): Promise<NativeNavigationResult> {
  throw Object.assign(new Error('Native navigation is available in an Android/iOS development build'), { code: 'NATIVE_BUILD_REQUIRED' });
}
