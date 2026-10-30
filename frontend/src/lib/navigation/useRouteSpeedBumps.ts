import { useMemo } from 'react';

import { trafficApi } from '../api/api';
import { useApi } from '../api/useApi';
import { bboxForPoints } from '../location/geo';

// 경로 위 과속방지턱 좌표. 팀 main 의 홈 화면(app/index.tsx)에 있던 조회 코드를 길안내 화면에서도 쓰도록 옮긴 것이며 동작은 같다.
// 경로 전체를 덮는 영역으로 한 번만 조회한다(위험구간처럼 시군구 단위가 아니라 좌표 전체 범위). 데이터는 서버의 로컬 SQLite 라 외부 API 호출이 아니다.
// 경로(path)가 바뀔 때만 다시 조회하고, 반환 배열은 useMemo 로 참조를 고정한다(음성 훅의 effect 가 불필요하게 다시 돌지 않게).
export function useRouteSpeedBumps(path: { lat: number; lng: number }[] | null): { lat: number; lng: number }[] {
  const bbox = useMemo(() => (path && path.length > 0 ? bboxForPoints(path.map((p) => ({ latitude: p.lat, longitude: p.lng })), 300) : null), [path]);
  const bboxKey = bbox ? `${bbox.minLon},${bbox.maxLon},${bbox.minLat},${bbox.maxLat}` : '';
  const data = useApi((signal) => trafficApi.speedBumps(bbox!, { signal }), { key: bboxKey, enabled: !!bbox });

  // 좌표를 5자리(~1m)로 반올림해 중복 등록된 같은 방지턱도 한 번만 남긴다(행정안전부 데이터에 중복이 있다).
  return useMemo(() => {
    const items = data.state.status === 'success' ? data.state.data.items : [];
    const seen = new Set<string>();
    const points: { lat: number; lng: number }[] = [];
    for (const item of items) {
      const key = `${item.location.lat.toFixed(5)},${item.location.lon.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ lat: item.location.lat, lng: item.location.lon });
    }
    return points;
  }, [data.state.data]);
}
