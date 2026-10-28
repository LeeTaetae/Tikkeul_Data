import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { colors, radius, space } from '../theme';

const CATEGORIES = [
  { href: '/', label: 'tabs.home' },
  { href: '/map', label: 'tabs.map' },
  { href: '/alerts', label: 'tabs.alerts' },
] as const;

// 헤더 오른쪽 햄버거 버튼. 누르면 하단 탭과 같은 카테고리 목록이 펼쳐진다.
export function CategoryMenu() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    // zIndex: 펼친 메뉴가 아래쪽 콘텐츠(검색창·카드)에 가려지지 않게 한다.
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={t('menu.label')}
        accessibilityState={{ expanded: open }}
        style={styles.button}
      >
        <View style={styles.bar} />
        <View style={styles.bar} />
        <View style={styles.bar} />
      </Pressable>

      {open && (
        <View style={styles.menu} accessibilityRole="menu">
          {CATEGORIES.map(({ href, label }) => {
            const selected = pathname === href;
            return (
              <Pressable
                key={href}
                onPress={() => {
                  setOpen(false);
                  router.navigate(href);
                }}
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                style={[styles.item, selected && styles.itemSelected]}
              >
                <Text style={[styles.itemText, selected && styles.itemTextSelected]}>{t(label)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 10, flexShrink: 0 },
  button: {
    width: 44,
    height: 44,
    gap: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  bar: { width: 18, height: 2, borderRadius: 1, backgroundColor: colors.surface },
  menu: {
    position: 'absolute',
    top: 52,
    right: 0,
    minWidth: 160,
    padding: space.xs,
    borderRadius: radius.md,
    borderColor: colors.primary,
    borderWidth: 1,
    backgroundColor: colors.primarySoft,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.18)',
  },
  item: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  itemSelected: { backgroundColor: colors.brand },
  itemText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  itemTextSelected: { color: colors.surface },
});
