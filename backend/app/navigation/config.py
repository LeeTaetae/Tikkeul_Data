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


@lru_cache()
def get_settings() -> Settings:
    return Settings()
