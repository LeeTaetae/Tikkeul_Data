// 대중교통 경로선 색상 매핑 검증. 노선·유형 이름은 카카오 REST 실호출(2026-11, 7개 도시)에서 확인한 값이다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_BUS_COLOR,
  DEFAULT_SUBWAY_COLOR,
  MAX_BOUNDARY_GAP_M,
  SEOUL_BUS_COLORS,
  SUBWAY_COLORS,
  WALK_COLOR,
  buildRouteSegments,
  regionOf,
  subwayColor,
} from '../src/lib/navigation/transitColors.ts';

// 도시별 대표 지점(역)
const SEOUL = { lat: 37.5088, lng: 126.8913 }; // 신도림
const PANGYO = { lat: 37.395, lng: 127.111 }; // 성남 판교
const BUPYEONG = { lat: 37.4897, lng: 126.7227 }; // 인천 부평
const BUSAN = { lat: 35.1578, lng: 129.0594 }; // 서면
const DAEGU = { lat: 35.8795, lng: 128.6286 }; // 동대구
const DAEJEON = { lat: 36.3322, lng: 127.4347 }; // 대전역
const GWANGJU = { lat: 35.1378, lng: 126.7925 }; // 광주송정
const ULSAN = { lat: 35.5384, lng: 129.3114 };

test('지역 판정: 도시별 대표 지점이 맞는 지역이 되고, 모르는 곳은 null 이다', () => {
  assert.equal(regionOf(SEOUL), 'capital');
  assert.equal(regionOf(PANGYO), 'capital');
  assert.equal(regionOf(BUPYEONG), 'capital');
  assert.equal(regionOf(BUSAN), 'busan');
  assert.equal(regionOf(DAEGU), 'daegu');
  assert.equal(regionOf(DAEJEON), 'daejeon');
  assert.equal(regionOf(GWANGJU), 'gwangju');
  assert.equal(regionOf(ULSAN), null);
  assert.equal(regionOf({ lat: 33.5, lng: 126.5 }), null); // 제주
});

