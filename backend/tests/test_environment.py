"""환경 스모크 테스트: Python 버전, 핵심 패키지, SSL, .env.example 위생 점검."""
import re
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
KEY_NAMES = {
    "ITS_TRAFFIC_API_KEY",
    "ITS_EVENT_API_KEY",
    "ITS_PREDICTION_API_KEY",
    "ITS_CAUTION_API_KEY",
    "PROTECTION_ZONE_SERVICE_KEY",
    "KAKAO_REST_API_KEY",
}


def test_python_is_3_9():
    assert sys.version_info[:2] == (3, 9)


@pytest.mark.parametrize("module", ["fastapi", "uvicorn", "pydantic", "pydantic_settings", "httpx"])
def test_runtime_packages_import(module):
    __import__(module)


def test_ssl_module_available():
    # Anaconda DLL 경로가 PATH 에 없으면 여기서 ImportError 가 난다. README 의 SSL 항목 참고.
    import ssl

    assert ssl.OPENSSL_VERSION


def test_env_example_has_names_only():
    names = set()
    for line in (BACKEND / ".env.example").read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, sep, value = line.partition("=")
        assert sep == "=" and re.fullmatch(r"[A-Z][A-Z0-9_]*", name.strip()), line
        assert value.strip() == "", "%s 에 값이 들어 있다. 변수명만 적는다." % name
        names.add(name.strip())
    assert KEY_NAMES <= names  # 인증키 변수는 모두 있어야 한다(그 밖의 선택 설정 변수는 허용)
