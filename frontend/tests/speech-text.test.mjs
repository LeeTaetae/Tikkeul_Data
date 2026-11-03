// 언어별 음성 안내 문장. 번역은 앱이 쓰는 실제 i18next 리소스(ko/en/zh 로케일 파일)로 만든다.
// 핵심 규칙: 영어·중국어 음성이 읽는 문장에는 한글이 한 글자도 들어가면 안 된다(한국어 문장·고유명사를 외국어 음성으로 읽지 않는다).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import i18next from 'i18next';

import ko from '../src/i18n/locales/ko.ts';
import en from '../src/i18n/locales/en.ts';
import zh from '../src/i18n/locales/zh.ts';
import { busNumbers, isSafeToSpeak, speakableName, subwayLineLabel } from '../src/lib/speech/speechNames.ts';
import { guideOfInstruction, hazardSpeech, instructionSpeech, spokenDistance, transitActionSpeech, turnSentence } from '../src/lib/speech/speechText.ts';

const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;

async function translator(lng) {
  const instance = i18next.createInstance();
  await instance.init({ lng, fallbackLng: 'ko', resources: { ko: { translation: ko }, en: { translation: en }, zh: { translation: zh } }, interpolation: { escapeValue: false } });
  return (key, params) => instance.t(key, params);
}
const T = { ko: await translator('ko'), en: await translator('en'), zh: await translator('zh') };

// 실제 Tmap 응답(자동차)에서 확인한 turnType 과 안내 문구(guidanceDisplay.ts 주석 참고)
const guide = (turnType, description, extra = {}) => ({ index: 0, lat: 37.5, lng: 127.0, pathIndex: 0, turnType, pointType: 'N', description, name: '', nextRoadName: '', ...extra });
const GUIDES = [
  guide(12, '교차로에서 좌회전 후 느티나무1길을 따라 158m 이동', { lat: 37.5001, nextRoadName: '느티나무1길' }),
  guide(13, '우회전 후 테헤란로 이동', { lat: 37.5002, nextRoadName: '테헤란로' }),
  guide(11, '직진 후 계속 이동', { lat: 37.5003 }),
  guide(14, 'U턴 후 이동', { lat: 37.5004 }),
  guide(201, '도착', { lat: 37.5005, pointType: 'E' }),
  guide(16, '8시 방향 좌회전 후 이동', { lat: 37.5006 }), // 응답에서 확인하지 못한 turnType
  guide(125, '육교 이용', { lat: 37.5007 }), // 시설을 뜻하는 코드
  guide(13, 'Teheran-ro 로 우회전', { lat: 37.5008, nextRoadName: 'Teheran-ro' }), // 영문 도로명
];
const instr = (g) => ({ text: g.description, point: { lat: g.lat, lng: g.lng } });

// ───────────────────────── 거리 ─────────────────────────

test('거리는 10m 단위로 읽는 말로: 미터, 1km 이상은 킬로미터', () => {
  assert.equal(spokenDistance(83, T.en), '80 meters');
  assert.equal(spokenDistance(1234, T.en), '1.2 kilometers');
  assert.equal(spokenDistance(2000, T.en), '2 kilometers');
  assert.equal(spokenDistance(83, T.zh), '80米');
  assert.equal(spokenDistance(1234, T.zh), '1.2公里');
  assert.equal(spokenDistance(83, T.ko), '80미터');
  assert.equal(spokenDistance(2, T.en), '10 meters'); // 너무 작은 값은 10m
});

// ───────────────────────── 턴 안내 문장 ─────────────────────────

test('회전 문장: 영어·중국어 모두 직진·좌회전·우회전·U턴·도착을 그 언어로 말한다 (남은 거리 포함)', () => {
  const sentence = (kind, lang, distanceM = 80) => turnSentence({ kind, distanceM }, lang, T[lang]);
  assert.equal(sentence('left', 'en'), 'In 80 meters, turn left.');
  assert.equal(sentence('right', 'en'), 'In 80 meters, turn right.');
  assert.equal(sentence('straight', 'en'), 'In 80 meters, continue straight.');
  assert.equal(sentence('uturn', 'en'), 'In 80 meters, make a U-turn.');
  assert.equal(sentence('arrive', 'en'), 'In 80 meters, you will arrive at your destination.');
  assert.equal(sentence('left', 'zh'), '前方80米，左转。');
  assert.equal(sentence('right', 'zh'), '前方80米，右转。');
  assert.equal(sentence('straight', 'zh'), '前方80米，直行。');
  assert.equal(sentence('uturn', 'zh'), '前方80米，掉头。');
  assert.equal(sentence('arrive', 'zh'), '前方80米，即将到达目的地。');
});

