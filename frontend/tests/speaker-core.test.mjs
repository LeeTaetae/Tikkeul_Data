// TTS 재생 관리자: 언어별 locale/voice 전달, 언어 변경 시 예약 취소, 음성 데이터가 없을 때의 처리, 중복 방지.
// 엔진은 가짜(호출을 기록)이고, 언어 값은 실제 앱처럼 i18next 가 바꾸는 ko/en/zh 를 쓴다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSpeaker } from '../src/lib/speech/speakerCore.ts';

const voice = (language, name = `${language}-voice`, quality = 'Default') => ({ identifier: name, name, language, quality });
const ALL_VOICES = [voice('ko-KR'), voice('en-US', 'en-us-enhanced', 'Enhanced'), voice('en-GB'), voice('zh-CN'), voice('zh-TW')];

function setup({ platform = 'android', voices = ALL_VOICES, preferredWebVoices, hold = false } = {}) {
  const calls = { speak: [], stop: 0, voices: 0, unsupported: [] };
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const engine = {
    speak: (text, options) => calls.speak.push({ text, ...options }),
    stop: () => {
      calls.stop += 1;
    },
    getAvailableVoicesAsync: () => {
      calls.voices += 1;
      return hold ? gate.then(() => voices) : Promise.resolve(voices);
    },
  };
  const speaker = createSpeaker({ engine, platform, preferredWebVoices, onUnsupported: (language) => calls.unsupported.push(language) });
  return { speaker, calls, release };
}
// 음성 목록 조회가 release() 를 부를 때까지 멈춰 있는 엔진(안드로이드에서 엔진이 아직 준비 중인 상황)
const heldSetup = (options) => setup({ ...options, hold: true });

test('언어별로 TTS locale 이 전달된다: ko-KR, en-US, zh-CN', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  await speaker.changeLanguage('ko');
  assert.equal(await speaker.speak('안내', 'ko'), 'spoken');
  await speaker.changeLanguage('en');
  assert.equal(await speaker.speak('Turn left.', 'en'), 'spoken');
  await speaker.changeLanguage('zh');
  assert.equal(await speaker.speak('左转。', 'zh'), 'spoken');
  assert.deepEqual(calls.speak.map((c) => [c.text, c.language]), [['안내', 'ko-KR'], ['Turn left.', 'en-US'], ['左转。', 'zh-CN']]);
});

test('한국어→영어→중국어로 바꾸면 이후 안내부터 새 언어이고, 이전 언어로 만든 문장은 읽지 않는다', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  await speaker.changeLanguage('ko');
  assert.equal(await speaker.speak('좌회전하세요', 'ko'), 'spoken');
  await speaker.changeLanguage('en');
  assert.equal(await speaker.speak('좌회전하세요', 'ko'), 'stale'); // 바뀌기 전 화면이 만든 한국어 문장
  assert.equal(await speaker.speak('Turn left.', 'en'), 'spoken');
  await speaker.changeLanguage('zh');
  assert.equal(await speaker.speak('Turn left.', 'en'), 'stale');
  assert.equal(await speaker.speak('左转。', 'zh'), 'spoken');
  assert.deepEqual(calls.speak.map((c) => c.language), ['ko-KR', 'en-US', 'zh-CN']);
});

test('앱 언어가 en-US·zh-Hans-CN 같은 지역 코드로 와도 같은 TTS locale 이 쓰인다', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  await speaker.changeLanguage('en-US');
  await speaker.speak('Hello', 'en-US');
  await speaker.changeLanguage('zh-Hans-CN');
  await speaker.speak('你好', 'zh-Hans-CN');
  assert.deepEqual(calls.speak.map((c) => c.language), ['en-US', 'zh-CN']);
});

test('언어를 바꾸면 읽던 음성을 끊고, 같은 언어로 다시 설정하면 아무것도 끊지 않는다', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  await speaker.changeLanguage('ko'); // 처음 설정: 끊을 것이 없다
  assert.equal(calls.stop, 0);
  await speaker.changeLanguage('ko');
  assert.equal(calls.stop, 0);
  await speaker.changeLanguage('en');
  assert.equal(calls.stop, 1);
});

