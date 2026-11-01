import type { RoutePoint } from '../../map/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

// shortcut: 최근 6개(3턴)만 보낸다. 더 긴 맥락이 필요해지면 서버 쪽 요약(compaction)으로 올려야 한다.
export function trimHistory(history: ChatTurn[], max = 6): ChatTurn[] {
  return history.slice(-max);
}

export function buildRequestBody(message: string, history: ChatTurn[], origin: RoutePoint | null) {
  return {
    message,
    history: trimHistory(history),
    ...(origin ? { lat: origin.lat, lon: origin.lng } : {}),
  };
}
