import { Check, ChevronDown, ChevronUp, Heart, House, Info, LogOut, Map as MapIcon, TriangleAlert, User, X, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LANGUAGES, type Language } from '../../i18n';
import { authApi } from '../../lib/auth/api';
import { useAuth } from '../../lib/auth/AuthContext';
import { authErrorMessage } from '../../lib/auth/errorMessage';
import { MAX_CONTENT_WIDTH, colors, radius, shadow, space } from '../../theme';
import { CarIconSetting } from '../CarIconSetting';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { RoundButton } from './RoundButton';

// 하단 탭과 같은 세 화면. 라우트(href)는 _layout.tsx 의 탭과 같다.
const PAGES: { href: '/' | '/map' | '/alerts'; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'tabs.home', icon: House },
  { href: '/map', label: 'tabs.map', icon: MapIcon },
  { href: '/alerts', label: 'tabs.alerts', icon: TriangleAlert },
];

// 지하철 정거장 좌표의 출처(공공누리 제1유형). 문구는 menu.sources.* 번역에 있고, 공공기관이 후원·보증하는 것처럼 보이지 않게 그 사실을 함께 밝힌다.
const SEOUL_STATION_DATA_URL = 'https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// 햄버거 버튼으로 여는 하단 메뉴 시트. 화면 이동 + 언어 선택.
// 닫는 방법: 바깥 어두운 곳 누르기 · 닫기 버튼 · Esc(웹) · 뒤로 가기(안드로이드) · 화면 이동.
export function MenuSheet({ visible, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { status, user, token, logout } = useAuth();
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const onResendVerification = async () => {
    if (!token) return;
    setResendState('sending');
    setResendError(null);
    try {
      await authApi.sendVerification(token);
      setResendState('sent');
    } catch (e) {
      setResendState('error');
      setResendError(authErrorMessage(e, t));
    }
  };

  const goTo = (href: (typeof PAGES)[number]['href']) => {
    onClose();
    router.navigate(href);
  };

  const goToFavorites = () => {
    onClose();
    router.navigate('/favorites');
  };

  const goToLogin = () => {
    onClose();
    router.navigate('/login');
  };

  const onLogout = () => {
    onClose();
    logout();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* 스크린리더에는 아래 닫기 버튼만 알린다. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
        />
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          accessibilityViewIsModal
          accessibilityLabel={t('menu.label')}
        >
          <View style={styles.top}>
            <View style={styles.grabber} />
            <RoundButton icon={X} label={t('menu.close')} variant="soft" size={44} onPress={onClose} />
          </View>

          <View accessibilityRole="menu" style={styles.pages}>
            {PAGES.map(({ href, label, icon }) => {
              const selected = pathname === href;
              return (
                <Pressable
                  key={href}
                  onPress={() => goTo(href)}
                  accessibilityRole="menuitem"
                  aria-selected={selected}
                  style={({ pressed }) => [styles.page, selected && styles.pageSelected, pressed && styles.pressed]}
                >
                  <Icon icon={icon} size={22} color={selected ? colors.brand : colors.ink} />
                  <Text style={[styles.pageText, selected && styles.pageTextSelected]}>{t(label)}</Text>
                  {/* 현재 화면은 색 말고 체크 표시로도 알린다. */}
                  {selected && <Icon icon={Check} size={20} color={colors.brand} strokeWidth={2.6} />}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.account}>
            {status === 'authenticated' && user ? (
              <>
                <View style={styles.accountRow}>
                  <Icon icon={User} size={20} color={colors.muted} />
                  <Text style={styles.accountEmail} numberOfLines={1}>
                    {user.provider === 'kakao' && user.email === null ? t('auth.kakaoUser') : user.email}
                  </Text>
                </View>
                {user.email_verified ? (
                  <Text style={styles.verifiedText}>{t('auth.emailVerified')}</Text>
                ) : (
                  <View style={styles.verifyRow}>
                    <Text style={styles.unverifiedText}>{t('auth.emailNotVerified')}</Text>
                    {resendState === 'sent' ? (
                      <Text style={styles.verificationSentText}>{t('auth.verificationSent')}</Text>
                    ) : (
                      <Pressable
                        onPress={onResendVerification}
                        disabled={resendState === 'sending'}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.resendButton, pressed && styles.pressed]}
                      >
                        {resendState === 'sending' ? (
                          <ActivityIndicator size="small" color={colors.brand} />
                        ) : (
                          <Text style={styles.resendButtonText}>{t('auth.resendVerification')}</Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                )}
                {resendState === 'error' && resendError && <Text style={styles.resendErrorText}>{resendError}</Text>}
                <Pressable
                  onPress={goToFavorites}
                  accessibilityRole="menuitem"
                  style={({ pressed }) => [styles.page, pressed && styles.pressed]}
                >
                  <Icon icon={Heart} size={22} color={colors.ink} />
                  <Text style={styles.pageText}>{t('favorites.title')}</Text>
                </Pressable>
                <Pressable
                  onPress={onLogout}
                  accessibilityRole="menuitem"
                  style={({ pressed }) => [styles.page, pressed && styles.pressed]}
                >
                  <Icon icon={LogOut} size={22} color={colors.dangerInk} />
                  <Text style={[styles.pageText, styles.logoutText]}>{t('auth.logout')}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={goToLogin}
                accessibilityRole="menuitem"
                style={({ pressed }) => [styles.page, pressed && styles.pressed]}
              >
                <Icon icon={User} size={22} color={colors.brand} />
                <Text style={[styles.pageText, styles.loginText]}>{t('auth.login')}</Text>
              </Pressable>
            )}
          </View>

          <CarIconSetting />

          <View>
            <Pressable
              onPress={() => setSourcesOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: sourcesOpen }}
              style={({ pressed }) => [styles.page, pressed && styles.pressed]}
            >
              <Icon icon={Info} size={22} color={colors.ink} />
              <Text style={styles.pageText}>{t('menu.sources.title')}</Text>
              <Icon icon={sourcesOpen ? ChevronUp : ChevronDown} size={20} color={colors.muted} />
            </Pressable>
            {sourcesOpen && (
              // 작은 화면에서 시트가 화면을 넘지 않게 본문은 높이를 제한하고 안에서 스크롤한다.
              <ScrollView style={styles.sourcesBody} nestedScrollEnabled>
                <Text style={styles.sourcesText}>{t('menu.sources.body')}</Text>
                <Pressable onPress={() => Linking.openURL(SEOUL_STATION_DATA_URL)} accessibilityRole="link" style={({ pressed }) => [styles.sourcesLink, pressed && styles.pressed]}>
                  <Text style={styles.sourcesLinkText}>{t('menu.sources.link')}</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>

          <View style={styles.languages}>
            <Text style={styles.sectionTitle}>{t('lang.label')}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('lang.label')} style={styles.languageRow}>
              {LANGUAGES.map((lng: Language) => (
                <Chip
                  key={lng}
                  role="radio"
                  label={t(`lang.${lng}`)}
                  selected={i18n.language === lng}
                  onPress={() => i18n.changeLanguage(lng)}
                />
              ))}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadow.sheet,
  },
  top: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  // 시트 윗부분 손잡이 모양 장식. 가운데에 두려고 절대 위치로 띄운다.
  grabber: {
    position: 'absolute',
    left: '50%',
    marginLeft: -20,
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
  },
  pages: { gap: space.xs },
  page: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  pageSelected: { backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.8 },
  pageText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.ink },
  pageTextSelected: { fontWeight: '800', color: colors.brand },
  languages: { gap: space.sm },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted },
  languageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  account: { gap: space.xs, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.sm },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.xs },
  accountEmail: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.muted },
  logoutText: { color: colors.dangerInk },
  loginText: { fontWeight: '800', color: colors.brand },
  verifiedText: { fontSize: 12, color: colors.muted, paddingHorizontal: space.md },
  verifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  unverifiedText: { flex: 1, fontSize: 12, color: colors.dangerInk, fontWeight: '600' },
  verificationSentText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  resendButton: { paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  resendButtonText: { fontSize: 12, fontWeight: '800', color: colors.brand },
  resendErrorText: { fontSize: 12, color: colors.dangerInk, paddingHorizontal: space.md },
  sourcesBody: { maxHeight: 130, paddingHorizontal: space.md },
  sourcesText: { fontSize: 13, lineHeight: 19, color: colors.muted },
  sourcesLink: { minHeight: 44, justifyContent: 'center' },
  sourcesLinkText: { fontSize: 14, fontWeight: '700', color: colors.brand, textDecorationLine: 'underline' },
});
