import { useNativeHazardRail } from '../../lib/navigation/useNativeHazardRail';

/** 카카오 SDK 주행 화면 위험 레일을 구동하는 보이지 않는 컴포넌트. 화면이 사라지면 오버레이를 비운다 */
export function NativeHazardRailBridge() {
  useNativeHazardRail();
  return null;
}
