import { useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

import { projectOntoRoute, type Route } from './routeHazards';
import type { RouteInstruction } from '../map/navigationApi';

// i18n 언어 코드(ko/en/zh) → Speech locale.
const SPEECH_LOCALE: Record<string, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };

// 이 거리 안에 들어오면 한 번 읽는다. 통과 직후(-20m)까지는 늦게라도 읽어준다.
const ANNOUNCE_DISTANCE_M = 100;
const PASSED_GRACE_M = -20;

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
export function useTurnInstructionSpeech({ active, routeKey, route, instructions, progressM, language }: Options) {
  const spoken = useRef(new Set<number>());
  const lastRouteKey = useRef(routeKey);

  useEffect(() => {
    if (lastRouteKey.current !== routeKey) {
      spoken.current.clear();
      lastRouteKey.current = routeKey;
    }
    if (!active || !route) return;

    // 한 틱에 여러 안내지점이 한꺼번에 범위 안에 들어와도 하나만 읽는다. Chrome 은 speak() 를 여러 개
    // 연달아 큐에 넣으면 전부 조용히 버리는 경우가 있어서(이벤트조차 안 뜸), 겹쳐 부르면 안 된다.
    let nearest: { index: number; text: string; distanceM: number } | null = null;
    for (const [i, instruction] of instructions.entries()) {
      if (spoken.current.has(i) || !instruction.point) continue;
      const projected = projectOntoRoute(route, { latitude: instruction.point.lat, longitude: instruction.point.lng });
      if (!projected) continue;
      const distanceM = projected.offsetM - progressM;
      if (distanceM <= ANNOUNCE_DISTANCE_M && distanceM > PASSED_GRACE_M) {
        if (!nearest || distanceM < nearest.distanceM) nearest = { index: i, text: instruction.text, distanceM };
      }
    }
    if (nearest) {
      spoken.current.add(nearest.index);
      Speech.speak(nearest.text, { language: SPEECH_LOCALE[language] ?? SPEECH_LOCALE.ko });
    }
  }, [active, routeKey, route, instructions, progressM, language]);
}
