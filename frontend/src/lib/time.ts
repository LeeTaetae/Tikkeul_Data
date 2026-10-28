// 서버·클라이언트 렌더 결과가 같도록 KST(UTC+9) HH:mm 으로 직접 계산한다.
export function formatTimeKst(iso: string): string {
  const d = new Date(iso);
  const h = (d.getUTCHours() + 9) % 24;
  return `${String(h).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 오늘(KST)이면 HH:mm, 다른 날이면 MM.DD HH:mm. 오래 이어지는 공사 등의 발생 시각이 오늘 시각으로 오해되지 않게 한다.
export function formatDateTimeKst(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  const today = new Date(now.getTime() + KST_OFFSET_MS);
  const hm = `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
  if (kst.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) return hm;
  return `${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')} ${hm}`;
}
