// 브라우저 빌드에는 카카오 로그인 네이티브 모듈이 없다.
export function isKakaoLoginAvailable(): boolean {
  return false;
}

export async function loginWithKakaoNative(): Promise<string> {
  throw Object.assign(new Error('Native Kakao login is available in an Android/iOS development build'), { code: 'NATIVE_BUILD_REQUIRED' });
}
