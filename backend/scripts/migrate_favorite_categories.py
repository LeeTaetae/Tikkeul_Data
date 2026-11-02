"""FavoritePlace 테이블에 category 컬럼을 추가한다.

favoriteplace 는 다른 테이블이 참조하는 FK 가 없는 리프 테이블이라, user 마이그레이션처럼
테이블을 재생성할 필요 없이 ALTER TABLE 로 컬럼만 추가하면 된다. 그래도 실행 전 DB 파일을
타임스탬프 붙여 백업한다.

실행(backend 폴더에서):
    .venv/bin/python scripts/migrate_favorite_categories.py
"""
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def migrate(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(favoriteplace)")}
        if "category" in columns:
            print("이미 마이그레이션된 DB 입니다 - 아무것도 하지 않습니다.")
            return
    finally:
        conn.close()

    backup_path = db_path.parent / f"{db_path.name}.bak-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    shutil.copy2(db_path, backup_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("ALTER TABLE favoriteplace ADD COLUMN category TEXT")
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    from app.config import get_settings

    settings = get_settings()
    path = Path(settings.database_url.removeprefix("sqlite:///"))
    migrate(path)
    print(f"완료: {path}")
