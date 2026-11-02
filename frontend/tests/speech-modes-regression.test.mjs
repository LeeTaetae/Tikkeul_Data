// 실기기에서 발견된 문제의 회귀 테스트: 자동차 영어가 한국어 음성으로 나오고, 대중교통 중국어가 무음이던 문제.
//
// 원인(소스로 확인)
//  1) expo-speech 안드로이드 구현은 Locale.Builder().setLanguage(language) 를 쓴다. 'en-US'·'zh-CN' 처럼 지역이 붙은 값은 형식 오류라
//     기기 기본 언어(한국어)로 떨어지고, 그 뒤 voice 설정이 실패하면(설치되지 않은 네트워크 음성 등) 한국어 음성이 남는다.
//     한국어 음성은 영어 문장을 한국어 음성으로 읽고, 중국어 문장은 읽지 못해 무음이 된다.
//  2) 안드로이드의 자동차 길안내는 JS 화면이 아니라 카카오 내비 SDK 네이티브 화면이다. SDK 음성은 SDK 가 내고, SDK 를 KNLanguageType_KOREAN 으로 고정 초기화하고 있었다.
//
// 이 테스트는 가짜 엔진으로 "엔진에 무엇을 넘기는가"를 확인한다. 실제 안드로이드 음성 출력은 검증하지 못한다(실기기 절차는 보고서 참고).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import i18next from 'i18next';

import ko from '../src/i18n/locales/ko.ts';
import en from '../src/i18n/locales/en.ts';
import zh from '../src/i18n/locales/zh.ts';
import { createSpeaker } from '../src/lib/speech/speakerCore.ts';
import { pickVoice } from '../src/lib/speech/speechLocale.ts';
import { instructionSpeech, transitActionSpeech } from '../src/lib/speech/speechText.ts';

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function translator(lng) {
  const instance = i18next.createInstance();
  await instance.init({ lng, fallbackLng: 'ko', resources: { ko: { translation: ko }, en: { translation: en }, zh: { translation: zh } }, interpolation: { escapeValue: false } });
  return (key, params) => instance.t(key, params);
}
const T = { ko: await translator('ko'), en: await translator('en'), zh: await translator('zh') };

const voice = (language, name, quality = 'Default') => ({ identifier: name, name, language, quality });
// 실제 구글 TTS 처럼 같은 언어에 로컬 음성과 네트워크 음성이 함께 있다 (네트워크가 더 '고음질'로 보고된다)
const DEVICE_VOICES = [
  voice('ko-KR', 'ko-kr-x-ism-local'),
  voice('en-US', 'en-us-x-tpd-network', 'Enhanced'),
  voice('en-US', 'en-us-x-tpf-local', 'Enhanced'),
  voice('zh-CN', 'cmn-cn-x-ccc-network', 'Enhanced'),
  voice('cmn-CN', 'cmn-cn-x-ccc-local', 'Enhanced'),
  voice('zh-TW', 'cmn-tw-x-ctc-local'),
];

/** 안드로이드를 흉내 낸 엔진. 호출 순서(stop/speak)와 엔진에 넘긴 값을 기록한다. */
function androidDevice({ voices = DEVICE_VOICES, failVoiceOnSpeak = false } = {}) {
  const log = [];
  const events = [];
  const engine = {
    speak: (text, options) => {
      log.push({ call: 'speak', text, language: options.language, voice: options.voice });
      if (failVoiceOnSpeak && options.voice) setTimeout(() => options.onError?.(new Error('voice not installed')), 0);
      else setTimeout(() => options.onStart?.(), 0);
    },
    // 실제 엔진처럼 stop 은 비동기로 늦게 끝난다: 기다리지 않고 speak 하면 speak 가 먼저 기록된다
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      log.push({ call: 'stop' });
    },
    getAvailableVoicesAsync: async () => voices,
  };
  const speaker = createSpeaker({ engine, platform: 'android', onEvent: (event) => events.push(event) });
  return { speaker, log, events };
}
const speaks = (log) => log.filter((entry) => entry.call === 'speak');
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

// ───────────────────────── 음성 선택 ─────────────────────────