test('지하철 노선색: 수도권 1~9호선과 광역 노선', () => {
  const expected = { '1호선': '#0052A4', '2호선': '#009D3E', '3호선': '#EF7C1C', '4호선': '#00A4E3', '5호선': '#996CAC', '6호선': '#CD7C2F', '7호선': '#747F00', '8호선': '#F15B66', '9호선': '#BDB092' };
  for (const [line, color] of Object.entries(expected)) assert.equal(subwayColor('capital', line).color, color, line);
  for (const line of ['신분당선', '경의중앙선', '수인분당선', '경춘선', '서해선', '인천1호선', '인천2호선', '우이신설', '에버라인', '의정부 경전철']) {
    assert.match(subwayColor('capital', line).color, /^#[0-9A-F]{6}$/, line);
  }
});

test('같은 "1호선" 이름이라도 지역이 다르면 다른 색이다', () => {
  const colors = ['capital', 'busan', 'daegu'].map((r) => subwayColor(r, '1호선').color);
  assert.equal(new Set(colors).size, 3);
  assert.notEqual(subwayColor('busan', '2호선').color, subwayColor('daegu', '2호선').color);
  assert.notEqual(subwayColor('capital', '2호선').color, subwayColor('busan', '2호선').color);
});

test('근거를 확인하지 못한 노선·지역은 색을 주지 않는다(기본 색을 쓰게 한다)', () => {
  assert.equal(subwayColor('daejeon', '1호선'), null); // 출처 없음
  assert.equal(subwayColor('gwangju', '1호선'), null);
  assert.equal(subwayColor('capital', '공항철도'), null); // 값이 엇갈려 넣지 않음
  assert.equal(subwayColor('capital', 'GTX-A'), null);
  assert.equal(subwayColor('capital', '경강선'), null);
  assert.equal(subwayColor('daegu', '대경선'), null);
  assert.equal(subwayColor(null, '2호선'), null); // 지역을 모르면 같은 이름 노선과 섞이지 않게 색을 주지 않는다
  assert.equal(subwayColor('capital', '없는선'), null);
});

test('모든 지하철 색은 근거 표기(A~G)와 #RRGGBB 형식을 갖는다', () => {
  for (const lines of Object.values(SUBWAY_COLORS)) {
    for (const entry of Object.values(lines)) {
      assert.match(entry.color, /^#[0-9A-F]{6}$/);
      assert.match(entry.source, /^[A-G]$/);
    }
  }
});

test('서울 버스 공식 유형 색: 간선 파랑 · 지선 초록 · 광역 빨강 · 순환 노랑은 서로 다른 색', () => {
  const picked = ['간선', '지선', '광역', '순환'].map((t) => officialBusColor('seoul', t).color);
  assert.equal(new Set(picked).size, 4);
  for (const t of ['간선', '지선', '광역', '순환']) assert.equal(officialBusColor('seoul', t).color, SEOUL_BUS_COLORS[t].color);
});

test('확인되지 않은 서울 버스 유형·지역은 색을 주지 않는다', () => {
  for (const type of ['마을', '직행', '일반', '좌석', '급행', '외곽', '농어촌', '모르는유형']) assert.equal(officialBusColor('seoul', type), null, type);
  assert.equal(officialBusColor(null, '간선'), null);
  assert.equal(officialBusColor('seoul', null), null);
  assert.equal(officialBusColor('seoul', ''), null);
});

// ── 구간 나누기 ──

const P = (i, lat = 37.5) => ({ lat, lng: 127.0 + i * 0.001 }); // 경도 0.001 ≈ 88m
const veh = (name, type = null) => [{ name, type }];
// 지하철 2호선(0~2) - 환승 도보(3~4) - 지하철 3호선(5~7) - 버스(8~9). 구간 경계는 앞 구간 끝과 다음 구간 시작 점이 거의 겹친다.
const path = [P(0), P(1), P(2), P(2), P(3), P(3), P(4), P(5), P(5), P(6)];
const stepsFor = (over = {}) => [
  { type: 'SUBWAY', vehicles: veh('2호선', '일반'), pathStartIndex: 0 },
  { type: 'WALKING', vehicles: [], pathStartIndex: 3 },
  { type: 'SUBWAY', vehicles: veh('3호선', '급행'), pathStartIndex: 5 },
  { type: 'BUS', vehicles: [{ name: '402', type: '간선', operatorRegion: 'seoul', routeClass: '간선' }], pathStartIndex: 8, ...over },
];

test('환승하면 구간마다 색이 바뀌고, 도보 환승 구간은 회색 점선이다', () => {
  const segments = buildRouteSegments({ path, steps: stepsFor() });
  assert.deepEqual(segments.map((s) => [s.kind, s.color, s.dashed]), [
    ['subway', '#009D3E', false],
    ['walk', WALK_COLOR, true],
    ['subway', '#EF7C1C', false], // 급행이어도 노선색은 그대로
    ['bus', SEOUL_BUS_COLORS['간선'].color, false],
  ]);
});

test('구간 선은 기존 좌표를 그대로 쓰고, 다음 구간 첫 점까지 이어져 색이 바뀌는 곳에서 끊기지 않는다', () => {
  const segments = buildRouteSegments({ path, steps: stepsFor() });
  assert.deepEqual(segments[0].path, path.slice(0, 4)); // 0..2 + 다음 구간 첫 점(3)
  assert.deepEqual(segments[3].path, path.slice(8));
  for (let i = 0; i + 1 < segments.length; i++) assert.deepEqual(segments[i].path.at(-1), segments[i + 1].path[0]);
  assert.equal(segments.flatMap((s) => s.path).every((pt) => path.includes(pt)), true); // 새 좌표를 만들지 않는다
});

test('버스 환승: 공식 유형이 바뀌면 색이 바뀐다. 서울의 지선과 간선은 다르다', () => {
  const twoBuses = [
    { type: 'BUS', vehicles: [{ name: '402', type: '간선', operatorRegion: 'seoul', routeClass: '간선' }], pathStartIndex: 0 },
    { type: 'BUS', vehicles: [{ name: '1120', type: '지선', operatorRegion: 'seoul', routeClass: '지선' }], pathStartIndex: 5 },
  ];
  const [a, b] = buildRouteSegments({ path, steps: twoBuses });
  assert.equal(a.color, SEOUL_BUS_COLORS['간선'].color);
  assert.equal(b.color, SEOUL_BUS_COLORS['지선'].color);
});

test('버스 번호로 유형을 추정하지 않는다: 9로 시작해도 라벨이 "일반"이면 일반 색, 라벨이 없으면 기본 색', () => {
  const [seg] = buildRouteSegments({ path, steps: [{ type: 'BUS', vehicles: veh('9401', '일반'), pathStartIndex: 0 }] });
  assert.equal(seg.color, REGULAR_BUS_COLOR);
  const [noType] = buildRouteSegments({ path, steps: [{ type: 'BUS', vehicles: veh('402', null), pathStartIndex: 0 }] });
  assert.equal(noType.color, DEFAULT_BUS_COLOR);
});

test('확정되지 않은 "간선" 라벨은 서울 안·밖 어디서든 서울 공식 색이 아니라 일반 색이다', () => {
  const pangyoPath = [P(0, 37.395), P(1, 37.395), P(2, 37.395)];
  const [seg] = buildRouteSegments({ path: pangyoPath, steps: [{ type: 'BUS', vehicles: veh('302', '간선'), pathStartIndex: 0 }] });
  assert.equal(seg.color, REGULAR_BUS_COLOR);
  const [inSeoul] = buildRouteSegments({ path, steps: [{ type: 'BUS', vehicles: veh('402', '간선'), pathStartIndex: 0 }] }); // path 는 서울 안
  assert.equal(inSeoul.color, REGULAR_BUS_COLOR);
  assert.notEqual(inSeoul.color, SEOUL_BUS_COLORS['간선'].color);
});

test('한 구간에 직행과 일반이 섞이면 기본 버스 색이고, 같은 종류끼리면 그 색이다', () => {
  const mixed = buildRouteSegments({ path, steps: [{ type: 'BUS', vehicles: [{ name: '8146', type: '직행' }, { name: '8146-1', type: '일반' }], pathStartIndex: 0 }] });
  assert.equal(mixed[0].color, DEFAULT_BUS_COLOR);
  const same = buildRouteSegments({ path, steps: [{ type: 'BUS', vehicles: [{ name: '8146', type: '간선' }, { name: '8146-1', type: '지선' }], pathStartIndex: 0 }] });
  assert.equal(same[0].color, REGULAR_BUS_COLOR);
});

test('미확인 노선은 기본 지하철 색이다(대전 1호선·공항철도·모르는 노선)', () => {
  const daejeon = [P(0, 36.33), P(1, 36.33), P(2, 36.33)];
  assert.equal(buildRouteSegments({ path: daejeon, steps: [{ type: 'SUBWAY', vehicles: veh('1호선', '일반'), pathStartIndex: 0 }] })[0].color, DEFAULT_SUBWAY_COLOR);
  for (const line of ['공항철도', '없는선']) {
    assert.equal(buildRouteSegments({ path, steps: [{ type: 'SUBWAY', vehicles: veh(line, '일반'), pathStartIndex: 0 }] })[0].color, DEFAULT_SUBWAY_COLOR, line);
  }
});

test('부산의 1호선은 수도권 1호선과 다른 색이다', () => {
  const busanPath = [P(0, 35.157), P(1, 35.157), P(2, 35.157)].map((p) => ({ ...p, lng: 129.05 + (p.lng - 127) }));
  const [seg] = buildRouteSegments({ path: busanPath, steps: [{ type: 'SUBWAY', vehicles: veh('1호선', '일반'), pathStartIndex: 0 }] });
  assert.equal(seg.color, SUBWAY_COLORS.busan['1호선'].color);
  assert.notEqual(seg.color, SUBWAY_COLORS.capital['1호선'].color);
});

test('구간 좌표 위치가 없거나 어긋나면 null 이다(기존 한 가지 색 경로로 되돌린다)', () => {
  const noIndex = stepsFor().map(({ pathStartIndex: _unused, ...rest }) => rest);
  assert.equal(buildRouteSegments({ path, steps: noIndex }), null); // 옛 서버
  assert.equal(buildRouteSegments({ path, steps: stepsFor().map((s, i) => ({ ...s, pathStartIndex: i + 1 })) }), null); // 첫 구간이 0 에서 시작하지 않음
  assert.equal(buildRouteSegments({ path, steps: stepsFor().map((s, i) => ({ ...s, pathStartIndex: [0, 5, 3, 8][i] })) }), null); // 순서가 거꾸로
  assert.equal(buildRouteSegments({ path, steps: stepsFor({ pathStartIndex: 99 }) }), null); // 범위 밖
  assert.equal(buildRouteSegments({ path, steps: stepsFor().map((s, i) => ({ ...s, pathStartIndex: [0, 3, 3, 8][i] })) }), null); // 같은 위치 중복
  assert.equal(buildRouteSegments({ path: [P(0)], steps: stepsFor() }), null);
  assert.equal(buildRouteSegments({ path, steps: [] }), null);
});

test('구간 경계가 서로 멀리 떨어져 있으면(잘못 연결될 선) null 이다', () => {
  const broken = path.map((p, i) => (i >= 5 ? { lat: p.lat + 0.01, lng: p.lng } : p)); // 5번 이후가 약 1.1km 떨어짐
  assert.ok(0.01 * 111_320 > MAX_BOUNDARY_GAP_M);
  assert.equal(buildRouteSegments({ path: broken, steps: stepsFor() }), null);
});

test('좌표가 없는 구간(pathStartIndex 없음)은 건너뛰고 나머지를 그린다', () => {
  const steps = [stepsFor()[0], { type: 'WALKING', vehicles: [] }, stepsFor()[2]];
  const segments = buildRouteSegments({ path, steps });
  assert.deepEqual(segments.map((s) => s.kind), ['subway', 'subway']);
});

// ── 공식 노선 데이터(TAGO)로 확정된 버스 ──

import { EXPRESS_BUS_COLOR, OFFICIAL_BUS_COLORS, REGULAR_BUS_COLOR, busLegColor, officialBusColor } from '../src/lib/navigation/transitColors.ts';

const matchedBus = (region, routeClass, name = '103', type = '간선') => ({ name, type, operatorRegion: region, routeClass });
const busStep = (vehicles) => [{ type: 'BUS', vehicles, pathStartIndex: 0 }];
const SEOUL_PATH = [P(0, 37.55), P(1, 37.55), P(2, 37.55)]; // 서울 사각형 안
const INCHEON_PATH = [P(0, 37.45), P(1, 37.45), P(2, 37.45)].map((p) => ({ ...p, lng: 126.65 + (p.lng - 127) }));

test('인천 공식 노선 유형별 색: 광역 빨강 · 간선 파랑 · 지선·순환 초록은 서로 다르다(지선=순환)', () => {
  const c = (cls) => officialBusColor('incheon', cls)?.color;
  assert.equal(new Set([c('광역버스'), c('간선버스'), c('지선버스')]).size, 3);
  assert.equal(c('지선버스'), c('순환버스'));
  assert.equal(OFFICIAL_BUS_COLORS.incheon['간선버스'].color, SEOUL_BUS_COLORS['간선'].color); // 서울·인천 모두 파랑
});

test('공식 색 기준이 없는 지역·유형은 색을 주지 않는다(경기 전체, 인천 좌석·마을·공항·급행)', () => {
  for (const cls of ['일반버스', '직행좌석버스', '좌석버스', '광역급행버스', '농어촌(일반)버스']) assert.equal(officialBusColor('gyeonggi', cls), null, cls);
  for (const cls of ['좌석버스', '마을버스', '공항버스', '급행버스', '모르는유형']) assert.equal(officialBusColor('incheon', cls), null, cls);
  assert.equal(officialBusColor(null, '간선버스'), null);
  assert.equal(officialBusColor('incheon', null), null);
});

test('인천에서 공식 노선으로 확정된 버스는 공식 유형 색이 칠해진다', () => {
  const [seg] = buildRouteSegments({ path: INCHEON_PATH, steps: busStep([matchedBus('incheon', '광역버스')]) });
  assert.equal(seg.color, OFFICIAL_BUS_COLORS.incheon['광역버스'].color);
});

test('경기에서 확정된 버스는 서울 공식 색을 쓰지 않는다: 공식 색 기준이 없으니 유형 이름(일반버스·직행좌석버스)으로 구분한다', () => {
  const colorOf = (cls, type = '간선') => buildRouteSegments({ path: SEOUL_PATH, steps: busStep([matchedBus('gyeonggi', cls, '31', type)]) })[0].color;
  assert.equal(colorOf('일반버스'), REGULAR_BUS_COLOR); // 카카오 라벨이 '간선'이어도 공식 유형 이름이 우선이다
  assert.equal(colorOf('직행좌석버스', '일반'), EXPRESS_BUS_COLOR); // 카카오 라벨이 '일반'이어도 공식 유형 이름이 우선이다
  assert.equal(colorOf('광역급행버스', '광역'), EXPRESS_BUS_COLOR);
  // 확정되지 않았다면(옛 서버·키 없음·매칭 실패) 카카오 라벨로 구분한다
  const [unconfirmed] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([{ name: '402', type: '간선' }]) });
  assert.equal(unconfirmed.color, REGULAR_BUS_COLOR);
});