test('음성 목록을 기다리는 중에 언어가 바뀌면 예약된 안내는 재생되지 않는다 (이전 언어 음성 잔류 방지)', async () => {
  const { speaker, calls, release } = heldSetup();
  void speaker.changeLanguage('ko'); // 앱 시작 때 현재 언어를 설정해 둔 상태(speaker.ts 가 한다)
  const pending = speaker.speak('좌회전하세요', 'ko'); // 음성 목록을 확인하는 중
  const changing = speaker.changeLanguage('en'); // 그 사이 사용자가 영어로 바꿈
  release();
  assert.equal(await pending, 'stale');
  await changing;
  assert.equal(calls.speak.length, 0);
  assert.ok(calls.stop >= 1); // 읽던 음성도 끊었다
  assert.equal(await speaker.speak('Turn left.', 'en'), 'spoken');
  assert.deepEqual(calls.speak.map((c) => [c.text, c.language]), [['Turn left.', 'en']]); // 안드로이드는 지역 없는 코드
});

test('stop() 은 읽던 음성과 아직 읽기 전인 예약을 모두 취소한다. stopSpeaking() 은 지금 읽는 음성만 끊는다', async () => {
  const first = heldSetup();
  void first.speaker.changeLanguage('ko');
  const pending = first.speaker.speak('다음 안내', 'ko');
  first.speaker.stop();
  first.release();
  assert.equal(await pending, 'stale');
  assert.equal(first.calls.speak.length, 0);
  assert.equal(first.calls.stop, 1);

  const second = heldSetup();
  void second.speaker.changeLanguage('ko');
  const reserved = second.speaker.speak('예약', 'ko');
  second.speaker.stopSpeaking(); // 지금 읽는 음성만 끊는다: 예약은 그대로
  second.release();
  assert.equal(await reserved, 'spoken');
  assert.equal(second.calls.speak.length, 1);
});

test('호출한 쪽이 사라졌다고(isCancelled) 알리면 읽지 않는다 (경고 카드가 닫힌 뒤 늦게 읽히는 것 방지)', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  let cancelled = false;
  const pending = speaker.speak('경고', 'ko', { isCancelled: () => cancelled });
  cancelled = true;
  assert.equal(await pending, 'stale');
  assert.equal(calls.speak.length, 0);
});

test('interrupt 를 주면 읽던 음성을 끊고 읽는다. 주지 않으면 이어서 읽는다', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  await speaker.speak('A', 'ko');
  assert.equal(calls.stop, 0);
  await speaker.speak('B', 'ko', { interrupt: true });
  assert.equal(calls.stop, 1);
  assert.deepEqual(calls.speak.map((c) => c.text), ['A', 'B']);
});

test('빈 문장은 읽지 않는다', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  assert.equal(await speaker.speak('', 'en'), 'empty');
  assert.equal(await speaker.speak('   ', 'zh'), 'empty');
  assert.equal(calls.speak.length, 0);
});

test('엔진이 완료·중단·오류를 알리면 호출한 쪽의 콜백이 불린다', async () => {
  const { speaker, calls } = setup({ platform: 'ios' });
  const seen = [];
  await speaker.speak('A', 'en', { onDone: () => seen.push('done'), onStopped: () => seen.push('stopped'), onError: () => seen.push('error') });
  calls.speak[0].onDone();
  calls.speak[0].onStopped();
  calls.speak[0].onError(new Error('x'));
  assert.deepEqual(seen, ['done', 'stopped', 'error']);
});

// ───────────────────────── 안드로이드 음성 데이터 ─────────────────────────

test('안드로이드: 기기 음성 목록에서 대상 언어 음성을 골라 voice 로 함께 넘긴다 (언어만 넘기면 엔진 기본 언어로 떨어질 수 있다)', async () => {
  const { speaker, calls } = setup();
  await speaker.changeLanguage('en');
  await speaker.speak('Turn left.', 'en');
  await speaker.changeLanguage('zh');
  await speaker.speak('左转。', 'zh');
  await speaker.changeLanguage('ko');
  await speaker.speak('좌회전하세요', 'ko');
  assert.deepEqual(calls.speak.map((c) => [c.language, c.voice]), [['en', 'en-us-enhanced'], ['zh', 'zh-CN-voice'], ['ko', 'ko-KR-voice']]); // 안드로이드는 language 를 지역 없는 코드로 넘기고, zh-TW 가 아니라 zh-CN 음성을 고른다
});

test('안드로이드: 대상 언어 음성이 기기에 없으면 한국어로 대신 읽지 않고 읽기를 건너뛰며, 언어마다 한 번만 알린다', async () => {
  const { speaker, calls } = setup({ voices: [voice('ko-KR')] });
  assert.equal(await speaker.speak('Turn left.', 'en'), 'unsupported');
  assert.equal(await speaker.speak('Turn right.', 'en'), 'unsupported');
  assert.equal(await speaker.speak('左转。', 'zh'), 'unsupported');
  assert.equal(await speaker.speak('좌회전하세요', 'ko'), 'spoken'); // 한국어는 계속 정상
  assert.equal(calls.speak.length, 1);
  assert.equal(calls.speak[0].language, 'ko');
  assert.deepEqual(calls.unsupported, ['en', 'zh']);
});

