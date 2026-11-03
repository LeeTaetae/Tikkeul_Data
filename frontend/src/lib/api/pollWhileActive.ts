// 앱이 화면에 보이는 동안(active)에만 주기적으로 onTick 을 부른다. 백그라운드에서는 멈추고, 돌아오면 한 번 바로 부른 뒤 주기를 이어간다.
// 보이지 않는 화면의 polling 이 서버 호출을 늘리지 않게 한다. react-native 를 직접 import 하지 않아 Node 에서 테스트할 수 있다.
export interface AppStateLike {
  currentState: string | null | undefined;
  addEventListener(type: 'change', listener: (next: string) => void): { remove(): void };
}

export function pollWhileActive(onTick: () => void, intervalMs: number, appState: AppStateLike): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (id === null) id = setInterval(onTick, intervalMs);
  };
  const stop = () => {
    if (id !== null) clearInterval(id);
    id = null;
  };

  if (appState.currentState === 'active') start();
  const subscription = appState.addEventListener('change', (next) => {
    if (next === 'active') {
      if (id === null) onTick(); // 멈춰 있던 동안 오래된 데이터를 바로 갱신한다
      start();
    } else {
      stop();
    }
  });
  return () => {
    stop();
    subscription.remove();
  };
}
