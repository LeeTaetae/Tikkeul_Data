import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { speaker, ttsDebug } from '../lib/speech/speaker';
import { SPEECH_LOCALES, speechLanguageOf } from '../lib/speech/speechLocale';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { checkGuidanceFix } from '../lib/location/guidanceFix';
import { clearGuidanceRequest, getGuidanceRequest } from '../lib/navigation/guidanceSession';
import { nativeNavigationRequest } from '../lib/navigation/nativeNavigationRequest';
import { useNearbyProtectionZoneStatus } from '../lib/navigation/useNearbyProtectionZoneStatus';
import { getNativeNavigationStatus, openNativeNavigation, onNativeNavigationLanguageChanged } from '../native/kakaoNavigation';
import type { NativeNavigationResult } from '../native/navigationTypes';
import { VisionHazardController } from '../components/vision/VisionHazardController';
import { colors, radius, space } from '../theme';
import { NativeHazardRailBridge } from '../components/navigation/NativeHazardRailBridge';
import type { SpikeReport } from '../dev/spikeProbe';

// Metro eliminates this branch in production; diagnostics never drive the product rail.
const diagnostics: typeof import('../dev/spikeProbe') | null = __DEV__ ? require('../dev/spikeProbe') : null;

const FAILURE_KEYS: Record<string, string> = {
  NATIVE_BUILD_REQUIRED: 'nav.nativeBuildRequired',
  NATIVE_APP_REQUIRED: 'nav.nativeAppRequired',
  NOT_CONFIGURED: 'nav.nativeNotConfigured',
  UNSUPPORTED_MODE: 'nav.nativeDrivingOnly',
  PERMISSION_DENIED: 'nav.gpsDenied',
  PRECISE_LOCATION_REQUIRED: 'nav.nativePreciseLocation',
  SERVICES_DISABLED: 'nav.gpsServicesDisabled',
  SDK_AUTH_FAILED: 'nav.nativeAuthenticationFailed',
  GPS_UNAVAILABLE: 'nav.gpsNoSignal',
  GPS_INACCURATE: 'nav.gpsWeak',
};
// 실내·지하에서는 정밀 위치가 늦거나 안 온다. 이 시간 안에 못 받으면 GPS 수신 불량으로 안내한다.
const FIX_TIMEOUT_MS = 15_000;

