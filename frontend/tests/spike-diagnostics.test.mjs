// SPIKE(임시) 진단 로직 테스트: 네이티브 위치 이벤트 → JS 수신 → ACK 흐름과 주행 종료 후 판정을 Mock 이벤트로 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createJsDiagnostics, diagnose, formatSummaryLines, parseAckId } from '../src/lib/navigation/spikeDiagnostics.ts';

const native = (extra = {}) => ({ session: 1, emitted: 100, acked: 100, dupAck: 0, badAck: 0, lastEventId: 100, lastAckId: 100, maxEmitGapMs: 1100, lastAckAtMs: Date.UTC(2026, 10, 4, 6, 30, 0), ...extra });
const js = (extra = {}) => ({ session: 1, received: 100, duplicates: 0, invalid: 0, maxEventGapMs: 1200, lastEventAtMs: 99_000, timerTicks: 20, maxTimerGapMs: 5100, timerIntervalMs: 5000, lastAppState: 'background', ...extra });

test('parseAckId: 1 이상의 정수만 통과한다', () => {
  for (const ok of [1, 2, 999_999]) assert.equal(parseAckId(ok), ok);
  for (const bad of [0, -1, 1.5, NaN, Infinity, '3', null, undefined, {}, 2 ** 60]) assert.equal(parseAckId(bad), null);
});

test('receive: 정상 이벤트는 (session, id) 를 돌려주고 수신 수와 최대 간격을 센다', () => {
  const d = createJsDiagnostics(5000);
  assert.deepEqual(d.receive(1, 1, 1000, 'background'), { session: 1, id: 1 });
  assert.deepEqual(d.receive(1, 2, 2000, 'background'), { session: 1, id: 2 });
  assert.deepEqual(d.receive(1, 3, 6500, 'background'), { session: 1, id: 3 }); // JS 가 4.5초 멈췄다 깨어난 경우
  const s = d.summary();
  assert.equal(s.received, 3);
  assert.equal(s.maxEventGapMs, 4500);
  assert.equal(s.lastEventAtMs, 6500);
  assert.equal(s.lastAppState, 'background');
});

test('receive: 중복 ID 는 ACK 를 다시 보내지 않고, 잘못된 값은 세기만 한다', () => {
  const d = createJsDiagnostics(5000);
  d.receive(1, 1, 1000, 'active');
  assert.equal(d.receive(1, 1, 1500, 'active'), null);
  assert.equal(d.receive(1, 0, 1600, 'active'), null);
  assert.equal(d.receive(1, '2', 1700, 'active'), null);
  assert.equal(d.receive(undefined, 2, 1800, 'active'), null);
  const s = d.summary();
  assert.equal(s.received, 1);
  assert.equal(s.duplicates, 1);
  assert.equal(s.invalid, 3);
});

test('receive: 새 주행(session 변경)이면 기록을 새로 시작하므로 같은 ID 를 중복으로 보지 않는다', () => {
  const d = createJsDiagnostics(5000);
  d.receive(1, 1, 1000, 'active');
  d.receive(1, 2, 2000, 'active');
  d.tick(5000, 'active');
  assert.deepEqual(d.receive(2, 1, 90_000, 'active'), { session: 2, id: 1 });
  const s = d.summary();
  assert.equal(s.session, 2);
  assert.equal(s.received, 1);
  assert.equal(s.duplicates, 0);
  assert.equal(s.maxEventGapMs, 0); // 이전 주행과의 간격을 이번 주행에 섞지 않는다
  assert.equal(s.timerTicks, 0);
});

test('tick: 타이머 간격의 최대값과 마지막 AppState 를 기록한다', () => {
  const d = createJsDiagnostics(5000);
  d.tick(0, 'active');
  d.tick(5000, 'active');
  d.tick(25_000, 'background'); // 타이머가 15초 더 멈췄던 경우
  const s = d.summary();
  assert.equal(s.timerTicks, 3);
  assert.equal(s.maxTimerGapMs, 20_000);
  assert.equal(s.lastAppState, 'background');
});

test('diagnose: 모두 정상이면 ok', () => {
  assert.deepEqual(diagnose(native(), js()), { verdict: 'ok', notes: [] });
});

test('diagnose: 네이티브가 이벤트를 안 보냈으면 JS 문제가 아니다', () => {
  assert.equal(diagnose(native({ emitted: 0, acked: 0 }), js({ received: 0 })).verdict, 'no-native-events');
});

test('diagnose: 네이티브는 보냈는데 JS 가 하나도 못 받았으면 js-not-receiving', () => {
  assert.equal(diagnose(native({ acked: 0 }), js({ received: 0 })).verdict, 'js-not-receiving');
});

test('diagnose: JS 는 받았는데 네이티브 ACK 가 부족하면 ack-failed (끝 무렵 2건은 허용)', () => {
  assert.equal(diagnose(native({ acked: 40 }), js()).verdict, 'ack-failed');
  assert.equal(diagnose(native({ acked: 98 }), js()).verdict, 'ok');
});

test('diagnose: JS 수신이 발생보다 5% 넘게 적으면 js-lost-events', () => {
  assert.equal(diagnose(native({ acked: 80 }), js({ received: 80 })).verdict, 'js-lost-events');
  assert.equal(diagnose(native({ acked: 96 }), js({ received: 96 })).verdict, 'ok');
});

test('diagnose: JS 이벤트 간격이 네이티브보다 3초 넘게 길면 js-stalled', () => {
  assert.equal(diagnose(native(), js({ maxEventGapMs: 30_000 })).verdict, 'js-stalled');
  // SDK 자체가 오래 조용했다면(예: 터널) 양쪽 간격이 같으므로 JS 탓이 아니다.
  assert.equal(diagnose(native({ maxEmitGapMs: 30_000 }), js({ maxEventGapMs: 30_500 })).verdict, 'ok');
});

test('diagnose: 타이머가 멈췄어도 이벤트가 계속 왔다면 ok 이고 참고로만 남긴다', () => {
  assert.deepEqual(diagnose(native(), js({ maxTimerGapMs: 60_000 })), { verdict: 'ok', notes: ['timer-paused'] });
});

test('Mock 주행: 1초 간격 120건을 JS 가 모두 받고 ACK 하면 ok, 중간에 JS 가 20초 멈추면 js-stalled', () => {
  const run = (pauseAtId) => {
    const d = createJsDiagnostics(5000);
    let acked = 0;
    let t = 0;
    for (let id = 1; id <= 120; id++) {
      t += id === pauseAtId ? 20_000 : 1000;
      if (d.receive(1, id, t, 'background')) acked++;
      if (id % 5 === 0) d.tick(t, 'background');
    }
    return diagnose(native({ emitted: 120, acked, lastEventId: 120, lastAckId: 120 }), d.summary());
  };
  assert.equal(run(null).verdict, 'ok');
  assert.equal(run(60).verdict, 'js-stalled');
});

test('formatSummaryLines: 요청한 항목이 모두 있고 좌표·위치값은 없다', () => {
  const text = formatSummaryLines(native(), js(), diagnose(native(), js())).join('\n');
  for (const needle of ['네이티브 발생 100건', 'JS 수신 100건', '네이티브 ACK 100건', '최대 이벤트 간격', '마지막 ACK', '타이머', 'AppState: background', '마지막 이벤트 ID 100']) {
    assert.ok(text.includes(needle), needle);
  }
  assert.doesNotMatch(text, /lat|lng|latitude|longitude|위도|경도/i);
});
