// 백엔드가 주는 턴 안내 문장(Tmap 원문)을 화면 표시용으로 다듬는다. TTS 는 원문을 그대로 쓰므로 건드리지 않는다.
// 다른 모듈을 import 하지 않는 순수 함수라 Node 로도 테스트한다(거리 표기 규칙은 lib/distance.ts 의 formatDistance 와 같다).
import type { RouteInstruction } from '../map/navigationApi';

function formatDistance(meters: number): string {
  const rounded = Math.round(meters / 10) * 10;
  if (rounded < 1000) return `${rounded}m`;
  return `${(rounded / 1000).toFixed(1).replace(/\.0$/, '')}km`;
}

const DISTANCE_RE = /(\d+)m(?=\s|$)/g;
// "도로명, 123m" 형태만 걸러낸다. Tmap 이 턴 설명 바로 뒤에 같은 구간을 이 형태로 다시 요약해서 준다.
const PLAIN_ROAD_RE = /^[^,]+,\s*(\d+)m$/;

function lastDistanceM(text: string): number | null {
  let last: number | null = null;
  for (const match of text.matchAll(DISTANCE_RE)) last = Number(match[1]);
  return last;
}

/** 문장 속 거리 표기를 km 단위로 바꾼다("1856m 이동" → "1.9km 이동"). */
export function formatInstructionText(text: string): string {
  return text.replace(DISTANCE_RE, (_, n: string) => formatDistance(Number(n)));
}

/** 턴 설명 바로 뒤에 같은 구간을 "도로명, 거리"로 다시 요약하는 중복 줄을 뺀다. */
export function dedupeInstructions(instructions: RouteInstruction[]): RouteInstruction[] {
  const result: RouteInstruction[] = [];
  let prevDistance: number | null = null;
  for (const instruction of instructions) {
    const plain = PLAIN_ROAD_RE.exec(instruction.text);
    const plainDistance: number | null = plain ? Number(plain[1]) : null;
    const isDuplicate: boolean = plainDistance !== null && prevDistance !== null && plainDistance === prevDistance;
    if (!isDuplicate) result.push(instruction);
    prevDistance = isDuplicate ? null : lastDistanceM(instruction.text);
  }
  return result;
}