test('같은 언어에 로컬 음성과 네트워크 음성이 있으면 로컬 음성을 고른다 (설치되지 않은 네트워크 음성은 설정이 실패해 한국어로 떨어진다)', () => {
  assert.equal(pickVoice(DEVICE_VOICES, 'en').identifier, 'en-us-x-tpf-local');
  assert.equal(pickVoice(DEVICE_VOICES, 'zh').identifier, 'cmn-cn-x-ccc-local');
  assert.equal(pickVoice(DEVICE_VOICES, 'ko').identifier, 'ko-kr-x-ism-local');
  assert.equal(pickVoice([voice('en-US', 'en-us-x-tpd-network')], 'en').identifier, 'en-us-x-tpd-network'); // 다른 선택지가 없으면 쓴다
  assert.equal(pickVoice([voice('en-GB', 'en-gb-x-rjs-local'), voice('en-US', 'en-us-x-tpd-network')], 'en').identifier, 'en-gb-x-rjs-local'); // 로컬이면 다른 지역 영어가 네트워크 en-US 보다 낫다
});

// ───────────────────────── 자동차 (JS 화면: 웹·개발 미리보기. 안드로이드 실기기의 자동차는 카카오 SDK) ─────────────────────────

const GUIDES = [
  { index: 0, lat: 37.5, lng: 127.0, pathIndex: 0, turnType: 13, pointType: 'N', description: '교차로에서 우회전 후 158m 이동', name: '', nextRoadName: '느티나무1길' },
  { index: 1, lat: 37.501, lng: 127.0, pathIndex: 1, turnType: 12, pointType: 'N', description: '좌회전 후 이동', name: '', nextRoadName: '' },
];
const carInstruction = (i) => ({ text: GUIDES[i].description, point: { lat: GUIDES[i].lat, lng: GUIDES[i].lng } });

test('자동차 영어: 영어 문장을 en 언어와 영어 로컬 음성으로 요청한다 (한국어 문장도, language 누락도 아니다)', async () => {
  const { speaker, log, events } = androidDevice();
  await speaker.changeLanguage('en');
  const text = instructionSpeech(carInstruction(0), GUIDES, 80, 'en', T.en);
  assert.equal(text, 'In 80 meters, turn right.');
  assert.equal(await speaker.speak(text, 'en', { source: 'car' }), 'spoken');
  assert.deepEqual(speaks(log), [{ call: 'speak', text: 'In 80 meters, turn right.', language: 'en', voice: 'en-us-x-tpf-local' }]);
  const request = events.find((e) => e.stage === 'request');
  const speak = events.find((e) => e.stage === 'speak');
  assert.deepEqual([request.navigationMode, request.appLanguage, request.ttsLanguage, request.text], ['car', 'en', 'en-US', 'In 80 meters, turn right.']);
  assert.deepEqual([speak.speakCalled, speak.engineLanguage, speak.voice], [true, 'en', 'en-us-x-tpf-local']);
});

test('자동차 중국어: 중국어 문장을 zh 와 중국어 로컬 음성으로 요청한다 (기존 정상 동작 유지)', async () => {
  const { speaker, log } = androidDevice();
  await speaker.changeLanguage('zh');
  const text = instructionSpeech(carInstruction(1), GUIDES, 50, 'zh', T.zh);
  assert.equal(text, '前方50米，左转。');
  await speaker.speak(text, 'zh', { source: 'car' });
  assert.deepEqual(speaks(log), [{ call: 'speak', text: '前方50米，左转。', language: 'zh', voice: 'cmn-cn-x-ccc-local' }]);
});

test('자동차 한국어: Tmap 원문을 ko 와 한국어 음성으로 읽는다', async () => {
  const { speaker, log } = androidDevice();
  await speaker.changeLanguage('ko');
  const text = instructionSpeech(carInstruction(0), GUIDES, 80, 'ko', T.ko);
  await speaker.speak(text, 'ko', { source: 'car' });
  assert.deepEqual(speaks(log), [{ call: 'speak', text: '교차로에서 우회전 후 158m 이동', language: 'ko', voice: 'ko-kr-x-ism-local' }]);
});

// ───────────────────────── 대중교통 ─────────────────────────

const leg = (over = {}) => ({ kind: 'bus', source: 'step', transfer: false, fromName: '강남역', toName: '서초역', lineName: '3200', stopCount: null, ...over });

