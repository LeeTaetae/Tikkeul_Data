// E단계: 경로가 지나는 여러 시군구의 어린이보호구역 조회(표본 조회, 부분 조회 표시).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRouteSampler, collectRouteZones, coverageOf, planSamples, scanRouteRegions, ZONE_SAMPLING } from '../src/lib/navigation/routeZones.ts';

const M = 111320;
const K = Math.cos((37.5 * Math.PI) / 180);
// 동쪽으로 lengthM(m) 가는 직선 경로
const east = (lengthM) => [{ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 + lengthM / (M * K) }];
const lngOf = (point) => point.lng;
const lngAt = (m) => 127 + m / (M * K);

// 경로 위 거리(m)로 시군구를 정하는 가짜 지역 조회
const regionByDistance = (ranges, calls = []) => async (p) => {
  calls.push(p);
  const d = (p.lng - 127) * M * K;
  for (const [from, to, code] of ranges) if (d >= from && d < to) return code;
  return null;
};

test('경로 표본: 길이 0·점 하나는 null, 아니면 경로를 따라 보간한다', () => {
  assert.equal(buildRouteSampler([{ lat: 37.5, lng: 127 }]), null);
  assert.equal(buildRouteSampler([{ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 }]), null);
  const sampler = buildRouteSampler(east(10_000));
  assert.ok(Math.abs(sampler.totalM - 10_000) < 1);
  assert.ok(Math.abs((sampler.pointAt(2500).lng - 127) * M * K - 2500) < 1);
  assert.equal(sampler.pointAt(-5).lng, 127); // 범위 밖은 끝점으로
});

test('표본 계획: 짧은 경로는 시작·끝, 긴 경로는 간격을 늘리되 표본 수 한도를 지키고, 너무 길면 truncated', () => {
  assert.deepEqual(planSamples(1000), { distances: [0, 1000], spacingM: ZONE_SAMPLING.minSpacingM, truncated: false });
  const mid = planSamples(35_000);
  assert.ok(mid.distances.length <= ZONE_SAMPLING.maxSamples);
  assert.equal(mid.distances.at(-1), 35_000); // 도착 지점 포함
  assert.equal(mid.truncated, false);
  const huge = planSamples(200_000);
  assert.equal(huge.truncated, true);
  assert.ok(huge.distances.length <= ZONE_SAMPLING.maxSamples);
  assert.equal(huge.spacingM, ZONE_SAMPLING.maxSpacingM);
});

test('여러 행정구역: 경로가 지나는 시군구를 모두 찾는다(시작 지점 하나만 보지 않는다)', async () => {
  const calls = [];
  const scan = await scanRouteRegions(east(26_000), regionByDistance([[0, 9000, 'A'], [9000, 18_000, 'B'], [18_000, 99_999, 'C']], calls));
  assert.deepEqual([...scan.sggCodes].sort(), ['A', 'B', 'C']);
  assert.ok(scan.lookups <= ZONE_SAMPLING.maxLookups);
  assert.equal(scan.failedLookups, 0);
  assert.equal(coverageOf(scan, 0), 'sampled'); // 전부 조회했다(complete)가 아니라 표본 조회다
});

test('경계 이분 조회: 이웃한 두 표본 사이에 낀 작은 시군구를 찾는다', async () => {
  const total = 26_000;
  const plan = planSamples(total);
  const a = plan.distances[3];
  const b = plan.distances[4];
  const gap = b - a;
  // a 쪽은 A, b 쪽은 C, 그 사이 가운데 40% 구간만 B
  const ranges = [[0, a + gap * 0.3, 'A'], [a + gap * 0.3, a + gap * 0.7, 'B'], [a + gap * 0.7, 99_999, 'C']];
  const scan = await scanRouteRegions(east(total), regionByDistance(ranges));
  assert.ok(scan.sggCodes.includes('B'), 'B 를 찾아야 한다');
  assert.ok(scan.lookups > plan.distances.length); // 표본 외에 경계 조회가 있었다
});

