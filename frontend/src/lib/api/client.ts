// 백엔드 호출용 최소 fetch 클라이언트. 다른 모듈을 import 하지 않아(설정은 주입) Node 로도 그대로 테스트한다.
// 요청 URL(영역 좌표 포함)은 로그·오류 메시지에 남기지 않는다.

export type ApiErrorKind =
  | 'config' // API 주소 미설정
  | 'network' // 백엔드에 연결하지 못함(오프라인, 서버 꺼짐, CORS 등)
  | 'timeout' // 시간 초과(앱 쪽 또는 백엔드가 알려준 업스트림 지연)
  | 'auth' // 공공 API 인증 실패
  | 'notConfigured' // 서버에 인증키가 없음
  | 'rateLimit' // 공공 API 사용량 제한
  | 'server' // 그 밖의 서버·공공 API 오류, 응답 해석 실패
  | 'invalid' // 요청 값 오류(422)
  | 'regionNotFound'; // 좌표의 시군구를 확인할 수 없음(국내 위치가 아닐 수 있음)

export class ApiClientError extends Error {
  kind: ApiErrorKind;
  code?: string;
  status?: number;

  constructor(kind: ApiErrorKind, code?: string, status?: number) {
    super(code ? `${kind}:${code}` : kind);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

const CODE_TO_KIND: Record<string, ApiErrorKind> = {
  NOT_CONFIGURED: 'notConfigured',
  UPSTREAM_AUTH: 'auth',
  UPSTREAM_RATE_LIMIT: 'rateLimit',
  UPSTREAM_TIMEOUT: 'timeout',
  UPSTREAM_UNAVAILABLE: 'server',
  UPSTREAM_BAD_REQUEST: 'server',
  UPSTREAM_BAD_RESPONSE: 'server',
  UPSTREAM_ERROR: 'server',
  REGION_NOT_FOUND: 'regionNotFound',
};

/** 오류 HTTP 응답을 화면용 종류로 분류한다. 백엔드 오류 형식은 { error: { code } } 이다. */
export function classifyHttpError(status: number, body: unknown): ApiClientError {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === 'string') return new ApiClientError(CODE_TO_KIND[code] ?? 'server', code, status);
  if (status === 422) return new ApiClientError('invalid', undefined, status);
  return new ApiClientError('server', undefined, status);
}

export type QueryValue = string | number | boolean | undefined;

export function buildQuery(params: Record<string, QueryValue>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  /** 백엔드의 업스트림 제한 시간(15초)보다 길게 둔다 */
  timeoutMs?: number;
}

export function createApiClient({ baseUrl, fetchImpl, timeoutMs: defaultTimeoutMs = 20000 }: ApiClientConfig) {
  async function get<T>(path: string, params: Record<string, QueryValue> = {}, options: RequestOptions = {}): Promise<T> {
    if (!baseUrl) throw new ApiClientError('config');
    const doFetch = fetchImpl ?? fetch;
    const query = buildQuery(params);
    const url = `${baseUrl.replace(/\/+$/, '')}${path}${query ? `?${query}` : ''}`;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? defaultTimeoutMs);

    try {
      let response: Response;
      try {
        response = await doFetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      } catch (error) {
        if (options.signal?.aborted) throw error; // 호출한 쪽이 취소한 것(화면 이동 등). 오류로 보지 않는다
        throw new ApiClientError(timedOut ? 'timeout' : 'network');
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (timedOut) throw new ApiClientError('timeout');
        if (!response.ok) throw classifyHttpError(response.status, null);
        throw new ApiClientError('server', 'BAD_JSON', response.status);
      }
      if (!response.ok) throw classifyHttpError(response.status, body);
      return body as T;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  return { get };
}
