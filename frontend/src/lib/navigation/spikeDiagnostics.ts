// SPIKE(임시, 검증 후 삭제): Kakao 주행 화면이 앞에 있는 동안 JS 가 네이티브 위치 이벤트를 계속 받는지 가리는 진단 로직.
// React·네이티브에 의존하지 않는 순수 함수라 Node 로 테스트한다. 좌표·위치값은 다루지 않는다(이벤트 번호와 시각만).
//
// 흐름: 네이티브가 위치 이벤트에 (session, id) 를 붙여 보낸다 → JS 가 받아 receive() 로 기록하고 같은 번호를 ACK 로 돌려준다
//       → 네이티브가 ACK 를 세어 화면 오버레이에 보여 준다. 주행이 끝나면 양쪽 요약을 합쳐 diagnose() 로 판정한다.

export interface NativeSpikeSummary {
  session: number;
  /** 네이티브가 JS 로 보낸 위치 이벤트 수 */
  emitted: number;
  /** 네이티브가 정상으로 받은 ACK 수 */
  acked: number;
  dupAck: number;
  badAck: number;
  lastEventId: number;
  lastAckId: number;
  /** 연속한 두 이벤트 발생 사이의 최대 간격(ms) */
  maxEmitGapMs: number;
  /** 마지막 정상 ACK 의 기기 시각(epoch ms). 없으면 0 */
  lastAckAtMs: number;
}

export interface JsSpikeSummary {
  session: number | null;
  /** JS 가 실제로 받은(중복 제외) 위치 이벤트 수 */
  received: number;
  duplicates: number;
  invalid: number;
  /** JS 가 이벤트를 받은 시각 사이의 최대 간격(ms) */
  maxEventGapMs: number;
  lastEventAtMs: number | null;
  timerTicks: number;
  /** 타이머 틱 사이의 최대 간격(ms). 기대값(timerIntervalMs)보다 훨씬 크면 타이머가 멈췄던 것 */
  maxTimerGapMs: number;
  timerIntervalMs: number;
  lastAppState: string;
}

/** 번호는 1 이상의 정수여야 한다. 아니면 null (JS → 네이티브 ACK 로 보내지 않는다) */
export function parseAckId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

export function createJsDiagnostics(timerIntervalMs: number) {
  let session: number | null = null;
  let seen = new Set<number>();
  let received = 0;
  let duplicates = 0;
  let invalid = 0;
  let maxEventGapMs = 0;
  let lastEventAtMs: number | null = null;
  let timerTicks = 0;
  let maxTimerGapMs = 0;
  let lastTickMs: number | null = null;
  let lastAppState = 'unknown';

  const reset = (next: number | null) => {
    session = next;
    seen = new Set();
    received = duplicates = invalid = maxEventGapMs = timerTicks = maxTimerGapMs = 0;
    lastEventAtMs = null;
    lastTickMs = null;
  };

  return {
    /**
     * 위치 이벤트를 기록하고, 네이티브로 돌려보낼 ACK 번호를 알려 준다. 보낼 필요가 없으면 null.
     * 세션 번호가 바뀌면(새 주행) 기록을 새로 시작한다. 같은 번호가 또 오면 중복으로만 센다.
     */
    receive(sessionValue: unknown, idValue: unknown, nowMs: number, appState: string): { session: number; id: number } | null {
      const nextSession = parseAckId(sessionValue);
      const id = parseAckId(idValue);
      if (nextSession === null || id === null) {
        invalid++;
        return null;
      }
      if (nextSession !== session) reset(nextSession);
      lastAppState = appState;
      if (seen.has(id)) {
        duplicates++;
        return null;
      }
      seen.add(id);
      received++;
      if (lastEventAtMs !== null) maxEventGapMs = Math.max(maxEventGapMs, nowMs - lastEventAtMs);
      lastEventAtMs = nowMs;
      return { session: nextSession, id };
    },
    tick(nowMs: number, appState: string): void {
      lastAppState = appState;
      if (lastTickMs !== null) maxTimerGapMs = Math.max(maxTimerGapMs, nowMs - lastTickMs);
      lastTickMs = nowMs;
      timerTicks++;
    },
    summary(): JsSpikeSummary {
      return { session, received, duplicates, invalid, maxEventGapMs, lastEventAtMs, timerTicks, maxTimerGapMs, timerIntervalMs, lastAppState };
    },
  };
}

export type SpikeVerdict = 'ok' | 'no-native-events' | 'js-not-receiving' | 'ack-failed' | 'js-lost-events' | 'js-stalled';

