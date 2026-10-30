// 음성(TTS)으로 읽을 턴 안내에서 "같은 위치·같은 뜻"의 중복 줄을 거른다. 다른 모듈을 런타임 import 하지 않는 순수 함수라 Node 로 테스트한다.
//
// 왜: TMAP 은 턴 설명("교차로에서 우회전 후 느티나무1길을 따라 158m 이동") 바로 뒤에 같은 구간을 "느티나무1길, 158m" 로 한 번 더 요약해 준다.
// 팀 TTS 는 안내 문구를 원문 그대로 읽으므로 둘 다 읽혀서 같은 안내가 0.1초 간격으로 두 번 나온다.
// 실제 TMAP 응답 3개 경로(안내 101줄)에서 "도로명, 거리" 요약 52줄 중 39줄이 아래 조건을 모두 만족하는 중복이었고,
// 거리가 같은데 위치가 다른 경우는 0건이었다. 조건을 하나라도 만족하지 못하면 중복으로 보지 않고 그대로 둔다.
//
// 이 함수는 문구를 바꾸지 않는다(원문 정책 유지). 서로 다른 안내 지점도 지우지 않는다. 증명된 중복 줄만 뺀다.
import type { RouteInstruction } from '../../map/navigationApi';

// "도로명, 거리" 형태의 요약 줄
const SUMMARY_RE = /^([^,]+),\s*(\d+)m$/;
const DISTANCE_RE = /(\d+)m(?=\s|$)/g;
// 두 안내 지점이 같은 위치라고 볼 거리(m). 실제 응답에서는 0.00m 로 일치했다.
export const SAME_POINT_M = 3;

const M_PER_DEG = 111_320;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

function lastDistanceM(text: string): number | null {
  let last: number | null = null;
  for (const match of text.matchAll(DISTANCE_RE)) last = Number(match[1]);
  return last;
}

/**
 * 직전 줄과 "같은 위치(좌표 3m 이내) + 같은 거리 + 요약의 도로명이 직전 줄에 이미 들어 있음"인 요약 줄만 뺀다.
 * 좌표(point)가 없으면 같은 위치임을 확인할 수 없으므로 빼지 않는다. 입력 배열은 바꾸지 않는다.
 */
export function dedupeSpokenInstructions(instructions: RouteInstruction[]): RouteInstruction[] {
  return instructions.filter((item, i) => {
    const summary = SUMMARY_RE.exec(item.text);
    const prev = instructions[i - 1];
    if (!summary || !prev || !item.point || !prev.point) return true;
    const [, road, meters] = summary;
    const duplicate = distanceM(item.point, prev.point) <= SAME_POINT_M && lastDistanceM(prev.text) === Number(meters) && prev.text.includes(road.trim());
    return !duplicate;
  });
}
