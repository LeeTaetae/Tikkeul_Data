import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LocationState } from '../../lib/location/useUserLocation';
import { colors, radius, space } from '../../theme';
import { Card } from '../ui/Card';

type NotReady = Exclude<LocationState, { status: 'ready' }>;

// 위치를 얻지 못했을 때 보여주는 상태 카드. 이 카드가 보이는 동안에는 어떤 지역의 교통정보도 조회하지 않는다.
export function LocationGate({ state, onRequest }: { state: NotReady; onRequest: () => void }) {
  const { t } = useTranslation();
  const key = state.status === 'failed' ? state.reason : state.status; // idle | locating | denied | ...
  const isWeb = Platform.OS === 'web';

  if (state.status === 'locating') {
    return (
      <View accessibilityLiveRegion="polite">
        <Card style={styles.row}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.title}>{t('traffic.location.locating.title')}</Text>
        </Card>
      </View>
    );
  }

  const failed = state.status === 'failed';
  const reason = failed ? state.reason : null;
  return (
    <View accessibilityRole={failed ? 'alert' : undefined}>
      <Card style={[styles.stack, failed && styles.cardFailed]}>
        <Text style={styles.title}>{t(`traffic.location.${key}.title`)}</Text>
        <Text style={styles.body}>{t(`traffic.location.${key}.body`)}</Text>
        {/* 웹은 브라우저가 한 번 차단하면 다시 요청해도 대화상자가 뜨지 않아 사이트 설정 안내가 필요하다. */}
        {isWeb && reason === 'denied' && <Text style={styles.body}>{t('traffic.location.webSettings')}</Text>}
        {state.status === 'idle' && <Text style={styles.note}>{t('traffic.location.privacy')}</Text>}
  
        <View style={styles.actions}>
          {state.status === 'idle' && <ActionButton label={t('traffic.location.allow')} onPress={onRequest} primary />}
          {reason === 'denied' && <ActionButton label={t('traffic.location.askAgain')} onPress={onRequest} primary />}
          {reason === 'permanentlyDenied' && (
            <>
              {!isWeb && <ActionButton label={t('traffic.location.openSettings')} onPress={() => Linking.openSettings()} primary />}
              <ActionButton label={t('traffic.location.retry')} onPress={onRequest} />
            </>
          )}
          {(reason === 'servicesDisabled' || reason === 'timeout' || reason === 'unavailable') && (
            <ActionButton label={t('traffic.location.retry')} onPress={onRequest} primary />
          )}
        </View>
      </Card>
    </View>
  );
}

// 위치는 얻었지만 국내가 아닐 때의 안내. 외부 API 를 호출하지 않는다.
export function OutsideServiceNotice() {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="alert">
      <Card style={[styles.stack, styles.cardFailed]}>
        <Text style={styles.title}>{t('traffic.location.outsideKorea.title')}</Text>
        <Text style={styles.body}>{t('traffic.location.outsideKorea.body')}</Text>
      </Card>
    </View>
  );
}

function ActionButton({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, primary ? styles.buttonPrimary : styles.buttonSecondary, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, primary ? styles.buttonTextPrimary : styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  cardFailed: { borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 17, lineHeight: 24, fontWeight: '800', color: colors.ink },
  body: { fontSize: 15, lineHeight: 22, color: colors.ink },
  note: { fontSize: 13, lineHeight: 19, color: colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.md },
  buttonPrimary: { backgroundColor: colors.brand },
  buttonSecondary: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  buttonText: { fontSize: 15, fontWeight: '700' },
  buttonTextPrimary: { color: colors.surface },
  buttonTextSecondary: { color: colors.brand },
  pressed: { opacity: 0.85 },
});
