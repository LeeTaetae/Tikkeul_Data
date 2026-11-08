import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clearNativeHazardRail, onNativeGuidanceFeed, setNativeHazardRail } from '../../native/kakaoNavigation';
import { hazardKey, projectOntoRoute, type Route } from '../routeHazards';
import type { NavRoute } from './guidanceEngine';
import { parseNativeLocation, parseNativeRoute, type NativePosition } from './nativeGuidanceFeed';
import { buildNativeRailSnapshot, hazardBannerActive, railChanged, serializeNativeRail, type NativeRailSnapshot } from './nativeHazardRail';
import { useRouteHazardWarning } from './useRouteHazardWarning';
import { createNativeWeatherFixGate } from './nativeWeatherFix';
import { describeHazardForNative } from './nativeHazardText';

/**
 * 카카오 SDK 주행 화면(네이티브)의 위치·경로 이벤트로 기존 위험 훅(useRouteHazardWarning)을 돌리고, 그 결과(rail)를
 * 네이티브 왼쪽 위험 레일로 보낸다. 판단(매칭·P등급·단계)은 모두 기존 JS 로직이고, 네이티브는 받은 스냅샷을 그리기만 한다.
 *
 *  - 경로 이벤트(시작·재탐색)가 오면 경로를 바꾼다. 새 경로 기준으로 위험이 다시 분류되어 레일이 새 정보로 교체된다.
 *  - 위치 이벤트는 유효한(valid) 것만 쓴다. 위치가 무효이면 마지막 유효 위치를 유지한다.
 *  - 레일 내용(키·순서·단계·강조·50m 거리 단위)이 바뀔 때만 네이티브로 보낸다. 화면이 닫히면 비운다.
 *
 * 한계: SDK 화면이 앞에 있으면 RN 호스트가 일시정지되어 setInterval 이 멈춘다(실기기에서 확인). useApi 의 60초 자동 갱신도
 * 타이머라서 이 동안은 멈춘다. 위험 데이터는 경로·조회 영역이 바뀔 때 다시 받는다.
 */
export function useNativeHazardRail() {
  const { t, i18n } = useTranslation();
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [position, setPosition] = useState<NativePosition | null>(null);
  const [weatherFix,setWeatherFix]=useState<import('../tunnel/approach').GpsFix|null>(null);
  const [positionTrusted,setPositionTrusted]=useState(false);
  const [weatherProgressM,setWeatherProgressM]=useState<number|null>(null);
  const gpsGate=useRef(createNativeWeatherFixGate());

  useEffect(
    () =>
      onNativeGuidanceFeed((event) => {
        if (event.kind === 'route') {
          const keys = Array.isArray(event.keys) ? (event.keys as string[]) : undefined;
          const path = parseNativeRoute(event.points, keys);
          // 경로를 해석하지 못하면 이전 경로를 남기지 않는다(오래된 경로로 위험을 판정하면 안 된다).
          setRoute(path ? { id: `native-${Date.now()}`, source: 'api', mode: 'driving', path } : null);
          gpsGate.current.reset();setWeatherFix(null);setWeatherProgressM(null);setPositionTrusted(false);
        } else if (event.kind === 'location') {
          const next = parseNativeLocation(event);
          if (next) {
            setPosition(next);
          }
          const measured=gpsGate.current.accept(event,Date.now());
          if(measured.kind==='accepted') {
            setWeatherFix(measured.value.fix);setWeatherProgressM(measured.value.progressM);
            setPositionTrusted(measured.value.positionTrusted);
          } else if(measured.kind==='rejected') {setWeatherFix(null);setWeatherProgressM(null);setPositionTrusted(false);}
        }
      }),
    [],
  );

  const hazardRoute = useMemo<Route | null>(
    () => (route ? { id: route.id, points: route.path.map((p) => ({ latitude: p.lat, longitude: p.lng })) } : null),
    [route],
  );
  const progressM = useMemo(
    () => (hazardRoute && position ? projectOntoRoute(hazardRoute, { latitude: position.lat, longitude: position.lng })?.offsetM ?? 0 : 0),
    [hazardRoute, position],
  );

  const hazard = useRouteHazardWarning({
    route,
    progressM,
    active: route !== null && position !== null,
    position,
    speedMps: position?.speedMps ?? null,
  });

  // 개발 확인용: 경로 진행 거리와 위험 API 상태를 로그로 남긴다(좌표 없음). notice: 'failed'|'partial'|null, zones: 보호구역 조회 상태.
  useEffect(() => {
    if (__DEV__) console.warn('[rail] state', JSON.stringify({ progressKm: Math.round(progressM / 100) / 10, notice: hazard.notice, zones: hazard.zoneCoverage, rail: hazard.rail.length, candidates: hazard.candidates.length }));
  }, [Math.round(progressM / 500), hazard.notice, hazard.zoneCoverage, hazard.rail.length, hazard.candidates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 단계 안내(2km 사전 안내·500·300·100m)는 웹과 같은 useHazardWarning 이 단계마다 한 번만 만든다. 위험을 지나면 사라진다.
  const warning = hazard.warning;
  const warningKey = warning ? `${hazardKey(warning.alert)}:${warning.stage}` : null;
  const warningText = warning ? t(warning.message.key, warning.message.params) : null;
  // 이 단계 안내가 처음 나온 시각. 새 (위험, 단계)가 나올 때만 바뀐다.
  const warningShownAt = useMemo(() => (warningKey ? Date.now() : null), [warningKey]);
  const snapshot = useMemo(
    () =>
      buildNativeRailSnapshot(hazard.rail, {
        describe: (item) => describeHazardForNative(item, t, i18n.language),
        warning: warning && warningKey && warningText ? { key: warningKey, stage: warning.stage, text: warningText } : null,
      }),
    // warning 객체는 렌더마다 새로 만들어지므로 키·단계·문장으로 비교한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hazard.rail, warningKey, warning?.stage, warningText, t, i18n.language],
  );
  const lastSent = useRef<NativeRailSnapshot | null>(null);
  useEffect(() => {
    if (!railChanged(lastSent.current, snapshot)) return;
    lastSent.current = snapshot;
    setNativeHazardRail(serializeNativeRail(snapshot));
    // 좌표·원문 없이 유형·단계·거리만 로그로 남긴다.
    if (__DEV__) console.warn('[rail] send', JSON.stringify(snapshot.items.map((i) => [i.type, i.zoneType, i.priority, i.stage, i.distanceM])), 'overflow', snapshot.overflow, 'notice', hazard.notice);
  }, [snapshot, hazard.notice]);

  // 주행 화면이 끝나면 오버레이를 비운다.
  useEffect(() => () => clearNativeHazardRail(), []);
  return {weatherRoute:hazardRoute,weatherFix,weatherProgressM,positionTrusted,weatherBlocked:hazardBannerActive(warningShownAt,Date.now())};
}