test('가까우면(30m 미만) 거리 없이 바로 지금 하는 말로, 도착은 이미 도착한 문장이다', () => {
  assert.equal(turnSentence({ kind: 'left', distanceM: 12 }, 'en', T.en), 'Turn left.');
  assert.equal(turnSentence({ kind: 'left', distanceM: null }, 'zh', T.zh), '左转。');
  assert.equal(turnSentence({ kind: 'arrive', distanceM: 10 }, 'en', T.en), 'You have arrived at your destination.');
  assert.equal(turnSentence({ kind: 'arrive', distanceM: 10 }, 'zh', T.zh), '您已到达目的地。');
});

test('도로명: 영문 이름은 읽고, 한글 이름은 읽지 않는다 (임의 번역·음역을 하지 않는다)', () => {
  assert.equal(turnSentence({ kind: 'right', distanceM: 60, road: 'Teheran-ro' }, 'en', T.en), 'In 60 meters, turn right onto Teheran-ro.');
  assert.equal(turnSentence({ kind: 'right', distanceM: 60, road: 'Teheran-ro' }, 'zh', T.zh), '前方60米，右转，进入Teheran-ro。');
  for (const lang of ['en', 'zh']) {
    const text = turnSentence({ kind: 'left', distanceM: 60, road: '느티나무1길' }, lang, T[lang]);
    assert.equal(HANGUL.test(text), false, text);
  }
  assert.equal(turnSentence({ kind: 'left', distanceM: 60, road: '느티나무1길' }, 'en', T.en), 'In 60 meters, turn left.');
});

// ───────────────────────── 안내 문구 -> 문장 ─────────────────────────

test('한국어는 Tmap 원문을 그대로 읽는다 (기존 동작 유지)', () => {
  for (const g of GUIDES) assert.equal(instructionSpeech(instr(g), GUIDES, 80, 'ko', T.ko), g.description);
  assert.equal(instructionSpeech({ text: '느티나무1길, 158m', point: null }, GUIDES, 80, 'ko', T.ko), '느티나무1길, 158m');
});

test('영어·중국어: 안내 지점의 회전 종류로 그 언어 문장을 만들고, 한국어 원문은 읽지 않는다', () => {
  const [left, right, straight, uturn, arrive] = GUIDES;
  assert.equal(instructionSpeech(instr(left), GUIDES, 80, 'en', T.en), 'In 80 meters, turn left.');
  assert.equal(instructionSpeech(instr(right), GUIDES, 50, 'en', T.en), 'In 50 meters, turn right.');
  assert.equal(instructionSpeech(instr(straight), GUIDES, 40, 'zh', T.zh), '前方40米，直行。');
  assert.equal(instructionSpeech(instr(uturn), GUIDES, 90, 'zh', T.zh), '前方90米，掉头。');
  assert.equal(instructionSpeech(instr(arrive), GUIDES, 10, 'en', T.en), 'You have arrived at your destination.');
  assert.equal(instructionSpeech(instr(arrive), GUIDES, 10, 'zh', T.zh), '您已到达目的地。');
  assert.equal(instructionSpeech(instr(GUIDES[7]), GUIDES, 70, 'en', T.en), 'In 70 meters, turn right onto Teheran-ro.');
});

test('영어·중국어 음성은 어떤 안내 입력에서도 한글을 읽지 않는다', () => {
  for (const lang of ['en', 'zh']) {
    for (const g of GUIDES) {
      for (const distanceM of [null, 5, 45, 100]) {
        const text = instructionSpeech(instr(g), GUIDES, distanceM, lang, T[lang]);
        assert.equal(HANGUL.test(text), false, `${lang} ${g.turnType}: ${text}`);
      }
    }
    // 대응하는 안내 지점이 없는 문구(도로명·거리 요약 줄, 좌표 없음)도 한국어로 읽지 않고 건너뛴다
    assert.equal(instructionSpeech({ text: '느티나무1길, 158m', point: { lat: 37.5001, lng: 127 } }, GUIDES, 50, lang, T[lang]), '');
    assert.equal(instructionSpeech({ text: GUIDES[0].description, point: null }, GUIDES, 50, lang, T[lang]), '');
    assert.equal(instructionSpeech({ text: GUIDES[0].description, point: { lat: 37.5001, lng: 127 } }, undefined, 50, lang, T[lang]), '');
  }
});

