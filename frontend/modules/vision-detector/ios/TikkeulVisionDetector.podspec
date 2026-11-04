Pod::Spec.new do |s|
  s.name = 'TikkeulVisionDetector'
  s.version = '0.1.0'
  s.summary = 'On-device camera + CoreML (YOLO) hazard detection for Tikkeul Data'
  s.description = 'Captures the back camera and runs an on-device CoreML YOLO model to emit hazard detections to JS.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Tikkeul Data'
  s.homepage = 'https://github.com/tikkeuldata'
  s.source = { :path => '.' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.{h,m,swift}'
  # 실측 전 임시 모델(ADR 0002) — export_yolo.py --out frontend/assets/models 의 산출물을 복사해 둔 것.
  s.resource = 'kickboard_v3.mlpackage'
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
