"""User 테이블에 소셜 로그인용 provider/provider_id 컬럼을 추가하고 email/password_hash 를 nullable 로 바꾼다.

SQLite 는 ALTER TABLE 로 컬럼을 nullable 로 바꾸거나 NOT NULL 제약을 지울 수 없어서, 표준 절차(새 테이블
생성 -> 데이터 복사 -> 교체)를 쓴다. 실행 전 DB 파일을 타임스탬프 붙여 백업하고, 트랜잭션 안에서
row 수가 그대로인지 확인한 뒤에만 커밋한다.

실행(backend 폴더에서):
    .venv/bin/python scripts/migrate_social_login.py
"""
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def migrate(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(user)")}
        if "provider" in columns:
            print("이미 마이그레이션된 DB 입니다 - 아무것도 하지 않습니다.")
            return
    finally:
        conn.close()

    backup_path = db_path.parent / f"{db_path.name}.bak-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    shutil.copy2(db_path, backup_path)

    conn = sqlite3.connect(db_path)
    try:
        before = conn.execute("SELECT COUNT(*) FROM user").fetchone()[0]

        conn.execute("BEGIN")
        conn.execute("ALTER TABLE user RENAME TO user_old")
        conn.execute(
            """
            CREATE TABLE user (
                id INTEGER PRIMARY KEY,
                provider TEXT NOT NULL DEFAULT 'local',
                provider_id TEXT,
                email TEXT UNIQUE,
                password_hash TEXT,
                email_verified BOOLEAN NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO user (id, provider, provider_id, email, password_hash, email_verified, created_at) "
            "SELECT id, 'local', NULL, email, password_hash, email_verified, created_at FROM user_old"
        )

        after = conn.execute("SELECT COUNT(*) FROM user").fetchone()[0]
        if after != before:
            conn.execute("ROLLBACK")
            raise RuntimeError(f"마이그레이션 전후 row 수가 다릅니다 (전: {before}, 후: {after}) - 롤백했습니다.")

        conn.execute("DROP TABLE user_old")
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    from app.config import get_settings

    settings = get_settings()
    path = Path(settings.database_url.removeprefix("sqlite:///"))
    migrate(path)
    print(f"완료: {path}")