test('안드로이드: 언어를 바꾸는 순간에도 그 언어 음성이 없으면 바로 알린다 (안내를 기다리지 않는다)', async () => {
  const { speaker, calls } = setup({ voices: [voice('ko-KR')] });
  assert.equal(await speaker.changeLanguage('ko'), 'available');
  assert.equal(await speaker.changeLanguage('en'), 'missing');
  assert.deepEqual(calls.unsupported, ['en']);
  assert.equal(await speaker.changeLanguage('zh'), 'missing');
  await speaker.changeLanguage('en');
  assert.deepEqual(calls.unsupported, ['en', 'zh']);
});

test('안드로이드: 음성 목록을 못 받거나 비어 있으면 막지 않고 언어만 넘겨 시도하고, 다음에 목록을 다시 받는다', async () => {
  const { speaker, calls } = setup({ voices: [] });
  assert.equal(await speaker.speak('Turn left.', 'en'), 'spoken');
  assert.equal(calls.speak[0].voice, undefined);
  assert.equal(calls.speak[0].language, 'en');
  await speaker.speak('Turn right.', 'en');
  assert.equal(calls.voices, 2); // 빈 목록은 저장하지 않는다
  assert.deepEqual(calls.unsupported, []);
});

test('지원 여부 조회: 세 언어의 ko-KR/en-US/zh-CN 음성 유무를 알려 준다', async () => {
  assert.deepEqual(await setup().speaker.getSupport(), { ko: 'available', en: 'available', zh: 'available' });
  assert.deepEqual(await setup({ voices: [voice('ko-KR'), voice('zh-TW')] }).speaker.getSupport(), { ko: 'available', en: 'missing', zh: 'missing' });
  assert.deepEqual(await setup({ platform: 'ios' }).speaker.getSupport(), { ko: 'unknown', en: 'unknown', zh: 'unknown' });
});

test('웹: 선호 음성(Samantha)은 기기에 있을 때만 넘기고, 없으면 지정하지 않는다', async () => {
  const preferredWebVoices = { 'en-US': 'Samantha' };
  const withVoice = setup({ platform: 'web', voices: [voice('en-US', 'Samantha'), voice('en-US', 'Albert')], preferredWebVoices });
  await withVoice.speaker.speak('Hello', 'en');
  assert.equal(withVoice.calls.speak[0].voice, 'Samantha');
  const without = setup({ platform: 'web', voices: [voice('en-US', 'Albert')], preferredWebVoices });
  await without.speaker.speak('Hello', 'en');
  assert.equal(without.calls.speak[0].voice, undefined);
  const korean = setup({ platform: 'web', voices: [voice('en-US', 'Samantha')], preferredWebVoices });
  await korean.speaker.speak('안내', 'ko');
  assert.equal(korean.calls.speak[0].voice, undefined);
  assert.equal(korean.calls.voices, 0); // 선호 음성이 없는 언어는 목록을 받지도 않는다
});

// ───────────────────────── 시나리오: 안내 중 언어 변경 ─────────────────────────

test('안내 중 한국어→영어→중국어: 각 단계의 text/language 쌍이 맞고 이전 언어 문장이 섞이지 않는다', async () => {
  const { speaker, calls } = setup();
  const script = [
    ['ko', '좌회전하세요'],
    ['en', 'In 80 meters, turn left.'],
    ['zh', '前方80米，左转。'],
  ];
  for (const [language, text] of script) {
    await speaker.changeLanguage(language);
    // 언어를 바꾸는 순간 아직 예약돼 있던 이전 언어 문장이 뒤늦게 도착한다
    const stale = script.filter(([l]) => l !== language).map(([l, t]) => speaker.speak(t, l));
    assert.equal(await speaker.speak(text, language), 'spoken');
    assert.deepEqual(await Promise.all(stale), stale.map(() => 'stale'));
  }
  assert.deepEqual(
    calls.speak.map((c) => [c.text, c.language]),
    [['좌회전하세요', 'ko'], ['In 80 meters, turn left.', 'en'], ['前方80米，左转。', 'zh']],
  );
});

// ───────────────────────── 음성 데이터를 나중에 설치한 경우 (삼성 TTS 에 중국어 팩이 없던 실기기 상황) ─────────────────────────

import { MISSING_VOICE_RECHECK_MS } from '../src/lib/speech/speakerCore.ts';

