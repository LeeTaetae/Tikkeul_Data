// 웹 빌드. expo-speech-recognition 의 웹 구현(.web.js)은 네이티브 모듈을 찾지 않고 브라우저 Web Speech API 를
// 감싸므로 안전하게 그대로 쓴다. 네이티브 빌드는 같은 이름의 speechRecognition.native.ts 가 대신 쓰인다 -
// 이쪽을 import 하면 안 되는 이유는 그 파일 주석 참고.
export { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
