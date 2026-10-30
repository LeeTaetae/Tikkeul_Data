import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';

import type { KakaoMapHandle, MapInsets } from '../../map/types';
import {
  buildPathIndex,
  INITIAL_HEADING,
  nextFollowLevel,
  pathAhead,
  pointAtDistance,
  routeBearingAt,
  shouldMoveCamera,
  updateHeading,
  type CameraTarget,
  type HeadingState,
  type LevelState,
} from './drivingCamera';
import type { Fix, GuidanceSnapshot, NavRoute } from './guidanceEngine';

interface Options {
  /** 차량 모드이고 지도가 준비됐을 때만 true. false 면 아무것도 하지 않는다(도보 모드는 기존 동작 그대로) */
  enabled: boolean;
  mapRef: RefObject<KakaoMapHandle | null>;
  route: NavRoute | null;
  position: Fix | null;
  snapshot: GuidanceSnapshot | null;
  /** false 면(사용자가 지도를 끌었다) 카메라는 옮기지 않는다. 마커와 앞쪽 경로는 계속 갱신한다 */
  following: boolean;
  /** 지도를 가리는 위 카드·아래 패널의 크기(px). 위치를 받는 순간의 최신 값을 쓴다 */
  insets: MapInsets;
}

// 차량 길안내 지도: 방향 화살표 마커, 앞쪽 경로만 그리기, 속도에 따른 확대 단계, 부드러운 카메라 추적.
// 지도 SDK 호출은 모두 핸들(mapRef)로 하고, 판단은 drivingCamera.ts 의 순수 함수가 한다.
export function useDrivingCamera({ enabled, mapRef, route, position, snapshot, following, insets }: Options) {
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const state = useRef<{ routeId: string; heading: HeadingState; level: LevelState | null; lastTarget: CameraTarget | null }>({
    routeId: '',
    heading: INITIAL_HEADING,
    level: null,
    lastTarget: null,
  });

  const index = useMemo(() => (route ? buildPathIndex(route.path) : null), [route]);

  // 패널 높이와 화면 방향이 바뀌면 같은 GPS 위치라도 화면 안의 자리를 다시 맞춘다.
  useEffect(() => {
    state.current.lastTarget = null;
  }, [insets.top, insets.bottom, insets.left, insets.right]);

  // 도착 지점 표시. 경로가 바뀌면 새 도착 지점으로 옮긴다.
  useEffect(() => {
    if (!enabled) return;
    const end = route?.path.at(-1) ?? null;
    mapRef.current?.setDestination(end);
    return () => mapRef.current?.setDestination(null);
  }, [enabled, route, mapRef]);

  // 앞쪽 경로만 그린다. 첫 위치를 받기 전에는 전체 경로 그대로 둔다(출발 전 경로 확인).
  const progressM = snapshot?.progressM ?? null;
  const arrived = snapshot?.status === 'arrived';
  useEffect(() => {
    if (!enabled || !index || progressM === null) return;
    // 확대된 주행 지도에서는 15m 단위 갱신도 차량 뒤에 긴 꼬리로 보인다.
    // 위치가 갱신될 때마다 정확히 같은 진행 지점에서 남은 경로를 시작한다.
    mapRef.current?.setRoutePath(arrived ? [] : pathAhead(index, progressM));
  }, [enabled, index, progressM, arrived, mapRef]);

  // 방향 화살표 마커와 카메라.
  useEffect(() => {
    const map = mapRef.current;
    if (!enabled || !map || !route || !index) return;
    const s = state.current;
    if (s.routeId !== route.id) {
      // 재탐색으로 새 경로가 오면 방향 기준을 새 경로로 바꾼다. 확대 단계는 유지한다.
      s.routeId = route.id;
      s.heading = INITIAL_HEADING;
      s.lastTarget = null;
    }
    if (!position) {
      // GPS가 아직 유효하지 않아도 전체 경로로 축소하지 않고 출발지 주변을 보여준다.
      // 출발지 미리보기 화살표는 반투명으로 표시한다. 실제 위치는 아니다.
      map.setLocationMarker(null);
      const start = route.path[0];
      if (following && start) {
        const target: CameraTarget = {
          position: start,
          headingDeg: routeBearingAt(index, 0),
          level: nextFollowLevel(null, null, Date.now()).level,
        };
        map.setLocationMarker(start, { headingDeg: target.headingDeg, preview: true });
        if (shouldMoveCamera(s.lastTarget, target)) {
          s.lastTarget = target;
          map.followTo(start, { level: target.level, headingDeg: target.headingDeg, insets: insetsRef.current });
        }
      } else {
        s.lastTarget = null;
      }
      return;
    }
    // 경로 위로 판정된 경우 화살표와 경로 시작점에 동일한 매칭 좌표를 쓴다.
    // 이탈 중에는 실제 GPS 위치를 그대로 보여준다.
    const point = snapshot?.status === 'onRoute'
      ? pointAtDistance(index, snapshot.progressM) ?? { lat: position.lat, lng: position.lng }
      : { lat: position.lat, lng: position.lng };
    const speedMps = snapshot?.speedMps ?? null;
    // 경로 위에 있을 때만 경로 방향을 쓴다. 이탈 중에는 위치 변화로 잰다.
    const routeBearing = snapshot && snapshot.status === 'onRoute' ? routeBearingAt(index, snapshot.progressM) : null;
    s.heading = updateHeading(s.heading, { position: point, speedMps, routeBearing });
    const headingDeg = s.heading.headingDeg;
    map.setLocationMarker(point, { headingDeg });

    if (!following) {
      s.lastTarget = null; // 다시 따라가기 시작하면 바로 제자리로 옮긴다
      return;
    }
    s.level = nextFollowLevel(s.level, speedMps, Date.now());
    const target: CameraTarget = { position: point, headingDeg, level: s.level.level };
    if (!shouldMoveCamera(s.lastTarget, target)) return;
    s.lastTarget = target;
    map.followTo(point, { level: target.level, headingDeg, insets: insetsRef.current });
  }, [enabled, route, index, position, progressM, following, mapRef, insets.top, insets.bottom, insets.left, insets.right]);
}
