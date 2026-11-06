// 기상청 초단기실황 **관측값**으로 "비·눈·저온" 조건을 판단한다.
//
// 이것은 노면 결빙 판정이 아니다. 관측값(T1H·RN1·PTY·REH)은 "지금 비·눈이 오는가, 기온이 낮은가"만 말해 준다.
// 그래서 결과에는 '얼었다/결빙'이라는 단정이 없고, 문구는 "미끄러울 수 있다"(slippery possible)까지만 쓴다.
// 도로 결빙 위험정보(기상청 도로위험 기상정보, 한국도로공사 결빙취약구간)는 아직 연결하지 않았다 - basis 는 항상 weather_only 다.
// 임계값은 PoC 의 검증되지 않은 초안이다(ai/tunnel_detection/road_hazard_poc/weather_risk.py 와 같은 값).
//
// 서버(backend)가 키를 들고 기상청을 호출해 아래 형태(snake_case JSON)로 내려준다. 실패·누락은 unknown 이며 "안전"이 아니다.

export type PtyKind = 'none' | 'rain' | 'rain_snow' | 'snow' | 'shower' | 'drizzle' | 'drizzle_snow' | 'snow_flurry' | 'unknown';

const SNOW_LIKE: ReadonlySet<PtyKind> = new Set(['snow', 'rain_snow', 'drizzle_snow', 'snow_flurry']);
const RAIN_LIKE: ReadonlySet<PtyKind> = new Set(['rain', 'drizzle', 'shower']);
const PTY_VALUES: ReadonlySet<string> = new Set(['none', 'rain', 'rain_snow', 'snow', 'shower', 'drizzle', 'drizzle_snow', 'snow_flurry', 'unknown']);

export interface RoadWeatherObservation {
  /** 기상청 발표 기준시각(ISO 8601, +09:00). */
  observedAt: string;
  tempC: number | null;
  rainMm1h: number | null;
  pty: PtyKind;
  humidityPct: number | null;
  /** 결측으로 확인된 항목(T1H, RN1, PTY, REH ...). */
  missing: string[];
}

export type RoadWeatherLevel = 'unknown' | 'none' | 'caution' | 'warning';
export type RoadWeatherReason = 'rain' | 'snow' | 'low_temp' | 'wet_or_humid';

export interface RoadWeatherRisk {
  level: RoadWeatherLevel;
  reasons: RoadWeatherReason[];
  /** 항상 weather_only: 관측값만으로 만든 판단이다. 노면 결빙 정보가 아니다. */
  basis: 'weather_only' | 'none' | 'unknown';
  /** 관측이 너무 오래됐거나 없어서 unknown 이 된 경우의 이유. */
  note?: 'observation_unavailable' | 'observation_stale' | 'observation_invalid' | 'observation_incomplete';
}

export interface WeatherPolicy {
  /** 비가 이 기온 이하면 결빙 가능성이 커진다고 보는 초안 값. */
  freezingTempC: number;
  /** 강수 없이도 노면이 미끄러울 수 있다고 보는 초안 값(젖음·습도와 함께). */
  coldTempC: number;
  humidPct: number;
  /** 관측이 이보다 오래되면 unknown. */
  staleAfterMin: number;
}

export const WEATHER_POLICY: WeatherPolicy = { freezingTempC: 3, coldTempC: 2, humidPct: 80, staleAfterMin: 60 };

const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));

/** 서버 JSON(snake_case)을 검증한다. 형식이 맞지 않으면 null (호출한 쪽이 unknown 으로 다룬다). */
export function parseRoadWeather(raw: unknown): RoadWeatherObservation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.observed_at !== 'string' || Number.isNaN(Date.parse(r.observed_at))) return null;
  if (!isNumOrNull(r.temp_c ?? null) || !isNumOrNull(r.rain_mm_1h ?? null) || !isNumOrNull(r.humidity_pct ?? null)) return null;
  const pty = typeof r.pty === 'string' && PTY_VALUES.has(r.pty) ? (r.pty as PtyKind) : 'unknown';
  return {
    observedAt: r.observed_at,
    tempC: (r.temp_c as number | null | undefined) ?? null,
    rainMm1h: (r.rain_mm_1h as number | null | undefined) ?? null,
    pty,
    humidityPct: (r.humidity_pct as number | null | undefined) ?? null,
    missing: Array.isArray(r.missing) ? r.missing.filter((m): m is string => typeof m === 'string') : [],
  };
}

function condition(obs: RoadWeatherObservation, p: WeatherPolicy): { level: 'none' | 'caution' | 'warning'; reasons: RoadWeatherReason[] } {
  if (SNOW_LIKE.has(obs.pty)) return { level: 'warning', reasons: ['snow'] };
  if (RAIN_LIKE.has(obs.pty)) {
    if (obs.tempC !== null && obs.tempC <= p.freezingTempC) return { level: 'warning', reasons: ['rain', 'low_temp'] };
    return { level: 'caution', reasons: ['rain'] };
  }
  const wet = obs.rainMm1h !== null && obs.rainMm1h > 0;
  if (obs.pty === 'none' || obs.pty === 'unknown') {
    if (obs.tempC !== null && obs.tempC <= p.coldTempC && (wet || (obs.humidityPct ?? 0) >= p.humidPct)) {
      return { level: 'caution', reasons: ['low_temp', 'wet_or_humid'] };
    }
  }
  return { level: 'none', reasons: [] };
}

/**
 * 관측값 → 위험 등급.
 *  - 관측이 없거나, 시각이 이상하거나, 너무 오래됐으면 unknown (위험 없음이 아니다).
 *  - 강수 형태(PTY)를 모르는데(결측) 기온도 높으면 none 이 아니라 unknown 이다: 눈이 오는지 모르는 채로 "괜찮다"고 하지 않는다.
 */
export function assessRoadWeather(obs: RoadWeatherObservation | null, nowMs: number, policy: WeatherPolicy = WEATHER_POLICY): RoadWeatherRisk {
  if (!obs) return { level: 'unknown', reasons: [], basis: 'unknown', note: 'observation_unavailable' };
  const observedMs = Date.parse(obs.observedAt);
  if (Number.isNaN(observedMs)) return { level: 'unknown', reasons: [], basis: 'unknown', note: 'observation_invalid' };
  const ageMin = (nowMs - observedMs) / 60_000;
  if (ageMin > policy.staleAfterMin) return { level: 'unknown', reasons: [], basis: 'unknown', note: 'observation_stale' };
  if (ageMin < -10) return { level: 'unknown', reasons: [], basis: 'unknown', note: 'observation_invalid' }; // 미래 시각

  const c = condition(obs, policy);
  if (c.level !== 'none') return { level: c.level, reasons: c.reasons, basis: 'weather_only' };
  // 비·눈 여부(PTY)를 모르면 "없음"이라고 단정하지 않는다.
  if (obs.missing.includes('PTY') || (obs.pty === 'unknown' && obs.tempC === null)) {
    return { level: 'unknown', reasons: [], basis: 'unknown', note: 'observation_incomplete' };
  }
  return { level: 'none', reasons: [], basis: 'none' };
}
