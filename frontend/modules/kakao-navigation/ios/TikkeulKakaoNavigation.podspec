Pod::Spec.new do |s|
  s.name = 'TikkeulKakaoNavigation'
  s.version = '0.1.0'
  s.summary = 'Kakao navigation UI inside the Tikkeul Data application'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Tikkeul Data'
  s.homepage = 'https://developers.kakaomobility.com/product/navisdk.html'
  s.source = { :path => '.' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.{h,m,swift}'
  s.public_header_files = 'KakaoNavigationController.h'
  s.dependency 'ExpoModulesCore'
  s.dependency 'KNSDK-UI', '1.12.14'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