/** 안드로이드 엔진 + 설치된 음성 목록을 바꿀 수 있는 가짜 기기. 시계도 직접 움직인다. */
function installableDevice(initialVoices) {
  const state = { voices: [...initialVoices], listCalls: 0, speaks: [], time: 10_000, unsupported: [] };
  const engine = {
    speak: (text, options) => state.speaks.push({ text, ...options }),
    stop: () => {},
    getAvailableVoicesAsync: async () => {
      state.listCalls += 1;
      return [...state.voices];
    },
  };
  const speaker = createSpeaker({ engine, platform: 'android', onUnsupported: (language) => state.unsupported.push(language), now: () => state.time });
  return { speaker, state };
}
const SAMSUNG_KO_EN = [voice('ko-KR', 'ko-KR-SMTl01'), voice('en-US', 'en-US-SMTd01')];
const ZH_VOICE = voice('zh-CN', 'zh-CN-SMTz01');

test('중국어 음성이 없다가 설치되면, 시간이 지난 뒤 다음 안내에서 목록을 다시 받아 중국어로 읽는다', async () => {
  const { speaker, state } = installableDevice(SAMSUNG_KO_EN);
  await speaker.changeLanguage('zh');
  assert.equal(await speaker.speak('请步行至屏幕上显示的上车点。', 'zh'), 'unsupported'); // 아직 없다
  assert.equal(state.speaks.length, 0);
  state.voices.push(ZH_VOICE); // 사용자가 음성 데이터를 설치하고 앱으로 돌아왔다
  state.time += MISSING_VOICE_RECHECK_MS;
  assert.equal(await speaker.speak('请步行至屏幕上显示的上车点。', 'zh'), 'spoken');
  assert.deepEqual(state.speaks.map((s) => [s.language, s.voice]), [['zh', 'zh-CN-SMTz01']]);
});

test('음성이 없다고 나온 직후에는 안내마다 목록을 다시 받지 않는다 (간격 안에서는 조회 1회)', async () => {
  const { speaker, state } = installableDevice(SAMSUNG_KO_EN);
  await speaker.changeLanguage('zh');
  const afterFirst = state.listCalls;
  for (let i = 0; i < 4; i += 1) {
    state.time += 500; // 간격(3초)보다 짧게 반복
    assert.equal(await speaker.speak('前方50米，左转。', 'zh'), 'unsupported');
  }
  assert.equal(state.listCalls, afterFirst);
  state.time += MISSING_VOICE_RECHECK_MS; // 간격이 지나면 한 번 다시 받는다
  await speaker.speak('前方50米，左转。', 'zh');
  assert.equal(state.listCalls, afterFirst + 1);
});

test('설치되지 않은 상태가 계속되면 간격마다 한 번씩만 다시 확인하고, 알림은 한 번만 띄운다', async () => {
  const { speaker, state } = installableDevice(SAMSUNG_KO_EN);
  await speaker.changeLanguage('zh');
  for (let i = 0; i < 3; i += 1) {
    state.time += MISSING_VOICE_RECHECK_MS;
    assert.equal(await speaker.speak('左转。', 'zh'), 'unsupported');
  }
  assert.deepEqual(state.unsupported, ['zh']);
});

test('언어를 중국어로 바꾸는 순간에도 간격이 지났으면 다시 확인한다 (설치 후 설정에서 돌아와 언어를 바꾸는 경우)', async () => {
  const { speaker, state } = installableDevice(SAMSUNG_KO_EN);
  assert.equal(await speaker.changeLanguage('ko'), 'available');
  state.voices.push(ZH_VOICE);
  state.time += MISSING_VOICE_RECHECK_MS;
  assert.equal(await speaker.changeLanguage('zh'), 'available');
  assert.deepEqual(state.unsupported, []);
});

test('한국어·영어처럼 이미 음성이 있는 언어는 목록을 다시 받지 않고, 한국어 동작은 그대로다', async () => {
  const { speaker, state } = installableDevice(SAMSUNG_KO_EN);
  await speaker.changeLanguage('ko');
  const afterInit = state.listCalls;
  state.time += MISSING_VOICE_RECHECK_MS * 10;
  assert.equal(await speaker.speak('좌회전하세요', 'ko'), 'spoken');
  await speaker.changeLanguage('en');
  assert.equal(await speaker.speak('Turn left.', 'en'), 'spoken');
  assert.equal(state.listCalls, afterInit);
  assert.deepEqual(state.speaks.map((s) => [s.text, s.language, s.voice]), [['좌회전하세요', 'ko', 'ko-KR-SMTl01'], ['Turn left.', 'en', 'en-US-SMTd01']]);
});