test('대중교통 중국어: 안내 이벤트가 중국어 문장으로 만들어지고, 끊은 뒤에 zh 언어와 중국어 음성으로 speak 가 호출된다', async () => {
  const { speaker, log, events } = androidDevice();
  await speaker.changeLanguage('zh');
  const text = transitActionSpeech('board', leg(), 'zh', T.zh);
  assert.equal(text, '请在屏幕上显示的站点乘坐3200路公交车。');
  assert.equal(await speaker.speak(text, 'zh', { interrupt: true, source: 'transit' }), 'spoken');
  // 끊는 호출(stop)이 먼저 끝난 뒤 speak: 끊기 전에 음성 설정을 받으면 그 설정이 끊김과 함께 사라질 수 있다
  assert.deepEqual(log.map((entry) => entry.call), ['stop', 'speak']);
  assert.deepEqual(speaks(log), [{ call: 'speak', text, language: 'zh', voice: 'cmn-cn-x-ccc-local' }]);
  const speak = events.find((e) => e.stage === 'speak');
  assert.deepEqual([speak.navigationMode, speak.appLanguage, speak.ttsLanguage, speak.speakCalled], ['transit', 'zh', 'zh-CN', true]);
  assert.equal(HANGUL.test(text), false);
});

test('대중교통 영어·한국어', async () => {
  const { speaker, log } = androidDevice();
  await speaker.changeLanguage('en');
  const english = transitActionSpeech('ride', leg({ kind: 'subway', lineName: '2호선', stopCount: 3 }), 'en', T.en);
  assert.equal(english, 'In 3 stops, get off at the station shown on the screen.');
  await speaker.speak(english, 'en', { interrupt: true, source: 'transit' });
  await speaker.changeLanguage('ko');
  await speaker.speak('3개 정류장 뒤에 서초역에서 내리세요.', 'ko', { interrupt: true, source: 'transit' });
  assert.deepEqual(speaks(log).map((e) => [e.language, e.voice]), [['en', 'en-us-x-tpf-local'], ['ko', 'ko-kr-x-ism-local']]);
});

test('대중교통 안내가 연달아 오면 새 안내가 이전 안내를 끊고, 끊긴 안내는 다시 읽지 않는다 (중복 방지)', async () => {
  const { speaker, log } = androidDevice();
  await speaker.changeLanguage('zh');
  await speaker.speak('第一条', 'zh', { interrupt: true, source: 'transit' });
  await speaker.speak('第二条', 'zh', { interrupt: true, source: 'transit' });
  assert.deepEqual(log.map((entry) => entry.call === 'speak' ? entry.text : entry.call), ['stop', '第一条', 'stop', '第二条']);
});

// ───────────────────────── 오류·취소·언어 변경 ─────────────────────────

test('안드로이드에서 고른 음성이 시작도 못 하고 오류를 내면 음성 지정 없이 언어만으로 한 번 다시 시도한다', async () => {
  const { speaker, log, events } = androidDevice({ failVoiceOnSpeak: true });
  await speaker.changeLanguage('zh');
  await speaker.speak('前方50米，左转。', 'zh', { source: 'transit' });
  await flush();
  assert.deepEqual(speaks(log).map((e) => [e.language, e.voice]), [['zh', 'cmn-cn-x-ccc-local'], ['zh', undefined]]);
  assert.deepEqual(events.filter((e) => e.stage === 'error' || e.stage === 'retry').map((e) => e.stage), ['error', 'retry']);
  assert.equal(speaks(log).length, 2); // 한 번만 다시 시도한다
});

test('오류 후 재시도는 호출한 쪽이 취소했거나 언어가 바뀌었으면 하지 않는다', async () => {
  const device = androidDevice({ failVoiceOnSpeak: true });
  await device.speaker.changeLanguage('zh');
  let cancelled = false;
  await device.speaker.speak('前方50米，左转。', 'zh', { isCancelled: () => cancelled });
  cancelled = true;
  await flush();
  assert.equal(speaks(device.log).length, 1);

  const other = androidDevice({ failVoiceOnSpeak: true });
  await other.speaker.changeLanguage('zh');
  await other.speaker.speak('前方50米，左转。', 'zh');
  await other.speaker.changeLanguage('en'); // 오류가 오기 전에 언어를 바꿨다
  await flush();
  assert.equal(speaks(other.log).length, 1);
});

test('진단 이벤트: 요청 → speak 호출 → 시작, 건너뜀과 취소에는 이유가 남는다', async () => {
  const { speaker, events } = androidDevice();
  await speaker.changeLanguage('ko');
  await speaker.speak('안내', 'ko', { source: 'car' });
  await flush();
  assert.deepEqual(events.filter((e) => e.navigationMode === 'car').map((e) => e.stage), ['request', 'speak', 'start']);
  await speaker.speak('Hello', 'en', { source: 'car' }); // 앱 언어는 ko: 바뀌기 전 화면이 만든 문장
  assert.equal(events.at(-1).reason, 'stale-language(app=ko)');
  assert.equal(events.at(-1).speakCalled, false);
  await speaker.speak('', 'ko', { source: 'car' });
  assert.equal(events.at(-1).reason, 'empty-text');
  await speaker.stop('screen-blur');
  assert.deepEqual([events.at(-1).stage, events.at(-1).reason], ['cancel', 'screen-blur']);
  await speaker.changeLanguage('en');
  assert.ok(events.some((e) => e.stage === 'cancel' && e.reason === 'language-change'));
});

