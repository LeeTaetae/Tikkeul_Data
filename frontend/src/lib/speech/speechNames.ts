// 음성 안내에 들어가는 고유명사(도로명·정류장명·역명·노선명)의 안전한 처리. 순수 함수라 Node 로도 테스트한다.
//
// 조사 결과(2026-11): 지금 앱이 받는 이름은 전부 한국어뿐이다. Tmap 도로명, 카카오 정류장명·역명, TAGO·서울 버스 정류장명, 서울 역사마스터 CSV(역사 ID·역사명·호선·좌표)
// 어디에도 영문·중문 명칭이 없다. 한국어 이름을 영어·중국어 음성으로 읽으면 엔진이 한글을 한국어로 읽거나(한국어 음성이 섞임) 못 읽는다.
// 그렇다고 임의 번역·음역으로 틀린 장소를 안내하면 안 된다. 그래서 외국어(en/zh)로 말할 때는 다음 원칙을 쓴다.
//  - 한글이 들어 있는 이름은 읽지 않고 "화면에 표시된 정류장/역" 같은 일반 표현으로 바꾼다(이름은 화면에 그대로 있다).
//  - 영문·숫자뿐인 이름, 그리고 공식 표기를 확인한 노선 이름(아래 표)만 읽는다.
//  - 번역 표는 확실한 것만 둔다. 모르는 노선은 일반 표현으로 바꾼다.
// 공식 영문·중문 명칭 데이터가 생기면 이 파일의 표/함수만 바꾸면 된다.
import type { SpeechLanguage } from './speechLocale';

const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/; // 한글 자모·호환 자모·음절
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF]/; // 한자

/** 이 언어의 음성으로 그대로 읽어도 되는 이름인가. 한국어는 항상, 영어는 ASCII 만, 중국어는 ASCII·한자만(한글이 섞이면 안 된다). */
export function isSafeToSpeak(name: string, language: SpeechLanguage): boolean {
  const text = name.trim();
  if (!text) return false;
  if (language === 'ko') return true;
  if (HANGUL.test(text)) return false;
  if (/^[\x20-\x7E]+$/.test(text)) return true;
  return language === 'zh' && HAN.test(text) && !/[^\x20-\x7E\u3400-\u4DBF\u4E00-\u9FFF]/.test(text);
}

/** 읽어도 되는 이름이면 그 이름, 아니면 null(호출한 쪽이 일반 표현을 쓴다). */
export function speakableName(name: string | null | undefined, language: SpeechLanguage): string | null {
  if (!name) return null;
  return isSafeToSpeak(name, language) ? name.trim() : null;
}

// 지하철 노선 이름. 숫자 호선은 규칙으로, 이름이 있는 노선은 공식 표기를 확인한 것만 둔다(없으면 일반 표현).
//  영문: 각 운영사·서울시 영문 노선도 표기. 중문: 서울시 중문 노선도·운영사 중문 표기.
const NAMED_LINES: Record<string, { en: string; zh: string }> = {
  신분당선: { en: 'Sinbundang Line', zh: '新盆唐线' },
  경의중앙선: { en: 'Gyeongui-Jungang Line', zh: '京义中央线' },
  수인분당선: { en: 'Suin-Bundang Line', zh: '水仁盆唐线' },
  경춘선: { en: 'Gyeongchun Line', zh: '京春线' },
  공항철도: { en: 'AREX Airport Railroad', zh: '机场铁路' },
  서해선: { en: 'Seohae Line', zh: '西海线' },
};

/** 지하철 노선 이름을 이 언어의 표기로. 확인된 표기가 없으면 null. 한국어는 원래 이름 그대로. */
export function subwayLineLabel(lineName: string | null | undefined, language: SpeechLanguage): string | null {
  const name = (lineName ?? '').trim();
  if (!name) return null;
  if (language === 'ko') return name;
  const numbered = /^(인천)?(\d{1,2})호선$/.exec(name);
  if (numbered) {
    const n = numbered[2];
    if (numbered[1]) return language === 'en' ? `Incheon Line ${n}` : `仁川${n}号线`;
    return language === 'en' ? `Line ${n}` : `${n}号线`;
  }
  return NAMED_LINES[name]?.[language] ?? null;
}

/** 버스 노선 번호들. 숫자·영문·하이픈 토큰만 읽는다("3200", "31-3", "M5333"). 한글이 섞인 토큰("서초03", "(평일)")은 뺀다. */
export function busNumbers(lineName: string | null | undefined): string[] {
  return (lineName ?? '')
    .split(/[,/\s]+/)
    .map((token) => token.trim())
    .filter((token) => /^[0-9A-Za-z][0-9A-Za-z-]*$/.test(token));
}
