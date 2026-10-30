import type { Route } from './routeHazards';
import { useAnnounceOnApproach } from './useAnnounceOnApproach';
import type { RouteInstruction } from '../map/navigationApi';

interface Options {
  active: boolean;
  routeKey: string;
  route: Route | null;
  instructions: RouteInstruction[];
  progressM: number;
  language: string;
}

// 턴바이턴 안내 중 좌표가 있는 항목만, 경로를 따라 계산한 남은 거리가 가까워지면 TTS 로 한 번씩 읽는다.
// 텍스트 표시는 기존 경로 상세 목록(activeRoute.instructions)이 이미 하고 있어 여기선 음성만 맡는다.
// 공통 로직은 useAnnounceOnApproach(useSpeedBumpSpeech 와 공유).
export function useTurnInstructionSpeech({ active, routeKey, route, instructions, progressM, language }: Options) {
  useAnnounceOnApproach({
    active,
    routeKey,
    route,
    candidates: instructions,
    progressM,
    language,
    getPoint: (instruction) => instruction.point,
    getText: (instruction) => instruction.text,
  });
}
