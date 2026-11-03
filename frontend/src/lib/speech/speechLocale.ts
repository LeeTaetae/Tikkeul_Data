// 앱 언어(i18next: ko/en/zh) <-> TTS 언어(locale)와 기기 음성(voice) 선택. 다른 모듈을 런타임 import 하지 않는 순수 함수라 Node 로도 테스트한다.
//
// 지원 언어는 한국어(ko-KR), 영어(en-US), 중국어 간체(zh-CN) 세 가지다. 앱 언어가 'en-US' 같은 지역 코드로 들어와도 같은 언어로 본다.
// 모르는 언어는 한국어로 돌린다(앱의 fallbackLng 와 같다).

export type SpeechLanguage = 'ko' | 'en' | 'zh';

export const SPEECH_LOCALES: Record<SpeechLanguage, string> = { ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' };

// 웹(브라우저)에서만 쓰는 선호 음성 이름. 웹의 영어 TTS 가 OS 기본의 장난 음성으로 뽑히는 것을 피한다. 기기에 있을 때만 적용한다.
export const PREFERRED_WEB_VOICES: Partial<Record<string, string>> = { 'en-US': 'Samantha' };

/** 앱 언어 값(ko · en-US · zh-Hans-CN 등)을 지원 언어 하나로. 모르는 값은 'ko'. */
export function speechLanguageOf(language: string | null | undefined): SpeechLanguage {
  const base = (language ?? '').toLowerCase().replace(/_/g, '-').split('-')[0];
  return base === 'en' ? 'en' : base === 'zh' ? 'zh' : 'ko';
}

export function speechLocaleOf(language: string | null | undefined): string {
  return SPEECH_LOCALES[speechLanguageOf(language)];
}

export interface VoiceLike {
  identifier: string;
  name: string;
  language: string;
  quality?: string;
}

// 중국어 간체(만다린) 음성으로 보는 태그. 대만·홍콩(zh-TW, zh-HK)·광둥어(yue)는 간체 안내용이 아니라서 넣지 않는다.
const ZH_SIMPLIFIED = new Set(['zh', 'zh-cn', 'zh-hans', 'zh-hans-cn', 'cmn', 'cmn-cn', 'cmn-hans', 'cmn-hans-cn']);
const EXACT: Record<SpeechLanguage, Set<string>> = {
  ko: new Set(['ko-kr']),
  en: new Set(['en-us']),
  zh: new Set(['zh-cn', 'zh-hans-cn', 'cmn-cn', 'cmn-hans-cn']),
};

function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/_/g, '-');
}

/** 이 음성이 대상 언어의 안내에 쓸 수 있는가: 'exact'(대상 locale 그대로), 'same'(같은 언어의 다른 지역), null(아님) */
export function voiceMatches(voiceLanguage: string, target: SpeechLanguage): 'exact' | 'same' | null {
  const tag = normalizeTag(voiceLanguage);
  if (EXACT[target].has(tag)) return 'exact';
  if (target === 'zh') return ZH_SIMPLIFIED.has(tag) ? 'same' : null;
  return tag === target || tag.startsWith(`${target}-`) ? 'same' : null;
}

const QUALITY_RANK: Record<string, number> = { enhanced: 2, default: 1 };

// 네트워크 음성(구글 TTS 는 이름에 "network")은 기기에 내려받아 두지 않았거나 연결이 없으면 못 읽는다. expo-speech 안드로이드는 voice 설정이 실패해도
// 오류를 알리지 않고 기기 기본 음성(한국어)으로 읽기 때문에, 설치된 음성으로 보이는 것을 먼저 고르고 네트워크 음성은 다른 선택지가 없을 때만 쓴다.
const NETWORK_PENALTY = 20;
const isNetworkVoice = (voice: VoiceLike): boolean => /network/i.test(voice.name) || /network/i.test(voice.identifier);

/** 대상 언어에 쓸 음성 하나. 네트워크가 아닌 음성이 우선이고, 대상 locale 과 같은 음성, 고음질 순이다. 없으면 null. */
export function pickVoice<V extends VoiceLike>(voices: V[], target: SpeechLanguage): V | null {
  let best: V | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const match = voiceMatches(voice.language, target);
    if (!match) continue;
    const score = (match === 'exact' ? 10 : 0) + (QUALITY_RANK[String(voice.quality ?? '').toLowerCase()] ?? 0) - (isNetworkVoice(voice) ? NETWORK_PENALTY : 0);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

export type VoiceSupport = 'available' | 'missing' | 'unknown';

/** 기기 음성 목록으로 본 지원 여부. 목록을 못 받았거나 비어 있으면 모른다('unknown'): 막지 않고 시도한다. */
export function voiceSupport(voices: VoiceLike[], target: SpeechLanguage): VoiceSupport {
  if (voices.length === 0) return 'unknown';
  return pickVoice(voices, target) ? 'available' : 'missing';
}
