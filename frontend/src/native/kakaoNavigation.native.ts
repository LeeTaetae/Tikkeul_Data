import { requireOptionalNativeModule } from 'expo-modules-core';
import { CAR_ICONS, type CarIconId, type NativeNavigationOptions, type NativeNavigationResult, type NativeNavigationStatus } from './navigationTypes';

interface KakaoNavigationModule {
  getStatus(): Omit<NativeNavigationStatus, 'available'>;
  openNavigation(options: NativeNavigationOptions): Promise<NativeNavigationResult>;
  // Android 빌드에만 있다(iOS 모듈과 이전 APK 에는 없다).
  getCarIcon?(): string;
  setCarIcon?(id: CarIconId): void;
  // Android/iOS hazard rail; absent in older native builds.
  setHazardRail?(json: string): void;
  clearHazardRail?(): void;
  setWeatherSafetyBanner?(text:string):void;
  addListener?(event: 'onLanguageChanged', listener: (event: { language: string }) => void): { remove(): void };
  addListener?(event: 'onGuidance', listener: (event: Record<string, unknown>) => void): { remove(): void };
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

/** 위험 레일 스냅샷(JSON)을 주행 화면 오버레이로 보낸다. 지원하지 않는 빌드이면 아무 일도 하지 않는다 */
export function setNativeHazardRail(json: string): void {
  nativeModule()?.setHazardRail?.(json);
}

export function clearNativeHazardRail(): void {
  nativeModule()?.clearHazardRail?.();
}

export function setNativeWeatherSafetyBanner(text:string|null):void {
  nativeModule()?.setWeatherSafetyBanner?.(text??'');
}

/**
 * SDK position/route events on the product channel, in Debug and Release.
 * SDK 화면이 앞에 있으면 RN 호스트가 일시정지되어 setInterval 이 멈추지만 이 이벤트는 계속 온다(실기기 로그로 확인).
 */
export function onNativeGuidanceFeed(listener: (event: Record<string, unknown>) => void): () => void {
  const subscription = nativeModule()?.addListener?.('onGuidance', listener);
  return () => subscription?.remove();
}
