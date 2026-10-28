// 서버·클라이언트 렌더 결과가 같도록 KST(UTC+9) HH:mm 으로 직접 계산한다.
export function formatTimeKst(iso: string): string {
  const d = new Date(iso);
  const h = (d.getUTCHours() + 9) % 24;
  return `${String(h).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
