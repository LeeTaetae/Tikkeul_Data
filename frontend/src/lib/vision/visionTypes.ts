// 전방 비전(YOLO) 탐지 공용 타입. docs/ADR/0002-vision-yolo-integration.md 참고.
export type HazardClass = 'kickboard' | 'motorcycle' | 'vehicle' | 'person' | 'animal';

// 0~1 정규화 좌표. y는 위에서 아래로.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Detection {
  class: HazardClass;
  confidence: number;
  box: Box;
}
