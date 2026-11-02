// 음성(TTS)으로 읽을 안내 문장을 언어별로 만든다. 번역 함수(t)를 받아 쓰는 순수 함수라 Node 로도 테스트한다.
//
// 원칙
//  - 한국어는 지금 동작을 그대로 둔다: 자동차·도보·자전거 턴 안내는 Tmap 원문, 대중교통 안내는 화면 문구(ride.action.*).
//  - 영어·중국어는 한국어 문장을 외국어 음성으로 읽지 않는다. 구조화된 값(회전 종류·거리·노선 번호)으로 그 언어의 문장을 새로 만든다.
//  - 정류장·역·도로 이름은 영문·중문 명칭이 없어서(speechNames.ts 참고) 한글이 든 이름은 읽지 않고 "화면에 표시된 정류장" 같은 일반 표현으로 바꾼다.
//  - 확인된 회전 종류(직진·좌회전·우회전·U턴·도착)가 아니면 외국어 음성은 읽지 않는다(잘못된 안내보다 무음이 낫다. 화면에는 그대로 있다).
import type { RouteInstruction } from '../../map/navigationApi';
import type { RouteGuide } from '../../map/parseRoutes';
import { turnKindOf } from '../navigation/guidanceDisplay';
import { speechLanguageOf } from './speechLocale';
import { busNumbers, speakableName, subwayLineLabel } from './speechNames';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** 거리를 읽는 말로: 10m 단위로 반올림, 1km 이상은 km. ("80 meters", "1.2 kilometers", "80米", "1.2公里") */
export function spokenDistance(meters: number, t: Translate): string {
  const rounded = Math.max(10, Math.round(meters / 10) * 10);
  if (rounded < 1000) return t('speech.distance.m', { n: rounded });
  return t('speech.distance.km', { n: (rounded / 1000).toFixed(1).replace(/\.0$/, '') });
}

/** 이만큼 이상 남았을 때만 "N미터 앞에서"를 붙인다. 가까우면 바로 지금 하는 말로 읽는다. */
const LEAD_MIN_M = 30;

export type SpokenTurnKind = 'straight' | 'left' | 'right' | 'uturn' | 'arrive';

/** 회전 안내 한 문장. distanceM 은 그 지점까지 남은 거리(m)이고 모르면 생략한다. road 는 다음 도로 이름(읽어도 되는 이름일 때만 들어간다). */
export function turnSentence(args: { kind: SpokenTurnKind; distanceM?: number | null; road?: string | null }, language: string, t: Translate): string {
  const lang = speechLanguageOf(language);
  const hasLead = args.distanceM != null && Number.isFinite(args.distanceM) && args.distanceM >= LEAD_MIN_M;
  if (args.kind === 'arrive' && !hasLead) return t('nav.arrived'); // 이미 도착한 거리
  const lead = hasLead ? t('speech.lead', { distance: spokenDistance(args.distanceM as number, t) }) : '';
  const road = args.kind === 'arrive' ? null : speakableName(args.road, lang);
  const onto = road ? t('speech.onto', { road }) : '';
  const sentence = `${lead}${t(`speech.action.${args.kind}`)}${onto}${t('speech.end')}`;
  return lang === 'en' ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence;
}

const M_PER_DEG = 111_320;
/** 안내 문구의 좌표와 안내 지점(guide)의 좌표가 같은 지점이라고 볼 거리(m). 자동차는 0m, 자전거 안내 지점은 경로에 10m 안으로 붙인 값이다. */
const GUIDE_MATCH_M = 40;

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot((b.lat - a.lat) * M_PER_DEG, (b.lng - a.lng) * M_PER_DEG * k);
}

/**
 * 안내 문구(한국어 원문)에 대응하는 구조화된 안내 지점. 같은 지점의 같은 문구(guide.description)만 인정한다.
 * "도로명, 거리" 같은 요약 줄은 안내 지점의 description 이 아니므로 대응하지 않는다(null).
 */
