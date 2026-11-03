import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Crosshair } from 'lucide-react-native';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { speaker } from '../lib/speech/speaker';
import { transitActionSpeech, type Translate } from '../lib/speech/speechText';
import { useTranslation } from 'react-i18next';

import { NavStatus } from '../components/navigation/NavStatus';
import { TransitActionCard, TransitLegList, type LegItem } from '../components/navigation/TransitGuidance';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Card } from '../components/ui/Card';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { RoundButton } from '../components/ui/RoundButton';
import { formatDistance } from '../lib/distance';
import { displayEta, durationLabel } from '../lib/navigation/guidanceDisplay';
import { RIDE_POLICY, type NavRoute } from '../lib/navigation/guidanceEngine';
import { clearRideRequest, getRideRequest } from '../lib/navigation/guidanceSession';
import {
  INITIAL_RIDE,
  applyFix,
  buildTasks,
  buildTransitPlan,
  confirmTask,
  distanceM,
  hintFor,
  isFinished,
  legFraction,
  rideTotals,
  undoTask,
  INITIAL_STOP_TRACK,
  advanceStopTrack,
  canTrackStops,
  stopMarkOf,
  type StopTrack,
  type TransitLeg,
  type TransitTask,
} from '../lib/navigation/rideGuidance';
import { useGuidanceTracking } from '../lib/navigation/useGuidanceTracking';
import { rideGpsStatus, useRideMapFollow } from '../lib/navigation/useRideMap';
import { formatTimeKst } from '../lib/time';
import { KakaoMap } from '../map/KakaoMap';
import { showTransitRoute } from '../map/showTransitRoute';
import type { KakaoMapHandle } from '../map/types';
import { MAX_CONTENT_WIDTH, colors, radius, space } from '../theme';

const FOLLOW_LEVEL = 4;
// 시트 위에 놓는 현재 위치 버튼(48) + 간격
const FAB_RESERVE = 64;

