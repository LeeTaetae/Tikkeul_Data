import mongomock
import pytest

from scripts import migrate_auth_mongodb as migration
from tests.conftest import make_settings
from tests.test_migrate_social_login import _make_legacy_db


def test_legacy_migration_preserves_identity_hashes_and_existing_roles(tmp_path, monkeypatch):
    path = tmp_path / "accounts.db"
    _make_legacy_db(path)
    database = mongomock.MongoClient().accounts
    monkeypatch.setattr(migration, "open_user_database", lambda settings: (database.client, database))
    settings = make_settings(database_url="sqlite:///" + str(path), mongodb_uri="mongodb://test")
    migration.migrate(settings)
    assert database.users.count_documents({}) == 3
    assert database.users.find_one({"id": 1})["password_hash"] == "hash-a"
    assert database.counters.find_one({"_id": "users"})["value"] == 3
    assert list(tmp_path.glob("accounts.db.*.backup"))
    database.users.update_one({"id": 1}, {"$set": {"role": "admin"}})
    migration.migrate(settings)
    assert database.users.count_documents({}) == 3
    assert database.users.find_one({"id": 1})["role"] == "admin"


def test_migration_preflights_all_conflicts_before_copying_accounts(tmp_path, monkeypatch):
    path = tmp_path / "accounts.db"
    _make_legacy_db(path)
    database = mongomock.MongoClient().accounts
    database.users.insert_one({"id": 3, "email": "different@example.com", "provider": "local"})
    monkeypatch.setattr(migration, "open_user_database", lambda settings: (database.client, database))
    settings = make_settings(database_url="sqlite:///" + str(path), mongodb_uri="mongodb://test")
    with pytest.raises(RuntimeError, match="identity conflict"):
        migration.migrate(settings)
    assert database.users.count_documents({}) == 1
    assert database.users.find_one({"id": 1}) is None
