# VoiceAuto Backend

The backend is a small Node HTTP service that serves the built frontend from `dist/` and exposes authentication, user management, and configuration APIs.

## Required Environment

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/voiceauto
PORT=3000
DB_POOL_SIZE=10
```

For local Vite development, run the backend on `3002` so Vite can keep `3000`:

```bash
PORT=3002 DATABASE_URL=postgresql://voiceauto_app:<password>@10.10.64.202:5432/voiceauto npm start
```

Vite proxies `/api/*` to `http://127.0.0.1:3002`.

For Docker on the same host as PostgreSQL, use:

```bash
DATABASE_URL=postgresql://postgres@host.docker.internal:5432/voiceauto
```

The existing `user_account` table must contain:

- `login_account`
- `password_hash`
- `password_salt`
- `password_algorithm = sha256_salt_v1`
- `role`
- `status`

The application creates `app_config` automatically when a config API is accessed.

```sql
CREATE TABLE IF NOT EXISTS app_config (
  config_type TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);
```

## APIs

- `POST /api/auth/login`
- `GET /api/auth/profile`
- `POST /api/auth/logout`
- `POST /api/users`
- `GET /api/configs`
- `GET /api/configs/:type`
- `PUT /api/configs/:type`

Successful login sets an HttpOnly `voiceauto_session` cookie.

## Configuration Storage

Configuration Center data is persisted in PostgreSQL, not browser `localStorage`.

- `config_type`: `langfuse`, `tapd`, `dingtalk`, `doubaoTts`, `minimax`, `server`
- `payload`: JSON object for the selected config type
- `updated_by`, `updated_at`, `version`: used by the UI for traceability

The frontend loads configs after login through `/api/configs`, keeps a runtime cache for active services, and writes changes back through `PUT /api/configs/:type`.

## Seed Defaults

Default DingTalk, TAPD, and Langfuse values live in:

```text
src/config/sensitiveDefaults.js
```

To seed those defaults into PostgreSQL:

```bash
node scripts/seedDefaultConfigs.js
```

Inside Docker:

```bash
docker exec voiceauto-web-api-test node scripts/seedDefaultConfigs.js
```

Do not print full secrets in logs or documentation. Use the Configuration Center to edit values.
