// TTS 재생 관리자(엔진을 주입받는 순수 로직이라 Node 로 테스트한다. 앱에서는 speaker.ts 가 expo-speech 를 연결한다).
//
// 풀려는 문제
//  - 앱 언어를 바꿔도 이전 언어 설정으로 읽거나, 예약돼 있던 안내가 새 언어로 바꾼 뒤에 재생되는 것.
//  - 안드로이드에서 엔진이 기본(한국어) 음성으로 조용히 대신 읽는 것. 원인은 expo-speech 안드로이드 구현이다:
//      speakOut() 이 Locale.Builder().setLanguage(language) 를 쓰는데, 'en-US'·'zh-CN' 처럼 지역이 붙은 값은 형식 오류(IllformedLocaleException)라
//      기기 기본 언어(한국어)로 떨어진다. 그 뒤 voice 를 설정해야만 외국어로 읽히고, voice 설정이 실패하면(설치되지 않은 음성 등) 한국어 음성이 남는다.
//      한국어 음성이 중국어 문장을 읽으면 무음, 영어 문장을 읽으면 한국어 음성으로 들린다.
//    그래서 안드로이드에는 language 를 'en'·'zh'·'ko' 처럼 지역 없는 코드로 넘기고(iOS·웹은 'en-US' 그대로),
//    기기 음성 목록에서 설치된 것으로 보이는 음성(네트워크 음성은 뒤로)을 골라 voice 로 함께 넘긴다.
//  - 호출하는 곳마다 따로 있던 언어 매핑·음성 선택.
//
// 동작
//  - speak() 는 "요청 시점의 세대(generation)"를 기억하고, 음성 목록 확인을 기다린 뒤 세대가 바뀌었으면(언어 변경·stop) 읽지 않고 'stale' 을 돌려준다.
//  - 앱 언어와 다른 언어로 요청된 문장(바뀌기 전 화면이 만든 문장)도 읽지 않는다.
//  - 대상 언어 음성이 하나도 없으면 읽지 않고 한 번만 알린다('unsupported'). 목록을 못 받았거나 비어 있으면 모른다('unknown'): 막지 않고 시도한다.
//  - 모든 단계(요청·건너뜀·speak 호출·시작·종료·중단·오류·재시도)를 onEvent 로 알린다(개발 모드 진단용. 키·개인정보는 담지 않는다).
import {
  SPEECH_LOCALES,
  pickVoice,
  speechLanguageOf,
  voiceSupport,
  type SpeechLanguage,
  type VoiceLike,
  type VoiceSupport,
} from './speechLocale';

export interface SpeechEngine {
  speak(
    text: string,
    options: {
      language?: string;
      voice?: string;
      onStart?: () => void;
      onDone?: () => void;
      onStopped?: () => void;
      onError?: (error: unknown) => void;
    },
  ): void;
  stop(): void | Promise<void>;
  getAvailableVoicesAsync(): Promise<VoiceLike[]>;
}

export type SpeakResult = 'spoken' | 'stale' | 'unsupported' | 'empty';

/** 어느 안내가 만든 음성인가(진단용): car · walk · cycling · transit · home · hazard · chat */
export type SpeechSource = string;

export interface SpeakHooks {
  /** 읽기 전에 읽던 음성을 끊는다(단계 안내처럼 새 안내가 이전 안내를 대신할 때). 기본은 이어서 읽는다. */
  interrupt?: boolean;
  /** 진단 로그에 남길 안내 종류(navigationMode). */
  source?: SpeechSource;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (error: unknown) => void;
  /** 음성 목록을 기다리는 사이 호출한 쪽이 사라졌는지(화면이 닫힘 등). true 면 읽지 않고 'stale' 을 돌려준다. */
  isCancelled?: () => boolean;
  /** Optional low-priority admission check after voice resolution, before engine dispatch. */
  beforeSpeak?: () => Promise<boolean>;
}

export type SpeechEventStage =
  | 'request' // speak() 가 불렸다
  | 'skip' // 읽지 않기로 했다(reason)
  | 'speak' // 엔진 speak 를 불렀다
  | 'start' // 엔진이 읽기 시작했다고 알렸다
  | 'done'
  | 'stopped' // 엔진이 중단됐다고 알렸다
  | 'error' // 엔진이 오류를 알렸다
  | 'retry' // 선택한 음성이 오류를 내서 음성 지정 없이 다시 시도한다
  | 'cancel' // stop()/언어 변경으로 읽던 음성과 예약을 취소했다(reason)
  | 'language'; // 앱 언어가 바뀌었다

