import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/ui/PrimaryButton';
import { VisionDebugPanel } from '../src/components/vision/VisionDebugPanel';
import { useAuth } from '../src/lib/auth/AuthContext';
import { authApi, type AuthUser } from '../src/lib/auth/api';
import { authErrorMessage } from '../src/lib/auth/errorMessage';
import { colors, space } from '../src/theme';

export default function AdminScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  // 탭 화면은 다른 탭으로 가도 언마운트되지 않는다 - 안 보일 때 카메라가 계속 돌지 않게 포커스일 때만 띄운다.
  const focused = useIsFocused();
  const { token, status, logout } = useAuth();
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [members, setMembers] = useState<AuthUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (!token) {
      router.replace('/login');
      return;
    }
    const controller = new AbortController();
    setAccount(null);
    setMembers(null);
    setError(null);
    // 관리자 확인이 먼저다 - 일반 계정이면 회원 목록은 요청하지 않는다(어차피 403).
    authApi.adminMe(token, { signal: controller.signal })
      .then(async (user) => {
        if (controller.signal.aborted) return;
        setAccount(user);
        const list = await authApi.adminUsers(token, { signal: controller.signal });
        if (!controller.signal.aborted) setMembers(list);
      })
      .catch((e) => { if (!controller.signal.aborted) setError(authErrorMessage(e, t)); });
    return () => controller.abort();
  }, [token, status, router, t]);

  const toggleStatus = async (member: AuthUser) => {
    if (!token) return;
    setError(null);
    try {
      const updated = await authApi.adminSetUserStatus(token, member.id, member.status === 'active' ? 'disabled' : 'active');
      setMembers((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? null);
    } catch (e) {
      setError(authErrorMessage(e, t));
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={styles.title}>{t('auth.adminTitle')}</Text>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {account ? (
          <>
            <Text>{t('auth.adminLoginSuccess')}</Text>
            <Text>{account.email ?? account.nickname}</Text>
            <Text style={styles.section}>{t('auth.adminVisionDebug')}</Text>
            {focused && <VisionDebugPanel />}

            <Text style={styles.section}>{t('auth.adminMembers')}</Text>
            {members?.length === 0 && <Text>{t('auth.adminMembersEmpty')}</Text>}
            {members?.map((m) => {
              const self = m.id === account.id;
              const disabled = m.status === 'disabled';
              return (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={[styles.memberName, disabled && styles.muted]} numberOfLines={1}>
                      {m.email ?? m.nickname ?? `#${m.id}`}
                    </Text>
                    <Text style={styles.memberMeta}>
                      {m.provider} · {m.role}
                      {self ? ` · ${t('auth.adminMemberSelf')}` : ''}
                      {disabled ? ` · ${t('auth.adminMemberDisabled')}` : ''}
                    </Text>
                  </View>
                  {!self && (
                    <Pressable accessibilityRole="button" onPress={() => toggleStatus(m)} style={styles.memberButton}>
                      <Text style={styles.memberButtonText}>
                        {disabled ? t('auth.adminMemberEnable') : t('auth.adminMemberDisable')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </>
        ) : !error && <Text>{t('auth.adminChecking')}</Text>}
        <PrimaryButton label={t('auth.adminHome')} onPress={() => router.replace('/')} />
        <PrimaryButton label={t('auth.logout')} onPress={async () => {
          await logout();
          router.replace('/login');
        }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingVertical: space.lg },
  title: { fontSize: 24, fontWeight: '800', color: colors.brand },
  section: { fontSize: 18, fontWeight: '700', marginTop: space.md },
  error: { color: colors.dangerInk },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberMeta: { fontSize: 12, color: colors.muted },
  muted: { color: colors.muted, textDecorationLine: 'line-through' },
  memberButton: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.line },
  memberButtonText: { fontSize: 13, fontWeight: '600' },
});