test('확인되지 않은 회전 종류(8시 방향, 육교 등)는 외국어 음성으로 읽지 않는다 (화면 안내는 그대로)', () => {
  for (const lang of ['en', 'zh']) {
    assert.equal(instructionSpeech(instr(GUIDES[5]), GUIDES, 60, lang, T[lang]), '');
    assert.equal(instructionSpeech(instr(GUIDES[6]), GUIDES, 60, lang, T[lang]), '');
  }
});

test('안내 문구와 안내 지점의 대응: 같은 문구여도 40m 넘게 떨어진 지점은 대응하지 않는다', () => {
  assert.equal(guideOfInstruction({ text: GUIDES[0].description, point: { lat: 37.5001, lng: 127.0 } }, GUIDES), GUIDES[0]);
  assert.equal(guideOfInstruction({ text: GUIDES[0].description, point: { lat: 37.51, lng: 127.0 } }, GUIDES), null);
});

test('자전거 안내 지점(문구에서 만든 turnType)도 같은 방식으로 영어·중국어 문장이 된다', () => {
  const g = guide(12, '좌회전 후 이동', { lat: 37.6 });
  assert.equal(instructionSpeech({ text: g.description, point: { lat: 37.60002, lng: 127.0 } }, [g], 70, 'en', T.en), 'In 70 meters, turn left.');
});

// ───────────────────────── 대중교통 ─────────────────────────

const leg = (over) => ({ kind: 'bus', source: 'step', transfer: false, fromName: '강남역', toName: '서초역', lineName: '3200', stopCount: null, ...over });

test('버스 탑승·하차: 노선 번호는 읽고 한국어 정류장 이름은 읽지 않는다', () => {
  assert.equal(transitActionSpeech('board', leg({}), 'en', T.en), 'Board bus 3200 at the stop shown on the screen.');
  assert.equal(transitActionSpeech('board', leg({}), 'zh', T.zh), '请在屏幕上显示的站点乘坐3200路公交车。');
  assert.equal(transitActionSpeech('ride', leg({ stopCount: 5 }), 'en', T.en), 'In 5 stops, get off at the stop shown on the screen.');
  assert.equal(transitActionSpeech('ride', leg({ stopCount: 5 }), 'zh', T.zh), '乘坐5站后，请在屏幕上显示的站点下车。');
  assert.equal(transitActionSpeech('ride', leg({}), 'en', T.en), 'Get off at the stop shown on the screen.');
  assert.equal(transitActionSpeech('ride', leg({}), 'zh', T.zh), '请在屏幕上显示的站点下车。');
});

test('같은 구간의 여러 버스 번호는 모두 읽고, 한글이 섞인 번호 조각은 뺀다', () => {
  assert.equal(transitActionSpeech('board', leg({ lineName: '31, 31-3' }), 'en', T.en), 'Board bus 31 or 31-3 at the stop shown on the screen.');
  assert.equal(transitActionSpeech('board', leg({ lineName: '31, 31-3' }), 'zh', T.zh), '请在屏幕上显示的站点乘坐31或31-3路公交车。');
  assert.deepEqual(busNumbers('8146(평일), 146'), ['146']);
  assert.equal(transitActionSpeech('board', leg({ lineName: '서초03' }), 'en', T.en), 'Board the bus at the stop shown on the screen.'); // 번호를 모르면 일반 표현
});

test('지하철 탑승·하차: 호선 번호와 확인된 노선 이름만 읽고, 모르는 노선은 일반 표현이다', () => {
  const subway = (lineName, over = {}) => leg({ kind: 'subway', lineName, ...over });
  assert.equal(transitActionSpeech('board', subway('2호선'), 'en', T.en), 'Board the Line 2 train at the station shown on the screen.');
  assert.equal(transitActionSpeech('board', subway('2호선'), 'zh', T.zh), '请在屏幕上显示的车站乘坐2号线列车。');
  assert.equal(transitActionSpeech('board', subway('신분당선'), 'en', T.en), 'Board the Sinbundang Line train at the station shown on the screen.');
  assert.equal(transitActionSpeech('board', subway('에버라인'), 'en', T.en), 'Board the subway at the station shown on the screen.'); // 공식 표기를 확인하지 못한 노선
  assert.equal(transitActionSpeech('board', subway('에버라인'), 'zh', T.zh), '请在屏幕上显示的车站乘坐地铁。');
  assert.equal(transitActionSpeech('ride', subway('2호선', { stopCount: 3 }), 'en', T.en), 'In 3 stops, get off at the station shown on the screen.');
  assert.equal(transitActionSpeech('ride', subway('2호선'), 'zh', T.zh), '请在屏幕上显示的车站下车。');
});

