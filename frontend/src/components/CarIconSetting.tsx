import { Check, Navigation } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getCarIcon, setCarIcon } from '../native/kakaoNavigation';
import { CAR_ICONS, type CarIconId } from '../native/navigationTypes';
import { colors, radius, space } from '../theme';
import { Icon } from './ui/Icon';

// 미리보기는 네이티브 주간 아이콘과 같은 그림. 기본은 카카오 SDK 마커라 그림 대신 방향 아이콘으로 보여준다.
const PREVIEWS: Record<Exclude<CarIconId, 'default'>, ImageSourcePropType> = {
  taxi: require('../../assets/car-icons/taxi.png'),
  sports: require('../../assets/car-icons/sports.png'),
  character: require('../../assets/car-icons/character.png'),
};

// 메뉴 시트의 "주행 아이콘" 고르기. 자동차 길안내(카카오 SDK 화면)의 내 위치 마커를 바꾼다.
// 이 기능이 없는 빌드(웹·iOS·이전 APK)에서는 아무것도 그리지 않는다.
export function CarIconSetting() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<CarIconId | null>(getCarIcon);
  if (selected === null) return null;

  const choose = (id: CarIconId) => {
    setCarIcon(id);
    setSelected(id);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{t('carIcon.title')}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('carIcon.title')} style={styles.row}>
        {CAR_ICONS.map((id) => {
          const active = id === selected;
          return (
            <Pressable
              key={id}
              onPress={() => choose(id)}
              accessibilityRole="radio"
              accessibilityLabel={t(`carIcon.${id}`)}
              aria-checked={active}
              style={({ pressed }) => [styles.tile, active && styles.tileActive, pressed && styles.pressed]}
            >
              {id === 'default' ? (
                <View style={styles.defaultPreview}>
                  <Icon icon={Navigation} size={22} color={colors.info} />
                </View>
              ) : (
                <Image source={PREVIEWS[id]} style={styles.preview} resizeMode="contain" />
              )}
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {t(`carIcon.${id}`)}
              </Text>
              {/* 선택은 테두리 색 말고 체크 표시로도 알린다. */}
              {active && (
                <View style={styles.check}>
                  <Icon icon={Check} size={12} color={colors.zoneInk} strokeWidth={3} />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('carIcon.hint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  title: { fontSize: 13, fontWeight: '700', color: colors.muted },
  row: { flexDirection: 'row', gap: space.sm },
  tile: {
    flex: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  tileActive: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper },
  pressed: { opacity: 0.8 },
  preview: { width: 40, height: 44 },
  defaultPreview: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 12, fontWeight: '600', color: colors.ink },
  labelActive: { fontWeight: '800' },
  check: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.zone,
  },
  hint: { fontSize: 12, color: colors.muted },
});
