# 카카오 공식 길찾기 SDK with UI 연동

Android/iOS 앱에서 자동차 `안내 시작`은 카카오 공식 SDK의 전체 안내 화면을 엽니다. 외부 카카오내비 앱을 실행하거나 WebView로 지도를 흉내 내는 방식이 아닙니다. SDK가 지도, 위치 매칭, 경로 계산, 음성 안내와 내비 UI를 담당합니다. 안내가 닫히면 앱의 홈으로 돌아옵니다.

브라우저의 F12 모바일 모드와 Expo Go에는 이 네이티브 SDK가 포함되어 있지 않습니다. 자체 개발 빌드 또는 설치형 앱이 필요합니다. 일반 웹 자동차 안내 진입 시에는 설치형 앱이 필요하다고 표시합니다. 개발용 `?test=city` 등의 URL에서만 기존 웹 시뮬레이션을 사용할 수 있습니다.

## 현재 확인 범위

- Android Kotlin 및 iOS Objective-C/Swift 연결 코드와 Expo 로컬 모듈 설정을 추가했습니다.
- SDK 배포본에서 공개 API와 좌표 변환 방식, 의존성을 확인했습니다.
- Android native prebuild와 Android/iOS 모듈 자동 연결 검색을 확인했습니다. iOS native prebuild는 Windows에서 지원되지 않아 macOS에서 진행해야 합니다.
- 앱 등록/네이티브 키가 아직 없어 SDK 인증과 실기기 안내 화면은 미검증입니다.
- 이 Windows 환경에는 JDK/Android SDK 및 Xcode가 없어 네이티브 컴파일/설치를 완료했다고 간주하면 안 됩니다.
- 네이티브 운전 경로는 카카오 SDK가 새로 계산합니다. 웹에서 검색한 경로와 일치한다고 보장하지 않습니다. 도보는 이번 공식 SDK 연결 범위에 포함하지 않습니다.
- 앱의 자체 경고 레일/가상 위험 데이터/Expo TTS는 SDK 안내와 동시에 실행하지 않습니다. 현재 네이티브 화면의 안전 운행 안내는 카카오 SDK가 제공합니다. 자체 서버의 돌발 정보 오버레이는 별도 연동 작업입니다.

## 1. 카카오디벨로퍼스 등록

