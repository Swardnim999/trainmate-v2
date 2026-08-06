# TrainMate v2 — Backend API

Express 5 + TypeScript (ESM, strict) backend for TrainMate v2.

**Sprint 1 scope:** backend foundation only — Docker dev stack, Zod env validation,
Pino logging, centralized error handling, health endpoint, CI, and the test
harness. No business logic, no auth, no database models, no Socket.IO, and no
endpoints beyond `GET /health` (the `authenticate` / `rate-limit` middleware are
inert Phase-3 stubs).

## Prerequisites

- Node.js ≥ 20 (LTS)
- npm ≥ 10 (this repo uses npm for the backend; the frontend uses bun)
- Docker Desktop (with WSL2 on Windows) — for the full stack

## Quickstart

```bash
cd backend

# 1. Start the infrastructure + API stack
docker compose up -d --build        # postgres, redis, minio, api

# 2. Local (host) dev — separate process, hot reload
cp .env.example .env                # first time only
npm install
npm run dev                         # http://localhost:3000

# 3. Health check
curl http://localhost:3000/health
# => {"status":"ok","service":"trainmate-api","version":"0.1.0","uptimeSeconds":N,"timestamp":"..."}
```

The `api` container and `npm run dev` serve the same app on the same port —
run one or the other, not both, unless you change `PORT`.

## Environment variables

Validated by Zod at startup (`src/config/env.ts`). Only variables the app
actually uses are validated; future-phase secrets (`JWT_SECRET`, `S3_*`, …)
appear in `.env.example` as commented placeholders and become active when the
phase that consumes them lands.

| Variable       | Default                 | Description                                                                                                                                                    |
| -------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | `development`           | `development` \| `test` \| `production`                                                                                                                        |
| `HOST`         | `0.0.0.0`               | Bind address                                                                                                                                                   |
| `PORT`         | `3000`                  | HTTP port                                                                                                                                                      |
| `LOG_LEVEL`    | `info`                  | pino level (`fatal`…`trace`, or `silent`)                                                                                                                      |
| `CORS_ORIGIN`  | `http://localhost:5173` | Comma-separated allowlist of origins                                                                                                                           |
| `DATABASE_URL` | —                       | `postgres://` or `postgresql://` URL. **Optional at runtime** in Sprint 1 (no DB access); required by `prisma generate` / `prisma migrate` and from Phase 2 on |

`.env` is gitignored; `.env.example` is committed. A misconfigured environment
fails fast at startup with a list of every offending variable.

## npm scripts

| Script                                  | Purpose                                 |
| --------------------------------------- | --------------------------------------- |
| `dev`                                   | `tsx watch` — hot-reload dev server     |
| `build`                                 | `tsc` → `dist/`                         |
| `start`                                 | Run compiled `dist/index.js`            |
| `typecheck`                             | `tsc --noEmit`                          |
| `lint` / `lint:fix`                     | ESLint (flat config, Prettier-aware)    |
| `format` / `format:check`               | Prettier                                |
| `test` / `test:watch` / `test:coverage` | Vitest                                  |
| `prisma:generate` / `prisma:validate`   | Prisma client generation / schema check |
| `db:up` / `db:down`                     | Postgres only via compose               |

## Project structure

```
backend/
  src/
    index.ts                    # HTTP server bootstrap + graceful shutdown
    app.ts                      # Express assembly (middleware → routes → 404 → errors)
    config/
      env.ts                    # Zod-validated environment
      constants.ts              # service name/version, body limit
    middleware/
      http-logger.ts            # request id + pino-http request logging
      error-handler.ts          # centralized error → locked envelope
      not-found.ts              # 404 handler
      authenticate.ts           # Phase-3 stub (always 401)
      rate-limit.ts             # Phase-3 stub (no-op)
    routes/
      health.routes.ts          # GET /health
    utils/
      logger.ts                 # pino instance (redaction, dev pretty-print)
      request-id.ts             # request id generation + header sanitization
      errors.ts                 # AppError / NotFoundError
    types/express.d.ts          # Request.id augmentation
    test/setup.ts               # Vitest setup (Phase-2 disposable-Postgres hook)
  test/                         # Vitest + Supertest suite
  prisma/schema.prisma          # datasource + generator only (models land Phase 2)
  Dockerfile  docker-compose.yml
  eslint.config.js  .prettierrc.json  tsconfig.json  vitest.config.ts
  .env.example  .gitignore  .dockerignore  .npmrc
```

## Conventions (locked in Sprint 1)

- **Error envelope** — every failure response is exactly
  `{ error: { code, message, details? } }`. Error codes are stable strings
  (`NOT_FOUND`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `VALIDATION_ERROR`, …).
  The request id is exposed via the `x-request-id` response header, not the
  body, so the envelope stays stable.
- **Errors** — signal expected failures with `AppError` (or `NotFoundError`).
  The centralized handler converts Zod errors → 400, body-parser errors → 400/413,
  everything unknown → 500. Stack traces never leave the process except in
  development.
- **Request ids** — every request gets a `x-request-id` (honors a sane inbound
  value). Correlate logs and responses by it.
- **Logging** — pino. JSON in non-dev, pretty in dev. Request logs emit method,
  path (no query string) and an allowlisted header subset — raw headers,
  `req.query`/`req.params` and response headers are never logged. Auth headers,
  cookies, passwords, tokens, emails are redacted at the logger.
- **Env** — every new variable is added to the Zod schema and `.env.example`.
- **Adding a route** — create `src/routes/*.routes.ts`, export a `Router`,
  mount it in `app.ts` before the 404 handler. Add a Supertest test.
- **Adding a service/repository** — plain modules under `src/services|repositories`;
  injected into route handlers. No global singletons.
- **Config in the backend** — `backend/.npmrc` pins `omit=` so devDependencies
  (the toolchain) are always installed regardless of a machine's global npm config.

## Docker

`docker compose up -d --build` runs four services:

| Service    | Image                                    | Ports                      | Notes                                       |
| ---------- | ---------------------------------------- | -------------------------- | ------------------------------------------- |
| `api`      | local build                              | 3000                       | Node 20 alpine, multi-stage                 |
| `postgres` | postgres:17-alpine                       | 5432                       | `trainmate` / `trainmate_dev` / `trainmate` |
| `redis`    | redis:7-alpine                           | 6379                       |                                             |
| `minio`    | minio/minio:RELEASE.2025-09-07T16-13-09Z | 9000 (S3) / 9001 (console) | `minioadmin` / `minioadmin`                 |

All data is persisted in named volumes. Every service has a healthcheck; the
`api` starts as soon as it is healthy (it connects to no infra service in
Sprint 1, so it has no `depends_on`). `docker compose --profile test up -d
testdb` starts the disposable test Postgres (port 5433) used by the Phase-2 test
harness.

## Testing

`npm test` runs the unit + integration suite (Vitest + Supertest). Tests are
isolated from any developer `.env` (`NODE_ENV=test`, `LOG_LEVEL=silent`). The
CI pipeline runs lint → format → typecheck → build → test → docker build →
`npm audit` on every push touching `backend/`.

See `DECISIONS.md` for the rationale behind every architectural choice.
