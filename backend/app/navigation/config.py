from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # backend/.env 를 교통 API 설정과 같이 쓴다. 그 파일에는 이 클래스에 없는 변수(ITS_* 등)도 있으므로 extra="ignore".
    model_config = SettingsConfigDict(env_file=str(BACKEND_DIR / ".env"), env_file_encoding="utf-8", extra="ignore")

    tmap_app_key: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    kakao_rest_api_key: str = ""
    # 국토교통부 TAGO 버스노선정보 인증키(data.go.kr). 없으면 버스 노선 매칭을 끄고 모든 버스 필드가 null 이다. 코드·Git 에 넣지 않는다.
    tago_service_key: str = ""
    # 서울특별시 노선정보조회(data.go.kr 15000193) 인증키. 없으면 서울 버스 매칭을 끄고 TAGO 만 쓴다. 코드·Git 에 넣지 않는다.
    seoul_bus_service_key: str = ""


@lru_cache()
def get_settings() -> Settings:
    return Settings()
