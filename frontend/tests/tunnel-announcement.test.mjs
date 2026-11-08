// 터널 안내 회귀 테스트: 실제 카카오 경로(남산2호터널 구간)로 GPS 기반 터널 판정 → 안내 이벤트 → 배너 단계를 확인한다.
// 곡선 터널 탈락, 같은 터널의 인접 후보를 모호로 오판, 위험 배너가 터널 안내를 영구 차단하는 문제의 재발을 막는다.
// 카메라(YOLO) 터널 감지와는 별개다. 이 테스트는 GPS·터널 좌표 기반 감지만 다룬다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { createWeatherSafetyTracker } from '../src/lib/weather/safety.ts';
import { parseTunnelDataset } from '../src/lib/tunnel/dataset.ts';
import { HAZARD_BANNER_MS, hazardBannerActive } from '../src/lib/navigation/nativeHazardRail.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('./namsan2-route-fixture.json', import.meta.url), 'utf8'));
const tunnels = parseTunnelDataset(JSON.parse(fs.readFileSync(new URL('../src/data/tunnelEntrances.json', import.meta.url), 'utf8'))).index;
const pts = fixture.points;
const route = { id: 'namsan2', points: pts.map(([latitude, longitude]) => ({ latitude, longitude })) };
const hav = (a, b, c, d) => Math.hypot((c - a) * 111320, (d - b) * 111320 * Math.cos((a * Math.PI) / 180));
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(...pts[i - 1], ...pts[i]));
const at = (m) => { let i = 1; while (i < cum.length - 1 && cum[i] < m) i++; const f = (m - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; };

// 이 조각에서 남산2호터널 진입은 약 1,670m 지점(전체 경로 25,973m − 조각 시작 24,3xx m)이다. 하드코딩하지 않고 첫 접근에서 구한다.
function drive({ from = 0, to = cum.at(-1) - 5, step = 25, blockedAt = () => false }) {
  const tracker = createWeatherSafetyTracker();
  const t0 = Date.now(); const rows = [];
  for (let m = from, k = 1; m <= to; m += step, k++) {
    const [lat, lng] = at(m); const now = t0 + k * 1500;
    const r = tracker.update({ route, fix: { lat, lng, accuracyM: 5, timestampMs: now }, weather: null, now, cameraActive: false,
      blocked: blockedAt(m, k), positionTrusted: true, progressM: m, tunnels, bridges: [] });
    rows.push({ m, k, approach: r.facilityMatch.approach, warning: r.warning, speech: r.speechEvents, ambiguous: r.facilityMatch.ambiguous });
  }
  return rows;
}
const entryM = () => drive({}).find((r) => r.approach?.kind === 'tunnel_entry');
const speechOf = (rows) => rows.flatMap((r) => r.speech.map((w) => ({ m: r.m, w })));

test('곡선 터널(남산2호터널, 중점이 경로에서 ~50m)도 진입 500m 안에서 감지된다', () => {
  const first = entryM();
  assert.ok(first, '터널 진입 접근이 한 번도 잡히지 않았다');
  assert.equal(first.approach.name, '남산2호터널');
  assert.ok(first.approach.distanceM <= 500 && first.approach.distanceM > 400, `첫 접근 거리 ${first.approach.distanceM}`);
  assert.equal(first.approach.stage, 500);
});

test('같은 터널이 인접 경로 꼭짓점에 걸쳐 여러 후보가 돼도 모호(ambiguous)로 버려지지 않는다', () => {
  const rows = drive({});
  assert.equal(rows.some((r) => r.ambiguous), false);
});

test('안내 이벤트: 진입 500m 단계에서 한 번, 100m 단계에서 한 번이며 같은 단계는 반복하지 않는다', () => {
  const events = speechOf(drive({})).filter((e) => e.w.facility === 'tunnel_entry');
  assert.deepEqual(events.map((e) => e.w.stage), [500, 100].slice(0, events.length));
  assert.ok(events.length >= 1 && events.length <= 2);
  assert.equal(new Set(events.map((e) => e.w.id)).size, events.length, '같은 안내 id 가 중복 발행됐다');
});

test('위험 배너 시간(8초)만 차단되면 그 뒤 터널 안내가 나온다 — 영구 누락 없음', () => {
  const first = entryM();
  // 첫 접근 시점부터 5번 위치 갱신(=125m) 동안 위험 배너가 떠 있다고 본다.
  const blockedUntilK = first.k + 5;
  const rows = drive({ blockedAt: (m, k) => k < blockedUntilK });
  const duringBlock = rows.filter((r) => r.k < blockedUntilK && r.approach);
  assert.ok(duringBlock.length > 0 && duringBlock.every((r) => r.warning === null && r.speech.length === 0), '차단 중에는 배너·이벤트가 없어야 한다');
  const after = speechOf(rows).filter((e) => e.w.facility === 'tunnel_entry');
  assert.ok(after.length >= 1, '차단이 풀린 뒤에도 터널 안내가 한 번도 나오지 않았다');
  assert.ok(rows.some((r) => r.k >= blockedUntilK && r.warning?.kind === 'facility'));
});

test('이미 지나간 터널의 진입 안내는 차단이 풀려도 뒤늦게 나오지 않는다', () => {
  const first = entryM();
  const insideK = first.k + Math.ceil(700 / 25); // 진입 지점을 지나 터널 안으로 들어간 뒤에야 차단이 풀린다
  const rows = drive({ blockedAt: (m, k) => k < insideK });
  const late = speechOf(rows).filter((e) => e.w.facility === 'tunnel_entry');
  assert.deepEqual(late, [], '이미 지난 진입 안내가 나왔다');
  assert.ok(rows.filter((r) => r.k >= insideK && r.approach).every((r) => r.approach.kind === 'tunnel_exit'));
});

test('터널을 완전히 지난 뒤에는 접근도 안내도 없다', () => {
  const rows = drive({});
  const end = rows.at(-1);
  assert.equal(end.approach, null);
  // 날씨 값이 없는 시험이라 'unavailable' 경고는 남을 수 있다. 터널(시설) 경고만 없어야 한다.
  assert.notEqual(end.warning?.kind, 'facility');
});

test('hazardBannerActive: 위험 배너가 뜬 뒤 8초 동안만 true, 시각이 없거나 거꾸로면 false', () => {
  assert.equal(HAZARD_BANNER_MS, 8000);
  assert.equal(hazardBannerActive(null, 1000), false);
  assert.equal(hazardBannerActive(1000, 1000), true);
  assert.equal(hazardBannerActive(1000, 8999), true);
  assert.equal(hazardBannerActive(1000, 9000), false);
  assert.equal(hazardBannerActive(5000, 1000), false);
});

// ── 결빙 가능 조건 + 터널: 터널 전용 문구 ─────────────────────────────────────────────
import { weatherBannerText } from '../src/lib/weather/presentation.ts';
import { weatherWarningText } from '../src/lib/weather/safety.ts';

const obs = (extra) => ({ observed_at: new Date().toISOString(), temp_c: 10, rain_mm_1h: 0, pty: 'none', humidity_pct: 50, missing: [], ...extra });
const wx = (extra) => ({ observation: { status: 'available', data: obs(extra) },
  ultra_forecast: { status: 'unavailable', data: null }, village_forecast: { status: 'unavailable', data: null } });
function firstTunnelResult(weather) {
  const tracker = createWeatherSafetyTracker(); const t0 = Date.now();
  for (let m = 0, k = 1; m <= cum.at(-1) - 5; m += 25, k++) {
    const [lat, lng] = at(m); const now = t0 + k * 1500;
    const r = tracker.update({ route, fix: { lat, lng, accuracyM: 5, timestampMs: now }, weather, now, cameraActive: false, blocked: false, positionTrusted: true, progressM: m, tunnels, bridges: [] });
    if (r.facilityMatch.approach?.kind === 'tunnel_entry') return r;
  }
  return null;
}

test('비·눈 + 3℃ 이하이면 결빙 가능 + 터널 전용 문구(ko/en/zh). 결빙을 단정하지 않는다', () => {
  const r = firstTunnelResult(wx({ temp_c: -2, pty: 'snow', rain_mm_1h: 0.5 }));
  assert.equal(r.warning.kind, 'ice');
  assert.equal(r.warning.facility, 'tunnel_entry');
  assert.equal(weatherWarningText(r.warning, 'ko'), '결빙 가능성이 있습니다. 터널 안 노면이 미끄러울 수 있으니 서행하세요.');
  assert.match(weatherWarningText(r.warning, 'en'), /Possible icing.*tunnel.*slow down/);
  assert.match(weatherWarningText(r.warning, 'zh'), /可能结冰.*隧道/);
  const banner = weatherBannerText(r, 'ko');
  assert.match(banner, /결빙 가능성이 있습니다\. 터널 안 노면이 미끄러울 수 있으니 서행하세요\./);
  assert.match(banner, /전방 터널 구간 · \d+m/);
  assert.doesNotMatch(banner, /얼었|결빙되었|결빙입니다/);
});

test('결빙 조건이 아니면 터널 전용 결빙 문구가 나오지 않는다: 맑고 따뜻함 / 추워도 강수 없음 / 비 + 따뜻함', () => {
  for (const [label, w] of [['맑음 10℃', wx({})], ['건조 -5℃', wx({ temp_c: -5 })], ['비 10℃', wx({ pty: 'rain', rain_mm_1h: 1 })]]) {
    const r = firstTunnelResult(w);
    assert.ok(r, label);
    assert.doesNotMatch(weatherBannerText(r, 'ko') ?? '', /결빙/, `${label}: 결빙 문구가 나왔다`);
    assert.notEqual(r.warning.kind, 'ice', label);
  }
});