test('공식 유형이 섞이거나 지역이 다르면 기본 색이다. 일부만 확정된 구간은 확정한 공식 유형 이름과 라벨로 구분한다', () => {
  const mixedClass = buildRouteSegments({ path: INCHEON_PATH, steps: busStep([matchedBus('incheon', '간선버스'), matchedBus('incheon', '지선버스', '5')]) });
  assert.equal(mixedClass[0].color, DEFAULT_BUS_COLOR);
  const mixedRegion = buildRouteSegments({ path: INCHEON_PATH, steps: busStep([matchedBus('incheon', '간선버스'), matchedBus('gyeonggi', '간선버스', '5')]) });
  assert.equal(mixedRegion[0].color, DEFAULT_BUS_COLOR);
  // 일부만 확정되면 공식 색을 쓰지 않는다(어느 노선인지 모른다): 인천 간선 파랑이 아니라 구분 색
  const partial = buildRouteSegments({ path: INCHEON_PATH, steps: busStep([matchedBus('incheon', '간선버스'), { name: '999', type: '간선' }]) });
  assert.equal(partial[0].color, REGULAR_BUS_COLOR);
  assert.notEqual(partial[0].color, OFFICIAL_BUS_COLORS.incheon['간선버스'].color);
});

test('버스→버스 환승에서 공식 유형이 다르면 색이 바뀌고, 도보 점선·지하철 노선색은 그대로다', () => {
  const longPath = [...INCHEON_PATH, ...INCHEON_PATH.map((p) => ({ ...p, lng: p.lng + 0.003 })), ...INCHEON_PATH.map((p) => ({ ...p, lng: p.lng + 0.006 }))];
  const segments = buildRouteSegments({
    path: longPath,
    steps: [
      { type: 'BUS', vehicles: [matchedBus('incheon', '간선버스')], pathStartIndex: 0 },
      { type: 'BUS', vehicles: [matchedBus('incheon', '지선버스', '5')], pathStartIndex: 3 },
      { type: 'WALKING', vehicles: [], pathStartIndex: 6 },
    ],
  });
  assert.deepEqual(segments.map((s) => [s.kind, s.color, s.dashed]), [
    ['bus', OFFICIAL_BUS_COLORS.incheon['간선버스'].color, false],
    ['bus', OFFICIAL_BUS_COLORS.incheon['지선버스'].color, false],
    ['walk', WALK_COLOR, true],
  ]);
});