export function NativeNavigationScreen() {
  const focused=useIsFocused();
  const { t, i18n } = useTranslation();
  useEffect(() => onNativeNavigationLanguageChanged(language => { void i18n.changeLanguage(language); }), [i18n]);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [locating, setLocating] = useState(false);
  // 카카오 내비 SDK 화면이 떠 있는 동안(iOS는 모달 presentViewController라 RN 루트와 같은 프로세스에 남아있다) true.
  const [navigating, setNavigating] = useState(false);
  // 경로를 안 들고 있어 useRouteZones(경로 기반)를 못 쓰니, 현재 위치만으로 보호구역 여부를 따로 추적한다.
  const { inZone: inProtectionZone, speedKmh,fix:weatherFallbackFix } = useNearbyProtectionZoneStatus(navigating);
  const [spikeReport, setSpikeReport] = useState<SpikeReport | null>(null); // SPIKE(임시)
  const pending = useRef<Promise<NativeNavigationResult> | null>(null);
  // navigation 은 탭 화면이라 홈으로 돌아가도 이 화면이 남는다. 다시 들어올 때마다(포커스) 새 안내 요청으로 처음부터 시작한다.
  const [session, setSession] = useState(0);
  useFocusEffect(useCallback(() => {
    setError(null);
    setSession(value => value + 1);
  }, []));
  const request = useMemo(getGuidanceRequest, [session]); // session 이 바뀔 때마다 새 요청을 읽는다

  useEffect(() => {
    let active = true;
    const open = async () => {
      if (!request) throw Object.assign(new Error('No guidance request'), { code: 'NO_REQUEST' });
      const options = nativeNavigationRequest(request);
      if (Platform.OS === 'web') throw Object.assign(new Error('Native app required'), { code: 'NATIVE_APP_REQUIRED' });
      const status = getNativeNavigationStatus();
      if (!status.available) throw Object.assign(new Error('Native build required'), { code: 'NATIVE_BUILD_REQUIRED' });
      if (!status.configured) throw Object.assign(new Error('Native key required'), { code: 'NOT_CONFIGURED' });
      if (__DEV__) console.warn('[native-nav] step status ok'); // 임시 진단 로그: 확인 후 제거
      if (!(await Location.hasServicesEnabledAsync())) throw Object.assign(new Error('Location is disabled'), { code: 'SERVICES_DISABLED' });
      if (__DEV__) console.warn('[native-nav] step services ok'); // 임시 진단 로그: 확인 후 제거
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw Object.assign(new Error('Location permission denied'), { code: 'PERMISSION_DENIED' });
      if (__DEV__) console.warn('[native-nav] step permission ok'); // 임시 진단 로그: 확인 후 제거
      // 출발점은 경로 검색 때 좌표가 아니라 지금 다시 잰 정밀 위치를 쓴다. 기준에 못 미치면 진행하지 않고 알린다
      // (오래된 좌표·넓은 오차·서울시청 대체 좌표가 SDK 출발점이 되지 않게 한다).
      setLocating(true);
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
      ]);
      setLocating(false);
      if (!position) throw Object.assign(new Error('No current position'), { code: 'GPS_UNAVAILABLE' });
      const fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp };
      const problem = checkGuidanceFix(fix, Date.now());
      // 개발 빌드 전용: 네이티브 TikkeulNavGps 로그(SDK gpsOrigin·gpsMatched)와 비교할 Expo 측정값.
      if (__DEV__) console.warn('[native-nav] expo fix', { lat: fix.lat.toFixed(5), lng: fix.lng.toFixed(5), accuracyM: fix.accuracy, ageMs: Date.now() - fix.timestamp, problem });
      if (problem) throw Object.assign(new Error(`Current position is ${problem}`), { code: problem === 'inaccurate' ? 'GPS_INACCURATE' : 'GPS_UNAVAILABLE' });
      await speaker.stop('native-navigation-open');
      // The native activity owns car speech: SDK recordings for Korean, Android TTS for English/Chinese.
      ttsDebug({ stage: 'language', navigationMode: 'car', appLanguage: speechLanguageOf(i18n.language), ttsLanguage: SPEECH_LOCALES[speechLanguageOf(i18n.language)], engineLanguage: speechLanguageOf(i18n.language) === 'ko' ? 'kakao-sdk:recorded-voice' : 'android-tts', reason: 'Native car activity owns speech; actual voice language is logged under TikkeulVoice' });
      if (__DEV__) console.warn('[native-nav] step speech ok, opening'); // 임시 진단 로그: 확인 후 제거
      setNavigating(true);
      return openNativeNavigation({
        ...options,
        originLatitude: fix.lat,
        originLongitude: fix.lng,
        language: speechLanguageOf(i18n.language),
      });
    };
    // Reuse the in-flight call through React development effect replays. A second
    // native UI must never open because Strict Mode repeated a mount effect.
    if (__DEV__) console.warn('[native-nav] effect', { hasPending: pending.current !== null, attempt }); // 임시 진단 로그: 확인 후 제거
    pending.current ??= open();
    // 호출이 끝나면(성공·실패) 가드를 풀어 다음 안내가 새로 열 수 있게 한다. 진행 중일 때만 재사용한다.
    const current = pending.current;
    current.then(() => {
      if (pending.current === current) pending.current = null;
      if (!active) return;
      setNavigating(false);
      // SPIKE(임시): 개발 빌드에서는 주행이 끝난 뒤 JS 이벤트 전달 진단 요약을 보여 주고, 버튼으로 홈에 돌아간다.
      const report = diagnostics?.collectSpikeReport();
      if (report) { setSpikeReport(report); return; }
      clearGuidanceRequest();
      router.replace('/');
    }).catch((failure: { code?: string }) => {
      if (pending.current === current) pending.current = null;
      if (__DEV__) console.warn('[native-nav] failure', failure.code, (failure as { message?: string }).message); // 임시 진단 로그: 확인 후 제거
      if (!active) return;
      setNavigating(false);
      setError(failure.code === 'NO_REQUEST' ? 'nav.noRequest' : FAILURE_KEYS[failure.code ?? ''] ?? 'nav.nativeOpenFailed');
    });
    return () => { active = false; };
  }, [request, attempt, session, router]);

  const retry = () => {
    pending.current = null;
    setError(null);
    setAttempt(value => value + 1);
  };

  const leaveSpikeReport = () => { setSpikeReport(null); clearGuidanceRequest(); router.replace('/'); }; // SPIKE(임시)
  if (spikeReport && diagnostics) {
    return <SafeAreaView style={styles.root}>
      <diagnostics.SpikeReportCard report={spikeReport} />
      <Pressable accessibilityRole="button" onPress={leaveSpikeReport} style={[styles.button, { marginTop: space.md }]}><Text style={styles.buttonText}>{t('nav.goHome')}</Text></Pressable>
    </SafeAreaView>;
  }

  return <SafeAreaView style={styles.root}>
    {/* 전방 비전 경고(ADR 0002). 카카오 내비 SDK 화면이 이 화면을 모달로 덮는 동안에도 진동은 울린다 - 배너는
        SDK 화면 아래 깔려 안 보인다(네이티브 오버레이 작업이 따로 필요, 지금은 범위 밖). */}
    <VisionHazardController enabled={focused && navigating} inProtectionZone={inProtectionZone} speedKmh={speedKmh} />
    {Platform.OS !== 'web' && focused && <NativeHazardRailBridge fallbackFix={weatherFallbackFix} />}
    {diagnostics && <diagnostics.SpikeProbe />}{/* Debug only */}
    <View style={styles.card}>
      {!error && <ActivityIndicator color={colors.brand} size="large" />}
      <Text style={styles.title}>{t(error ?? (locating ? 'nav.locating' : 'nav.nativeOpening'))}</Text>
      {!!request?.destinationLabel && <Text style={styles.destination}>{request.destinationLabel}</Text>}
      {error && <>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.button}><Text style={styles.buttonText}>{t('nav.retry')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.homeButton}><Text style={styles.destination}>{t('nav.goHome')}</Text></Pressable>
      </>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, justifyContent: 'center', padding: space.lg },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  title: { fontSize: 19, lineHeight: 28, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  destination: { fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand, borderRadius: radius.md },
  buttonText: { fontSize: 16, fontWeight: '700', color: colors.surface },
  homeButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
