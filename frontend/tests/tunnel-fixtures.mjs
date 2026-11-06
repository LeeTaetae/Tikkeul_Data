// 터널 테스트 공용 도구. 테스트 파일이 아니다(파일명이 .test.mjs 로 끝나지 않는다).
// 지도 위 가상 터널: 입구 A(37.5, 127.0) 에서 정북으로 800m 가면 출구 B. 차량은 남쪽에서 북쪽으로 달린다.
export const M_LAT = 111_320;
export const LAT0 = 37.5;
export const LNG0 = 127.0;
const K = Math.cos((LAT0 * Math.PI) / 180);

/** 입구 A 기준 북쪽 northM, 동쪽 eastM 인 지점 */
export const pt = (northM, eastM = 0) => ({ lat: LAT0 + northM / M_LAT, lng: LNG0 + eastM / (M_LAT * K) });
const arr = (p) => [Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))];

/** 번들 JSON 한 항목 모양의 터널. northStart~northEnd 는 입구 A, 출구 B 의 북쪽 거리(m). */
export function tunnel(id, { name = `${id}터널`, from = 0, to = 800, east = 0, lengthM, direction = 'both', roadType = '일반국도' } = {}) {
  return {
    id,
    name,
    baseName: name.replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '').replace(/\s/g, ''),
    roadType,
    roadName: '테스트로',
    direction,
    lengthM: lengthM ?? Math.abs(to - from),
    entranceA: arr(pt(from, east)),
    entranceB: arr(pt(to, east)),
  };
}

/** mulberry32 난수. 테스트가 매번 같은 결과를 내도록 시드 고정. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(rand, sigma) {
  const u = Math.max(rand(), 1e-12);
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * 정북으로 일정 속도로 달리는 GPS 점열. startNorth 에서 endNorth 까지 dt 초 간격. noiseM 이면 가우시안 잡음.
 * 반환: [{ fix, t }] (t = 초). timestampMs 는 T0 + t*1000.
 */
export const T0 = Date.parse('2026-11-05T12:00:00+09:00');
export function drive({ startNorth, endNorth, speedKmh, dt = 1, eastM = 0, noiseM = 0, seed = 1, accuracyM = 5 }) {
  const ms = speedKmh / 3.6;
  const dir = endNorth >= startNorth ? 1 : -1;
  const rand = rng(seed);
  const out = [];
  for (let t = 0; startNorth + dir * ms * t <= Math.max(startNorth, endNorth) + 1e-9 && startNorth + dir * ms * t >= Math.min(startNorth, endNorth) - 1e-9; t += dt) {
    const n = startNorth + dir * ms * t + (noiseM ? gauss(rand, noiseM) : 0);
    const e = eastM + (noiseM ? gauss(rand, noiseM) : 0);
    out.push({ fix: { ...pt(n, e), accuracyM, timestampMs: T0 + t * 1000 }, t, trueNorth: startNorth + dir * ms * t });
  }
  return out;
}

/** 기상청 초단기실황을 backend 가 내려주는 JSON(snake_case)으로 만든 것. 기준시각은 now 의 10분 전. */
export function weatherJson({ pty = 'none', temp = 10, rain = 0, reh = 50, missing = [], ageMin = 10, now = T0 } = {}) {
  return {
    observed_at: new Date(now - ageMin * 60_000).toISOString(),
    temp_c: temp,
    rain_mm_1h: rain,
    pty,
    humidity_pct: reh,
    missing,
  };
}
