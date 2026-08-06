# Backend Architectural Decisions — Sprint 1

Every decision below is recorded with **context → decision → consequence**. These
are locked in Sprint 1 and, per D8 in `docs/Implementation-Roadmap.md`, changing
them requires a governance review.

---

## 1. Express 5 over Express 4

- **Context:** Roadmap Phase 1 targets Express + TypeScript. Express 5 is the
  current stable line in 2026 and the version new installs get by default.
- **Decision:** `express@^5`.
- **Consequence:** Async handler errors are forwarded to the error handler
  automatically (no wrapper middleware needed). `notFoundHandler` can simply
  `throw` and rely on Express 5 to route it to the centralized handler. No
  `*`/wildcard route syntax is used.

## 2. TypeScript, strict ESM (NodeNext + `verbatimModuleSyntax`)

- **Context:** The repo is frontend-TS; the backend must compile to plain Node
  ESM. Mixing module systems is the #1 source of "works on my machine".
- **Decision:** `"type": "module"`, `module`/`moduleResolution: NodeNext`,
  `verbatimModuleSyntax: true`, `isolatedModules: true`, full `strict` +
  `noUnused*`/`noImplicitReturns`/`noFallthroughCasesInSwitch`, relative imports
  use explicit `.js` extensions, `rootDir: src`, `outDir: dist`.
- **Consequence:** Type-only imports must use `import type`. Imports compiled
  by `tsc` are runnable by plain `node dist/index.js` with zero runtime module
  interop surprises. Vitest handles `.js`-suffixed TS imports transparently.

## 3. npm for the backend (bun for the frontend)

- **Context:** The frontend uses bun.lock; the roadmap asks for a standard,
  boring Node toolchain for the backend.
- **Decision:** npm (package-lock.json) for `backend/`. This is the safest
  default for a server (mature scripts, universal CI availability, npm11 in the
  Node24 install).
- **Consequence:** Two package managers coexist in the monorepo; each project
  owns its own lockfile and CI caches against the right one.

## 4. `backend/.npmrc` pins dev dependencies (`omit=`)

- **Context:** Some machines/environments inject a default `omit=dev`, which
  silently drops the toolchain (typescript, vitest, prisma, eslint, prettier)
  on `npm install`/`npm ci`. This machine had exactly that injection; a plain
  install left `node_modules` without dev deps while `package.json` still listed
  them.
- **Decision:** Commit `backend/.npmrc` with `omit=` (empty → omit nothing) so
  every install includes dev deps, for every developer and in CI. Note: npm
  prints a cosmetic `invalid config omit=""` warning for the empty value but
  honors it; a silent machine-dependent install is worse than the warning.
- **Consequence:** Deterministic installs across machines. A one-line warning
  in npm output; documented in the file itself.

## 5. Zod environment validation with "only validate what we use"

- **Context:** Roadmap: "env config validation (missing/invalid vars fail fast)".
  The spec's `env.ts` shows `JWT_SECRET, DATABASE_URL, S3_*` for later phases.
- **Decision:** Validate only the Sprint-1 foundation set (`NODE_ENV`, `HOST`,
  `PORT`, `LOG_LEVEL`, `CORS_ORIGIN`, optional `DATABASE_URL`) with a single
  `z.object` schema; export `loadEnv(source)` for testing plus an `env` singleton.
  Future-phase secrets stay as commented placeholders in `.env.example` and are
  validated by the phase that consumes them.
- **Consequence:** An invalid/missing variable fails startup with a descriptive
  error listing every offending var. No fake validation of unused secrets.

## 6. `DATABASE_URL` optional at runtime in Sprint 1

- **Context:** Sprint 1 opens no DB connection; nothing reads `DATABASE_URL` at
  runtime. Prisma's schema still references `env("DATABASE_URL")` at
  generate/migrate time.
