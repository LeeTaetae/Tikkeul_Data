"""Provision a MongoDB administrator without accepting passwords as CLI arguments.

python scripts/manage_admin.py --email admin@test.com
Use --reset-password to replace an existing password (prompts securely).
--password-file writes a generated password locally for an initial new account.
"""
import argparse
import secrets
import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo.errors import PyMongoError

from app.auth.models import User, normalize_email, _validate_password
from app.auth.security import hash_password
from app.auth.store import MongoUsers, open_user_database
from app.config import Settings


def provision(email, password_file=None, reset_password=False):
    settings = Settings()
    if not settings.secret("mongodb_uri"):
        raise RuntimeError("MONGODB_URI is required.")
    client, database = open_user_database(settings)
    try:
        store = MongoUsers(database)
        user = store.by_email(normalize_email(email))
        is_new = user is None
        if user is not None and user.provider != "local":
            raise RuntimeError("This email belongs to a social account; provision a separate local administrator.")
        if user is None:
            user = User(email=normalize_email(email), email_verified=True)
        if is_new or reset_password:
            if password_file:
                password = secrets.token_urlsafe(24)
                path = Path(password_file)
                path.parent.mkdir(parents=True, exist_ok=True)
                # Exclusive creation prevents overwriting an existing credential file.
                with path.open("x", encoding="utf-8") as output:
                    output.write(password + "\n")
            else:
                password = getpass("New administrator password: ")
                if password != getpass("Confirm password: "):
                    raise RuntimeError("Passwords do not match.")
            user.password_hash = hash_password(_validate_password(password))
        user.role = "admin"
        user.status = "active"
        store.add(user)
        store.commit()
        print("ADMIN_READY (password is never printed)")
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password-file", type=Path)
    parser.add_argument("--reset-password", action="store_true")
    args = parser.parse_args()
    try:
        provision(args.email, args.password_file, args.reset_password)
    except (PyMongoError, RuntimeError, ValueError, OSError) as exc:
        print("ADMIN_SETUP_FAILED: " + type(exc).__name__)
        sys.exit(1)
