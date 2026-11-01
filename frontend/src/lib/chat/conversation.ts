import type { RoutePoint } from '../../map/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

// shortcut: 최근 6개(3턴)만 보낸다. 더 긴 맥락이 필요해지면 서버 쪽 요약(compaction)으로 올려야 한다.
export function trimHistory(history: ChatTurn[], max = 6): ChatTurn[] {
  return history.slice(-max);
}

// getCurrentLocation() 은 GPS 를 못 읽으면(권한 거부·웹 데모·타임아웃) 실패 대신 DEMO_ORIGIN(서울시청,
// src/map/demoDestinations.ts)으로 조용히 대체한다. 그 값을 실제 위치로 보내면 챗봇이 엉뚱한 위치 기준으로
// 실시간 데이터를 답하게 되므로 "위치 없음"과 같은 취급을 한다.
// shortcut: 좌표를 직접 비교해 DEMO_ORIGIN을 가져오지 않는다 - demoDestinations.ts를 임포트하면(확장자 없는
// 상대경로) node --test 가 값 임포트를 못 찾는다(타입 임포트만 지워지고 값 임포트는 그대로 남아 리졸브됨).
// DEMO_ORIGIN 좌표가 바뀌면 여기도 같이 고쳐야 한다.
const DEMO_ORIGIN_LAT = 37.5665;
const DEMO_ORIGIN_LNG = 126.978;

function isRealLocation(origin: RoutePoint | null): origin is RoutePoint {
  return origin !== null && !(origin.lat === DEMO_ORIGIN_LAT && origin.lng === DEMO_ORIGIN_LNG);
}

export function buildRequestBody(message: string, history: ChatTurn[], origin: RoutePoint | null) {
  return {
    message,
    history: trimHistory(history),
    ...(isRealLocation(origin) ? { lat: origin.lat, lon: origin.lng } : {}),
  };
}
