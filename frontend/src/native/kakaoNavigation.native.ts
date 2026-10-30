import { requireOptionalNativeModule } from 'expo-modules-core';
import type { NativeNavigationOptions, NativeNavigationResult, NativeNavigationStatus } from './navigationTypes';

interface KakaoNavigationModule {
  getStatus(): Omit<NativeNavigationStatus, 'available'>;
  openNavigation(options: NativeNavigationOptions): Promise<NativeNavigationResult>;
}

const nativeModule = () => requireOptionalNativeModule<KakaoNavigationModule>('KakaoNavigation');

export function getNativeNavigationStatus(): NativeNavigationStatus {
  const module = nativeModule();
  return module ? { ...module.getStatus(), available: true } : { available: false, configured: false };
}

export async function openNativeNavigation(options: NativeNavigationOptions): Promise<NativeNavigationResult> {
  const module = nativeModule();
  if (!module) throw Object.assign(new Error('The Kakao navigation module is not in this build'), { code: 'NATIVE_BUILD_REQUIRED' });
  if (!module.getStatus().configured) throw Object.assign(new Error('Native application key is not configured'), { code: 'NOT_CONFIGURED' });
  return module.openNavigation(options);
}
