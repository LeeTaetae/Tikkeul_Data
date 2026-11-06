// 개발 빌드 전용 화면: 카카오 네이티브 SDK onGuidance 이벤트의 경로 점 수·잘림 여부를 확인한다(홈의 [DEV] 버튼으로만 들어온다).
// 기본은 꺼짐. 사용자가 이 화면에서 켠 경우에만 이벤트를 관찰해 기기 메모리에 모으며, 서버로 보내지 않는다. 운영 빌드에서는 아무것도 그리지 않는다.
// 로직은 src/lib/navigation/guidanceCapture.ts, 연결은 src/dev/guidanceCapture.ts.
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

// 타입만 가져온다(값을 import 하면 운영 번들에 진단 로직이 들어간다). 값은 아래 dev 모듈을 통해서만 쓴다.
import type { CaptureLevel, CaptureStatus, RouteSummary } from '../src/lib/navigation/guidanceCapture';

// Metro 가 운영 번들에서 이 분기를 제거한다(NativeNavigationScreen 의 spikeProbe 와 같은 방식).
const dev: typeof import('../src/dev/guidanceCapture') | null = __DEV__ ? require('../src/dev/guidanceCapture') : null;

const km = (m: number | null) => (m === null ? '-' : `${(m / 1000).toFixed(1)}km`);

function routeLines(r: RouteSummary): string[] {
  return [
    `경로 이벤트 "${r.reason}"`,
    `  SDK 전체 점 수(count): ${r.count ?? '알 수 없음'} / 실제 전달된 점: ${r.delivered}`,
    `  잘림: ${r.truncated ? '예 (6000점 상한)' : r.cause === 'invalid_points' ? '아니오, 단 일부 점이 빠짐' : r.cause === 'unknown' ? '알 수 없음' : '아니오'}` +
      (r.shortfall ? ` (빠진 점 ${r.shortfall}개${r.estimatedFullLengthM ? `, 전체 길이 추정 ${km(r.estimatedFullLengthM)}` : ''})` : ''),
    `  앱이 이 경로를 쓸 수 있나: ${r.appWouldUseRoute ? '예' : '아니오 (위험 레일이 비게 됨)'}`,
    `  전달된 경로 길이: ${km(r.lengthM)}, 점 간격 평균 ${r.avgSpacingM ?? '-'}m / 최대 ${r.maxSpacingM ?? '-'}m`,
  ];
}

