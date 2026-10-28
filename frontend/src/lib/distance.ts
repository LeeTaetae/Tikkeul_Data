// 경고 문구용 거리 표기. 1km 이상은 km, 그 미만은 10m 단위 m 로 보여준다.
export function formatDistance(meters: number): string {
  const rounded = Math.round(meters / 10) * 10;
  if (rounded < 1000) return `${rounded}m`;
  return `${(rounded / 1000).toFixed(1).replace(/\.0$/, '')}km`;
}
