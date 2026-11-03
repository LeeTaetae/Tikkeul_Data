import type { TransitVehicle } from './navigationApi';

// 공식 노선 정보는 서버가 match_confidence 'high' 로 확정하고 노선 ID·운영 지역이 모두 있을 때만 믿는다. 아니면 세 값 모두 버린다(일부만 쓰지 않는다).
// 노선 유형(routeClass)은 없을 수 있다: 서울 API 로만 채운 경기·인천 노선은 운영 지역만 알고 세부 유형은 모른다. 이때 유형만 null 로 둔다.
export function parseTransitVehicle(raw: any): TransitVehicle {
  const trusted = raw?.match_confidence === 'high' && typeof raw.route_id === 'string' && typeof raw.operator_region === 'string';
  return {
    name: typeof raw?.name === 'string' ? raw.name : '',
    type: typeof raw?.type === 'string' ? raw.type : null,
    routeId: trusted ? raw.route_id : null,
    operatorRegion: trusted ? raw.operator_region : null,
    routeClass: trusted && typeof raw.route_class === 'string' ? raw.route_class : null,
  };
}
