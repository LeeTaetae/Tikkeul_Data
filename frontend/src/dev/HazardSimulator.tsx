// 개발 전용: 실제 내비게이션·GPS 가 없는 동안 경로 기반 위험 경고를 손으로 확인하는 시뮬레이터.
// 시뮬레이터가 만드는 것은 "경로, 진행 거리, 후보 위험" 입력뿐이다. 경로 위·방향 판정(matchHazardsToRoute)과
// 단계 경고(useHazardWarning)는 실서비스와 같은 코드를 그대로 쓴다.
// 지울 때는 src/dev/ 폴더와 app/index.tsx 의 useHazardSimulation · HazardSimulator 사용부만 걷어내면 된다.
// 문구는 개발자용이라 번역하지 않는다.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MOCK_ALERTS } from '../data/mockAlert';
import { formatDistance } from '../lib/distance';
import { matchHazardsToRoute, projectOntoRoute, remainingHazards } from '../lib/routeHazards';
import type { RejectReason } from '../lib/routeHazards';
import { colors, radius, space } from '../theme';
import { MOCK_ROUTE_A, MOCK_ROUTE_B, OFF_ROUTE_ALERT, OPPOSITE_ALERT } from './mockRoute';

const ROUTES = [MOCK_ROUTE_A, MOCK_ROUTE_B];
const TARGETS = [
  { label: '사고', alert: MOCK_ALERTS[0] },
  { label: '공사', alert: MOCK_ALERTS[1] },
  { label: '정체', alert: MOCK_ALERTS[2] },
  { label: '반대 방향', alert: OPPOSITE_ALERT },
  { label: '경로 밖', alert: OFF_ROUTE_ALERT },
];
// 선택한 위험까지 남은 거리(m). 처음은 2km 전방에서 시작한다.
const STEPS = [
  { label: '2km', m: 2000 },
  { label: '500m', m: 500 },
  { label: '300m', m: 300 },
  { label: '100m', m: 100 },
  { label: '통과', m: 0 },
];
const REASON_LABEL: Record<RejectReason, string> = {
  offRoute: '경로 밖',
  oppositeDirection: '반대 방향',
  unknownDirection: '방향 불명',
};

export function useHazardSimulation() {
  const [active, setActive] = useState(false);
  const [routeIdx, setRouteIdx] = useState(0);
  const [targetIdx, setTargetIdx] = useState(0);
  const [progressM, setProgressM] = useState(0); // 사용자가 경로를 따라 진행한 거리

  const route = ROUTES[routeIdx];
  const target = TARGETS[targetIdx].alert;

  // 선택한 위험 하나만 후보로 넣는다. 위험이 여러 개 겹치지 않아 단계별 동작을 따로 볼 수 있다.
  const match = useMemo(() => matchHazardsToRoute(route, [target]), [route, target]);
  const hazards = remainingHazards(match.onRoute, progressM);

  // 거리 버튼의 기준: 판정 결과와 상관없이 위험 위치를 경로에 투영한 지점
  const offsetOf = (alert: typeof target, r = route) => projectOntoRoute(r, alert)?.offsetM ?? 0;
  const distanceToTargetM = offsetOf(target) - progressM;
  const rejected = match.rejected[0]?.reason;

  const placeAt = (distanceM: number, alert = target) => setProgressM(Math.max(0, offsetOf(alert) - distanceM));
  const nextStep = STEPS.find((s) => s.m < Math.round(distanceToTargetM));

  const status = !active
    ? '안내 꺼짐'
    : rejected
      ? `숨김: ${REASON_LABEL[rejected]} (위험까지 ${formatDistance(Math.max(0, distanceToTargetM))})`
      : distanceToTargetM <= 0
        ? '통과'
        : `경로 위 · 남은 ${formatDistance(distanceToTargetM)}`;

  return {
    active,
    routeKey: route.id,
    hazards,
    routeIdx,
    targetIdx,
    distanceToTargetM,
    status,
    canNext: active && !!nextStep,
    toggleActive: () => {
      setActive(!active);
      placeAt(2000);
    },
    selectTarget: (i: number) => {
      setTargetIdx(i);
      placeAt(2000, TARGETS[i].alert);
    },
    placeAt,
    next: () => nextStep && placeAt(nextStep.m),
    reroute: () => setRouteIdx((i) => (i + 1) % ROUTES.length),
  };
}

export function HazardSimulator({ sim }: { sim: ReturnType<typeof useHazardSimulation> }) {
  const [open, setOpen] = useState(true);

  return (
    <View style={styles.box}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" style={styles.head}>
        <Text style={styles.title}>개발용 위험 시뮬레이터 (예시 데이터)</Text>
        <Text style={styles.title}>{open ? '접기' : '펼치기'}</Text>
      </Pressable>

      {open && (
        <>
          <View style={styles.row}>
            <Chip label={sim.active ? '안내 종료' : '안내 시작'} selected={sim.active} onPress={sim.toggleActive} />
            <Chip
              label={`재탐색 (경로 ${sim.routeIdx === 0 ? 'A' : 'B'})`}
              selected={false}
              disabled={!sim.active}
              onPress={sim.reroute}
            />
            <Chip label="다음 ▶" selected={false} disabled={!sim.canNext} onPress={sim.next} />
          </View>
          <View style={styles.row}>
            {TARGETS.map((target, i) => (
              <Chip key={target.label} label={target.label} selected={sim.targetIdx === i} onPress={() => sim.selectTarget(i)} />
            ))}
          </View>
          <View style={styles.row}>
            {STEPS.map((s) => (
              <Chip
                key={s.label}
                label={s.label}
                selected={Math.round(sim.distanceToTargetM) === s.m}
                disabled={!sim.active}
                onPress={() => sim.placeAt(s.m)}
              />
            ))}
          </View>
          <Text style={styles.status}>{sim.status}</Text>
          <Text style={styles.hint}>이미 본 단계는 다시 안 뜹니다. 처음부터 보려면 안내 종료 후 시작하세요.</Text>
        </>
      )}
    </View>
  );
}

function Chip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(23, 32, 42, 0.88)',
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  title: { fontSize: 12, fontWeight: '700', color: colors.surface },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.zone },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  status: { fontSize: 13, fontWeight: '700', color: colors.zone },
  hint: { fontSize: 11, color: 'rgba(255, 255, 255, 0.7)' },
});
