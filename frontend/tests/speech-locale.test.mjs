// TTS 언어(ko-KR / en-US / zh-CN) 매핑과 기기 음성 선택 규칙.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SPEECH_LOCALES, pickVoice, speechLanguageOf, speechLocaleOf, voiceMatches, voiceSupport } from '../src/lib/speech/speechLocale.ts';

const voice = (language, name = `${language}-voice`, quality = 'Default') => ({ identifier: name, name, language, quality });

test('앱 언어마다 TTS locale 이 정해져 있다: 한국어 ko-KR, 영어 en-US, 중국어 간체 zh-CN', () => {
  assert.deepEqual(SPEECH_LOCALES, { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' });
  assert.equal(speechLocaleOf('ko'), 'ko-KR');
  assert.equal(speechLocaleOf('en'), 'en-US');
  assert.equal(speechLocaleOf('zh'), 'zh-CN');
});

test('지역 코드가 붙은 앱 언어도 같은 언어로 보고, 모르는 값은 한국어다', () => {
  for (const value of ['en-US', 'en_GB', 'EN']) assert.equal(speechLanguageOf(value), 'en', value);
  for (const value of ['zh-CN', 'zh-Hans-CN', 'zh_CN', 'zh']) assert.equal(speechLanguageOf(value), 'zh', value);
  for (const value of ['ko-KR', 'ko', undefined, null, '', 'fr', 'ja-JP']) assert.equal(speechLanguageOf(value), 'ko', String(value));
});

test('기기 음성 태그 판정: 같은 locale 은 exact, 같은 언어의 다른 지역은 same, 그 외는 null', () => {
  assert.equal(voiceMatches('ko-KR', 'ko'), 'exact');
  assert.equal(voiceMatches('en-US', 'en'), 'exact');
  assert.equal(voiceMatches('en_GB', 'en'), 'same');
  assert.equal(voiceMatches('en-IN', 'en'), 'same');
  assert.equal(voiceMatches('zh-CN', 'zh'), 'exact');
  assert.equal(voiceMatches('cmn-CN', 'zh'), 'exact'); // 안드로이드 구글 TTS 의 중국어(만다린) 태그
  assert.equal(voiceMatches('zh_CN', 'zh'), 'exact');
  assert.equal(voiceMatches('en-US', 'ko'), null);
  assert.equal(voiceMatches('ko-KR', 'en'), null);
});

test('중국어 간체 안내에 대만·홍콩·광둥어 음성은 쓰지 않는다', () => {
  for (const tag of ['zh-TW', 'zh-HK', 'yue-HK', 'zh-Hant-TW']) assert.equal(voiceMatches(tag, 'zh'), null, tag);
});

test('음성 선택: 대상 locale 과 같은 음성이 우선이고, 같은 점수면 고음질이 우선이다', () => {
  const voices = [voice('en-GB', 'gb', 'Enhanced'), voice('en-US', 'us', 'Default'), voice('ko-KR', 'ko')];
  assert.equal(pickVoice(voices, 'en').identifier, 'us');
  assert.equal(pickVoice([voice('en-US', 'a', 'Default'), voice('en-US', 'b', 'Enhanced')], 'en').identifier, 'b');
  assert.equal(pickVoice([voice('en-GB', 'gb')], 'en').identifier, 'gb'); // en-US 가 없으면 같은 영어의 다른 지역
  assert.equal(pickVoice(voices, 'zh'), null);
});

test('지원 여부: 대상 언어 음성이 있으면 available, 목록은 있는데 없으면 missing, 목록이 비면 unknown(막지 않는다)', () => {
  const koOnly = [voice('ko-KR')];
  assert.equal(voiceSupport(koOnly, 'ko'), 'available');
  assert.equal(voiceSupport(koOnly, 'en'), 'missing');
  assert.equal(voiceSupport(koOnly, 'zh'), 'missing');
  assert.equal(voiceSupport([voice('ko-KR'), voice('zh-TW')], 'zh'), 'missing'); // 번체(대만)만 있으면 간체 안내는 없는 것
  assert.equal(voiceSupport([], 'en'), 'unknown');
});
