import { Check, House, Map as MapIcon, TriangleAlert, X, type LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LANGUAGES, type Language } from '../../i18n';
import { MAX_CONTENT_WIDTH, colors, radius, shadow, space } from '../../theme';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { RoundButton } from './RoundButton';

// 하단 탭과 같은 세 화면. 라우트(href)는 _layout.tsx 의 탭과 같다.
const PAGES: { href: '/' | '/map' | '/alerts'; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'tabs.home', icon: House },
  { href: '/map', label: 'tabs.map', icon: MapIcon },
  { href: '/alerts', label: 'tabs.alerts', icon: TriangleAlert },
];

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

  const goTo = (href: (typeof PAGES)[number]['href']) => {
    onClose();
    router.navigate(href);
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
});
