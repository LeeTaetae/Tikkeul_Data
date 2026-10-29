from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]

# 로컬 Expo Web 개발 서버 주소. 운영에서는 CORS_ALLOW_ORIGINS 로 덮어쓴다.
DEFAULT_CORS_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081", "http://localhost:19006"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BACKEND_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")

    # 인증키. 없으면 해당 API 만 NOT_CONFIGURED 오류를 낸다. 값은 로그·응답에 절대 내보내지 않는다(SecretStr).
    its_traffic_api_key: Optional[SecretStr] = None
    its_event_api_key: Optional[SecretStr] = None
    its_prediction_api_key: Optional[SecretStr] = None
    its_caution_api_key: Optional[SecretStr] = None
    protection_zone_service_key: Optional[SecretStr] = None
    # 좌표 -> 시군구코드 변환(Kakao Local). 서버에서만 쓰고 프런트엔드에는 내보내지 않는다.
    kakao_rest_api_key: Optional[SecretStr] = None

    its_base_url: str = "https://openapi.its.go.kr:9443"
    # ITS 가 이 서버의 IP 대역에서 연결되지 않을 때 쓰는 한국 PC 중계(relay/). 비워 두면 its_base_url 로 직접 호출한다.
    # 설정하면 ITS 인증키는 중계에만 있고(이 서버는 보내지 않는다), 중계에는 토큰으로 인증한다.
    its_relay_url: str = ""
    its_relay_token: Optional[SecretStr] = None
    protection_zone_url: str = "https://apis.data.go.kr/1320000/safetyzonedtlinfo/getdtllist"
    kakao_region_url: str = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json"
    http_timeout_s: float = 15.0

    # 캐시 TTL(초). 공식 문서에 갱신 주기가 없어 2026-10-28 실측으로 정한 값이다(README 참고).
    # 소통정보는 5분 간격 스냅샷(16:55 -> 17:00 -> 17:05)이라 2분마다 확인하면 새 스냅샷을 곧바로 받는다.
    ttl_incidents_s: int = 60
    ttl_caution_s: int = 60
    ttl_flow_s: int = 120
    ttl_prediction_s: int = 600
    ttl_protection_s: int = 86400
    # 업스트림이 실패했을 때 마지막 성공 결과를 stale=true 로 계속 내주는 최대 시간
    max_stale_s: int = 1800

    # 쉼표로 구분한 허용 출처. 비우면 DEFAULT_CORS_ORIGINS
    cors_allow_origins: str = ""

    def secret(self, name: str) -> Optional[str]:
        value = getattr(self, name)
        text = value.get_secret_value().strip() if value is not None else ""
        return text or None

    def cors_origins(self) -> List[str]:
        items = [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]
        return items or DEFAULT_CORS_ORIGINS


@lru_cache()
def get_settings() -> Settings:
    return Settings()
