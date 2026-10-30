// 개발 전용: 음성(TTS) 충돌 확인용 짧은 가상 경로. /navigation?test=tts 에서만 쓴다(__DEV__). 실제 위험·실제 안내가 아니다.
// 시속 약 50km(초속 14m)로 실시간 재생한다. 경로 600m 지점에서 위험 경고(최종 단계), 턴 안내, 과속방지턱, 보호구역 과속 경고가
// 같은 순간에 겹치도록 일부러 한곳에 모았다. 문구에 "(테스트)"를 붙여 구분한다.
import type { RoadAlert } from '../types/alert';

const M_PER_DEG = 111_320;
const START = { lat: 37.5, lng: 127.0 };
const at = (northM: number) => ({ lat: START.lat + northM / M_PER_DEG, lng: START.lng });

/** 북쪽으로 900m 직선 */
export const TTS_TEST_PATH = [at(0), at(900)];

/** 경로 600m 지점에 위험·턴 안내·방지턱·보호구역이 모두 있다 */
export const TTS_TEST_INSTRUCTIONS = [
  { text: '(테스트) 첫 안내입니다', point: at(80) },
  { text: '(테스트) 600m 지점 턴 안내입니다', point: at(600) },
  { text: '(테스트) 마지막 안내입니다', point: at(820) },
];

export const TTS_TEST_SPEED_BUMPS = [{ lat: at(600).lat, lng: at(600).lng }];

export const TTS_TEST_ALERTS: RoadAlert[] = [
  {
    id: 'tts-accident',
    eventKey: 'tts-accident',
    type: 'accident',
    severity: 'danger',
    location: '예시: 음성 충돌 확인용 사고',
    description: '개발용 예시입니다.',
    updatedAt: '2026-10-28T09:00:00+09:00',
    isSample: true,
    directionScope: 'both',
    ...{ latitude: at(600).lat, longitude: at(600).lng },
  },
];

export const TTS_TEST_ZONES: RoadAlert[] = [
  {
    id: 'tts-school-zone',
    eventKey: 'tts-school-zone',
    type: 'school_zone',
    severity: 'caution',
    location: '예시: 가상 어린이보호구역',
    description: '개발용 예시 보호구역입니다.',
    updatedAt: '',
    isSample: true,
    omnidirectional: true,
    latitude: at(600).lat,
    longitude: at(600).lng,
  },
];