test('한계: 양쪽 표본이 같은 시군구일 때 그 사이에만 걸친 아주 좁은 시군구는 놓칠 수 있다(그래서 sampled 이지 complete 가 아니다)', async () => {
  const total = 26_000;
  const plan = planSamples(total);
  const a = plan.distances[2];
  const b = plan.distances[3];
  const ranges = [[0, a + 100, 'A'], [a + 100, a + 300, 'SLIVER'], [a + 300, 99_999, 'A']];
  const scan = await scanRouteRegions(east(total), regionByDistance(ranges));
  assert.deepEqual(scan.sggCodes, ['A']);
  assert.equal(coverageOf(scan, 0), 'sampled');
  assert.ok(b > a);
});

test('조회 실패: 일부 실패하면 partial, 모두 실패하면 failed, 코드를 하나도 못 찾으면 failed', async () => {
  const flaky = async (p) => {
    if (lngOf(p) > lngAt(13_000)) throw new Error('network');
    return 'A';
  };
  const partial = await scanRouteRegions(east(26_000), flaky);
  assert.ok(partial.failedLookups > 0);
  assert.equal(coverageOf(partial, 0), 'partial');
  const allFail = await scanRouteRegions(east(26_000), async () => {
    throw new Error('down');
  });
  assert.equal(coverageOf(allFail, 0), 'failed');
  const noRegion = await scanRouteRegions(east(5000), async () => null);
  assert.equal(coverageOf(noRegion, 0), 'failed');
  assert.equal(coverageOf(null, 0), 'failed');
});

test('너무 긴 경로나 조회 한도에 걸리면 partial 로 표시한다', async () => {
  const long = await scanRouteRegions(east(200_000), async () => 'A');
  assert.equal(long.truncated, true);
  assert.equal(coverageOf(long, 0), 'partial');
  // 시군구가 계속 바뀌어 이분 조회가 한도(maxLookups)에 걸리는 경우
  let n = 0;
  const alternating = async () => `R${n++ % 7}`;
  const capped = await scanRouteRegions(east(40_000), alternating);
  assert.ok(capped.lookups <= ZONE_SAMPLING.maxLookups + 1);
});

test('보호구역 모으기: 시군구별 목록을 합치고 같은 구역은 한 번만, 일부 시군구 실패는 partial', async () => {
  const zonesBySgg = { A: [{ id: 'z1' }, { id: 'z2' }], B: [{ id: 'z2' }, { id: 'z3' }], C: [{ id: 'z4' }] };
  const fetchRegion = regionByDistance([[0, 9000, 'A'], [9000, 18_000, 'B'], [18_000, 99_999, 'C']]);
  const ok = await collectRouteZones(east(26_000), { fetchRegion, fetchZones: async (code) => zonesBySgg[code], keyOf: (z) => z.id });
  assert.deepEqual(ok.items.map((z) => z.id).sort(), ['z1', 'z2', 'z3', 'z4']);
  assert.equal(ok.coverage, 'sampled');
  assert.ok(ok.spacingM >= ZONE_SAMPLING.minSpacingM);

  const failing = await collectRouteZones(east(26_000), {
    fetchRegion,
    fetchZones: async (code) => {
      if (code === 'B') throw new Error('zones down');
      return zonesBySgg[code];
    },
    keyOf: (z) => z.id,
  });
  assert.equal(failing.coverage, 'partial'); // 다른 시군구의 결과는 그대로 쓴다
  assert.deepEqual(failing.items.map((z) => z.id).sort(), ['z1', 'z2', 'z4']);
  assert.deepEqual([...failing.sggCodes].sort(), ['A', 'B', 'C']);
});

test('경로가 없으면 빈 결과와 failed', async () => {
  const r = await collectRouteZones([], { fetchRegion: async () => 'A', fetchZones: async () => [], keyOf: (z) => z.id });
  assert.deepEqual([r.items, r.coverage, r.spacingM], [[], 'failed', null]);
});

test('coverage 값에는 complete 가 없다', async () => {
  const seen = new Set();
  for (const f of [async () => 'A', async () => null, async () => { throw new Error('x'); }]) {
    seen.add((await collectRouteZones(east(5000), { fetchRegion: f, fetchZones: async () => [], keyOf: (z) => z.id })).coverage);
  }
  assert.ok([...seen].every((c) => ['sampled', 'partial', 'failed'].includes(c)));
});
