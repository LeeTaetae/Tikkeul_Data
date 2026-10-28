import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '../src/components/Screen';
import { colors } from '../src/theme';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Text style={styles.title}>{t('notFound.title')}</Text>
      <Link href="/" style={styles.link}>
        {t('notFound.back')}
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: colors.ink },
  link: { fontSize: 16, fontWeight: '700', color: colors.info },
});
