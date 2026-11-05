import pytest
from sqlmodel import Session, select

from app.auth.models import User
from tests.conftest import make_settings
from tests.test_auth_mongodb import bearer, mongo_auth, signup  # noqa: F401 (pytest fixture 재사용)


@pytest.fixture
def sql_auth(make_client):
    settings = make_settings()
    return make_client(lambda request: None, settings=settings), settings


def _make_admin_sql(client, email):
    with Session(client.app.state.db_engine) as session:
        user = session.exec(select(User).where(User.email == email)).one()
        user.role = "admin"
        session.add(user)
        session.commit()


@pytest.fixture(params=["sql", "mongo"])
def backend(request, sql_auth, mongo_auth):
    """(client, settings, make_admin) - 두 계정 저장소에서 같은 시나리오를 돌린다."""
    if request.param == "sql":
        client, settings = sql_auth
        return client, settings, lambda email: _make_admin_sql(client, email)
    client, db, settings = mongo_auth
    return client, settings, lambda email: db.users.update_one({"email": email}, {"$set": {"role": "admin"}})


def _login(client, email):
    return client.post("/api/auth/login", json={"email": email, "password": "password123"})


def test_admin_lists_users_and_normal_user_is_forbidden(backend):
    client, settings, make_admin = backend
    signup(client, settings, email="admin@example.com")
    signup(client, settings, email="user@example.com")
    make_admin("admin@example.com")

    assert client.get("/api/auth/admin/users", headers=bearer(_login(client, "user@example.com"))).status_code == 403

    response = client.get("/api/auth/admin/users", headers=bearer(_login(client, "admin@example.com")))
    assert response.status_code == 200
    users = response.json()
    assert [u["email"] for u in users] == ["admin@example.com", "user@example.com"]
    assert all("password_hash" not in u for u in users)


def test_admin_disables_and_reactivates_user(backend):
    client, settings, make_admin = backend
    signup(client, settings, email="admin@example.com")
    user_id = signup(client, settings, email="user@example.com").json()["user"]["id"]
    make_admin("admin@example.com")
    admin = bearer(_login(client, "admin@example.com"))
    user_token = bearer(_login(client, "user@example.com"))

    response = client.patch(f"/api/auth/admin/users/{user_id}/status", json={"status": "disabled"}, headers=admin)
    assert response.status_code == 200 and response.json()["status"] == "disabled"
    assert client.get("/api/auth/me", headers=user_token).status_code == 403
    assert _login(client, "user@example.com").status_code == 403

    response = client.patch(f"/api/auth/admin/users/{user_id}/status", json={"status": "active"}, headers=admin)
    assert response.json()["status"] == "active"
    assert client.get("/api/auth/me", headers=user_token).status_code == 200


def test_admin_cannot_disable_self_and_unknown_user_is_404(backend):
    client, settings, make_admin = backend
    admin_id = signup(client, settings, email="admin@example.com").json()["user"]["id"]
    make_admin("admin@example.com")
    admin = bearer(_login(client, "admin@example.com"))

    assert client.patch(f"/api/auth/admin/users/{admin_id}/status", json={"status": "disabled"}, headers=admin).status_code == 400
    assert client.patch("/api/auth/admin/users/9999/status", json={"status": "disabled"}, headers=admin).status_code == 404
    assert client.patch(f"/api/auth/admin/users/{admin_id}/status", json={"status": "banned"}, headers=admin).status_code == 422