- **Decision:** Zod validates `DATABASE_URL` _if present_ (scheme must be
  `postgres://` or `postgresql://`) but does not require it. A scheme regex is
  used instead of `z.string().url()`: the WHATWG URL parser accepts non-postgres
  schemes (http://, mysql://) and wrongly rejects valid libpq multi-host URLs.
  Required in `.env.example`/compose; becomes required at runtime from Phase 2.
- **Consequence:** `npm run dev` works without a running Postgres. The moment a
  phase connects to a DB, flipping the field to required is a one-line change.

## 7. Pino + pino-http structured logging

- **Context:** Roadmap: "request-ID + pino structured logging (headers redacted)".
- **Decision:** pino with a redact list covering `Authorization`, `Cookie`,
  `x-api-key` headers plus `password`/`token`/`secret`/`apiKey`/`email` fields
  anywhere in a log record (censor `[REDACTED]`). pino-http for request logging
  with `genReqId` honoring a sanitized inbound `x-request-id` and echoing it as a
  response header. Log levels: 5xx → `error`, 4xx → `warn`, else `info`.
  pino-pretty transport only when `NODE_ENV=development`. Request logs use a
  curated `req` serializer (method + path _without query string_ + an
  allowlisted header subset) and a `res` serializer (status only); pino-http
  inherits the parent's redact list rather than overriding it. Path redaction
  alone cannot censor a query-string secret (`/oauth/callback?code=...`) or an
  unlisted header name, so request logs simply never emit them.
- **Consequence:** Structured JSON logs in prod, readable dev output, and
  credentials never land in logs regardless of caller behavior.

## 8. Request-id sanitization

- **Context:** An inbound `x-request-id` is reflected into a response header and
  logs — a hostile value is a log-injection/header-injection vector.
- **Decision:** Accept only `[A-Za-z0-9._-]`, trimmed, ≤100 chars; anything else
  yields a fresh UUID. Exposed as `req.id` (typed via a global augmentation in
  `src/types/express.d.ts`) and the `x-request-id` response header.
- **Consequence:** Safe end-to-end correlation. Covered by unit + integration
  tests.

## 9. Locked error envelope + centralized handler

- **Context:** Roadmap: emit the locked `{ error: { code, message, details? } }`
  envelope; "a malformed request returns a consistent error envelope with a
  request ID".
- **Decision:** One `sendError` helper + one `errorHandler`. `AppError` carries
  `statusCode`/`code`/`details`; Zod → 400 `VALIDATION_ERROR`; body-parser
  failures → 400 `INVALID_JSON` / 413 `PAYLOAD_TOO_LARGE`; unknown → 500
  `INTERNAL_SERVER_ERROR` (stack trace only in development). The request id
  travels in the `x-request-id` header so the envelope shape never changes.
- **Consequence:** Every failure response is machine-parseable and consistent;
  interns never leak. The envelope is contract-locked for all future phases.

## 10. `authenticate` / `rate-limit` as inert stubs (not wired)

- **Context:** Roadmap Phase 1 lists "authenticate middleware skeleton (stubbed
  to 401 until Phase 3)" and a rate-limit skeleton. The Sprint-1 instruction
  says "do not implement authentication" and "no APIs except GET /health".
- **Decision:** Ship the two skeleton files (a 401-failing `authenticate`, a
  no-op `createRateLimiter`) as un-mounted modules, unit-tested directly. No
  protected route exists, so nothing wires them in.
- **Consequence:** The stubs document intent and satisfy the roadmap file tree
  without implementing auth, JWT, or any protected API in Sprint 1.

## 11. Prisma initialized with an empty schema

- **Context:** "Prisma initialized (no models)". No schema port until Phase 2.
- **Decision:** `prisma/schema.prisma` with `prisma-client-js` generator +
  postgresql datasource (`env("DATABASE_URL")`) and zero models. `prisma
generate` succeeds on this empty schema (verified). No `postinstall` script —
  the Docker build and CI run `npx prisma generate` explicitly, avoiding the
  classic @prisma/client postinstall chicken-and-egg.
- **Consequence:** Client generates today; models land in Phase 2 with `prisma
migrate`. The `package.json#prisma` key was deliberately omitted (deprecated
  in Prisma 6.19, removed in Prisma 7; the default schema path works).

## 12. Docker multi-stage build with full `node_modules` in runtime

- **Context:** Roadmap: "Docker images pinned to digest/version". The `api`
  image must build reliably on Windows + CI.
- **Decision:** Multi-stage `node:20-alpine`. Build stage copies `package*.json`,
  **`.npmrc`** (pins `omit=` so a build machine's injected `omit=dev` can't drop
  the toolchain) **and `prisma/` before** `npm ci` (so @prisma/client postinstall
  can generate against a present schema), sets a build-time `DATABASE_URL`, runs
  `npx prisma generate`, then `tsc`. Runtime stage copies the full `node_modules`
  (dev deps
  included) — `--omit=dev` would break @prisma/client's postinstall and prune
  the generated client. `openssl` installed in both stages (Prisma engines need
  it on alpine). Runs as non-root `USER node`.
