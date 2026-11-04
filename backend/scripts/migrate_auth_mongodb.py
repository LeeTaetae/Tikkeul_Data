"""Copy SQLite accounts to MongoDB without changing IDs or overwriting accounts.

Run from backend: python scripts/migrate_auth_mongodb.py
Stop the backend while migrating. SQLite data is backed up and retained.
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo.errors import PyMongoError
from sqlmodel import Session, select

from app.auth.models import User
from app.auth.store import open_user_database
from app.config import Settings
from app.db import create_db_and_tables, make_engine
from scripts.migrate_social_login import migrate as migrate_legacy_social


def migrate(settings):
    if not settings.secret("mongodb_uri"):
        raise RuntimeError("MONGODB_URI is required.")
    sqlite_path = Path(settings.database_url.removeprefix("sqlite:///"))
    if not settings.database_url.startswith("sqlite:///") or not sqlite_path.is_file():
        raise RuntimeError("Existing SQLite account database not found.")
    backup = sqlite_path.with_name(sqlite_path.name + datetime.now(timezone.utc).strftime(".%Y%m%d%H%M%S.backup"))
    with sqlite3.connect(str(sqlite_path)) as source, sqlite3.connect(str(backup)) as destination:
        source.backup(destination)
    with sqlite3.connect(str(sqlite_path)) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(user)")}
    if columns and "provider" not in columns:
        migrate_legacy_social(sqlite_path)
    engine = make_engine(settings)
    client = None
    try:
        create_db_and_tables(engine)
        with Session(engine) as session:
            users = session.exec(select(User)).all()
            documents = [user.model_dump() for user in users]
        client, database = open_user_database(settings)
        # Preflight every ID/email/provider collision before any account write.
        for document in documents:
            queries = [{"id": document["id"]}]
            if document["email"] is not None:
                queries.append({"email": document["email"]})
            if document["provider_id"] is not None:
                queries.append({"provider": document["provider"], "provider_id": document["provider_id"]})
            for existing in database.users.find({"$or": queries}):
                identity = ("id", "email", "provider", "provider_id", "password_hash")
                if any(existing.get(key) != document.get(key) for key in identity):
                    raise RuntimeError("Account identity conflict; no accounts overwritten. Resolve before switching stores.")
        maximum = max((document["id"] for document in documents), default=0)
        database.counters.update_one({"_id": "users"}, {"$max": {"value": maximum}}, upsert=True)
        copied = 0
        for document in documents:
            result = database.users.update_one({"id": document["id"]}, {"$setOnInsert": document}, upsert=True)
            copied += int(result.upserted_id is not None)
        print(f"MIGRATION_OK copied={copied} existing={len(documents) - copied}; SQLite backup retained.")
    finally:
        if client is not None:
            client.close()
        engine.dispose()


if __name__ == "__main__":
    try:
        migrate(Settings())
    except (PyMongoError, RuntimeError):
        print("MIGRATION_FAILED: check connection and account conflicts. No existing accounts are overwritten.")
        sys.exit(1)
