Pod::Spec.new do |s|
  s.name = 'TikkeulKakaoLogin'
  s.version = '0.1.0'
  s.summary = 'Native Kakao login for the Tikkeul Data application'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Tikkeul Data'
  s.homepage = 'https://developers.kakao.com/docs/latest/en/kakaologin/ios'
  s.source = { :path => '.' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.{h,m,swift}'
  s.dependency 'ExpoModulesCore'
  # shortcut: Kakao ended CocoaPods support for the iOS SDK at 2.23.0 (2024-10-14; SPM only since).
  # Pinned to the last CocoaPods-compatible release (2.22.7) so it installs through this project's existing
  # Podfile-based build. Upgrade path: migrate to SPM, which needs Xcode project changes beyond what
  # expo config-plugins can do (not attempted here) — revisit once that migration is planned.
  s.dependency 'KakaoSDKAuth', '2.22.7'
  s.dependency 'KakaoSDKUser', '2.22.7'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
