import sqlite3
from pathlib import Path

from scripts.migrate_favorite_categories import migrate


def _make_legacy_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE favoriteplace (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,
            label TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            address_text TEXT NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL
        )
        """
    )
    conn.executemany(
        "INSERT INTO favoriteplace (id, user_id, kind, label, lat, lon, address_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (1, 1, "home", "집", 37.5, 127.0, "", "2026-01-01T00:00:00"),
            (2, 1, "custom", "카페", 37.6, 127.1, "address", "2026-01-02T00:00:00"),
        ],
    )
    conn.commit()
    conn.close()


def test_migrate_preserves_rows_and_adds_category_column(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM favoriteplace ORDER BY id").fetchall()
    conn.close()

    assert len(rows) == 2  # 유실 없음
    assert [r["label"] for r in rows] == ["집", "카페"]  # 원본 데이터 보존
    for r in rows:
        assert r["category"] is None


def test_migrate_allows_new_row_with_null_or_string_category(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO favoriteplace (id, user_id, kind, label, lat, lon, address_text, created_at, category) "
        "VALUES (3, 1, 'custom', '헬스장', 37.5, 127.0, '', '2026-01-03T00:00:00', '운동')"
    )
    conn.execute(
        "INSERT INTO favoriteplace (id, user_id, kind, label, lat, lon, address_text, created_at, category) "
        "VALUES (4, 1, 'custom', '서점', 37.5, 127.0, '', '2026-01-04T00:00:00', NULL)"
    )
    conn.commit()
    rows = conn.execute("SELECT COUNT(*) FROM favoriteplace").fetchone()
    conn.close()

    assert rows[0] == 4


def test_migrate_creates_backup_file(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    backups = list(tmp_path.glob("tikkeul.db.bak-*"))
    assert len(backups) == 1


def test_migrate_is_idempotent_on_second_run(tmp_path):
    db_path = tmp_path / "tikkeul.db"
    _make_legacy_db(db_path)

    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO favoriteplace (id, user_id, kind, label, lat, lon, address_text, created_at, category) "
        "VALUES (3, 1, 'custom', '헬스장', 37.5, 127.0, '', '2026-01-03T00:00:00', '운동')"
    )
    conn.commit()
    conn.close()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    before_rows = [dict(r) for r in conn.execute("SELECT * FROM favoriteplace ORDER BY id").fetchall()]
    conn.close()

    # 이미 마이그레이션된 DB 에 다시 실행해도 데이터가 바뀌지 않아야 한다.
    migrate(db_path)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    after_rows = [dict(r) for r in conn.execute("SELECT * FROM favoriteplace ORDER BY id").fetchall()]
    conn.close()

    assert after_rows == before_rows
