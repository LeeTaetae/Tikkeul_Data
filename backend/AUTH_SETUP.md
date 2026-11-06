# MongoDB authentication

Accounts use MongoDB when `MONGODB_URI` is set. With no URI, SQLite remains available
for isolated tests. A configured MongoDB failure never falls back to SQLite.
Favorites and trips continue using SQLite and the existing integer user IDs.

## Local settings

Set these in `backend/.env` (never commit credentials):

- `MONGODB_URI`: Atlas connection string, with URI-encoded credentials.
- `MONGODB_DATABASE`: `tikkeul`.
- `JWT_SECRET`: a long random secret. Keep it stable across restarts.
- `RESEND_API_KEY`: required for signup verification and password reset emails.
- `RESEND_FROM_EMAIL`: a sender allowed by your Resend account/domain.
- `GOOGLE_WEB_CLIENT_ID`: must match the native frontend's Google web client ID.

Signup still requires successful email verification. There is no development
verification bypass. Social provider tokens are verified by the backend before
accounts are looked up or created. Matching emails do not automatically link accounts.
Existing Google/Kakao UI platform restrictions remain in place.

## Migrate existing accounts

Stop account writes during migration. From `backend`:

```powershell
.\.venv\Scripts\python.exe scripts/migrate_auth_mongodb.py
```

The script backs up SQLite, handles the older social-login schema, preserves IDs
and password hashes, and refuses identity conflicts. Re-running does not overwrite
MongoDB passwords, roles or status. The local database had no users at setup time.

## Administrator

From `backend`, create or promote a local account:

```powershell
.\.venv\Scripts\python.exe scripts/manage_admin.py --email admin@test.com
```

New accounts prompt for a password without echoing it. Existing local accounts retain
their password. To set a new password explicitly:

```powershell
.\.venv\Scripts\python.exe scripts/manage_admin.py --email admin@test.com --reset-password
```

During initial setup a generated password was saved to
`backend/data/admin-initial-password.txt`, which is ignored by Git. Set your own
password with the command above, then delete the initial password file.
`admin@test.com` is a local development administrator, not an email address whose
ownership was verified through Resend; do not use it as a production identity.

There is one login screen. Password and social login return the account's role,
and the app sends admin accounts to the admin page (navigation only, not a
security check). `/api/auth/admin/me`, `/api/auth/admin/users` and other admin APIs
require the admin role via `get_admin_user`. `/api/auth/admin/me` rechecks the current role and account status
in the database on every request, so demotion and suspension apply to existing JWTs.
This page confirms administrator access; user-management features are not included.

## Start locally

From `backend`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start_local.ps1
```

This uses port 8000 and loads the Conda SSL library paths through venv activation.
The initial setup also started this backend in the background. Do not start a
second copy on the same port. Logs are in `backend/data/local-api.*.log`.

The local `frontend/.env` deployment URL is commented out so development uses
`localhost:8000` on web, or the Expo host IP on native. Restart Expo after changing
its environment. Devices must reach this PC on the same network. Built native
bundles may need rebuilding to replace their embedded API URL.

```powershell
cd frontend
npm.cmd run start -- --clear
```

## Validation

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
.\.venv\Scripts\python.exe scripts/smoke_auth_mongodb.py --password-file data/admin-initial-password.txt
```

The Atlas smoke test uses a unique temporary account, verifies persistence, password
hashing, normal/admin access and the configured administrator, then removes only its
own test account. Email verification is simulated with a signed test token in this
script; it does not prove actual email delivery. No passwords or connection strings
are printed. Automated tests use an isolated in-memory MongoDB mock.

For deployment, configure these settings separately on the backend host, allow its
outbound IP in Atlas, migrate its existing accounts, deploy both applications, and
set the frontend API URL to that host. Local `.env` values are not sent to Render.
