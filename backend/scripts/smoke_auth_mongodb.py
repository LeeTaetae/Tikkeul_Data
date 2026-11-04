"""Exercise actual MongoDB-backed auth APIs, cleaning up only this run's test user.

Run from backend: python scripts/smoke_auth_mongodb.py
Email verification is simulated with a signed test token; no emails are sent.
"""
import argparse
import secrets
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from fastapi.testclient import TestClient

from app.auth.security import create_signup_verified_token
from app.config import Settings
from app.main import create_app


async def no_warmup():
    return None


def check(condition, label):
    if not condition:
        raise RuntimeError(label)
    print("PASS " + label)


def smoke(admin_email, password_file):
    settings = Settings()
    check(bool(settings.secret("mongodb_uri")), "MongoDB configured")
    email = "smoke-" + secrets.token_hex(12) + "@example.invalid"
    password = secrets.token_urlsafe(24)
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})))
    with patch("app.main.warm_up_bus_routes", no_warmup), TestClient(create_app(settings, http_client=http)) as client:
        database = client.app.state.user_database
        try:
            response = client.post("/api/auth/signup", json={
                "email": email, "password": password, "verify_token": create_signup_verified_token(email, settings),
                "role": "admin",
            })
            check(response.status_code == 201, "signup")
            stored = database.users.find_one({"email": email})
            check(stored is not None and stored["role"] == "user", "MongoDB persistence and privilege protection")
            check(stored["password_hash"] != password and "password_hash" not in response.json()["user"], "password hashing and response privacy")
            credentials = {"email": email, "password": password}
            response = client.post("/api/auth/login", json=credentials)
            check(response.status_code == 200, "normal login")
            headers = {"Authorization": "Bearer " + response.json()["access_token"]}
            check(client.get("/api/auth/me", headers=headers).status_code == 200, "authenticated account lookup")
            check(client.post("/api/auth/admin/login", json=credentials).status_code == 403, "normal user denied admin login")
            check(client.get("/api/auth/admin/me", headers=headers).status_code == 403, "normal user denied admin API")
            if password_file and Path(password_file).exists():
                response = client.post("/api/auth/admin/login", json={
                    "email": admin_email, "password": Path(password_file).read_text(encoding="utf-8").strip(),
                })
                check(response.status_code == 200 and response.json()["user"]["role"] == "admin", "administrator login")
                headers = {"Authorization": "Bearer " + response.json()["access_token"]}
                check(client.get("/api/auth/admin/me", headers=headers).status_code == 200, "administrator API")
        finally:
            database.users.delete_one({"email": email, "provider": "local"})
            check(database.users.count_documents({"email": email}) == 0, "temporary test account cleanup")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--admin-email", default="admin@test.com")
    parser.add_argument("--password-file", type=Path)
    args = parser.parse_args()
    try:
        smoke(args.admin_email, args.password_file)
    except Exception as exc:
        print("SMOKE_FAILED: " + type(exc).__name__)
        sys.exit(1)