// ── 서울 노선정보조회로 확정된 서울 버스 ──

test('서울 버스는 서울 API 가 확정한 유형(간선·지선·순환·광역)의 공식 색이 칠해지고 서로 다르다', () => {
  const colorOf = (cls) => buildRouteSegments({ path: SEOUL_PATH, steps: busStep([matchedBus('seoul', cls)]) })[0].color;
  const colors = ['간선', '지선', '순환', '광역'].map(colorOf);
  assert.equal(new Set(colors).size, 4);
  assert.deepEqual(colors, ['간선', '지선', '순환', '광역'].map((c) => SEOUL_BUS_COLORS[c].color));
});

test('서울 마을버스는 색 기준이 없어 기본 색이다 (카카오 라벨이 무엇이든)', () => {
  const [seg] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([matchedBus('seoul', '마을')]) });
  assert.equal(seg.color, DEFAULT_BUS_COLOR);
  assert.equal(officialBusColor('seoul', '마을'), null);
});

test('서울 API 가 확정한 유형이 카카오 라벨과 다르면 확정한 유형을 따른다', () => {
  const [seg] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([matchedBus('seoul', '지선')]) }); // 라벨은 '간선'
  assert.equal(seg.color, SEOUL_BUS_COLORS['지선'].color);
});

test('유형을 모르는 경기·인천 노선(서울 API 로만 채움)은 서울 공식 색이 아니라 카카오 라벨로 구분한다', () => {
  for (const region of ['gyeonggi', 'incheon']) {
    const [seg] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([matchedBus(region, null)]) }); // 카카오 라벨 '간선'
    assert.equal(seg.color, REGULAR_BUS_COLOR, region);
    assert.notEqual(seg.color, SEOUL_BUS_COLORS['간선'].color, region);
    const [express] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([{ ...matchedBus(region, null), type: '직행' }]) });
    assert.equal(express.color, EXPRESS_BUS_COLOR, region);
  }
});

test('서울 확정 노선과 경기 노선이 한 구간에 섞이면 기본 색이다', () => {
  const [seg] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([matchedBus('seoul', '간선'), matchedBus('gyeonggi', null, '5')]) });
  assert.equal(seg.color, DEFAULT_BUS_COLOR);
});

test('서울 API 가 확정하지 못한 서울 버스는 서울 공식 색을 받지 않는다(라벨 구분 색)', () => {
  for (const type of ['간선', '지선', '광역', '순환']) {
    const [seg] = buildRouteSegments({ path: SEOUL_PATH, steps: busStep([{ name: '402', type, operatorRegion: null, routeClass: null }]) });
    assert.equal(seg.color, type === '광역' ? EXPRESS_BUS_COLOR : REGULAR_BUS_COLOR, type); // 광역 라벨은 표시용 빨강
    assert.notEqual(seg.color, SEOUL_BUS_COLORS[type].color, type); // 서울 공식 HEX 가 아니다
  }
});