test('도보·환승·목적지까지 걷기', () => {
  assert.equal(transitActionSpeech('walk', leg({ kind: 'walk', source: 'access' }), 'en', T.en), 'Walk to the boarding point shown on the screen.');
  assert.equal(transitActionSpeech('walk', leg({ kind: 'walk', source: 'access' }), 'zh', T.zh), '请步行至屏幕上显示的上车点。');
  assert.equal(transitActionSpeech('walk', leg({ kind: 'walk', transfer: true }), 'en', T.en), 'Transfer on foot to the next point shown on the screen.');
  assert.equal(transitActionSpeech('walk', leg({ kind: 'walk', transfer: true }), 'zh', T.zh), '请步行换乘至屏幕上显示的下一个地点。');
  assert.equal(transitActionSpeech('walk', leg({ kind: 'walk', source: 'egress' }), 'en', T.en), 'Walk to your destination.');
  assert.equal(transitActionSpeech('walk', leg({ kind: 'walk', source: 'egress' }), 'zh', T.zh), '请步行至目的地。');
});

test('영문 이름이면 정류장 이름도 읽는다 (읽어도 안전한 이름만)', () => {
  assert.equal(transitActionSpeech('board', leg({ kind: 'subway', lineName: '1호선', fromName: 'Seoul Station' }), 'en', T.en), 'Board the Line 1 train at Seoul Station.');
  assert.equal(transitActionSpeech('board', leg({ fromName: 'Gangnam Stn.' }), 'zh', T.zh), '请在Gangnam Stn.乘坐3200路公交车。');
});

test('한국어 대중교통은 null: 기존 화면 문구(ride.action.*)를 그대로 읽는다', () => {
  for (const task of ['walk', 'board', 'ride']) assert.equal(transitActionSpeech(task, leg({}), 'ko', T.ko), null);
});

test('영어·중국어 대중교통 음성에는 한글이 없다 (한국어 이름·노선이 어떤 조합이어도)', () => {
  const names = ['강남역', '서초역삼세무서', '', 'Seoul Station'];
  for (const lang of ['en', 'zh']) {
    for (const kind of ['bus', 'subway', 'walk']) {
      for (const source of ['step', 'access', 'egress']) {
        for (const lineName of ['3200', '31, 31-3', '2호선', '신분당선', '서초03', '8146(평일), 146', '에버라인', '']) {
          for (const task of ['walk', 'board', 'ride']) {
            for (const name of names) {
              const text = transitActionSpeech(task, leg({ kind, source, transfer: source === 'step' && kind === 'walk', lineName, fromName: name, toName: name, stopCount: 4 }), lang, T[lang]);
              assert.equal(HANGUL.test(text), false, `${lang}/${kind}/${source}/${lineName}/${task}/${name}: ${text}`);
            }
          }
        }
      }
    }
  }
});

test('목적지 도착 안내(nav.arrived)는 세 언어 모두 있다', () => {
  assert.equal(T.ko('nav.arrived'), '목적지에 도착했습니다.');
  assert.equal(T.en('nav.arrived'), 'You have arrived at your destination.');
  assert.equal(T.zh('nav.arrived'), '您已到达目的地。');
});

// ───────────────────────── 위험 알림 ─────────────────────────

test('위험 알림: 한국어는 화면과 같은 문장, 영어·중국어는 거리를 읽는 말로 바꾼 같은 경고', () => {
  const screen = (lang) => T[lang]('hazard.message.accident', { distance: '300m' });
  assert.equal(hazardSpeech('hazard.message.accident', 300, screen('ko'), 'ko', T.ko), screen('ko'));
  assert.equal(hazardSpeech('hazard.message.accident', 300, screen('en'), 'en', T.en), T.en('hazard.message.accident', { distance: '300 meters' }));
  assert.equal(hazardSpeech('hazard.message.accident', 300, screen('zh'), 'zh', T.zh), '前方300米发生交通事故');
  for (const lang of ['en', 'zh']) {
    for (const type of ['accident', 'construction', 'congestion', 'protection_zone_child', 'protection_zone_senior', 'protection_zone_disabled', 'accident_prone']) {
      for (const prefix of ['message', 'advance']) {
        const text = hazardSpeech(`hazard.${prefix}.${type}`, 480, '', lang, T[lang]);
        assert.equal(HANGUL.test(text), false, text);
        assert.match(text, lang === 'en' ? /480 meters/ : /480米/);
      }
    }
    assert.equal(HANGUL.test(T[lang]('hazard.speedBump')), false);
    assert.equal(HANGUL.test(T[lang]('hazard.speedingSchoolZone')), false);
  }
});

