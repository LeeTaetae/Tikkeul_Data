import { requireOptionalNativeModule } from 'expo-modules-core';
import { CAR_ICONS, type CarIconId, type NativeNavigationOptions, type NativeNavigationResult, type NativeNavigationStatus } from './navigationTypes';

interface KakaoNavigationModule {
  getStatus(): Omit<NativeNavigationStatus, 'available'>;
  openNavigation(options: NativeNavigationOptions): Promise<NativeNavigationResult>;
  // Android 빌드에만 있다(iOS 모듈과 이전 APK 에는 없다).
  getCarIcon?(): string;
  setCarIcon?(id: CarIconId): void;
  addListener?(event: 'onLanguageChanged', listener: (event: { language: string }) => void): { remove(): void };
}

export function onNativeNavigationLanguageChanged(listener: (language: string) => void): () => void {
  const module = nativeModule();
  if (module?.getStatus().platform !== 'android') return () => {};
  const subscription = module.addListener?.('onLanguageChanged', event => listener(event.language));
  return () => subscription?.remove();
}

const nativeModule = () => requireOptionalNativeModule<KakaoNavigationModule>('KakaoNavigation');

export function getNativeNavigationStatus(): NativeNavigationStatus {
  const module = nativeModule();
  return module ? { ...module.getStatus(), available: true } : { available: false, configured: false };
}

/** 이 빌드가 주행 아이콘 변경을 지원하면 저장된 값, 아니면 null(메뉴를 숨긴다) */
export function getCarIcon(): CarIconId | null {
  const value = nativeModule()?.getCarIcon?.();
  if (value === undefined) return null;
  return (CAR_ICONS as readonly string[]).includes(value) ? (value as CarIconId) : 'default';
}

export function setCarIcon(id: CarIconId): void {
  nativeModule()?.setCarIcon?.(id);
}

export async function openNativeNavigation(options: NativeNavigationOptions): Promise<NativeNavigationResult> {
  const module = nativeModule();
  if (!module) throw Object.assign(new Error('The Kakao navigation module is not in this build'), { code: 'NATIVE_BUILD_REQUIRED' });
  if (!module.getStatus().configured) throw Object.assign(new Error('Native application key is not configured'), { code: 'NOT_CONFIGURED' });
  return module.openNavigation(options);
}
