// SPIKE(임시, 검증 후 삭제): 네이티브 내비 실행 중 JS 이벤트·타이머·API·위험 훅이 동작하는지 로그로 확인한다.
// Debug-only observer; the product hazard rail uses its own onGuidance subscription.
import { useEffect, useRef } from 'react';
import { AppState, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import {
  createJsDiagnostics, diagnose, formatSummaryLines,
  type JsSpikeSummary, type NativeSpikeSummary, type SpikeDiagnosis,
} from '../lib/navigation/spikeDiagnostics';

interface SpikeNativeModule {
  addListener?: (e: string, l: (ev: Record<string, unknown>) => void) => { remove(): void };
  // 디버그 빌드 APK 에만 있다(이전 APK·Release 에는 없거나 "disabled"/null 을 돌려준다).
  spikeAck?: (session: number, id: number) => string;
  getSpikeSummary?: () => NativeSpikeSummary | null;
}
const spikeModule = () => requireOptionalNativeModule<SpikeNativeModule>('KakaoNavigation');

const TIMER_MS = 5000;
// 주행 한 번 동안의 JS 쪽 기록. 화면(SpikeProbe)이 다시 그려져도 유지되어야 해서 컴포넌트 밖에 둔다.
const diag = createJsDiagnostics(TIMER_MS);

const log = (...args: unknown[]) => console.warn('[spike]', ...args);
const appStateNow = (): string => AppState.currentState ?? 'unknown';

export interface SpikeReport { native: NativeSpikeSummary; js: JsSpikeSummary; diagnosis: SpikeDiagnosis }

/** 주행이 끝난 뒤 네이티브·JS 요약을 합쳐 판정한다. 디버그 진단이 없는 빌드이면 null (화면에 아무것도 보이지 않는다) */
export function collectSpikeReport(): SpikeReport | null {
  if (!__DEV__) return null;
  const native = spikeModule()?.getSpikeSummary?.() ?? null;
  if (!native) return null;
  const js = diag.summary();
  return { native, js, diagnosis: diagnose(native, js) };
}

/** 주행 종료 후 개발 화면에 보여 주는 진단 요약. 좌표·위치값은 없다 */
export function SpikeReportCard({ report }: { report: SpikeReport }) {
  const lines = formatSummaryLines(report.native, report.js, report.diagnosis);
  const ok = report.diagnosis.verdict === 'ok';
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: ok ? '#E8F8EE' : '#FDECEC' }}>
      <Text style={{ fontWeight: '700', fontSize: 15, color: '#111' }}>[개발] JS 이벤트 전달 진단</Text>
      {lines.map((line, i) => <Text key={i} style={{ fontSize: 13, lineHeight: 19, color: '#222' }}>{line}</Text>)}
    </View>
  );
}

export function SpikeProbe() {
  const counts = useRef({ location: 0, route: 0 });
  const started = useRef(Date.now());

  // 1) 네이티브 → JS 이벤트
  useEffect(() => {
    const mod = spikeModule();
    log('module', !!mod, 'addListener', typeof mod?.addListener, 'spikeAck', typeof mod?.spikeAck);
    const sub = mod?.addListener?.('onSpike', (ev) => {
      if (ev.kind === 'location') {
        counts.current.location++;
        // 이벤트 번호를 기록하고 같은 번호를 네이티브로 ACK 한다. 중복·잘못된 번호는 receive 가 null 을 돌려준다.
        const ack = diag.receive(ev.session, ev.id, Date.now(), appStateNow());
        if (ack) {
          try { mod.spikeAck?.(ack.session, ack.id); } catch (e) { log('spikeAck failed', e instanceof Error ? e.message : String(e)); }
        }
        // 좌표는 로그에 남기지 않는다(번호·속도·정확도 지표만).
        if (counts.current.location <= 3 || counts.current.location % 10 === 0) log('location', JSON.stringify({ session: ev.session, id: ev.id, speedKmh: ev.speedKmh, hdop: ev.hdop, valid: ev.valid }), 'appState', appStateNow());
      } else if (ev.kind === 'route') {
        counts.current.route++;
        const keys = (ev.keys as string[]) ?? [];
        log('route', ev.reason, 'count', ev.count, 'keys', JSON.stringify(keys)); // 좌표 값은 남기지 않는다
      }
    });
    return () => sub?.remove();
  }, []);

  // 2) JS 타이머: 5초마다 찍는다. 네이티브 화면이 앞에 있는 동안 멈추는지 본다.
  useEffect(() => {
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      diag.tick(now, appStateNow());
      log('timer tick', 'gapMs', now - last, 'elapsedS', Math.round((now - started.current) / 1000), 'events', JSON.stringify(counts.current), 'appState', appStateNow());
      last = now;
    }, TIMER_MS);
    return () => clearInterval(id);
  }, []);

  // (위험 훅과 레일 전송은 useNativeHazardRail 로 옮겼다. 여기서는 이벤트 전달 진단만 한다.)

  return null;
}
