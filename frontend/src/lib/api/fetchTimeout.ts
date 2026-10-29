// fetch 에 제한 시간을 둔다. 서버가 응답하지 않아도(Render 콜드 스타트, 연결 지연) 화면이 무기한 "불러오는 중"에 머물지 않게 한다.
// 제한 시간이 지나면 fetch 가 AbortError 로 실패하므로, 호출한 쪽은 기존 실패 처리(catch → null)를 그대로 쓴다.
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