// ───────────────────────── 고유명사 정책 ─────────────────────────

test('읽어도 되는 이름: 한국어는 모두, 영어는 ASCII, 중국어는 ASCII·한자. 한글이 섞이면 외국어로 읽지 않는다', () => {
  assert.equal(isSafeToSpeak('강남역', 'ko'), true);
  assert.equal(isSafeToSpeak('강남역', 'en'), false);
  assert.equal(isSafeToSpeak('강남역', 'zh'), false);
  assert.equal(isSafeToSpeak('Gangnam 2nd Ave', 'en'), true);
  assert.equal(isSafeToSpeak('江南站', 'zh'), true);
  assert.equal(isSafeToSpeak('江南站', 'en'), false);
  assert.equal(isSafeToSpeak('강남Station', 'en'), false);
  assert.equal(isSafeToSpeak('  ', 'en'), false);
  assert.equal(speakableName('강남역', 'en'), null);
  assert.equal(speakableName(undefined, 'en'), null);
});

test('지하철 노선 이름: 숫자 호선은 규칙으로, 이름이 있는 노선은 확인된 표기만. 인천 노선도 구분한다', () => {
  assert.equal(subwayLineLabel('9호선', 'en'), 'Line 9');
  assert.equal(subwayLineLabel('9호선', 'zh'), '9号线');
  assert.equal(subwayLineLabel('인천1호선', 'en'), 'Incheon Line 1');
  assert.equal(subwayLineLabel('인천2호선', 'zh'), '仁川2号线');
  assert.equal(subwayLineLabel('공항철도', 'en'), 'AREX Airport Railroad');
  assert.equal(subwayLineLabel('경의중앙선', 'zh'), '京义中央线');
  assert.equal(subwayLineLabel('2호선', 'ko'), '2호선');
  assert.equal(subwayLineLabel('에버라인', 'en'), null);
  assert.equal(subwayLineLabel('', 'en'), null);
});

// ───────────────────────── 번역 구조 ─────────────────────────

test('speech 번역은 세 언어가 같은 키와 같은 {{값}} 자리를 가진다', () => {
  const leaves = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  const placeholders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const koLeaves = Object.fromEntries(leaves(ko.speech));
  for (const [name, locale] of [['en', en], ['zh', zh]]) {
    const other = Object.fromEntries(leaves(locale.speech));
    assert.deepEqual(Object.keys(other).sort(), Object.keys(koLeaves).sort(), name);
    for (const [key, value] of Object.entries(other)) assert.equal(placeholders(value), placeholders(koLeaves[key]), `${name}.speech.${key}`);
  }
});

test('영어·중국어 speech 문장에는 한글이 없다 (언어 이름 표기와 한국어 전용 키 제외)', () => {
  const leaves = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  for (const locale of [en, zh]) for (const [key, value] of leaves(locale.speech)) assert.equal(HANGUL.test(value), false, `${key}: ${value}`);
});

// ───────────────────────── 개발용 TTS 시나리오(/navigation?test=tts) ─────────────────────────

import { TTS_TEST_GUIDES, TTS_TEST_INSTRUCTIONS } from '../src/dev/ttsScenario.ts';

test('개발용 TTS 시나리오: 한국어는 원문, 영어·중국어는 우회전·좌회전·도착 문장으로 읽는다', () => {
  const speak = (lang, i, distanceM) => instructionSpeech(TTS_TEST_INSTRUCTIONS[i], TTS_TEST_GUIDES, distanceM, lang, T[lang]);
  assert.equal(speak('ko', 1, 60), '(테스트) 600m 지점 턴 안내입니다');
  assert.equal(speak('en', 0, 70), 'In 70 meters, turn right.');
  assert.equal(speak('en', 1, 50), 'In 50 meters, turn left.');
  assert.equal(speak('en', 2, 10), 'You have arrived at your destination.');
  assert.equal(speak('zh', 0, 70), '前方70米，右转。');
  assert.equal(speak('zh', 1, 50), '前方50米，左转。');
  assert.equal(speak('zh', 2, 10), '您已到达目的地。');
});
