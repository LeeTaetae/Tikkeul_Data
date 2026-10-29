"""배포 설정(render.yaml) 위생 점검. Render 서비스를 실제로 만들지 않고 파일 내용만 본다."""
import re
from pathlib import Path

from tests.test_environment import KEY_NAMES

ROOT = Path(__file__).resolve().parents[2]
RENDER = (ROOT / "render.yaml").read_text(encoding="utf-8")
NAV_KEY_NAMES = {"TMAP_APP_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"}


def test_render_pins_python_3_9_13():
    assert re.search(r"key: PYTHON_VERSION\s+value: 3\.9\.13\s*$", RENDER, re.M)


def test_render_secret_keys_are_never_written_in_file():
    # 비밀 키 변수는 모두 sync:false(대시보드 입력)여야 하고 value 를 갖지 않는다.
    for name in KEY_NAMES | NAV_KEY_NAMES:
        assert re.search(r"key: %s\n\s+sync: false" % name, RENDER), name


def test_render_start_command_binds_render_port():
    assert "uvicorn app.main:app" in RENDER and "--host 0.0.0.0" in RENDER and "--port $PORT" in RENDER


def test_env_example_lists_navigation_key_names():
    text = (ROOT / "backend" / ".env.example").read_text(encoding="utf-8")
    assert all(re.search(r"^%s=$" % name, text, re.M) for name in NAV_KEY_NAMES)