function Panel({ impl }: { impl: NonNullable<typeof dev> }) {
  const router = useRouter();
  const capture = impl.guidanceCapture;
  const [status, setStatus] = useState<CaptureStatus>(() => capture.status());
  useEffect(() => {
    const id = setInterval(() => setStatus(capture.status()), 1000);
    return () => clearInterval(id);
  }, [capture]);
  const refresh = () => setStatus(capture.status());

  const turnOn = (level: CaptureLevel) => {
    if (!capture.setLevel(level)) Alert.alert('켤 수 없음', '개발 빌드에서만 켤 수 있습니다.');
    refresh();
  };
  const confirmCoordinates = () =>
    Alert.alert('좌표 포함 기록', '경로 점과 현재 위치(소수 5자리)를 이 기기의 메모리에만 모읍니다. 앱이 서버로 보내지 않습니다. 끝나면 [삭제]를 누르세요. 켤까요?', [
      { text: '취소', style: 'cancel' },
      { text: '켜기', onPress: () => turnOn('coordinates') },
    ]);
  const share = () => {
    const text = capture.exportText();
    Alert.alert('공유', status.holdsCoordinates ? '좌표가 들어 있습니다. 공유 대상은 직접 고르세요(예: AirDrop 으로 내 PC).' : '좌표 없는 요약입니다.', [
      { text: '취소', style: 'cancel' },
      { text: '공유', onPress: () => { void Share.share({ message: text }); } },
    ]);
  };
  const clear = () => { capture.clear(); refresh(); };

  const level = status.level;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>[DEV] 카카오 내비 onGuidance 진단</Text>
      <Text style={styles.note}>기본은 꺼짐입니다. 켜면 경로 안내를 열기 전에 이 화면에서 설정하고, 홈으로 가서 평소처럼 안내를 시작하세요. 기록은 이 기기 메모리에만 있고 서버로 전송되지 않으며, 앱을 끄거나 [삭제]하면 사라집니다. 기존 안내·TTS·경고 동작은 바뀌지 않습니다.</Text>
      <Text style={styles.status}>현재: {level === 'off' ? '꺼짐' : level === 'summary' ? '요약만 (좌표 없음)' : '좌표 포함 (기기 메모리)'}</Text>
      <View style={styles.row}>
        <Pressable style={[styles.button, level === 'off' && styles.selected]} onPress={() => { capture.setLevel('off'); refresh(); }}><Text style={styles.buttonText}>끄기</Text></Pressable>
        <Pressable style={[styles.button, level === 'summary' && styles.selected]} onPress={() => turnOn('summary')}><Text style={styles.buttonText}>요약만 켜기</Text></Pressable>
        <Pressable style={[styles.button, level === 'coordinates' && styles.selected]} onPress={confirmCoordinates}><Text style={styles.buttonText}>좌표 포함 켜기</Text></Pressable>
      </View>
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={share}><Text style={styles.buttonText}>공유</Text></Pressable>
        <Pressable style={styles.button} onPress={clear}><Text style={styles.buttonText}>기록 삭제</Text></Pressable>
        <Pressable style={styles.button} onPress={() => router.replace('/')}><Text style={styles.buttonText}>홈으로</Text></Pressable>
      </View>
      <Text style={styles.section}>수신 현황</Text>
      <Text style={styles.line}>경로 이벤트 {status.routeEvents}건 / 위치 이벤트 {status.locationEvents}건{status.recorderErrors ? ` / 기록 오류 ${status.recorderErrors}` : ''}</Text>
      <Text style={styles.line}>
        위치: 유효 {status.location.valid} / 무효 {status.location.invalid} / hdop {status.location.hdopMin ?? '-'}~{status.location.hdopMax ?? '-'} / 최대 속도 {status.location.speedMaxKmh ?? '-'}km/h / 최대 간격 {status.location.maxGapMs ?? '-'}ms (2.5초 초과 {status.location.gapsOver2500ms}회)
      </Text>
      <Text style={styles.line}>좌표 보관: {status.holdsCoordinates ? '있음 (삭제 가능)' : '없음'}</Text>
      <Text style={styles.line}>카카오 네이티브 모듈: {impl.nativeModuleAvailable() ? '이 빌드에 있음' : '이 빌드에 없음 → 이벤트가 오지 않습니다(네이티브 재빌드 필요)'}</Text>
      <Text style={styles.section}>GPS 매칭·진행 방향 (숫자 통계, 좌표 없음)</Text>
      <Text style={styles.line}>
        경로에 맞춘 위치 {status.match.matched}/{status.match.evaluated} (경로 {impl.MATCH_LATERAL_M}m 밖{status.match.offRoute}, 경로 전 수신 {status.match.noRoute}) / 횡거리 중앙 {status.match.lateralMedianM ?? '-'}m · p90 {status.match.lateralP90M ?? '-'}m · 최대 {status.match.lateralMaxM ?? '-'}m
      </Text>
      <Text style={styles.line}>
        경로상 진행 {status.match.lastAlongM ?? '-'}m / 경로 길이 {status.match.routeLengthM ?? '-'}m / 뒤로 50m↑ 되돌아감 {status.match.backwardJumps}회 / 경로 변경 {status.match.routeChanges}회
      </Text>
      <Text style={styles.line}>
        진행 방향이 경로와 반대(90°↑): {status.match.headingOpposite}/{status.match.headingEvaluated}회 (angle 기준이 실기기로 확인되지 않아 참고용)
      </Text>
      {status.routes.length === 0 ? <Text style={styles.line}>아직 경로 이벤트가 없습니다.</Text> : status.routes.map((r, i) => (
        <View key={i} style={[styles.card, r.truncated || !r.appWouldUseRoute ? styles.bad : styles.good]}>
          {routeLines(r).map((line, j) => <Text key={j} style={styles.line}>{line}</Text>)}
        </View>
      ))}
    </ScrollView>
  );
}

export default function GuidanceCaptureScreen() {
  if (!dev) return null; // 운영 빌드: 아무것도 그리지 않는다
  return <Panel impl={dev} />;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 56, gap: 10, backgroundColor: '#fff' },
  title: { fontSize: 18, fontWeight: '800', color: '#111' },
  note: { fontSize: 13, lineHeight: 19, color: '#444' },
  status: { fontSize: 15, fontWeight: '700', color: '#111' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  button: { backgroundColor: '#222', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  selected: { backgroundColor: '#0a7d3b' },
  buttonText: { color: 'white', fontSize: 13, fontWeight: '700' },
  section: { fontSize: 15, fontWeight: '700', marginTop: 8, color: '#111' },
  line: { fontSize: 12.5, lineHeight: 18, color: '#222' },
  card: { borderRadius: 10, padding: 10, gap: 2 },
  good: { backgroundColor: '#E8F8EE' },
  bad: { backgroundColor: '#FDECEC' },
});
