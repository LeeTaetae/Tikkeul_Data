import type { NativeNavigationOptions, NativeNavigationResult, NativeNavigationStatus } from './navigationTypes';

// Browser builds never load the native module or a native application key.
export function getNativeNavigationStatus(): NativeNavigationStatus {
  return { available: false, configured: false };
}

export async function openNativeNavigation(_options: NativeNavigationOptions): Promise<NativeNavigationResult> {
  throw Object.assign(new Error('Native navigation is available in an Android/iOS development build'), { code: 'NATIVE_BUILD_REQUIRED' });
}
