import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/ui/PrimaryButton';
import { useAuth } from '../src/lib/auth/AuthContext';
import { authApi, type AuthUser } from '../src/lib/auth/api';
import { authErrorMessage } from '../src/lib/auth/errorMessage';
import { colors, space } from '../src/theme';

export default function AdminScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { token, status, logout } = useAuth();
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!token) {
      router.replace({ pathname: '/login', params: { mode: 'admin' } });
      return;
    }
    const controller = new AbortController();
    setAccount(null);
    setError(null);
    authApi.adminMe(token, { signal: controller.signal })
      .then((user) => { if (!controller.signal.aborted) setAccount(user); })
      .catch((e) => { if (!controller.signal.aborted) setError(authErrorMessage(e, t)); });
    return () => controller.abort();
  }, [token, status, router, t]);

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={styles.title}>{t('auth.adminTitle')}</Text>
        {error ? <Text accessibilityRole="alert">{error}</Text> : account ? (
          <>
            <Text>{t('auth.adminLoginSuccess')}</Text>
            <Text>{account.email ?? account.nickname}</Text>
          </>
        ) : <Text>{t('auth.adminChecking')}</Text>}
        <PrimaryButton label={t('auth.adminHome')} onPress={() => router.replace('/')} />
        <PrimaryButton label={t('auth.logout')} onPress={async () => {
          await logout();
          router.replace({ pathname: '/login', params: { mode: 'admin' } });
        }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingVertical: space.lg },
  title: { fontSize: 24, fontWeight: '800', color: colors.brand },
});
