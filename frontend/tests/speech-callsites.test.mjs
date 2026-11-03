// 음성 재생이 한 곳(speaker)을 거치는지 소스로 확인한다. React Native 화면·훅은 Node 로 실행할 수 없어서 소스를 읽어 확인한다.
// 목적: 화면·훅이 Speech.speak 를 직접 부르거나 언어 매핑('ko-KR' 하드코딩)을 따로 두면, 언어 변경 시 예약 취소와 음성 선택이 우회된다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'app'))].map((file) => ({ file: path.relative(ROOT, file).replace(/\\/g, '/'), text: fs.readFileSync(file, 'utf8') }));
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test("expo-speech 는 speaker.ts 한 곳에서만 불러온다 (음성 인식 expo-speech-recognition 은 별개)", () => {
  const users = files.filter(({ text }) => /from 'expo-speech'/.test(code(text))).map(({ file }) => file);
  assert.deepEqual(users, ['src/lib/speech/speaker.ts']);
});

test('화면·훅은 Speech.speak / Speech.stop 을 직접 부르지 않는다', () => {
  for (const { file, text } of files) {
    if (file === 'src/lib/speech/speaker.ts') continue;
    assert.equal(/\bSpeech\.(speak|stop)\(/.test(code(text)), false, file);
  }
});

test("TTS locale('ko-KR'/'en-US'/'zh-CN')은 speechLocale.ts 의 한 표에만 있다", () => {
  for (const { file, text } of files) {
    if (file === 'src/lib/speech/speechLocale.ts' || file.startsWith('src/i18n/') || file.startsWith('src/dev/')) continue;
    assert.equal(/'(ko-KR|en-US|zh-CN)'/.test(code(text)), false, `${file} 에 TTS locale 이 하드코딩돼 있다`);
  }
});

test('음성을 읽는 곳(훅·화면·경고·챗봇)은 모두 speaker 를 쓴다', () => {
  for (const file of [
    'src/lib/useAnnounceOnApproach.ts',
    'src/screens/TransitGuidanceScreen.tsx',
    'src/components/alerts/NavigationHazardAlert.tsx',
    'src/lib/chat/useChatAssistant.ts',
  ]) {
    const entry = files.find((f) => f.file === file);
    assert.match(entry.text, /speaker\.speak\(/, file);
  }
});

test('턴 안내 훅 호출부 세 곳(자동차·자전거·홈)은 구조화된 안내 지점(guides)을 넘긴다', () => {
  for (const file of ['app/navigation.tsx', 'src/screens/CyclingGuidanceScreen.tsx', 'app/index.tsx']) {
    const entry = files.find((f) => f.file === file);
    const call = entry.text.slice(entry.text.indexOf('useTurnInstructionSpeech({'));
    assert.match(call.slice(0, 600), /guides:/, file);
  }
});
