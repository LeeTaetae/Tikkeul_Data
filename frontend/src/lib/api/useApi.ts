import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError, isAbortError } from './client';

// 로딩/성공/오류를 구분한다. "빈 데이터"는 성공 응답의 items 가 비어 있는 경우라 화면에서 판단한다.
// 같은 조회 조건에서 새로고침 중이거나 새로고침이 실패해도 마지막 성공 데이터는 남겨 둔다(화면이 깜빡이지 않게).
// 조회 조건(key)이 바뀌면 이전 조건의 데이터는 버리고 새로 로딩한다(다른 지역의 정보가 남아 보이지 않게).
export type ApiState<T> =
  | { status: 'loading'; data: null }
  | { status: 'success'; data: T; refreshing: boolean }
  | { status: 'error'; error: ApiClientError; data: T | null };

function toApiError(error: unknown): ApiClientError {
  return error instanceof ApiClientError ? error : new ApiClientError('server', 'UNEXPECTED');
}

export interface UseApiOptions {
  /** 같은 조건으로 다시 받아오는 주기(ms). 없으면 자동 갱신하지 않는다. */
  refreshMs?: number;
  /** 조회 조건 식별자. 바뀌면 새 조건으로 다시 조회한다. */
  key?: string;
  /** false 면 조회하지 않는다(위치를 아직 모를 때 등). */
  enabled?: boolean;
  /** true 면 key 가 바뀌어도 이전 데이터를 지우지 않고 새로 받는 동안 보여준다(결과가 같은 값으로 이어지는 조회용). */
  keepPrevious?: boolean;
}

export function useApi<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { refreshMs, key = '', enabled = true, keepPrevious = false }: UseApiOptions = {},
) {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastKey = useRef(key);

  useEffect(() => {
    const keyChanged = lastKey.current !== key;
    lastKey.current = key;
    if (!enabled) {
      setState({ status: 'loading', data: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) =>
      (!keyChanged || keepPrevious) && prev.data ? { status: 'success', data: prev.data, refreshing: true } : { status: 'loading', data: null },
    );
    loadRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data, refreshing: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState((prev) => ({ status: 'error', error: toApiError(error), data: prev.data }));
      });
    return () => controller.abort();
  }, [tick, key, enabled]);

  useEffect(() => {
    if (!refreshMs || !enabled) return;
    const id = setInterval(() => setTick((n) => n + 1), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, enabled]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { state, reload };
}
