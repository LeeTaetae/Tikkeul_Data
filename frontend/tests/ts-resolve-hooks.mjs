// 테스트 전용 모듈 해석 훅: 앱 코드의 확장자 없는 상대 import('./speechLocale')를 Node 가 .ts 파일로 찾게 한다.
// 앱은 Metro/TypeScript 가 확장자 없는 import 를 해석하지만 Node 는 못 한다. 앱 설정(tsconfig)은 바꾸지 않는다.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
