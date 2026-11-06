import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radius, space } from '../theme';

interface Props {
  label: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

// 화면 가운데 팝업 - app/index.tsx의 "경로 실패" 가운데 팝업(errorBackdrop/errorDialog)과 같은 패턴.
export function FrequentDestinationBanner({ label, onConfirm, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={styles.message}>{t('map.frequentBannerTitle', { label })}</Text>
          <View style={styles.actions}>
            <Pressable onPress={onDismiss} accessibilityRole="button" style={styles.button}>
              <Text style={styles.buttonText}>{t('map.frequentBannerDismiss')}</Text>
            </Pressable>
            <Pressable onPress={onConfirm} accessibilityRole="button" style={[styles.button, styles.buttonPrimary]}>
              <Text style={[styles.buttonText, styles.buttonTextPrimary]}>{t('map.frequentBannerConfirm')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  dialog: { width: '100%', maxWidth: 360, gap: space.lg, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  message: { fontSize: 16, lineHeight: 23, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: space.sm },
  button: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  buttonPrimary: { backgroundColor: colors.brand, borderWidth: 0 },
  buttonText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  buttonTextPrimary: { color: colors.surface },
});
