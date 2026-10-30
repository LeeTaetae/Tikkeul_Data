import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearGuidanceRequest, getGuidanceRequest } from '../lib/navigation/guidanceSession';
import { nativeNavigationRequest } from '../lib/navigation/nativeNavigationRequest';
import { getNativeNavigationStatus, openNativeNavigation } from '../native/kakaoNavigation';
import type { NativeNavigationResult } from '../native/navigationTypes';
import { colors, radius, space } from '../theme';

const FAILURE_KEYS: Record<string, string> = {
  NATIVE_BUILD_REQUIRED: 'nav.nativeBuildRequired',
  NATIVE_APP_REQUIRED: 'nav.nativeAppRequired',
  NOT_CONFIGURED: 'nav.nativeNotConfigured',
  UNSUPPORTED_MODE: 'nav.nativeDrivingOnly',
  PERMISSION_DENIED: 'nav.gpsDenied',
  PRECISE_LOCATION_REQUIRED: 'nav.nativePreciseLocation',
  SERVICES_DISABLED: 'nav.gpsServicesDisabled',
  SDK_AUTH_FAILED: 'nav.nativeAuthenticationFailed',
};

export function NativeNavigationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
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
      await Speech.stop();
      if (__DEV__) console.warn('[native-nav] step speech ok, opening'); // 임시 진단 로그: 확인 후 제거
      return openNativeNavigation(options);
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
      clearGuidanceRequest();
      router.replace('/');
    }).catch((failure: { code?: string }) => {
      if (pending.current === current) pending.current = null;
      if (__DEV__) console.warn('[native-nav] failure', failure.code, (failure as { message?: string }).message); // 임시 진단 로그: 확인 후 제거
      if (!active) return;
      setError(failure.code === 'NO_REQUEST' ? 'nav.noRequest' : FAILURE_KEYS[failure.code ?? ''] ?? 'nav.nativeOpenFailed');
    });
    return () => { active = false; };
  }, [request, attempt, session, router]);

  const retry = () => {
    pending.current = null;
    setError(null);
    setAttempt(value => value + 1);
  };

  return <SafeAreaView style={styles.root}>
    <View style={styles.card}>
      {!error && <ActivityIndicator color={colors.brand} size="large" />}
      <Text style={styles.title}>{t(error ?? 'nav.nativeOpening')}</Text>
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