test('진단 이벤트에는 문장을 100자까지만 담고 키·좌표 같은 값은 없다', async () => {
  const { speaker, events } = androidDevice();
  await speaker.changeLanguage('en');
  await speaker.speak('A'.repeat(300), 'en', { source: 'car' });
  const request = events.find((e) => e.stage === 'request');
  assert.equal(request.text.length, 101);
  assert.deepEqual(Object.keys(request).sort(), ['appLanguage', 'navigationMode', 'stage', 'text', 'ttsLanguage']);
});

test('안내 중 언어 변경: 한국어→영어→중국어 순서로 바꿀 때 이전 언어 예약은 읽지 않고 새 언어만 읽는다 (자동차·대중교통 공통)', async () => {
  const { speaker, log } = androidDevice();
  const plan = [
    ['ko', '교차로에서 우회전 후 158m 이동', 'car'],
    ['en', 'In 80 meters, turn right.', 'car'],
    ['zh', '请在屏幕上显示的站点乘坐3200路公交车。', 'transit'],
  ];
  for (const [language, text, source] of plan) {
    await speaker.changeLanguage(language);
    const late = plan.filter(([l]) => l !== language).map(([l, t, s]) => speaker.speak(t, l, { source: s })); // 이전 언어로 예약돼 있던 안내가 뒤늦게 도착
    assert.equal(await speaker.speak(text, language, { source }), 'spoken');
    assert.deepEqual(await Promise.all(late), late.map(() => 'stale'));
  }
  assert.deepEqual(speaks(log).map((e) => [e.language, e.voice]), [['ko', 'ko-kr-x-ism-local'], ['en', 'en-us-x-tpf-local'], ['zh', 'cmn-cn-x-ccc-local']]);
});

// ───────────────────────── 안드로이드 자동차(카카오 내비 SDK): 소스 확인 ─────────────────────────

test('카카오 내비 SDK 는 앱 언어(ko/en/zh)로 초기화한다 — 한국어 고정이 아니다 (소스 확인. 실제 음성 출력은 실기기에서 확인해야 한다)', () => {
  const kotlin = fs.readFileSync(`${ROOT}modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/KakaoNavigationActivity.kt`, 'utf8');
  assert.match(kotlin, /"en" -> KNLanguageType\.KNLanguageType_ENGLISH/);
  assert.match(kotlin, /"zh" -> KNLanguageType\.KNLanguageType_CHINESE/);
  assert.match(kotlin, /initializeWithAppKey\(appKey, version, null, userId, language\)/);
  assert.equal(/initializeWithAppKey\([^)]*KNLanguageType_KOREAN/.test(kotlin), false);
  // 언어가 바뀌면 같은 키여도 SDK 를 다시 초기화한다
  assert.match(kotlin, /authenticatedKey == appKey && authenticatedLanguage == language/);
});

test('NativeNavigationScreen 은 SDK 에 앱 언어를 넘기고, 안드로이드의 자동차 길안내가 이 화면이라는 점을 코드가 보장한다', () => {
  const screen = fs.readFileSync(`${ROOT}src/screens/NativeNavigationScreen.tsx`, 'utf8');
  assert.match(screen, /language: speechLanguageOf\(i18n\.language\)/);
  const navigation = fs.readFileSync(`${ROOT}app/navigation.tsx`, 'utf8');
  assert.match(navigation, /const officialNavigation = Platform\.OS !== 'web'/);
});

test('음성 호출부는 안내 종류(source)를 진단 로그에 남긴다', () => {
  const read = (path) => fs.readFileSync(`${ROOT}${path}`, 'utf8');
  assert.match(read('src/screens/TransitGuidanceScreen.tsx'), /interrupt: true, source: 'transit'/);
  assert.match(read('src/screens/CyclingGuidanceScreen.tsx'), /source: 'cycling'/);
  assert.match(read('app/navigation.tsx'), /const speechSource = route\?\.mode === 'driving' \? 'car' : 'walk'/);
  assert.match(read('src/lib/useAnnounceOnApproach.ts'), /speaker\.speak\(text, language, \{ source \}\)/);
});