export interface SpeechDebugEvent {
  stage: SpeechEventStage;
  /** 안내 종류: car · walk · cycling · transit · home · hazard · chat. 모르면 'unknown' */
  navigationMode: string;
  /** 호출한 쪽이 넘긴 앱 언어(ko · en · zh) */
  appLanguage: string;
  /** 논리적 TTS 언어(ko-KR · en-US · zh-CN) */
  ttsLanguage: string;
  /** 엔진에 실제로 넘긴 language 값(안드로이드는 지역 없는 코드) */
  engineLanguage?: string;
  /** 읽으려는(읽은) 문장. 100자까지만 남긴다. */
  text?: string;
  /** 엔진에 넘긴 voice 식별자. 지정하지 않았으면 'default' */
  voice?: string;
  /** 엔진 speak 호출 여부 */
  speakCalled?: boolean;
  /** 건너뛰거나 취소한 이유 */
  reason?: string;
  /** 엔진 오류 요약(키·URL 없이 종류만) */
  error?: string;
}

export interface SpeakerOptions {
  engine: SpeechEngine;
  /** 'android' | 'ios' | 'web' */
  platform: string;
  /** 웹에서만: locale -> 선호 음성 이름(기기에 있을 때만 쓴다). 웹의 영어 TTS 가 이상한 음성으로 뽑히는 것을 피한다. */
  preferredWebVoices?: Partial<Record<string, string>>;
  /** 대상 언어 음성이 기기에 없을 때, 언어마다 한 번만 부른다. */
  onUnsupported?: (language: SpeechLanguage) => void;
  /** 진단 이벤트(개발 모드에서만 연결한다). */
  onEvent?: (event: SpeechDebugEvent) => void;
  /** 현재 시각(ms). 음성 목록을 다시 조회하는 간격을 재는 데 쓴다. 테스트에서 바꾼다. */
  now?: () => number;
}

/**
 * 대상 언어 음성이 없다고 나왔을 때(missing) 기기 음성 목록을 다시 조회하는 최소 간격(ms).
 * 사용자가 음성 데이터를 설치하고 앱으로 돌아오면 다음 안내·언어 변경 때 새로 설치된 음성을 알아본다. 안내가 올 때마다 조회하지 않도록 간격을 둔다.
 */
export const MISSING_VOICE_RECHECK_MS = 3000;

const TEXT_LIMIT = 100;

function errorKind(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error === 'string' ? error.slice(0, 60) : typeof error;
}

