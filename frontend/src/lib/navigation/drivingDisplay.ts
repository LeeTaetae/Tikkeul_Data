// 차량 길안내 화면의 속도·보호구역 주의 표시값. 순수 코드라 Node 로 테스트한다.
//
// 현재 속도는 엔진이 최근 위치 변화로 추정한 값이고, 제한속도는 경로 응답에 없다(도로별 제한속도 데이터 없음).
// 알 수 있는 제한속도는 어린이보호구역의 법정 30km/h 뿐이다. 보호구역은 "지점" 좌표라 구역의 실제 시작·끝을 모르므로,
// 지점 근처에서 "보호구역 근처, 30km/h 주의"만 알리고 지금 그 제한 구간 안이라고 단정하지 않는다. 아래 거리는 추정값이다.

/** 보호구역 지점 앞 이만큼(m)부터, 지난 뒤 이만큼(m)까지 주의 안내를 보여준다 */
export const LIMIT_SHOW_AHEAD_M = 300;
export const LIMIT_SHOW_BEHIND_M = 100;

/** 이 속도(km/h) 미만은 0 으로 보여준다. 멈춰 있을 때 GPS 흔들림이 1~2km/h 로 보이지 않게 한다 */
const STOPPED_KMH = 3;

/** 표시할 현재 속도(km/h, 정수). 속도를 모르면 null */
export function speedKmhOf(speedMps: number | null): number | null {
  if (speedMps === null || !Number.isFinite(speedMps) || speedMps < 0) return null;
  const kmh = speedMps * 3.6;
  return kmh < STOPPED_KMH ? 0 : Math.round(kmh);
}

/** 경로 위 보호구역 지점들(경로 시작부터의 거리 m) 중 하나라도 주의 안내를 보여줄 범위 안이면 true */
export function nearSchoolZone(zoneOffsetsM: number[], progressM: number): boolean {
  return zoneOffsetsM.some((offset) => {
    const ahead = offset - progressM;
    return ahead <= LIMIT_SHOW_AHEAD_M && ahead >= -LIMIT_SHOW_BEHIND_M;
  });
}
