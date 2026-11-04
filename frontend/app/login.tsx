import { Lock, Mail, X } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { GoogleIcon } from '../src/components/icons/GoogleIcon';
import { KakaoIcon } from '../src/components/icons/KakaoIcon';
import { Logo } from '../src/components/Logo';
import { Screen } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/ui/PrimaryButton';
import { RoundButton } from '../src/components/ui/RoundButton';
import { SocialButton } from '../src/components/ui/SocialButton';
import { TextField } from '../src/components/ui/TextField';
import { authErrorMessage } from '../src/lib/auth/errorMessage';
import { useAuth } from '../src/lib/auth/AuthContext';
import { isKakaoLoginAvailable } from '../src/native/kakaoLogin';
import { colors, space } from '../src/theme';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login, loginWithGoogle, loginWithKakao } = useAuth();
  // 비로그인 상태에서 로그인 전용 기능을 누르면 이 화면으로 오는데, 성공하면 원래 가려던 곳으로 돌려보낸다.
  const { redirect, mode } = useLocalSearchParams<{ redirect?: string; mode?: string }>();
  const [adminMode, setAdminMode] = useState(mode === 'admin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [kakaoSubmitting, setKakaoSubmitting] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const canSubmit = email.trim().includes('@') && password.length > 0 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password, adminMode);
      if (user.role === 'admin') router.replace('/admin' as never);
      else if (redirect) router.replace(redirect as never);
      else router.replace('/');
    } catch (e) {
      setError(authErrorMessage(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleSubmit = async () => {
    if (googleSubmitting) return;
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
      if (redirect) router.replace(redirect as never);
      else router.back();
    } catch (e) {
      // 사용자가 구글 로그인 창을 취소한 경우는 오류가 아니다.
      if ((e as { code?: string })?.code !== 'GOOGLE_SIGNIN_CANCELLED') setError(authErrorMessage(e, t));
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const onKakaoSubmit = async () => {
    if (kakaoSubmitting) return;
    setError(null);
    setKakaoSubmitting(true);
    try {
      await loginWithKakao();
      if (redirect) router.replace(redirect as never);
      else router.back();
    } catch (e) {
      // 사용자가 카카오 로그인 창을 취소한 경우는 오류가 아니다.
      if ((e as { code?: string })?.code !== 'KAKAO_LOGIN_CANCELLED') setError(authErrorMessage(e, t));
    } finally {
      setKakaoSubmitting(false);
    }
  };

  return (
    <Screen>
      <View style={styles.topRow}>
        <RoundButton icon={X} label={t('common.close')} variant="soft" onPress={() => router.back()} />
      </View>

      <View style={styles.header}>
        <Logo />
        <Text style={styles.subtitle}>{adminMode ? t('auth.adminLoginTitle') : t('auth.loginSubtitle')}</Text>
        <Text style={styles.link} onPress={() => { setAdminMode(!adminMode); setError(null); }}>
          {adminMode ? t('auth.userLoginTitle') : t('auth.adminLoginTitle')}
        </Text>
      </View>

      <View style={styles.form}>
        <TextField
          label={t('auth.email')}
          leadingIcon={Mail}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <TextField
          label={t('auth.password')}
          leadingIcon={Lock}
          secure
          inputRef={passwordRef}
          value={password}
          onChangeText={setPassword}
          autoComplete="password"
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          error={error ?? undefined}
        />
        <Text style={styles.forgotPassword} onPress={() => router.push('/forgot-password')}>
          {t('auth.forgotPassword')}
        </Text>
      </View>

      <PrimaryButton
        label={submitting ? t('auth.loggingIn') : t('auth.loginButton')}
        onPress={onSubmit}
        disabled={!canSubmit}
        loading={submitting}
      />

      {!adminMode && <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t('auth.orDivider')}</Text>
        <View style={styles.dividerLine} />
      </View>}

      {!adminMode && Platform.OS !== 'web' && (
        <SocialButton
          icon={<GoogleIcon />}
          label={googleSubmitting ? t('auth.loggingInGoogle') : t('auth.loginWithGoogle')}
          onPress={onGoogleSubmit}
          disabled={submitting || googleSubmitting || kakaoSubmitting}
          loading={googleSubmitting}
          backgroundColor="#FFFFFF"
          textColor="#1F1F1F"
          borderColor="#DADCE0"
        />
      )}

      {!adminMode && isKakaoLoginAvailable() && (
        <SocialButton
          icon={<KakaoIcon />}
          label={kakaoSubmitting ? t('auth.loggingInKakao') : t('auth.loginWithKakao')}
          onPress={onKakaoSubmit}
          disabled={submitting || googleSubmitting || kakaoSubmitting}
          loading={kakaoSubmitting}
          backgroundColor="#FEE500"
          textColor="#181600"
        />
      )}

      {!adminMode && <View style={styles.footer}>
        <Text style={styles.footerText}>{t('auth.noAccount')}</Text>
        <Text style={styles.link} onPress={() => router.replace(redirect ? { pathname: '/signup', params: { redirect } } : '/signup')}>
          {t('auth.goSignup')}
        </Text>
      </View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  header: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center' },
  form: { gap: space.md },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { fontSize: 13, color: colors.muted },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: space.xs, paddingTop: space.sm },
  footerText: { fontSize: 14, color: colors.muted },
  link: { fontSize: 14, fontWeight: '800', color: colors.brand },
  forgotPassword: { fontSize: 13, fontWeight: '700', color: colors.brand, alignSelf: 'flex-end' },
});
