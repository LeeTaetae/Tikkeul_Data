// 개발 전용: 가상 GPS 재생. 실제 위치·실제 경로가 아니다. /navigation?test=replay 로 열 때만 쓴다(__DEV__).
// 길안내 화면이 지도·마커·자동 추적·이탈·재탐색·도착에 어떻게 반응하는지 실제 GPS 없이 브라우저에서 확인하는 용도다.
// 다른 모듈을 런타임 import 하지 않는 순수 코드라 Node 로도 테스트한다.
import type { Fix, LatLng, LocationPort } from '../lib/navigation/guidanceEngine';

// offroute: 이탈 뒤 재탐색 성공 · rerouteFail: 이탈 뒤 재탐색이 계속 실패(화면의 실패 표시·수동 재시도 확인용)
export type ReplayScenario = 'replay' | 'offroute' | 'rerouteFail';

const M_PER_DEG = 111_320;
const DWELL_FIXES = 3;
const toRad = (deg: number) => (deg * Math.PI) / 180;

function distanceM(a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad((a.lat + b.lat) / 2));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

/** 경로를 따라 stepM 마다 점을 찍는다(마지막 점 포함). */
function sample(path: LatLng[], stepM: number): LatLng[] {
  const points: LatLng[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const len = distanceM(from, to);
    let d = stepM - carry;
    for (; d <= len; d += stepM) {
      const t = d / len;
      points.push({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
    }
    carry = len - (d - stepM);
  }
  const end = path[path.length - 1];
  const last = points[points.length - 1];
  if (last.lat !== end.lat || last.lng !== end.lng) points.push(end);
  return points;
}

/**
 * 경로를 따라 1초에 stepM(m)씩 가는 위치 열. offroute·rerouteFail 시나리오는 30% 지점에서 동쪽으로 벗어났다가 천천히 돌아온다.
 * 시각은 1초씩 늘려 만든다(실제 재생 속도는 createReplayPort 의 intervalMs).
 */
export function replayFixes(path: LatLng[], scenario: ReplayScenario, stepM = 40, startMs = 0): Fix[] {
  // 목적지에서 멈춘다(같은 위치를 몇 번 더). 마지막 간격이 도착 반경보다 넓어도 반경 안에 연속으로 들어와 도착이 판정된다.
  const sampled = sample(path, stepM);
  const points = [...sampled, ...Array.from({ length: DWELL_FIXES }, () => sampled[sampled.length - 1])];
  const DEVIATE_AT = Math.floor(points.length * 0.3);
  const DEVIATE_FIXES = 12; // 이탈 관측이 충분히 쌓이도록 오래 벗어나 있는다
  const RETURN_FIXES = 6;
  const OFFSET_M = 150;
  return points.map((p, i) => {
    let eastM = 0;
    if (scenario !== 'replay' && i >= DEVIATE_AT && i < DEVIATE_AT + DEVIATE_FIXES + RETURN_FIXES) {
      const into = i - DEVIATE_AT;
      eastM = into < DEVIATE_FIXES ? OFFSET_M : OFFSET_M * (1 - (into - DEVIATE_FIXES + 1) / (RETURN_FIXES + 1));
    }
    return {
      lat: p.lat,
      lng: p.lng + eastM / (M_PER_DEG * Math.cos(toRad(p.lat))),
      accuracyM: 8,
      timestampMs: startMs + i * 1000,
    };
  });
}

/** 위치 열을 intervalMs 마다 하나씩 흘려 보내는 가짜 위치 소스. 구독을 끊었다 다시 이으면 이어서 보낸다. */
export function createReplayPort(fixes: Fix[], intervalMs = 250): LocationPort {
  let cursor = 0;
  return {
    ensurePermission: async () => 'granted',
    watch: async (onFix) => {
      const id = setInterval(() => {
        if (cursor >= fixes.length) return clearInterval(id);
        onFix(fixes[cursor++]);
      }, intervalMs);
      return { remove: () => clearInterval(id) };
    },
  };
}

/** 재탐색 가상 응답: 현재 위치에서 시작해 원래 경로의 남은 점(현재 위치에 가장 가까운 점 다음부터)을 잇는다. */
export function replayRerouteFrom(position: LatLng, path: LatLng[]): LatLng[] {
  let nearest = 0;
  path.forEach((p, i) => {
    if (distanceM(position, p) <= distanceM(position, path[nearest])) nearest = i;
  });
  return [position, ...path.slice(Math.min(nearest + 1, path.length - 1))];
}
