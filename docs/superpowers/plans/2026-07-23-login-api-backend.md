# Login API Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real backend login API backed by PostgreSQL and route frontend authentication through it.

**Architecture:** Add a small Node HTTP server under `server/` that serves built frontend assets and exposes `/api/auth/login`, `/api/auth/profile`, `/api/auth/logout`, and config/log endpoints. The frontend auth store becomes an async API client with local fallback only when the API is unavailable.

**Tech Stack:** Node.js built-in HTTP/crypto/fs/path modules, `pg` PostgreSQL client, React/Vite frontend, PostgreSQL `voiceauto` database.

## Global Constraints

- Do not delete any existing server information.
- Use PostgreSQL for backend persistence.
- Passwords stored in PostgreSQL use the existing `sha256_salt_v1` salt + hash layout from `user_account`.
- Keep frontend local fallback for offline development only; production should use `/api/*`.

---

### Task 1: Backend Auth Service

**Files:**
- Create: `server/db.js`
- Create: `server/authRepository.js`
- Create: `server/app.js`
- Create: `server/index.js`
- Test: `tests/backendAuth.test.mjs`

**Interfaces:**
- Produces: `createApp({ pool, sessionStore })`, `authenticateUser(pool, loginAccount, password)`
- Produces HTTP JSON endpoints: `POST /api/auth/login`, `GET /api/auth/profile`, `POST /api/auth/logout`

- [x] Write failing backend auth API test.
- [x] Run `node tests/backendAuth.test.mjs` and confirm login route missing/failing.
- [x] Implement minimal Node HTTP app and auth repository.
- [x] Run backend auth test and confirm pass.

### Task 2: Frontend Auth API Client

**Files:**
- Modify: `src/modules/config/authStore.js`
- Modify: `src/components/AuthGate.jsx`
- Test: `tests/authStore.test.mjs`

**Interfaces:**
- Consumes: backend `/api/auth/login`, `/api/auth/profile`, `/api/auth/logout`
- Produces: `authenticateUser(loginAccount, password)` as async result and `getCurrentUser()` as async result when API is reachable.

- [x] Write failing frontend auth test for API-backed login.
- [x] Implement API-first auth methods with local fallback.
- [x] Update `AuthGate` for async profile/login/logout.
- [x] Run auth tests and build.

### Task 3: Deployment Wiring

**Files:**
- Modify: `package.json`
- Modify: `deploy/docker/Dockerfile`
- Modify: `.env.example`
- Create: `server/README.md`

**Interfaces:**
- Produces runtime command `npm start`.
- Produces env vars `DATABASE_URL`, `SESSION_SECRET`, `PORT`.

- [x] Add `pg` dependency and server start scripts.
- [x] Update Docker image to run Node server with built assets instead of nginx-only static hosting.
- [x] Document PostgreSQL environment variables and deploy notes.
- [x] Run tests and production build.
