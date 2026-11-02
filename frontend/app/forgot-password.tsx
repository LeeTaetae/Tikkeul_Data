import { Lock, Mail, X } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Logo } from '../src/components/Logo';
import { Screen } from '../src/components/Screen';
import { PrimaryButton } from '../src/components/ui/PrimaryButton';
import { RoundButton } from '../src/components/ui/RoundButton';
import { TextField } from '../src/components/ui/TextField';
import { authApi } from '../src/lib/auth/api';
import { authErrorMessage } from '../src/lib/auth/errorMessage';
import { colors, space } from '../src/theme';

// 3단계: 이메일 -> 코드 -> 새 비밀번호. signup.tsx 의 인증코드 상태 패턴을 그대로 따른다.
type Step = 'email' | 'code' | 'password' | 'done';

const PASSWORD_MIN = 8;
// bcrypt 가 72바이트를 넘으면 조용히 잘라버린다 - signup.tsx 와 같은 기준.
const PASSWORD_MAX_BYTES = 72;

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [socialOnly, setSocialOnly] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState('');

  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState('');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const codeRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);

  const emailValid = email.trim().includes('@');
  const passwordBytes = new TextEncoder().encode(password).length;
  const passwordValid = password.length >= PASSWORD_MIN && passwordBytes <= PASSWORD_MAX_BYTES;
  const confirmError = confirm.length > 0 && confirm !== password ? t('auth.passwordMismatch') : undefined;
  const canSubmitPassword = passwordValid && confirm === password && !submitting;

  const onSendCode = async () => {
    if (!emailValid || sending) return;
    setSending(true);
    setSendError(null);
    setSocialOnly(false);
    try {
      const res = await authApi.sendPasswordResetCode(email.trim());
      if (res.social_only) {
        setSocialOnly(true);
      } else {
        setChallenge(res.challenge ?? '');
        setStep('code');
      }
    } catch (e) {
      setSendError(authErrorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  const onConfirmCode = async () => {
    if (code.trim().length === 0 || confirming) return;
    setConfirming(true);
    setCodeError(null);
    try {
      const res = await authApi.verifyPasswordResetCode(email.trim(), code.trim(), challenge);
      setResetToken(res.token);
      setStep('password');
    } catch (e) {
      setCodeError(authErrorMessage(e, t));
    } finally {
      setConfirming(false);
    }
  };

  const onSubmitPassword = async () => {
    if (!canSubmitPassword) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await authApi.resetPassword(resetToken, password);
      setStep('done');
    } catch (e) {
      setSubmitError(authErrorMessage(e, t));
    } finally {
      setSubmitting(false);
    }
  };

  // 성공 안내를 잠깐 보여준 뒤 로그인 화면으로 이동한다.
  useEffect(() => {
    if (step !== 'done') return;
    const timer = setTimeout(() => router.replace('/login'), 900);
    return () => clearTimeout(timer);
  }, [step, router]);

  return (
    <Screen>
      <View style={styles.topRow}>
        <RoundButton icon={X} label={t('common.close')} variant="soft" onPress={() => router.back()} />
      </View>

      <View style={styles.header}>
        <Logo />
        <Text style={styles.subtitle}>
          {step === 'password' ? t('auth.resetNewPasswordSubtitle') : t('auth.resetPasswordSubtitle')}
        </Text>
      </View>

      {step === 'done' ? (
        <Text style={styles.doneText}>{t('auth.resetPasswordDone')}</Text>
      ) : (
        <View style={styles.form}>
          <TextField
            label={t('auth.email')}
            leadingIcon={Mail}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setSendError(null);
              setSocialOnly(false);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="done"
            onSubmitEditing={onSendCode}
            error={step === 'email' ? sendError ?? undefined : undefined}
            trailing={
              step !== 'email' ? undefined : sending ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <Pressable onPress={onSendCode} disabled={!emailValid} hitSlop={8}>
                  <Text style={[styles.verifyLink, !emailValid && styles.verifyLinkDisabled]}>{t('auth.resetSendCodeButton')}</Text>
                </Pressable>
              )
            }
          />

          {socialOnly && <Text style={styles.socialOnlyText}>{t('auth.resetSocialOnly')}</Text>}

          {(step === 'code' || step === 'password') && (
            <View style={styles.codeBlock}>
              <Text style={styles.codeSentHint}>{t('auth.codeSent')}</Text>
              <TextField
                label={t('auth.codeLabel')}
                inputRef={codeRef}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                placeholder={t('auth.codePlaceholder')}
                returnKeyType="done"
                onSubmitEditing={onConfirmCode}
                error={step === 'code' ? codeError ?? undefined : undefined}
                trailing={
                  step !== 'code' ? (
                    <Text style={styles.verifiedBadge}>{t('auth.verifyButtonVerified')}</Text>
                  ) : confirming ? (
                    <ActivityIndicator size="small" color={colors.muted} />
                  ) : (
                    <Pressable onPress={onConfirmCode} disabled={code.trim().length === 0} hitSlop={8}>
                      <Text style={[styles.verifyLink, code.trim().length === 0 && styles.verifyLinkDisabled]}>
                        {t('auth.codeConfirmButton')}
                      </Text>
                    </Pressable>
                  )
                }
              />
            </View>
          )}

          {step === 'password' && (
            <>
              <TextField
                label={t('auth.password')}
                leadingIcon={Lock}
                secure
                inputRef={passwordRef}
                value={password}
                onChangeText={setPassword}
                autoComplete="password-new"
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
              />
              <Text style={styles.hint}>{t('auth.passwordHint')}</Text>
              <TextField
                label={t('auth.passwordConfirm')}
                leadingIcon={Lock}
                secure
                inputRef={confirmRef}
                value={confirm}
                onChangeText={setConfirm}
                autoComplete="password-new"
                returnKeyType="done"
                onSubmitEditing={onSubmitPassword}
                error={confirmError ?? submitError ?? undefined}
              />
            </>
          )}
        </View>
      )}

      {step === 'password' && (
        <PrimaryButton
          label={submitting ? t('auth.resettingPassword') : t('auth.resetPasswordButton')}
          onPress={onSubmitPassword}
          disabled={!canSubmitPassword}
          loading={submitting}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  header: { alignItems: 'center', gap: space.xs, paddingVertical: space.lg },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center' },
  form: { gap: space.md },
  hint: { fontSize: 12, color: colors.muted, marginTop: -space.sm },
  verifyLink: { fontSize: 13, fontWeight: '800', color: colors.brand },
  verifyLinkDisabled: { color: colors.muted },
  verifiedBadge: { fontSize: 13, fontWeight: '800', color: colors.guide },
  socialOnlyText: { fontSize: 13, color: colors.dangerInk, fontWeight: '600', marginTop: -space.xs },
  codeBlock: { gap: space.xs },
  codeSentHint: { fontSize: 12, color: colors.muted },
  doneText: { fontSize: 15, color: colors.guide, fontWeight: '700', textAlign: 'center', paddingVertical: space.lg },
});
