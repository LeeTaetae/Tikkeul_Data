import { requireOptionalNativeModule } from 'expo-modules-core';

interface KakaoLoginModule {
  getStatus(): { configured: boolean };
  login(): Promise<{ accessToken: string }>;
}

const nativeModule = () => requireOptionalNativeModule<KakaoLoginModule>('KakaoLogin');

/** 이 빌드에 카카오 로그인 네이티브 모듈이 들어있는지(구 빌드/네이티브 재빌드 전이면 없다) */
export function isKakaoLoginAvailable(): boolean {
  return nativeModule()?.getStatus().configured ?? false;
}

export async function loginWithKakaoNative(): Promise<string> {
  const module = nativeModule();
  if (!module) throw Object.assign(new Error('The Kakao login module is not in this build'), { code: 'NATIVE_BUILD_REQUIRED' });
  if (!module.getStatus().configured) throw Object.assign(new Error('Native application key is not configured'), { code: 'NOT_CONFIGURED' });
  const { accessToken } = await module.login();
  return accessToken;
}
