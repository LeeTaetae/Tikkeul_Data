import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { LanguageSwitcher } from '../src/components/LanguageSwitcher';
import { Screen } from '../src/components/Screen';
import { SpeedSign } from '../src/components/SpeedSign';
import { StatusBanner } from '../src/components/StatusBanner';
import { SAMPLE_ALERTS } from '../src/data/sample';
import { colors, radius, space } from '../src/theme';

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const count = (kind: string) => SAMPLE_ALERTS.filter((a) => a.kind === kind).length;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t('home.title')}
        </Text>
        <LanguageSwitcher />
      </View>
      <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

      {/* 보호구역 경고: 이 화면의 중심. 표지판처럼 노랑 판 + 제한속도 원 */}
      <View style={styles.zone}>
        <SpeedSign limit={30} size={72} />
        <View style={styles.zoneText}>
          <Text style={styles.zoneTitle}>{t('home.zoneTitle')}</Text>
          <Text style={styles.zoneBody}>{t('home.zoneBody')}</Text>
          <Text style={styles.zoneMeta}>{t('home.zoneMeta')}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.cardTitle}>{t('home.cameraTitle')}</Text>
          <Text style={styles.badge}>{t('home.cameraStatus')}</Text>
        </View>
        <Text style={styles.cardBody}>{t('home.cameraBody')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('home.summary')}</Text>
        <Text style={styles.cardBody}>
          {t('home.summaryCount', { jam: count('jam'), work: count('work'), block: count('block') })}
        </Text>
      </View>

      <StatusBanner />

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.buttonPrimary]}
          onPress={() => router.push('/map')}
          accessibilityRole="link"
        >
          <Text style={styles.buttonPrimaryText}>{t('home.goMap')}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonGhost]}
          onPress={() => router.push('/alerts')}
          accessibilityRole="link"
        >
          <Text style={styles.buttonGhostText}>{t('home.goAlerts')}</Text>
        </Pressable>
      </View>

      <Text style={styles.disclaimer}>{t('home.disclaimer')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 16, lineHeight: 24, color: colors.muted },
  zone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    backgroundColor: colors.zone,
    borderColor: colors.ink,
    borderWidth: 3,
    borderRadius: radius.md,
    padding: space.lg,
  },
  zoneText: { flex: 1, gap: 2 },
  zoneTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  zoneBody: { fontSize: 16, lineHeight: 22, color: colors.ink },
  zoneMeta: { fontSize: 13, color: colors.zoneInk },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  cardBody: { fontSize: 15, lineHeight: 22, color: colors.muted },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  actions: { flexDirection: 'row', gap: space.md },
  button: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  buttonPrimary: { backgroundColor: colors.ink },
  buttonPrimaryText: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  buttonGhost: { backgroundColor: colors.surface, borderColor: colors.ink, borderWidth: 2 },
  buttonGhostText: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  disclaimer: { fontSize: 13, color: colors.muted, textAlign: 'center' },
});
