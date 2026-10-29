// 백엔드 GET /api/geo/region 응답(backend/app/models.py Region)
export interface Region {
  /** 현행 법정동코드 앞 5자리. 보호구역 조회(sgg_cd)에 쓴다 */
  sgg_cd: string;
  sido_name: string;
  /** 시군구 이름. 일반구가 있는 시는 '수원시 장안구'처럼 구까지 포함 */
  sgg_name: string;
  emd_name: string;
  source: string;
}
