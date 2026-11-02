import { useTranslation } from 'react-i18next';

import type { Route } from './routeHazards';
import { useAnnounceOnApproach } from './useAnnounceOnApproach';
import type { RouteInstruction } from '../map/navigationApi';
import type { RouteGuide } from '../map/parseRoutes';
import { instructionSpeech, type Translate } from './speech/speechText';

interface Options {
  active: boolean;
  routeKey: string;
  route: Route | null;
  instructions: RouteInstruction[];
  /** 구조화된 안내 지점(회전 종류·도로명). 영어·중국어 음성이 문장을 새로 만들 때 쓴다. 없으면 한국어만 읽는다. */
  guides?: RouteGuide[];
  progressM: number;
  language: string;
  /** 진단 로그용 안내 종류(car · walk · cycling · home) */
  source?: string;
}

// 턴바이턴 안내 중 좌표가 있는 항목만, 경로를 따라 계산한 남은 거리가 가까워지면 TTS 로 한 번씩 읽는다.
// 텍스트 표시는 기존 경로 상세 목록(activeRoute.instructions)이 이미 하고 있어 여기선 음성만 맡는다.
// 한국어는 Tmap 원문을 그대로 읽고, 영어·중국어는 한국어 원문을 읽지 않고 회전 종류·남은 거리로 그 언어의 문장을 만든다(speechText.instructionSpeech).
// 공통 로직은 useAnnounceOnApproach(useSpeedBumpSpeech 와 공유).
export function useTurnInstructionSpeech({ active, routeKey, route, instructions, guides, progressM, language, source }: Options) {
  const { t } = useTranslation();
  useAnnounceOnApproach({
    active,
    routeKey,
    route,
    candidates: instructions,
    progressM,
    language,
    source,
    getPoint: (instruction) => instruction.point,
    getText: (instruction, { distanceM }) => instructionSpeech(instruction, guides, distanceM, language, t as Translate),
  });
}
