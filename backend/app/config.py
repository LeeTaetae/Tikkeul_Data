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
    gemini_api_key: Optional[SecretStr] = None

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

    # 로그인용 서명 비밀키. 다른 인증키들과 같은 패턴 - 없으면 가입/로그인 시점에 NOT_CONFIGURED 오류를 낸다.
    jwt_secret: Optional[SecretStr] = None
    jwt_algorithm: str = "HS256"
    jwt_expires_days: int = 14
    mongodb_uri: Optional[SecretStr] = None
    mongodb_database: str = "tikkeul"
    # 로그인·즐겨찾기·최근목적지용 SQLite 파일. backend/data/ 는 .gitignore 대상이고 speed_bumps.db 는 같은 디렉터리다.
    database_url: str = f"sqlite:///{BACKEND_DIR / 'data' / 'tikkeul.db'}"

    # 가입 시 이메일 인증 메일 발송(Resend). 없으면 가입은 그대로 되고 메일만 조용히 건너뛴다(미인증 상태로 남는다).
    resend_api_key: Optional[SecretStr] = None
    resend_from_email: str = "onboarding@resend.dev"
    email_verify_expires_hours: int = 24
    # 가입 전 이메일 인증번호(6자리) 유효시간과, 인증 성공 뒤 "이 이메일은 확인됨" 토큰의 유효시간(그 사이에 가입을 끝내야 한다).
    signup_code_expires_minutes: int = 10
    signup_verified_expires_minutes: int = 30
    # 인증메일의 "인증하기" 링크가 가리킬 이 백엔드 자신의 공개 주소(프런트엔드 주소 아님).
    # 운영에서는 Render 서비스의 실제 URL로 덮어써야 한다 - 안 그러면 메일 링크가 localhost를 가리킨다.
    api_base_url: str = "http://localhost:8000"

    # 구글 소셜 로그인 - ID 토큰 검증의 audience로만 쓰는 공개 클라이언트 ID(비밀값 아님).
    google_web_client_id: str = ""

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