export interface SpikeDiagnosis {
  verdict: SpikeVerdict;
  /** 판정과 별개로 참고할 사실. 타이머가 멈췄더라도 이벤트가 계속 오면 판정은 ok 다(설계는 타이머가 아니라 이벤트가 박자를 만든다) */
  notes: Array<'timer-paused'>;
}

/** 이 값(ms) 이상 JS 쪽 이벤트 간격이 네이티브 발생 간격보다 길면 JS 가 멈췄던 것으로 본다 */
export const STALL_MARGIN_MS = 3000;
/** 주행이 끝나는 순간 오가던 이벤트를 놓친 것으로 보지 않도록 허용하는 건수 */
const IN_FLIGHT_TOLERANCE = 2;

/** 주행 종료 후 네이티브·JS 요약을 합쳐 판정한다. 위에서부터 먼저 맞는 것이 결과다 */
export function diagnose(native: NativeSpikeSummary, js: JsSpikeSummary): SpikeDiagnosis {
  const notes: SpikeDiagnosis['notes'] = js.maxTimerGapMs > js.timerIntervalMs + STALL_MARGIN_MS ? ['timer-paused'] : [];
  // SDK 가 위치를 안 줬다면 JS 문제가 아니다.
  if (native.emitted === 0) return { verdict: 'no-native-events', notes };
  if (js.received === 0) return { verdict: 'js-not-receiving', notes };
  // JS 는 받았는데 네이티브가 ACK 를 못 받았다면 JS → 네이티브 방향이 막힌 것이다.
  if (js.received - native.acked > IN_FLIGHT_TOLERANCE) return { verdict: 'ack-failed', notes };
  if (native.emitted - js.received > Math.max(IN_FLIGHT_TOLERANCE, Math.floor(native.emitted * 0.05))) return { verdict: 'js-lost-events', notes };
  if (js.maxEventGapMs > native.maxEmitGapMs + STALL_MARGIN_MS) return { verdict: 'js-stalled', notes };
  return { verdict: 'ok', notes };
}

export const VERDICT_LABEL: Record<SpikeVerdict, string> = {
  ok: '정상: JS 가 위치 이벤트를 계속 받았다',
  'no-native-events': '네이티브가 위치 이벤트를 한 번도 보내지 않았다(SDK 주행이 시작되지 않았거나 위치가 없음). JS 문제는 판정할 수 없다',
  'js-not-receiving': 'JS 가 위치 이벤트를 한 번도 받지 못했다(네이티브 → JS 전달 불가)',
  'ack-failed': 'JS 는 받았지만 네이티브가 ACK 를 받지 못했다(JS → 네이티브 호출 실패)',
  'js-lost-events': '네이티브가 보낸 것보다 JS 가 받은 이벤트가 눈에 띄게 적다(유실)',
  'js-stalled': 'JS 가 중간에 멈췄다가 다시 받았다(이벤트 간격이 네이티브보다 길다)',
};

const sec = (ms: number) => (ms / 1000).toFixed(1) + '초';
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** 진단 카드에 줄 단위로 보여줄 문장. 좌표·위치값은 들어 있지 않다 */
export function formatSummaryLines(native: NativeSpikeSummary, js: JsSpikeSummary, diagnosis: SpikeDiagnosis): string[] {
  return [
    `판정: ${VERDICT_LABEL[diagnosis.verdict]}`,
    ...(diagnosis.notes.includes('timer-paused') ? ['참고: JS 타이머가 멈췄던 구간이 있다(이벤트 기반 갱신이 필요하다는 뜻)'] : []),
    `주행 번호: ${native.session}`,
    `위치 이벤트 — 네이티브 발생 ${native.emitted}건 / JS 수신 ${js.received}건 / 네이티브 ACK ${native.acked}건`,
    `ACK 이상 — 중복 ${native.dupAck}, 잘못된 ID ${native.badAck} (JS 쪽: 중복 ${js.duplicates}, 잘못된 값 ${js.invalid})`,
    `최대 이벤트 간격 — 네이티브 ${sec(native.maxEmitGapMs)} / JS ${sec(js.maxEventGapMs)}`,
    `마지막 이벤트 ID ${native.lastEventId}, 마지막 ACK ID ${native.lastAckId}, 마지막 ACK ${native.lastAckAtMs > 0 ? clock(native.lastAckAtMs) : '없음'}`,
    `JS 타이머 — ${js.timerTicks}회, 최대 간격 ${sec(js.maxTimerGapMs)} (기대 ${sec(js.timerIntervalMs)})`,
    `마지막 AppState: ${js.lastAppState}`,
  ];
}
