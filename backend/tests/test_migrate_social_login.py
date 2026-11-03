import sqlite3
from pathlib import Path

from scripts.migrate_social_login import migrate


def _make_legacy_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE user (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email_verified BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL
        )
        """
    )
    conn.executemany(
        "INSERT INTO user (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)",
        [
            (1, "a@example.com", "hash-a", 1, "2026-01-01T00:00:00"),
            (2, "b@example.com", "hash-b", 0, "2026-01-02T00:00:00"),
            (3, "c@example.com", "hash-c", 1, "2026-01-03T00:00:00"),
        ],
    )
    conn.commit()
    conn.close()


def test_migrate_preserves_rows_and_adds_social_login_columns(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM user ORDER BY id").fetchall()
    conn.close()

    assert len(rows) == 3  # 유실 없음
    assert [r["email"] for r in rows] == ["a@example.com", "b@example.com", "c@example.com"]
    assert [r["password_hash"] for r in rows] == ["hash-a", "hash-b", "hash-c"]  # 원본 데이터 보존
    for r in rows:
        assert r["provider"] == "local"
        assert r["provider_id"] is None


def test_migrate_allows_new_row_with_null_email_and_password(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO user (provider, provider_id, email, password_hash, email_verified, created_at) "
        "VALUES ('kakao', 'kakao-123', NULL, NULL, 0, '2026-01-04T00:00:00')"
    )
    conn.commit()
    rows = conn.execute("SELECT COUNT(*) FROM user").fetchone()
    conn.close()

    assert rows[0] == 4


def test_migrate_creates_backup_file(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    backups = list(tmp_path.glob("tikkeul.db.bak-*"))
    assert len(backups) == 1


def test_migrate_allows_multiple_null_emails_but_rejects_duplicate_nonnull(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    # 여러 소셜 로그인 계정이 email=NULL 이어도 충돌하지 않아야 한다.
    conn.execute(
        "INSERT INTO user (provider, provider_id, email, password_hash, email_verified, created_at) "
        "VALUES ('kakao', 'kakao-1', NULL, NULL, 0, '2026-01-04T00:00:00')"
    )
    conn.execute(
        "INSERT INTO user (provider, provider_id, email, password_hash, email_verified, created_at) "
        "VALUES ('kakao', 'kakao-2', NULL, NULL, 0, '2026-01-05T00:00:00')"
    )
    conn.commit()

    # 기존 email 과 중복되는 non-NULL 값은 UNIQUE 제약으로 거부돼야 한다.
    try:
        conn.execute(
            "INSERT INTO user (provider, provider_id, email, password_hash, email_verified, created_at) "
            "VALUES ('local', NULL, 'a@example.com', 'hash-dup', 0, '2026-01-06T00:00:00')"
        )
        conn.commit()
        raised = False
    except sqlite3.IntegrityError:
        raised = True
    finally:
        conn.close()

    assert raised


def _make_legacy_db_with_fk_children(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE user (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            email_verified BOOLEAN NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE trip (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES user(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE favoriteplace (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES user(id)
        )
        """
    )
    conn.executemany(
        "INSERT INTO user (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)",
        [(1, "a@example.com", "hash-a", 1, "2026-01-01T00:00:00")],
    )
    conn.execute("INSERT INTO trip (id, user_id, label) VALUES (1, 1, 'trip-1')")
    conn.execute("INSERT INTO favoriteplace (id, user_id, label) VALUES (1, 1, 'home')")
    conn.commit()
    conn.close()


def test_migrate_preserves_foreign_keys_in_child_tables(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db_with_fk_children(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")

    # user_old 를 가리키게 깨져있지 않다 - FK 위반이 하나도 없어야 한다.
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    assert violations == [], violations

    # 자식 테이블의 FK 선언이 "user_old"가 아니라 "user"를 그대로 참조해야 한다.
    trip_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='trip'").fetchone()[0]
    fav_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name='favoriteplace'").fetchone()[0]
    assert "user_old" not in trip_sql
    assert "user_old" not in fav_sql
    assert "user" in trip_sql and "user" in fav_sql

    # 마이그레이션 후에도 새 자식 row 삽입이 FK 를 통과해야 한다(FK 가 끊겨서 "no such table" 이 나면 안 된다).
    conn.execute("INSERT INTO trip (id, user_id, label) VALUES (2, 1, 'trip-2')")
    conn.commit()
    conn.close()

    # 인덱스도 유실되지 않아야 한다.
    conn = sqlite3.connect(db_path)
    index_names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    conn.close()
    assert "ix_user_email" in index_names


def test_migrate_is_idempotent_on_second_run(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO user (provider, provider_id, email, password_hash, email_verified, created_at) "
        "VALUES ('kakao', 'kakao-1', NULL, NULL, 0, '2026-01-04T00:00:00')"
    )
    conn.commit()
    conn.close()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    before_rows = [dict(r) for r in conn.execute("SELECT * FROM user ORDER BY id").fetchall()]
    conn.close()

    # 이미 마이그레이션된 DB 에 다시 실행해도 데이터가 바뀌지 않아야 한다(provider/provider_id 덮어쓰기 금지).
    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    after_rows = [dict(r) for r in conn.execute("SELECT * FROM user ORDER BY id").fetchall()]
    conn.close()

    assert after_rows == before_rows
