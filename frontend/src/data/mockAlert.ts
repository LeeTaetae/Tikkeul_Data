// 화면 확인용 예시 데이터. 실제 교통정보가 아니다. (교통 공공데이터 API 확정 전까지 사용)
// headingDeg 는 src/dev/mockRoute.ts 의 가상 경로와 맞춘 값이다. 실제 도로 방향이 아니다.
import type { RoadAlert } from '../types/alert';

export const MOCK_ALERTS: RoadAlert[] = [
  {
    id: 'm1',
    type: 'accident',
    severity: 'danger',
    location: '성수대교 북단 사거리',
    description: '2차로에서 추돌 사고 정보가 접수됐어요. 해당 구간은 서행하고 우회 도로를 확인하세요.',
    updatedAt: '2026-10-28T09:20:00+09:00',
    latitude: 37.5446,
    longitude: 127.0557,
    isSample: true,
    headingDeg: 236,
    translations: {
      en: {
        location: 'Seongsu Bridge north junction',
        description: 'A rear-end collision on lane 2 has been reported. Slow down and check for a detour.',
      },
      zh: {
        location: '圣水大桥北端十字路口',
        description: '2车道发生追尾事故的信息已上报。请减速行驶，并确认绕行道路。',
      },
    },
  },
  {
    id: 'm2',
    type: 'construction',
    severity: 'caution',
    location: '서울특별시 강남구 테헤란로 152 역삼역 사거리에서 선릉역 방면 3차로 전체 구간',
    description:
      '도로 보수 공사로 3차로가 통제되고 있어요. 공사 구간 진입 전 차선을 미리 변경하고, 작업자와 장비가 있으니 제한속도를 지켜 주세요. 공사는 오늘 18시까지 이어질 예정이에요.',
    updatedAt: '2026-10-28T09:10:00+09:00',
    latitude: 37.5006,
    longitude: 127.0364,
    isSample: true,
    headingDeg: 170,
    translations: {
      en: {
        location: 'Teheran-ro 152, Seoul: all of lane 3 from Yeoksam Station intersection toward Seolleung Station',
        description:
          'Lane 3 is closed for road repair work. Change lanes before the work zone and keep to the speed limit, as workers and equipment are present. The work is expected to continue until 18:00 today.',
      },
      zh: {
        location: '首尔特别市江南区德黑兰路152号，驿三站十字路口至宣陵站方向3车道全段',
        description:
          '因道路维修施工，3车道已封闭。进入施工路段前请提前变道；现场有作业人员和设备，请遵守限速。施工预计持续到今天18点。',
      },
    },
  },
  {
    id: 'm3',
    type: 'congestion',
    severity: 'busy',
    location: '강변북로 성수대교 방면',
    description: '평소보다 통행 속도가 느려요. 약 15분 더 걸릴 수 있어요.',
    updatedAt: '2026-10-28T09:15:00+09:00',
    latitude: 37.5321,
    longitude: 127.0316,
    isSample: true,
    headingDeg: 175,
    translations: {
      en: {
        location: 'Gangbyeonbuk-ro toward Seongsu Bridge',
        description: 'Traffic is moving slower than usual. It may take about 15 minutes longer.',
      },
      zh: {
        location: '江边北路，圣水大桥方向',
        description: '通行速度比平时慢，可能需要多花约15分钟。',
      },
    },
  },
];
