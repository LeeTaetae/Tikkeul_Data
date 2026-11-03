# Android 자동차 안내 TTS 조사 및 검증 (2026-11-02)

대상: Galaxy S23 SM-S911N, Kakao Navigation UI SDK `1.12.8-hotfix05`, 브랜치 `test`.
backend, 대중교통 TTS, 기존 speakerCore 변경은 수정하지 않았다.

## 원인과 SDK 지원 범위

앱의 언어 전달 경로는 NativeNavigationScreen → kakaoNavigation.native → NavigationOptions.language → Intent.language → KNSDK.initializeWithAppKey이다.
기존 JS의 언어 완전 일치 검사는 `en-US`, `zh-CN`을 한국어로 돌릴 수 있어 기존 speechLanguageOf로 정규화했다.

SDK 초기화의 KNLanguageType과 녹음 음성 컨테이너의 KNVoiceLangType은 별개다.
설치된 SDK의 KNGuidance.setSndContainer(null) 바이트코드는 `R.raw.default_snd`를 읽고 Korean 음성 타입을 지정한다.
기본 AAR에는 `default_snd.snd`가 있으며 초기화 언어 변경만으로 영어/중국어 녹음을 선택하는 구현은 없다.
KNVoiceLangType에는 Korean, English만 존재한다. 영어는 별도 음성 데이터가 필요하며, 중국어 녹음 음성 타입은 없다.
따라서 이전 sdkLanguage/authenticatedLanguage 수정은 초기화 언어 관리에는 유효하지만 외국어 음성을 보장하지 않는다.

공식 문서:

- [KNLanguageType](https://developers.kakaomobility.com/reference/android-ui-ref-kotlin/enumerate-KNLanguageType.html)
- [KNVoiceLangType](https://developers.kakaomobility.com/reference/android-ref-kotlin/enumerate-KNVoiceLangType)
- [KNGuidance의 sndContainer](https://developers.kakaomobility.com/reference/android-ui-ref-kotlin/class-KNGuidance.html)
- [KNGuide_Voice의 안내 객체](https://developers.kakaomobility.com/reference/android-ui-ref-kotlin/class-KNGuide_Voice.html)

## 구현

- 한국어는 기존 SDK 음성을 유지한다.
- 영어/중국어는 native Activity 소유의 Android TextToSpeech로 SDK 음성 이벤트를 변환해 읽는다. SDK의 외국어 세션 한국어 녹음은 차단한다.
- Android에 대상 언어의 오프라인 음성이 없거나 언어 선택이 실패하면 안내창과 오류 로그를 남긴다. 한국어 음성으로 자동 대체하지 않는다.
- 좌/우회전, 유턴, 진입/진출, 시계 방향 회전교차로, 안전 안내, 경로 재탐색 이벤트를 변환한다. 알 수 없는 회전은 지도 확인 안내를 사용한다. 임의 거리·제한속도·도로명 번역을 만들지 않는다.
- 기존 SDK 안내 허용 조건을 먼저 적용한다. SDK의 경고음 이벤트는 유지한다.
- 주행 화면 오른쪽 언어 버튼으로 경로를 재시작하지 않고 언어를 바꾼다. 기존 SDK 소리와 TTS를 중단하고 새 언어를 선택하며, 이벤트로 i18next에도 반영한다.
- 재탐색은 Activity의 현재 언어를 유지한다. 종료 시 TTS 인스턴스를 해제한다.

제한: 이 구현은 SDK의 모든 상세 녹음 문장을 그대로 번역하지 않는다. 도로/목적지 이름, 숫자 거리/제한속도, 상세 차로 문장의 완전한 동등성은 제공하지 않는다. 실제 안내의 타이밍과 사용자 청취 검증이 남아 있다.

## Windows 빌드

기존 실패 캐시에는 `CMAKE_OBJECT_PATH_MAX=1024`만 있고 Unity 옵션은 없었다.
루트 Gradle의 react.rootproject가 앱을 먼저 평가하여 뒤쪽 앱 설정이 실제 CMake 인수에 반영되지 않았다.
앱 DSL에 직접 인수를 추가했다. Unity 기본 배치는 SVG 소스 병합 충돌을 일으켰다.
`CMAKE_UNITY_BUILD=ON`, `CMAKE_UNITY_BUILD_BATCH_SIZE=1`, `CMAKE_OBJECT_PATH_MAX=128`로 파일별 wrapper를 만들면 짧은 오브젝트 이름을 사용하면서 소스는 서로 합치지 않는다.
이 설정으로 arm64 Debug APK 빌드가 성공했다. 무시되는 android 폴더 외에 Expo config plugin에도 앱 설정을 남겼다. 기존 라이브러리 빌드 폴더 단축 설정은 유지했다.

```powershell
cd frontend/android
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME = 'C:/Users/Woori/AppData/Local/Android/Sdk'
./gradlew.bat :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
```

## 확인한 결과

- 프런트 테스트: 400/400 통과. TypeScript 검사 통과.
- Kotlin 문장 변환 실행 테스트 통과: `powershell -NoProfile -ExecutionPolicy Bypass -File frontend/scripts/test-car-voice.ps1` (기존 Gradle 캐시 사용, 의존성 추가 없음).
- Android arm64 Debug 빌드 성공. 다른 ABI와 Release는 검증하지 않았다.
- 기존 설치 APK DEX에는 sdkLanguage/authenticatedLanguage/TikkeulVoice가 없었다. 이전 수정은 기기에 미반영 상태였다.
- 기존 앱과 새 APK는 같은 com.tikkeuldata.app이지만 인증서가 달라 업데이트 설치가 거부됐다. 사용자에게 삭제 영향을 보고한 뒤 명시적 삭제 승인을 받아 기존 앱을 삭제하고 새 APK를 설치했다.
- 첫 교체 설치 성공: 2026-11-02 18:27:02 (기기 표시). 최종 보완 APK 업데이트도 성공했다.
- 최종 로컬 APK와 설치 APK의 SHA-256이 동일하다: `8b2c30c0020f613d6337f3b7fce04729b6aac05e6d6e97f718584e3cafb62590`.
- 확인 시 기기는 잠금 화면 상태이며 자동차 안내의 TikkeulVoice 로그는 아직 발생하지 않았다. 한/영/중 청취, 세션 중 전환, 재탐색 유지 검증은 미완료다. 설치/빌드 성공을 음성 검증 성공으로 간주하지 않는다.

## 실기기 확인 절차

잠금 해제 → 앱 실행 → 위치 권한 재허용 → 실제 위치에서 자동차 안내 시작.
한국어·영어·중국어 시작 안내를 각각 듣고, 오른쪽 언어 버튼으로 세션 중 전환한다.
경로 재탐색 후 같은 언어가 유지되는지 확인한다.

```powershell
adb -s 192.168.0.97:32961 logcat -v time -s TikkeulVoice ReactNativeJS AndroidRuntime
```

`build=car-tts-v1`, `stage=guidance-init`, `stage=voice-event`, `stage=tts-config valid=true`, `stage=tts-start`, `stage=tts-done`, `stage=language-change`, `stage=reroute`를 비교한다.
JS 설정 로그만으로 실제 음성이 맞다고 판단하지 않는다. 사용자의 실제 청취 결과가 필요하다.

개발 APK 인증서 SHA-1은 `5e8f16062ea3cd2c4a0d547876baa6f38cabf625`이다.
교체 후 Kakao 인증이 거부되면 해당 개발 인증서의 키 해시를 Kakao Developers Android 플랫폼에 등록해야 할 수 있다.