- **Consequence:** Reliable, reproducible image. Larger than a production image —
  image pruning is deferred to a production-hardening pass (documented, not
  accidentally shipped). Image _versions_ are pinned; digest pinning is also
  deferred to hardening.

## 13. docker-compose v2 with health checks and a `testdb` profile

- **Context:** Roadmap: `api`, `postgres:17`, `minio`, `redis` + a `testdb`
  profile.
- **Decision:** Top-level `name: trainmate-backend`; services pin known-good
  tags (`postgres:17-alpine`, `redis:7-alpine`,
  `minio/minio:RELEASE.2025-09-07T16-13-09Z` — a pinned release, not a moving
  `:latest`). Each service has a real healthcheck. In Sprint 1 the `api` has
  **no** `depends_on`: it connects to no infra service yet, so a broken
  postgres/redis/minio must not hold up the API. Re-add
  `condition: service_healthy` entries when Phase 2 wires real connections.
  `testdb` (port 5433) is behind `profiles: ['test']` so it never starts by
  default. Named volumes persist data.
- **Consequence:** `docker compose up -d --build` boots the full stack; the
  `api` starts as soon as _it_ is healthy, regardless of infra state.

## 14. Graceful shutdown

- **Context:** Roadmap requires graceful shutdown; a restart must not drop
  in-flight requests.
- **Decision:** `SIGTERM`/`SIGINT` → `server.close()` → clean exit; a 10s
  force-exit timer (unref'd) prevents a hung shutdown. The force-exit timer
  exits **0** after `closeAllConnections()`: an operator-initiated drain that
  overruns its budget is a best-effort stop, not a crash — exit 1 would make
  k8s / Docker restart policies record a routine deploy as a failure.
  `unhandledRejection` / `uncaughtException` log `fatal` and exit 1 (crash-fast
  so the supervisor restarts a process in an unknown state).
- **Consequence:** Docker sends SIGTERM on `stop`; the container exits cleanly
  instead of being SIGKILLed after the compose stop-grace timeout.

## 15. Vitest + Supertest harness, isolated env

- **Context:** Roadmap: unit + integration tests; "missing/invalid vars fail
  fast"; a disposable test Postgres mechanism for Phase 2.
- **Decision:** Vitest (node env) with Supertest against `createApp()` — the app
  factory is side-effect-free so tests never bind a port. `vitest.config.ts`
  pins `NODE_ENV=test` + `LOG_LEVEL=silent` so the suite is immune to developer
  `.env`. `src/test/setup.ts` is a placeholder where Phase 2 will boot the
  disposable Postgres (`testdb` profile). Coverage via v8.
- **Consequence:** 26 tests green, hermetic, fast. DB-backed integration tests
  get a home in Phase 2.

## 16. CI pipeline at `.github/workflows/ci.yml`

- **Context:** Roadmap: "lint → typecheck → unit+integration tests → docker
  build" as a Phase-1 exit gate.
- **Decision:** GitHub Actions, paths-filtered to `backend/**` + the workflow
  file. Steps: `npm ci` → `prisma generate` → lint → format → typecheck →
  build → test → docker build → `npm audit --audit-level=high`. Node 20, npm
  cache on `backend/package-lock.json`. Env pinned (`NODE_ENV=test`, a
  `DATABASE_URL` for future generate steps).
- **Consequence:** A green CI is the Sprint-1 definition-of-done gate.

## 17. Deviations from the roadmap — and why

| Roadmap item                                       | Sprint 1 status     | Why                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/ready`                                | **Deferred**        | Needs DB reachability — out of scope ("no APIs except GET /health"); arrives with DB wiring in Phase 2                                                                                  |
| OpenAPI scaffolding (zod-to-openapi)               | **Deferred**        | Roadmap lists it, but the Sprint-1 instruction's explicit requirements list does not; adding a schema-definition dependency now is scope creep. Revisit when the first real route lands |
| Disposable-test-Postgres _bootstrap script_        | **Scaffolded only** | There are no migrations in Sprint 1 to run; the `testdb` compose service + `setup.ts` hook are in place, the migration runner arrives in Phase 2                                        |
| `utils/ids.ts`                                     | **Deferred**        | No business IDs exist yet; creating an unused module just to match a file tree is cruft                                                                                                 |
| Separate `utils/request-id.ts` + `utils/errors.ts` | **Kept**            | Matches the roadmap file tree and keeps concerns separable                                                                                                                              |

Every deferral is a **documented, reversible** choice, not an omission.