// 대중교통 길안내. 카카오가 준 구간(도보·버스·지하철)을 단계로 나누고, GPS 는 도보 구간 도착과 "승차·하차 지점 근처" 알림에만 쓴다.
// 버스·지하철 탑승/하차는 GPS 로 확정할 수 없어서 사용자가 버튼으로 확인한다(rideGuidance 의 단계 규칙). 실시간 도착 정보는 없다.
export function TransitGuidanceScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();

  const requestRef = useRef(getRideRequest());
  const mapRef = useRef<KakaoMapHandle>(null);
  const spokenRef = useRef(new Set<string>());
  const [mapReady, setMapReady] = useState(false);
  const [following, setFollowing] = useState(true);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [topHeight, setTopHeight] = useState(0);
  const [ride, setRide] = useState(INITIAL_RIDE);
  const [ended, setEnded] = useState(false);
  // 구간별 현재 정거장 자동 판정 상태. 승차·하차 단계(ride)와 별개라 이 값이 바뀌어도 단계가 넘어가지 않는다.
  const [stopTracks, setStopTracks] = useState<Record<string, StopTrack>>({});
  const [, setClock] = useState(0);

  const option = useMemo(() => {
    const request = requestRef.current;
    return request?.mode === 'transit' ? request.transit : null;
  }, []);
  const plan = useMemo(() => (option && requestRef.current ? buildTransitPlan(option, requestRef.current.origin, requestRef.current.destination) : null), [option]);
  const legs = useMemo<TransitLeg[]>(() => plan?.legs ?? [], [plan]);
  const tasks = useMemo<TransitTask[]>(() => buildTasks(legs), [legs]);
  // 엔진이 따라갈 경로(앞뒤 직선 도보 포함). 안내 중에는 바뀌지 않는다(대중교통은 자동 재탐색을 하지 않는다).
  const route = useMemo<NavRoute | null>(
    () =>
      option && plan && legs.length > 0
        ? { id: `transit-${Date.now()}`, source: 'api', mode: 'walking', policy: RIDE_POLICY.transit, path: plan.path, distanceM: option.distanceKm > 0 ? option.distanceKm * 1000 : undefined, durationSec: option.durationMin > 0 ? option.durationMin * 60 : undefined }
        : null,
    [option, plan, legs],
  );

  const finished = isFinished(ride, tasks);
  const view = useGuidanceTracking({ route, enabled: focused && route !== null && !finished && !ended });
  const { snapshot, position } = view;

  // 도보 단계는 도착 반경 안에서 위치를 연속으로 받으면 자동으로 넘어간다. 탑승·하차 단계는 넘어가지 않는다(applyFix).
  useEffect(() => {
    if (position) setRide((prev) => applyFix(prev, tasks, legs, position, Date.now()));
  }, [position, tasks, legs]);
  // 엔진이 목적지 도착을 판정하면(목적지 근처에 연속으로 머묾) 남은 단계를 끝낸다.
  useEffect(() => {
    if (view.phase === 'arrived') setRide((prev) => ({ ...prev, taskIndex: tasks.length }));
  }, [view.phase, tasks.length]);

  useEffect(() => {
    if (!mapReady || !option) return;
    showTransitRoute(mapRef.current, option, { fit: true });
    if (requestRef.current) mapRef.current?.setDestination(requestRef.current.destination);
    const stops = legs.flatMap((leg) =>
      leg.kind === 'walk' || !leg.startPoint || !leg.endPoint
        ? []
        : [
            { point: leg.startPoint, label: leg.fromName },
            { point: leg.endPoint, label: leg.toName },
          ],
    );
    if (stops.length > 0) mapRef.current?.showPlaces(stops, colors.brand);
  }, [mapReady, option, legs]);

  useRideMapFollow({ mapRef, mapReady, position, following, level: FOLLOW_LEVEL });

  const task = tasks[ride.taskIndex] as TransitTask | undefined;
  const leg = task ? legs[task.legIndex] : undefined;
  // 현재 정거장 자동 판정은 사용자가 "탑승했어요"를 눌러 이동 단계가 된 구간에서만, 정거장 좌표가 확인된 경우에만 한다.
  const trackingKey = !finished && task?.kind === 'ride' && leg && canTrackStops(leg) ? String(task.legIndex) : null;

  // 이동 단계의 구간에서 위치가 들어올 때마다 현재 정거장을 판정한다(판정 규칙은 rideGuidance.advanceStopTrack).
  useEffect(() => {
    if (trackingKey === null || !task) return;
    const tracked = legs[task.legIndex];
    setStopTracks((prev) => ({
      ...prev,
      [trackingKey]: advanceStopTrack(prev[trackingKey] ?? INITIAL_STOP_TRACK, {
        points: tracked.stopPoints,
        offsets: tracked.stopOffsets,
        fix: position,
        nowMs: Date.now(),
        progressM: snapshot?.progressM ?? null,
        onRoute: snapshot?.status === 'onRoute',
      }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  // 위치가 한동안 안 들어오면(지하 등) "현재 역 인근"을 "마지막 확인 위치"로 바꾸려고 주기적으로 다시 그린다.
  useEffect(() => {
    if (trackingKey === null) return;
    const id = setInterval(() => setClock((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [trackingKey]);
  const stopMarks = Object.fromEntries(
    Object.entries(stopTracks).flatMap(([key, track]) => {
      const mark = stopMarkOf(track, Date.now(), view.phase === 'tracking'); // 위치 추적이 끊기거나 실패한 상태면 마지막 확인 위치로만 보인다
      return mark ? [[key, mark]] : [];
    }),
  );
  const hint = finished ? null : hintFor(task, leg, position, Date.now());

  const actionText = (): string => {
    if (!task || !leg) return t('nav.arrived');
    if (task.kind === 'walk') {
      if (leg.source === 'egress') return t('ride.action.walkTo', { place: t('ride.place.destination') });
      if (leg.transfer) return t('ride.action.transfer', { place: leg.toName || t('ride.place.next') });
      return t('ride.action.walkTo', { place: leg.toName || t('ride.place.boarding') });
    }
    if (task.kind === 'board') return t('ride.action.board', { line: leg.lineName || t(`ride.leg.${leg.kind}`), place: leg.fromName || t('ride.place.boarding') });
    const place = leg.toName || t('ride.place.alight');
    return leg.stopCount ? t('ride.action.rideStops', { n: leg.stopCount, place }) : t('ride.action.ride', { place });
  };
  const hintText = hint ? t(hint === 'nearBoard' ? 'ride.hint.nearBoard' : 'ride.hint.nearAlight') : null;
  const action = actionText();

  // 음성으로 읽는 단계 안내. 한국어는 화면 문구 그대로, 영어·중국어는 정류장·역 이름(한국어뿐)을 읽지 않는 그 언어의 문장을 따로 만든다(speechText.transitActionSpeech).
  const spokenAction = (): string => {
    if (!task || !leg) return t('nav.arrived');
    return transitActionSpeech(task.kind, leg, i18n.language, t as Translate) ?? action;
  };

  // 음성: 단계가 바뀔 때와 근처 알림이 처음 뜰 때 한 번씩만 읽는다. 되돌렸다 다시 와도 같은 안내를 반복하지 않는다.
  // 언어가 바뀌는 사이에 취소된 안내('stale')는 읽지 못했으니 '읽음'을 취소해서, 새 언어로 다시 읽게 한다.
  const speak = (key: string, text: string) => {
    if (!focused || spokenRef.current.has(key)) return;
    spokenRef.current.add(key);
    void speaker.speak(text, i18n.language, { interrupt: true, source: 'transit' }).then((result) => {
      if (result === 'stale') spokenRef.current.delete(key);
    });
  };
  useEffect(() => {
    if (route && !ended) speak(finished ? 'done' : `task:${ride.taskIndex}`, spokenAction());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride.taskIndex, finished, focused, i18n.language]);
  useEffect(() => {
    if (hint && hintText) speak(`hint:${ride.taskIndex}:${hint}`, hintText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint, ride.taskIndex]);
  useEffect(() => () => void speaker.stop('screen-unmount'), []);
  useEffect(() => {
    if (!focused) void speaker.stop('screen-blur');
  }, [focused]);

  const onEnd = () => {
    void speaker.stop('guidance-end');
    clearRideRequest();
    setEnded(true); // 위치 구독을 해제한다
    setStopTracks({});
    router.navigate('/');
  };

  const gps = rideGpsStatus(view);
  const fraction = leg && snapshot?.status === 'onRoute' ? legFraction(leg, snapshot.progressM) : 0;
  const totals = rideTotals(legs, tasks, ride.taskIndex, fraction);
  const eta = totals.remainingSec === null ? null : displayEta(totals.remainingSec, Date.now());
  const duration = eta ? durationLabel(eta.minutes) : null;
  const percent = Math.round(totals.fraction * 100);

  const straightDetail =
    !finished && task?.kind === 'walk' && leg?.endPoint && position
      ? t('ride.straight', { place: leg.transfer ? leg.toName || t('ride.place.next') : leg.source === 'egress' ? t('ride.place.destination') : leg.toName || t('ride.place.boarding'), distance: formatDistance(distanceM(position, leg.endPoint)) })
      : null;

  const lastTaskOfLeg = legs.map((_, i) => tasks.reduce((last, tk, index) => (tk.legIndex === i ? index : last), -1));
  const items: LegItem[] = legs.map((l, i) => {
    const state = lastTaskOfLeg[i] < ride.taskIndex ? 'done' : task?.legIndex === i ? 'current' : 'upcoming';
    const title =
      l.source === 'access' ? t('ride.leg.access') : l.source === 'egress' ? t('ride.leg.egress') : l.transfer ? t('ride.leg.transfer') : l.kind === 'walk' ? t('ride.leg.walk') : `${t(`ride.leg.${l.kind}`)} ${l.lineName}`.trim();
    const between = l.kind === 'walk' ? (l.transfer ? l.toName : '') : [l.fromName, l.toName].filter(Boolean).join(' → ');
    const detail = [between, l.stopCount ? t('ride.stops', { n: l.stopCount }) : ''].filter(Boolean).join(' · ');
    const time = l.timeSec === null ? null : durationLabel(Math.max(1, l.timeSec / 60));
    return {
      key: `${i}`,
      kind: l.kind,
      title,
      detail,
      meta: [formatDistance(l.distanceM), time ? t(time.key, time.params) : ''].filter(Boolean).join(' · '),
      state,
      stateLabel: state === 'done' ? t('ride.done') : state === 'current' ? t('ride.current') : '',
      fraction: state === 'current' ? fraction : 0,
      stops: l.kind === 'walk' ? undefined : l.stopNames,
      autoStops: l.kind === 'walk' ? undefined : canTrackStops(l),
    };
  });
  const hasStraightWalk = legs.some((l) => l.source !== 'step');
  const compact = windowHeight < 700;

  return (
    <View style={styles.root}>
      <View style={styles.mapLayer}>
        <KakaoMap ref={mapRef} autoLocate={false} onUserPan={() => setFollowing(false)} onReady={() => setMapReady(true)} />
      </View>

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} onLayout={(e: LayoutChangeEvent) => setTopHeight(Math.round(e.nativeEvent.layout.height))}>
        <View style={styles.column}>
          {route ? (
            <TransitActionCard
              kind={finished ? 'walk' : leg?.kind ?? 'walk'}
              stepLabel={finished ? t('ride.transitTitle') : t('ride.step', { current: ride.taskIndex + 1, total: tasks.length })}
              title={action}
              detail={[hintText, straightDetail].filter(Boolean).join('\n') || null}
              primaryLabel={finished ? t('nav.done') : t(task?.kind === 'board' ? 'ride.btn.boarded' : task?.kind === 'ride' ? 'ride.btn.alighted' : 'ride.btn.walkDone')}
              onPrimary={finished ? onEnd : () => setRide((prev) => confirmTask(prev, tasks))}
              undoLabel={!finished && ride.taskIndex > 0 ? t('ride.btn.undo') : undefined}
              onUndo={() => setRide((prev) => undoTask(prev))}
            />
          ) : (
            <Card>
              <Text style={styles.text} accessibilityRole="alert">
                {t(option ? 'ride.noLegs' : 'nav.noRequest')}
              </Text>
              <View style={styles.row}>
                <PrimaryButton label={t('nav.goHome')} onPress={() => router.navigate('/')} />
              </View>
            </Card>
          )}
          {route && !finished && gps && <NavStatus message={t(gps.key)} tone={gps.tone} actionLabel={gps.retry ? t('nav.gpsRetry') : undefined} onAction={gps.retry ? view.retry : undefined} />}
        </View>
      </View>

      {route && (
        <>
          <View style={[styles.fabLayer, { bottom: sheetHeight + space.sm }]}>
            <View style={styles.column}>
              <View style={styles.fabWrap}>
                <RoundButton icon={Crosshair} label={t('map.myLocation')} variant={following ? 'brand' : 'surface'} onPress={() => setFollowing(true)} />
              </View>
            </View>
          </View>

          {/* 펼쳐도 상단 카드(확인 버튼)와 현재 위치 버튼을 가리지 않게 높이를 제한한다 */}
          <BottomSheet windowHeight={windowHeight} bottomInset={insets.bottom} maxExpandedHeight={windowHeight - topHeight - FAB_RESERVE} onHeightChange={setSheetHeight}>
            <View style={styles.summary}>
              <View style={styles.summaryTexts}>
                <Text style={styles.summaryMain} numberOfLines={1} adjustsFontSizeToFit>
                  {eta ? formatTimeKst(new Date(eta.arrivalAtMs).toISOString()) : '—'} · {formatDistance(totals.remainingM)}
                </Text>
                <Text style={styles.summaryLabel}>
                  {t('nav.statArrival')} · {duration ? t(duration.key, duration.params) : '—'} · {t('nav.progress', { percent })}
                </Text>
              </View>
              <Pressable onPress={onEnd} accessibilityRole="button" style={({ pressed }) => [styles.endButton, compact && styles.endButtonCompact, pressed && styles.pressed]}>
                <Text style={styles.endText}>{t('nav.end')}</Text>
              </Pressable>
            </View>
            <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
              <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>
            <Text style={styles.note}>{t('ride.noRealtime')}</Text>
            {hasStraightWalk && <Text style={styles.note}>{t('ride.timeNote')}</Text>}
            <Text style={styles.sheetTitle}>{t('ride.sheetTitle')}</Text>
            <TransitLegList items={items} marks={stopMarks} trackingKey={trackingKey} />
          </BottomSheet>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  mapLayer: { ...StyleSheet.absoluteFill, zIndex: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  fabLayer: { position: 'absolute', left: 0, right: 0, zIndex: 4, alignItems: 'center', paddingHorizontal: space.lg, pointerEvents: 'box-none' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: space.sm, pointerEvents: 'box-none' },
  fabWrap: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  text: { fontSize: 15, lineHeight: 22, color: colors.ink, fontWeight: '600' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  summaryTexts: { flex: 1, minWidth: 0, gap: 2 },
  summaryMain: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: colors.ink },
  summaryLabel: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.muted },
  endButton: { minHeight: 48, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: colors.dangerStrong, alignItems: 'center', justifyContent: 'center' },
  endButtonCompact: { minHeight: 44, paddingHorizontal: space.md },
  endText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  pressed: { opacity: 0.85 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.brand },
  note: { fontSize: 12, lineHeight: 16, color: colors.muted },
  sheetTitle: { marginTop: space.xs, fontSize: 14, lineHeight: 20, fontWeight: '800', color: colors.ink },
});