export function guideOfInstruction(instruction: RouteInstruction, guides: RouteGuide[] | undefined): RouteGuide | null {
  if (!instruction.point || !guides || guides.length === 0) return null;
  let best: RouteGuide | null = null;
  let bestM = GUIDE_MATCH_M;
  for (const guide of guides) {
    if (guide.description !== instruction.text) continue;
    const m = metersBetween(instruction.point, guide);
    if (m <= bestM) {
      best = guide;
      bestM = m;
    }
  }
  return best;
}

/**
 * 턴 안내 한 줄을 읽을 문장으로. 한국어는 원문 그대로. 영어·중국어는 회전 종류·남은 거리로 새로 만든다.
 * 빈 문자열이면 읽지 않는다(대응하는 안내 지점이 없거나, 확인되지 않은 회전 종류).
 */
export function instructionSpeech(
  instruction: RouteInstruction,
  guides: RouteGuide[] | undefined,
  distanceM: number | null,
  language: string,
  t: Translate,
): string {
  if (speechLanguageOf(language) === 'ko') return instruction.text;
  const guide = guideOfInstruction(instruction, guides);
  if (!guide) return '';
  const kind = turnKindOf(guide);
  if (kind === 'generic') return '';
  return turnSentence({ kind, distanceM, road: guide.nextRoadName }, language, t);
}

export interface TransitSpeechLeg {
  kind: 'walk' | 'bus' | 'subway';
  source: 'step' | 'access' | 'egress';
  transfer: boolean;
  fromName: string;
  toName: string;
  lineName: string;
  stopCount: number | null;
}

/**
 * 대중교통 단계(걷기·탑승·하차) 안내 문장. 한국어는 null: 호출한 쪽이 기존 화면 문구를 그대로 읽는다.
 * 정류장·역 이름은 읽어도 되는 경우(영문·숫자)에만 넣고, 아니면 "화면에 표시된 정류장/역"으로 말한다. 버스 번호와 확인된 노선 이름은 읽는다.
 */
export function transitActionSpeech(task: 'walk' | 'board' | 'ride', leg: TransitSpeechLeg, language: string, t: Translate): string | null {
  const lang = speechLanguageOf(language);
  if (lang === 'ko') return null;
  const stopPlace = leg.kind === 'subway' ? t('speech.place.subwayStation') : t('speech.place.busStop');
  if (task === 'walk') {
    if (leg.source === 'egress') return t('speech.ride.walkTo', { place: t('speech.place.destination') });
    if (leg.transfer) return t('speech.ride.transfer', { place: speakableName(leg.toName, lang) ?? t('speech.place.nextPoint') });
    return t('speech.ride.walkTo', { place: speakableName(leg.toName, lang) ?? t('speech.place.boardingPoint') });
  }
  if (task === 'board') {
    const place = speakableName(leg.fromName, lang) ?? stopPlace;
    let vehicle: string;
    if (leg.kind === 'bus') {
      const numbers = busNumbers(leg.lineName);
      vehicle = numbers.length > 0 ? t('speech.vehicle.bus', { line: numbers.join(t('speech.vehicle.or')) }) : t('speech.vehicle.busGeneric');
    } else {
      const label = subwayLineLabel(leg.lineName, lang);
      vehicle = label ? t('speech.vehicle.subway', { line: label }) : t('speech.vehicle.subwayGeneric');
    }
    return t('speech.ride.board', { place, vehicle });
  }
  const place = speakableName(leg.toName, lang) ?? stopPlace;
  return leg.stopCount ? t('speech.ride.alightAfter', { n: leg.stopCount, place }) : t('speech.ride.alight', { place });
}

/**
 * 위험 경고 음성 문장. 영어·중국어는 거리를 "500 meters"/"500米"처럼 읽는 말로 바꾼 같은 경고 문구를 쓴다(화면의 "500m" 표기는 음성에서 어색하다).
 * 한국어는 화면과 같은 문장을 그대로 읽는다(기존 동작).
 */
export function hazardSpeech(messageKey: string, distanceM: number, screenText: string, language: string, t: Translate): string {
  if (speechLanguageOf(language) === 'ko') return screenText;
  return t(messageKey, { distance: spokenDistance(distanceM, t) });
}