export function createSpeaker({ engine, platform, preferredWebVoices, onUnsupported, onEvent, now = Date.now }: SpeakerOptions) {
  let generation = 0;
  let priorityRequests = 0;
  let resolvingPriority = 0;
  let activeLanguage: SpeechLanguage | null = null;
  let voicesPromise: Promise<VoiceLike[]> | null = null;
  let voicesLoadedAt = 0; // 마지막으로 목록을 받은 시각
  const notified = new Set<SpeechLanguage>();

  /** 엔진에 넘기는 language. 안드로이드 expo-speech 는 'en-US' 를 형식 오류로 버리고 기기 기본 언어로 떨어지므로 지역 없는 코드를 쓴다. */
  const engineLanguageOf = (lang: SpeechLanguage): string => (platform === 'android' ? lang : SPEECH_LOCALES[lang]);

  function emit(event: Omit<SpeechDebugEvent, 'ttsLanguage' | 'appLanguage' | 'navigationMode'> & { navigationMode?: string; appLanguage?: string; ttsLanguage?: string }): void {
    if (!onEvent) return;
    const text = event.text === undefined ? undefined : event.text.length > TEXT_LIMIT ? `${event.text.slice(0, TEXT_LIMIT)}…` : event.text;
    onEvent({
      navigationMode: 'unknown',
      appLanguage: activeLanguage ?? 'unknown',
      ttsLanguage: activeLanguage ? SPEECH_LOCALES[activeLanguage] : 'unknown',
      ...event,
      text,
    });
  }

  // 음성 목록은 한 번만 받는다. 실패하거나 비어 있으면(엔진이 아직 준비 중일 수 있다) 저장하지 않고 다음에 다시 받는다.
  function loadVoices(): Promise<VoiceLike[]> {
    if (platform !== 'android' && platform !== 'web') return Promise.resolve([]);
    if (!voicesPromise) {
      voicesLoadedAt = now();
      const pending: Promise<VoiceLike[]> = engine.getAvailableVoicesAsync().then(
        (voices) => {
          if (voices.length === 0 && voicesPromise === pending) voicesPromise = null;
          return voices;
        },
        () => {
          if (voicesPromise === pending) voicesPromise = null;
          return [];
        },
      );
      voicesPromise = pending;
    }
    return voicesPromise;
  }

  async function resolveTarget(language: SpeechLanguage): Promise<{ support: VoiceSupport; voice?: string }> {
    if (platform === 'android') {
      let voices = await loadVoices();
      let support = voiceSupport(voices, language);
      if (support === 'missing' && now() - voicesLoadedAt >= MISSING_VOICE_RECHECK_MS) {
        // 목록에 이 언어가 없다: 그 사이 사용자가 음성 데이터를 설치했을 수 있으니 목록을 다시 받아 확인한다(간격을 둬서 안내마다 조회하지는 않는다).
        voicesPromise = null;
        voices = await loadVoices();
        support = voiceSupport(voices, language);
      }
      return { support, voice: pickVoice(voices, language)?.identifier };
    }
    if (platform === 'web') {
      const preferred = preferredWebVoices?.[SPEECH_LOCALES[language]];
      if (!preferred) return { support: 'unknown' };
      const voices = await loadVoices();
      // 웹 구현은 못 찾은 voice 식별자를 주면 언어와 무관한 첫 음성으로 떨어지므로, 기기에 있을 때만 넘긴다.
      return { support: 'unknown', voice: voices.find((v) => v.name === preferred && v.language === SPEECH_LOCALES[language])?.identifier };
    }
    return { support: 'unknown' };
  }

  function notifyUnsupported(language: SpeechLanguage): void {
    if (notified.has(language)) return;
    notified.add(language);
    onUnsupported?.(language);
  }

  async function speak(text: string, language: string, hooks: SpeakHooks = {}): Promise<SpeakResult> {
    const priority = !hooks.beforeSpeak;
    if(priority)priorityRequests++;
    const priorityAtRequest=priorityRequests;
    const lang = speechLanguageOf(language);
    const base = { navigationMode: hooks.source ?? 'unknown', appLanguage: lang, ttsLanguage: SPEECH_LOCALES[lang], text };
    emit({ ...base, stage: 'request' });
    if (!text.trim()) {
      emit({ ...base, stage: 'skip', reason: 'empty-text', speakCalled: false });
      return 'empty';
    }
    if (activeLanguage && lang !== activeLanguage) {
      emit({ ...base, stage: 'skip', reason: `stale-language(app=${activeLanguage})`, speakCalled: false });
      return 'stale'; // 앱 언어가 이미 바뀐 뒤에 이전 언어로 만든 문장
    }
    const requested = generation;
    if(priority)resolvingPriority++;
    let target:Awaited<ReturnType<typeof resolveTarget>>;
    try { target = await resolveTarget(lang); }
    finally { if(priority)resolvingPriority--; }
    if (requested !== generation || hooks.isCancelled?.()) {
      emit({ ...base, stage: 'skip', reason: requested !== generation ? 'cancelled-while-resolving-voice' : 'caller-gone', speakCalled: false });
      return 'stale'; // 기다리는 동안 언어가 바뀌었거나 stop() 됐거나 호출한 쪽이 사라졌다
    }
    if (target.support === 'missing') {
      notifyUnsupported(lang);
      emit({ ...base, stage: 'skip', reason: 'voice-data-missing', speakCalled: false });
      return 'unsupported';
    }
    if (hooks.interrupt) {
      // 끊는 호출이 끝난 뒤에 읽는다: 끊기 전에 엔진이 새 음성 설정(voice)을 받으면 그 설정이 끊김과 함께 사라질 수 있다.
      await engine.stop();
      if (requested !== generation || hooks.isCancelled?.()) {
        emit({ ...base, stage: 'skip', reason: 'cancelled-after-interrupt', speakCalled: false });
        return 'stale';
      }
    }
    const engineLanguage = engineLanguageOf(lang);
    let started = false;
    let retried = false;
    const run = (voice: string | undefined): void => {
      emit({ ...base, stage: 'speak', engineLanguage, voice: voice ?? 'default', speakCalled: true });
      engine.speak(text, {
        language: engineLanguage,
        voice,
        onStart: () => {
          started = true;
          emit({ ...base, stage: 'start', engineLanguage, voice: voice ?? 'default' });
        },
        onDone: () => {
          emit({ ...base, stage: 'done' });
          hooks.onDone?.();
        },
        onStopped: () => {
          emit({ ...base, stage: 'stopped', reason: 'engine-stopped' });
          hooks.onStopped?.();
        },
        onError: (error) => {
          emit({ ...base, stage: 'error', voice: voice ?? 'default', error: errorKind(error) });
          // 안드로이드에서 고른 음성이 시작도 못 하고 오류를 내면(설치되지 않은 음성 등) 음성 지정 없이 언어만으로 한 번 더 시도한다.
          // 안드로이드의 stop() 은 onStopped 로 끝나므로 취소가 오류로 오지 않는다. 취소된 뒤에는 다시 읽지 않는다.
          if (platform === 'android' && voice && !started && !retried && requested === generation && !hooks.isCancelled?.()) {
            retried = true;
            emit({ ...base, stage: 'retry', reason: 'voice-error-before-start', engineLanguage, voice: 'default' });
            run(undefined);
            return;
          }
          hooks.onError?.(error);
        },
      });
    };
    if (hooks.beforeSpeak && !await hooks.beforeSpeak()) return 'stale';
    if (hooks.beforeSpeak && (resolvingPriority>0||priorityAtRequest!==priorityRequests)) return 'stale';
    if (requested !== generation || hooks.isCancelled?.()) return 'stale';
    run(target.voice);
    return 'spoken';
  }

  /** 읽던 음성과, 아직 읽기 전인 모든 예약(음성 목록을 기다리는 중인 것)을 취소한다. reason 은 진단 로그용이다. */
  function stop(reason = 'stop'): void | Promise<void> {
    generation += 1;
    emit({ stage: 'cancel', reason });
    return engine.stop();
  }

  /** 지금 읽는 음성만 끊는다(다른 안내의 예약은 그대로). 자기 경고만 정리할 때 쓴다. */
  function stopSpeaking(reason = 'stop-current'): void | Promise<void> {
    emit({ stage: 'cancel', reason });
    return engine.stop();
  }

  /** 앱 언어가 바뀌었다: 이전 언어의 음성과 예약을 끊고, 이후 안내부터 새 언어로 읽는다. 새 언어 음성 지원 여부를 확인한다. */
  async function changeLanguage(language: string): Promise<VoiceSupport> {
    const lang = speechLanguageOf(language);
    if (activeLanguage !== lang) {
      const first = activeLanguage === null;
      activeLanguage = lang;
      emit({ stage: 'language', reason: first ? 'initial' : 'changed' });
      if (!first) {
        generation += 1;
        emit({ stage: 'cancel', reason: 'language-change' });
        void engine.stop();
      }
    }
    const { support, voice } = await resolveTarget(lang);
    emit({ stage: 'language', reason: `voice-support=${support}`, engineLanguage: engineLanguageOf(lang), voice: voice ?? 'default' });
    if (support === 'missing') notifyUnsupported(lang);
    return support;
  }

  /** 세 언어의 기기 음성 지원 여부(안드로이드만 확인할 수 있다. 다른 플랫폼은 'unknown'). */
  async function getSupport(): Promise<Record<SpeechLanguage, VoiceSupport>> {
    const [ko, en, zh] = await Promise.all((['ko', 'en', 'zh'] as const).map((lang) => resolveTarget(lang).then((r) => r.support)));
    return { ko, en, zh };
  }

  return { speak, stop, stopSpeaking, changeLanguage, getSupport, activeLanguage: () => activeLanguage };
}

export type Speaker = ReturnType<typeof createSpeaker>;