[카카오디벨로퍼스](https://developers.kakao.com/)에서 앱을 만들고 네이티브 플랫폼을 등록합니다.

| 플랫폼 | 등록할 식별자 |
| --- | --- |
| Android 패키지명 | `com.tikkeuldata.app` |
| iOS 번들 ID | `com.tikkeuldata.app` |

Android는 실제 설치할 앱의 서명 키 해시도 등록해야 합니다. 로컬 debug 빌드와 EAS/배포 빌드의 서명이 다르면 각 키 해시를 모두 등록해야 합니다. 네이티브 앱 키는 JavaScript 키 또는 REST API 키와 다른 키입니다. 해당 앱의 길찾기 SDK 사용 조건/활성화 여부도 개발자 콘솔에서 확인합니다.

Android 프로젝트를 생성한 뒤 `npm run native:keyhash`로 로컬 debug 인증서의 카카오 키 해시를 확인할 수 있습니다. JDK 없이 인증서만 읽어 해시를 계산하며 개인 키를 복호화하거나 출력하지 않습니다. 이 값은 로컬 debug APK용이며 EAS/배포 서명과 자동으로 같아지는 것은 아닙니다.

참고: [Android 시작하기](https://developers.kakaomobility.com/guide/android-ui/start), [iOS 시작하기](https://developers.kakaomobility.com/guide/ios-ui/start).

## 2. 키 설정

Git에서 제외된 `frontend/.env`에 다음을 설정합니다. 키는 채팅이나 커밋에 올리지 않습니다.

```dotenv
KAKAO_NAVI_NATIVE_APP_KEY=발급받은_네이티브_앱_키
```

`EXPO_PUBLIC_` 접두사를 붙이지 않습니다. 설정 플러그인이 AndroidManifest와 iOS Info.plist에만 값을 넣으며 Expo `extra`/웹 JavaScript에 넣지 않습니다. 네이티브 앱 키는 설치 패키지에 포함되는 클라이언트 식별자이므로 카카오의 패키지·서명·번들 등록을 반드시 함께 적용합니다.

EAS를 사용한다면 같은 환경변수를 해당 EAS 빌드 환경에도 설정합니다. 키를 변경한 뒤에는 **앱을 다시 빌드**해야 합니다. Metro 새로고침만으로 적용되지 않습니다.

## 3. Android 개발 빌드

JDK 및 Android Studio/SDK를 설치한 환경에서 `frontend`를 작업 디렉터리로 사용합니다. Expo SDK 58에 맞는 JDK/Android SDK 버전을 사용합니다.

```powershell
npm run native:check
npm run native:prebuild -- --platform android
npm run native:android
```

생성된 `android` 폴더는 Git에서 제외됩니다. SDK 의존성과 Maven 저장소, 화면 및 권한 설정은 로컬 모듈/설정 플러그인에서 재생성됩니다. 등록한 키 해시는 실제 생성된 APK의 서명과 같아야 합니다.

## 4. iOS 개발 빌드

### Windows에서 실제 아이폰으로 테스트하기

1. https://developer.apple.com/account/ 에 로그인하고 Membership에서 Apple Developer Program 가입 상태를 확인합니다. 일반 Apple ID만으로는 EAS의 실제 아이폰용 서명 빌드를 만들 수 없습니다.
2. 카카오디벨로퍼스에서 같은 앱의 iOS 플랫폼을 추가하고 번들 ID `com.tikkeuldata.app`을 등록합니다. 기존 네이티브 앱 키를 사용하며 Android 키 해시는 iOS 등록에 사용하지 않습니다.
3. EAS development 환경에는 이미 네이티브 키를 Secret 변수로 등록했습니다. iOS 클라우드 빌드와 서명 설정은 별도 사용자 승인 후 진행합니다. Apple 비밀번호나 인증 코드를 채팅에 보내지 않습니다.
4. `npx eas-cli device:create`로 표시되는 등록 링크를 테스트할 아이폰의 Safari에서 열고 기기 등록을 완료합니다. Apple 계정 인증이 필요한 경우 본인이 로컬 CLI에서 진행합니다.
5. `npx eas-cli build --platform ios --profile development`를 실행하여 Apple 팀, 서명 인증서와 등록 기기를 선택합니다. 가입/결제가 필요하면 자동으로 진행하지 않습니다.
6. 완성된 설치 링크를 등록한 아이폰에서 열어 설치하고, iOS가 요구하면 설정 → 개인정보 보호 및 보안 → 개발자 모드를 켭니다.
7. PC에서 `npm run native:start -- --port 8082 --lan`을 실행하고 같은 네트워크의 아이폰 앱에서 `http://PC의_LAN_IP:8082`로 연결합니다. 목적지를 선택하고 안내 시작을 눌러 SDK 인증, 지도와 음성을 확인합니다.

2026-10-30 확인: iOS 모듈 자동 연결 및 네이티브 설정/요청 테스트 8개 통과. iOS 클라우드 빌드는 승인 검토로 실행되지 않았으며, iOS 네이티브 컴파일과 실기기 동작은 아직 검증하지 않았습니다.

macOS/Xcode/CocoaPods가 있는 환경에서 실행합니다.

```sh
npm run native:prebuild -- --platform ios
npm run native:ios
```

실제 기기 실행에는 Apple 서명 설정이 필요합니다. iOS SDK가 요구하는 위치 권한, 안내 음성 오디오 세션 및 백그라운드 모드는 플러그인/네이티브 컨트롤러에서 설정합니다. 백그라운드/전화 수신/화면 잠금 상태의 실제 기기 동작은 반드시 추가 검증해야 합니다.

## EAS 빌드

로컬 도구 없이 클라우드 빌드를 사용하는 경우 EAS 계정/프로젝트 연결 및 서명 설정 후 사용합니다. 개발용 프로필로 내부 테스트 APK를 빌드합니다. 앱 스토어에는 게시하지 않습니다.

프로젝트 루트의 `.easignore`는 앱 소스와 직접 작성한 네이티브 모듈을 포함하고, 로컬 `.env`, 생성된 Android/iOS 프로젝트, 테스트 아티팩트와 서버/릴레이 폴더는 업로드에서 제외합니다. 로컬 `.env`의 키는 자동으로 클라우드에 전달되지 않으므로, 연결된 EAS 프로젝트의 `development` 환경에 `KAKAO_NAVI_NATIVE_APP_KEY`를 별도로 설정해야 합니다. 해당 값을 로그나 채팅에 출력하지 않습니다.

먼저 Expo 계정으로 로그인합니다. 계정이 없다면 https://expo.dev/signup 에서 생성합니다.

```powershell
npx.cmd eas-cli login --browser
npx.cmd eas-cli whoami
npx.cmd eas-cli init
```

프로젝트를 연결한 뒤 Expo 대시보드의 Environment variables에서 `KAKAO_NAVI_NATIVE_APP_KEY`를 `development` 환경에 등록합니다. 휴대폰에서 앱의 검색/서버 기능까지 시험하려면 `EXPO_PUBLIC_API_BASE_URL`도 휴대폰에서 접근 가능한 백엔드 주소여야 합니다. PC의 `localhost` 주소는 휴대폰의 개발 PC를 가리키지 않습니다.

```sh
npx eas-cli build --profile development --platform android
# 또는
npx eas-cli build --profile development --platform ios
npm run native:start
```

## SDK 버전 및 검증

- Android: `com.kakaomobility.knsdk:knsdk_ui:1.12.8-hotfix05`
- iOS: `KNSDK-UI` CocoaPod `1.12.14`
- 앱은 WGS84 위·경도를 전달하고 각 네이티브 구현에서 SDK의 KATEC 변환 함수를 호출합니다.
- 공식 UI에 필요한 상태/위치/경로/안전/음성/C-ITS 델리게이트를 모두 전달합니다.
- 설정 누락, 인증 실패, 위치 권한 거부, 경로 요청 실패는 오류로 표시하며 가짜 안내 화면으로 대체하지 않습니다.

키와 실제 설치 환경을 준비한 뒤 확인할 항목: SDK 인증 → 목적지까지 실제 경로 표시 → 음성/교차로/차선 안내 → 이탈 시 재탐색 → 도착/종료 → 원래 앱 복귀 → 재진입 → 백그라운드/전화 수신/권한 변경.

### Android EAS 테스트 서명

- Expo 프로젝트: @taerori/tikkeul-data
- Android 패키지: com.tikkeuldata.app
- EAS 서명 키 해시: xySvT/bnjEHM4kUaZUbqKy4Dd1k=

카카오 Android 플랫폼에 위 해시를 기존 로컬 debug 해시와 함께 등록합니다. 서명 키를 교체하면 다시 확인해야 합니다.

### Android 클라우드 빌드 확인 (2026-10-30)

- EAS development 빌드 `1148524d-790b-4388-8237-73eb483c4177`: FINISHED.
- 카카오 모듈 Kotlin 컴파일 및 `:app:assembleDebug` 성공.
- 사용자가 위 EAS 서명 키 해시의 카카오 등록을 완료했다고 확인함.
- 네이티브 키는 EAS development 환경의 Secret 변수로 설정함.
- 휴대폰 설치, SDK 인증, 실제 지도/음성 안내는 아직 확인하지 않음.
- 개발 서버 실행: `npm run native:start -- --port 8082 --lan`.
- 휴대폰과 PC를 같은 네트워크에 연결하고 개발용 앱에서 PC의 LAN 주소로 접속함.
