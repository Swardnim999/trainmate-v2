# TrainMate v2 — Backend Implementation Roadmap

**Master execution plan: Supabase → self-hosted Node.js / Express / PostgreSQL / Prisma / JWT / Socket.IO**

| | |
| --- | --- |
| **Status** | Draft for review — prepared for execution sign-off |
| **Date** | 2026-08-06 |
| **Owner** | Lead Backend Engineer / Technical Architect |
| **Inputs (source of truth)** | `docs/Backend-Specification.md` (the contract — read first), `docs/Backend-Architecture.md` |
| **Scope** | Full backend migration; **no frontend behavior change**; Supabase remains live until Phase 14 |

> **How to read this document.** The Backend Specification is the source of truth for
> *what* the system does (schema §3, RLS §6, business rules §9, endpoints §10, call
> sites §11, realtime §8, storage §7). This roadmap is the *when, why, and how* of
> building it. Every `§X` cross-reference points at `docs/Backend-Specification.md`.
> The roadmap is deliberately exhaustive: each phase lists goal, rationale, dependencies,
> deliverables, files, APIs, DB work, security work, testing, manual checks, DoD,
> complexity, risks, rollback, and a git milestone — so a new engineer can execute a
> phase without re-deriving anything.

---

## Table of contents

- [Executive summary](#executive-summary)
  - [What we are building](#what-we-are-building)
  - [Phase summary](#phase-summary)
  - [Why this order (and where it deviates from the example list)](#why-this-order-and-where-it-deviates-from-the-example-list)
  - [Key architectural decisions](#key-architectural-decisions)
- [Part I — The authorization map (RLS → service layer)](#part-i--the-authorization-map-rls--service-layer)
- [Part II — The phases](#part-ii--the-phases)
  - [Phase 1 — Backend Foundation & Developer Experience](#phase-1--backend-foundation--developer-experience)
  - [Phase 2 — Database Schema Port (Prisma + data migration)](#phase-2--database-schema-port-prisma--data-migration)
  - [Phase 3 — Authentication & Session Management](#phase-3--authentication--session-management)
  - [Phase 4 — Storage Foundation (S3-compatible + presigned URLs)](#phase-4--storage-foundation-s3-compatible--presigned-urls)
  - [Phase 5 — Moderation: Blocking & Reporting](#phase-5--moderation-blocking--reporting)
  - [Phase 6 — Profiles](#phase-6--profiles)
  - [Phase 7 — Journeys & Train Directory](#phase-7--journeys--train-directory)
  - [Phase 8 — Companion Matching](#phase-8--companion-matching)
  - [Phase 9 — Requests Lifecycle](#phase-9--requests-lifecycle)
  - [Phase 10 — Conversations & Soft Delete](#phase-10--conversations--soft-delete)
  - [Phase 11 — Messages, Read Receipts & Attachments](#phase-11--messages-read-receipts--attachments)
  - [Phase 12 — Realtime (Socket.IO)](#phase-12--realtime-socketio)
  - [Phase 13 — Frontend Adapter & Integration](#phase-13--frontend-adapter--integration)
  - [Phase 14 — Cutover, Deployment & Rollback](#phase-14--cutover-deployment--rollback)
- [Part III — After the roadmap](#part-iii--after-the-roadmap)
  - [1. Total estimated project complexity](#1-total-estimated-project-complexity)
  - [2. Biggest technical risks](#2-biggest-technical-risks)
  - [3. Critical migration points](#3-critical-migration-points)
  - [4. Features that should NEVER be implemented until the migration is complete](#4-features-that-should-never-be-implemented-until-the-migration-is-complete)
  - [5. Nice-to-have improvements after the migration](#5-nice-to-have-improvements-after-the-migration)
  - [6. Recommended production deployment architecture](#6-recommended-production-deployment-architecture)
  - [7. Long-term scalability recommendations](#7-long-term-scalability-recommendations)
- [Appendices](#appendices)
  - [A. Endpoint → phase traceability](#a-endpoint--phase-traceability)
  - [B. Frontend call-site coverage](#b-frontend-call-site-coverage)
  - [C. Environment matrix](#c-environment-matrix)
  - [D. Governance & phase-exit criteria](#d-governance--phase-exit-criteria)

---

# Executive summary

## What we are building

TrainMate v2 currently runs entirely on **Supabase** — the React frontend talks directly
to PostgREST (data), GoTrue (auth), Realtime (websockets), and Storage (signed URLs),
with **zero custom server code**. Authorization is 100% database-enforced via **RLS**.

We are replacing that with a **self-hosted Node.js + Express (TypeScript) backend** on
**PostgreSQL + Prisma**, **JWT access + rotating refresh tokens**, **Socket.IO** for
realtime, and **S3-compatible object storage**, running in **Docker**. The frontend stays
byte-for-byte behaviorally identical; the data layer behind it changes.

The migration has **four non-negotiable guarantees** (from the spec's §12.1):
1. **Frontend frozen** until Phase 13 — every backend phase ships with zero `src/` changes.
2. **Schema is the contract** — a 1:1 port of the current schema (§3); no business-rule changes.
3. **RLS → explicit service-layer enforcement** — every policy in §6 becomes a tested check in code. Prisma does **not** enforce row security.
4. **Behavior preserved, including quirks** — no optimistic message insert, sender echo, client-computed unread counts, private-bucket signed-URL model, signup-without-email-hint UX, the dead `requests-changes` subscription (fixed only by deliberate, reversible decision).

The single most important security artifact of this project is the **authorization map** in
[Part I](#part-i--the-authorization-map-rls--service-layer) — every RLS policy, helper
function, storage policy, and realtime policy, mapped to the service check that replaces
it, the phase that lands it, and the test that proves it. **Do not start Phase 6 before
that map is signed off.**

## Phase summary

| # | Phase | Complexity | Est. effort (senior eng-days) | Depends on | Git milestone (tag) |
| --- | --- | --- | --- | --- | --- |
| 1 | Backend Foundation & Developer Experience | Medium | 6 | — | `phase-1-foundation` |
| 2 | Database Schema Port (Prisma + data migration) | High | 10 | 1 | `phase-2-schema-port` |
| 3 | Authentication & Session Management | High | 12 | 2 | `phase-3-auth` |
| 4 | Storage Foundation (S3-compatible + presigned URLs) | Medium | 5 | 1 | `phase-4-storage` |
| 5 | Moderation: Blocking & Reporting | Medium | 4 | 3 | `phase-5-moderation` |
| 6 | Profiles | Medium | 7 | 3, 4, 5 | `phase-6-profiles` |
| 7 | Journeys & Train Directory | Medium | 7 | 3, 5 | `phase-7-journeys` |
| 8 | Companion Matching | High | 7 | 7, 5 | `phase-8-matching` |
| 9 | Requests Lifecycle | High | 9 | 8, 5 | `phase-9-requests` |
| 10 | Conversations & Soft Delete | High | 9 | 9, 5 | `phase-10-conversations` |
| 11 | Messages, Read Receipts & Attachments | High | 11 | 10, 4, 5 | `phase-11-messages` |
| 12 | Realtime (Socket.IO) | High | 12 | 11, 10, 3 | `phase-12-realtime` |
| 13 | Frontend Adapter & Integration | High | 12 | 1–12 | `phase-13-adapter` |
| 14 | Cutover, Deployment & Rollback | High (ops) | 8 | 13 | `phase-14-cutover` |
| | **Total** | | **≈ 119 eng-days (≈ 24 engineer-weeks)** | | |

Calendar view: with **two** engineers (one on the critical path, one picking up
parallelizable work such as Phases 4/5/7 while 2/3/6 are in flight), expect **≈ 12–16
calendar weeks** including buffers and the Phase 14 rehearsals. One engineer alone: **≈
5–6 months**. Estimates are nominal for a senior engineer familiar with the stack; add
20–30% for a team learning Prisma/Express/Socket.IO.

## Why this order (and where it deviates from the example list)

The suggested order (Foundation → Auth → Profiles → Journeys → Matching → Requests →
Conversations → Messages → Attachments → Realtime → Notifications → Deployment) is sound.
This roadmap keeps its backbone but reorders for **dependency-first execution**, where
each phase is independently shippable and de-risks the next. Deviations, and why:

1. **A dedicated Database Schema Port phase (#2) comes immediately after Foundation.**
   The schema is the contract and everything else reads/writes it. Porting the *whole*
   schema up-front forces every hard decision (uuid[]→Prisma, jsonb, GIN, triggers,
   views, replica identity, legacy URL backfill) while nothing else is in flight, and
   gives every later phase a stable, migrated, seeded test database. Do not interleave
   schema with features.

2. **A Storage Foundation phase (#4) is pulled in early, before Profiles.**
   The example list buried "Attachments" at #9. But *profiles* upload avatars through
   storage today (§11.3), so Profiles (#6) already needs storage. Pulling an
   S3-compatible + presigned-URL foundation forward (right after Foundation/Auth)
   means neither Profiles nor Messages stubs anything, and the bucket/URL model is
   proven before either depends on it.

3. **A Moderation phase (#5) is added.**
   `is_blocked` is a **cross-cutting dependency** of the RLS port — it gates profiles,
   journeys, matching, requests, conversations, and messages (§6.12). The example list
   had no Moderation phase. Landing `blocked_users` + `user_reports` + the symmetric
   `isBlocked()` service function early means every later phase can assert blocking
   behavior in its own tests instead of papering over it.

4. **"Matching" stays a distinct phase (#8) but is placed as the read-side of journeys.**
   In TrainMate, matching is *not* a separate subsystem — it is the companions query
   (`GET /journeys/:train/:date/companions`) plus the `can_view_journey` /
   `users_share_journey` / `is_blocked` visibility arms. It is kept as its own phase
   because it is the product's core value and the trickiest authorization surface, and
   it must land before Requests (which depends on `users_share_journey`).

5. **"Attachments" is folded into Messages (#11).**
   Attachment data lives in the `messages` row (`attachment_*` columns, §3.2), and the
   frontend's single send-message call carries attachment fields (§11.5/#31). A separate
   Attachments phase would force a stubbed endpoint. The *infrastructure* (buckets,
   presign, key validation, signed-URL serialization) is already Phase 4; Phase 11 wires
   it into messages.

6. **"Notifications" is explicitly NOT a phase.**
   TrainMate has **no push-notification system today**. The only "notification" surface
   is the pending-request **count badge** on the Dashboard (§11.9/#48), which is a REST
   read and is covered by the Requests phase (#9). Push notifications are infra-heavy
   and belong **after** the migration — see [§4](#4-features-that-should-never-be-implemented-until-the-migration-is-complete).

7. **Adapter (#13) and Cutover (#14) are explicit final phases.**
   The example list ended at Deployment. Because the frontend contract is the whole
   game, the adapter swap and the production cutover deserve their own focused,
   reversible milestones (this matches the spec's §12.2 Phases F–G).

8. **Read-receipts, unread counts, and last_read live inside Messages (#11), not Realtime.**
   They are DB reads/writes; Realtime (#12) then *emits* the events those writes produce.

The dependency spine is: `1 → 2 → 3 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14`,
with **4** running alongside 3, and 5 alongside 4.

## Key architectural decisions

These decisions are locked **here** (and re-stated in their phases) so the execution
never re-litigates them.

### D1 — Authorization is a service layer, not RLS
The target Postgres is reached by a single application role. Every RLS policy (§6) is
ported to an explicit check in a `services/access.*` module or a route guard. The
DB-level `prevent_conversation_tamper` trigger and `updated_at` triggers are **kept as
defense-in-depth** (they are auth-independent and cheap). Prisma is used purely as a data
access layer. **The authorization map (Part I) is the single source of truth for what
must be enforced; the per-policy tests are the proof.**

### D2 — Storage: AWS S3 (or Cloudflare R2) + MinIO for dev — NOT Cloudinary
**Recommendation: S3-compatible object storage.** Rationale:
- **Object-key model ports 1:1.** The current buckets and key conventions
  (`avatars/<user_id>/avatar.<ext>`, `chat-attachments/<conversation_id>/<uuid>.<ext>`,
  §7.1) map directly to S3 object keys with zero transform.
- **Presigned-URL model mirrors Supabase Storage exactly.** Supabase Storage *is* S3
  underneath; the signed-URL flow the frontend uses (§7.3) ports mechanically to S3
  presigning, and the bucket-level authorization checks become the same visibility
  functions the REST layer already uses (§7.2).
- **Arbitrary attachment types.** Chat attachments include PDF/DOC/DOCX/TXT (§9.6).
  Cloudinary is image/video-centric: non-image uploads are second-class, transform-based
  pricing is a bad fit, and it would change URL semantics. S3 treats every object as a
  byte blob.
- **No re-encoding pipeline needed.** Avatars are already cropped client-side to 256×256
  JPEG (§7.3); there is no on-the-fly transform requirement.
- **Operational continuity.** MinIO in Docker gives local/dev parity; Cloudflare R2 is
  an egress-free S3-compatible fallback for production cost control; either can be
  swapped via env config behind one `s3` abstraction (Phase 4).
- **Lock-in.** S3 API is the de-facto standard; moving between MinIO/R2/S3 is a config
  change, not a rewrite.

### D3 — Signed URLs: store the object *path*, sign at serialization time
Supabase currently stores **1-year signed URLs** in `avatar_url` / `attachment_url`
(§7.1, §7.3). S3 presigned URLs max out at ~7 days, so this model does not port. The
behavior-preserving choice (§7.4): the DB stores the **object path**; the API returns a
**freshly-signed short-lived GET URL** whenever it serializes a profile or message. This
keeps the frontend's `src={url}` contract working, removes permanent tokens, and forces
an authorization check on every read. The cache-buster quirk (§7.3/§13.6) is preserved
or deliberately fixed at the adapter layer — **not** in the frontend. Legacy
Supabase-signed URLs in existing rows are rewritten to paths during the Phase 2 data
migration (see Critical migration point #3).

### D4 — Redis: yes, but as a scalability layer, not a core dependency
Redis ships in the dev compose from Phase 1 and is consumed by: (a) the **Socket.IO
Redis adapter** (Phase 12) so multiple API instances share rooms/presence, and
(b) **distributed rate limiting** (Phase 3, with in-memory fallback for single-instance
dev). The core must run without Redis (single instance, in-memory stores); Redis is an
opt-in via env. The spec's `refresh_tokens` are stored in **Postgres** (auditable,
durable, rotation-safe), not Redis.

### D5 — Frontend integration: typed API client + surgical hook rewrites (recommended), not a monolithic shim
The spec's §12.2 Phase F offers "a thin `api` client wrapping fetch/websockets, **or** a
drop-in shim implementing the same method signatures" (i.e., re-implementing the
PostgREST fluent builder + Supabase Realtime channel API). **Recommendation:** a **typed
API client** (`src/lib/api/`) with explicit endpoint functions, plus **mechanical
rewrites of the 9–10 hook files**, feature-flagged per page. Justification:
- Re-implementing PostgREST's fluent chain and Realtime's channel API in a shim is a
  large, subtle, untyped surface — the highest-risk way to preserve behavior.
- Typed functions are testable, grep-able, and comprehensible to a new engineer — the
  exact maintainability goal of this project.
- Each hook rewrite is mechanical and covered by the adapter **contract suite** (§11),
  so parity is proven, not assumed.
The swap happens **once**, in Phase 13, behind a flag, with an A/B smoke test and a
one-line rollback.

### D6 — Identity continuity is non-negotiable
`user.id` stays the **same UUID** as today's `auth.users.id`. Existing **bcrypt**
password hashes and `email_confirmed_at` are carried over so no user must re-register or
re-confirm. See Critical migration points #1–#2.

### D7 — Monorepo layout
The new backend lives at the repo root in **`backend/`** (the frontend stays at root).
This matches the spec's planned structure (§2.2), keeps one repo/one CI, and lets Phase
13 land in the same PR train. A future split into `apps/frontend` / `apps/backend` is a
post-migration refactor.

### D8 — Conventions locked in Phase 1
- **Language/runtime:** TypeScript, strict, **ESM**, Node ≥ 20 LTS.
- **HTTP:** Express. **Validation:** Zod (body/query/params on every route).
- **Errors:** single `ErrorResponse` envelope `{ error: { code, message, details? } }`
  with stable codes; **no stack traces** outside dev; request IDs on every response.
- **Logging:** pino, structured JSON, request-ID correlation, header redaction.
- **Docs:** OpenAPI generated from code (zod-to-openapi) — "API documented" in every DoD.
- **Tests:** Vitest + Supertest for integration, disposable Postgres per run; Playwright
  for Phase 13 E2E; k6 for Phase 14 load.
- **Secrets:** `.env` never committed; `JWT_SECRET`, `DATABASE_URL`, storage keys,
  email keys via environment (secrets manager in prod).

---

# Part I — The authorization map (RLS → service layer)

This is the **guarantee table**. Every security guarantee currently provided by RLS
must survive the migration. Each row states the current enforcement, the target
enforcement, the phase that lands it, and the test that proves it. **Part I must be
reviewed and signed off before Phase 6 starts.** It is the checklist for Phase 14's
"security verified" exit.

## A. Table policies (§6.1–§6.10)

| § | Table | Current RLS policy | Target service check | Phase | Verification test |
| --- | --- | --- | --- | --- | --- |
| 6.1 | `profiles` | SELECT `can_view_profile(id)` | `canViewProfile(requester, targetId)` — owner OR (not blocked AND (shared journey OR accepted request OR shared conversation)) | 6 | Truth-table unit test; integration 404-on-blocked |
| 6.1 | `profiles` | INSERT own | Route forces `req.user.id` as row id | 6 | Integration (id tamper → 400) |
| 6.1 | `profiles` | UPDATE own | Route checks `req.user.id === :id` | 6 | Integration (update other → 404) |
| 6.1 | `profiles` | DELETE own | Service capability; frontend never calls it — implement + test anyway (low priority, owner-only) | 6 | Integration |
| 6.2 | `journeys` | SELECT own OR (`can_view_journey` AND NOT blocked) | `canViewJourney(user, train, date)` + `isBlocked` filter; owner short-circuit | 7, 8 | Unit `canViewJourney`; integration cross-user visibility |
| 6.2 | `journeys` | INSERT own | Route forces `user_id = req.user.id` | 7 | Integration |
| 6.2 | `journeys` | UPDATE own | Frontend never updates journeys — implement owner-only guard anyway | 7 | Integration |
| 6.2 | `journeys` | DELETE own | Route checks ownership | 7 | Integration |
| 6.3 | `requests` | SELECT sent/received AND NOT blocked | Query filters `from/to = me` AND excludes blocked pairs (symmetric) | 9 | Integration (blocked pair hidden) |
| 6.3 | `requests` | INSERT `from=me AND from≠to AND NOT blocked AND users_share_journey` | `usersShareJourney(a,b,train,date)` + `isBlocked` + sender check | 9 | Integration (blocked / no shared journey → 403) |
| 6.3 | `requests` | UPDATE `to_user_id = auth.uid()` | Route checks `req.user.id === to_user_id` (accept/reject) | 9 | Integration (sender cannot accept) |
| 6.3 | `requests` | DELETE `from=me AND status='pending'` | Route checks sender + pending | 9 | Integration (cancel after accept → 403) |
| 6.4 | `conversations` | SELECT participant AND NOT in `deleted_for` | `isConversationParticipant(conv, me)` AND `me ∉ deleted_for` | 10 | Integration |
| 6.4 | `conversations` | INSERT `can_create_conversation(...)` | `canCreateConversation(participants, train, date)` — exactly 2, caller included, not blocked, accepted request exists | 10 | Truth-table unit test + integration |
| 6.4 | `conversations` | UPDATE participant, **column-restricted** | Service allows only `last_message/last_message_time/deleted_for`; **tamper trigger kept in DB** | 10, 11 | Integration + DB-trigger test |
| 6.5 | `messages` | SELECT participant | `isConversationParticipant` on read | 11 | Integration |
| 6.5 | `messages` | INSERT sender + participant + NOT `is_blocked_in_conversation` | `isBlockedInConversation(conv, me)` (any *other* participant blocked either direction) + sender check | 11 | Unit + integration |
| 6.6 | `last_read` | SELECT/INSERT/UPDATE own | Route forces `user_id = req.user.id` | 11 | Integration |
| 6.7 | `blocked_users` | SELECT/INSERT/DELETE `blocker_id = auth.uid()` | Route forces `blocker_id = req.user.id`; self-block rejected | 5 | Integration |
| 6.8 | `user_reports` | INSERT `reporter_id = auth.uid()`; SELECT own | Route forces `reporter_id = req.user.id`; no list surface in scope | 5 | Integration |
| 6.9 | `trains` | SELECT all authenticated | Route behind `authenticate` middleware only | 7 | Integration (401 unauthenticated) |
| 6.10 | `unverified_trains` | INSERT/SELECT own | Route forces `submitted_by = req.user.id` | 7 | Integration |

## B. Helper functions (§3.3) → service functions

| DB function | Target service function | Home phase | Notes |
| --- | --- | --- | --- |
| `is_blocked(a,b)` | `isBlocked(a, b)` | 5 | **Symmetric** (either direction). Lives in `services/access.service.ts`. |
| `can_view_profile(id)` | `canViewProfile(requester, id)` | 6 | Composes `isBlocked`, shared journey, accepted request, shared conversation. |
| `can_view_journey(train, date)` | `canViewJourney(user, train, date)` | 7 | Caller has a journey on that train+date. |
| `users_share_journey(a,b,train,date)` | `usersShareJourney(a,b,train,date)` | 8 | Used by requests (9). |
| `is_conversation_participant(conv)` | `isConversationParticipant(conv, user)` | 10 | Also used by storage (4) + messages (11). |
| `is_blocked_in_conversation(conv, uid)` | `isBlockedInConversation(conv, user)` | 11 | Any other participant blocked. |
| `can_create_conversation(parts, train, date)` | `canCreateConversation(...)` | 10 | Full §9.5 guard. |
| `soft_delete_conversation(conv, uid)` | `softDeleteConversation(conv, me)` (route) | 10 | The only path that mutates `deleted_for`. |
| `handle_new_user` (trigger) | `onUserCreated` DB trigger (kept) + service fallback | 2, 3 | Preserves "a profile row always exists". |
| `update_updated_at_column` (trigger) | kept as DB triggers | 2 | Defense-in-depth; app also sets timestamps. |
| `prevent_conversation_tamper` (trigger) | kept as DB trigger + service guard | 2, 10 | Auth-independent; reworked to not reference `auth.uid()`/RLS. |

## C. Storage policies (§7.2) → presign authorization

| Bucket | Current policy | Target enforcement | Phase |
| --- | --- | --- | --- |
| `avatars` | SELECT owner OR `can_view_profile(firstSegment)` | Presigned GET issued only after `canViewProfile`; presigned PUT only to `me/avatar.<ext>` | 4 (+6) |
| `avatars` | INSERT/UPDATE/DELETE owner | PUT URL scoped to owner path; delete/overwrite allowed for owner only | 4 |
| `chat-attachments` | SELECT participant; INSERT/UPDATE owner+participant; DELETE owner | Presigned PUT only for a conversation the user participates in; GET only for participants; **key validation** (no traversal / cross-tenant) | 4 (+11) |

## D. Realtime policies (§8.3) → Socket.IO enforcement

| Supabase policy | Target Socket.IO enforcement | Phase |
| --- | --- | --- |
| `messages-%` topic participant check | Room `conv:<cid>` — server emits `message:new` only to verified participants; **never trusts client-reported membership** | 12 |
| `last-read-%` topic participant check | Room `conv:<cid>` — emits `last-read:update` only to participants | 12 |
| `conversations-updates-<uid>` | Room `user:<uid>` — emits `conversation:updated` only to the affected user | 12 |
| presence/broadcast | **NOT gated by the realtime.messages policy** (different Realtime primitive); any authenticated user may join `presence-<cid>` and channel names leak conversation UUIDs. **Phase 12 must enforce participant checks on Socket.IO room join for presence/typing + typing rate-limiting.** | 12 |

## E. Security invariants (§6.12) — tracked to completion

| # | Invariant | Enforced in | Proved by |
| --- | --- | --- | --- |
| 1 | **Email is private**; `GET /profiles/:id` never returns another user's email. **Deployed reality (Supabase):** migration `20260725073436` blanket `GRANT SELECT ON ALL TABLES` overrides the column-level `REVOKE SELECT (email)` from `20260703100726`; RLS filters rows not columns; `profiles_safe` view is unused by frontend. The new backend serializer **must** never return another user's email. A parity test asserting email-absent **will fail against Supabase** — this is expected asymmetry, not a bug. | Phase 6 serializer | Serializer test (no `email` key) + documented Supabase asymmetry |
| 2 | Requests hide blocked pairs | Phase 9 query | Integration test |
| 3 | Conversation creation gated on accepted request + not blocked | Phase 10 `canCreateConversation` | Truth-table + integration |
| 4 | Conversation rows immutable except `last_message/last_message_time/deleted_for`; `deleted_for` only via soft-delete | Phase 10 service + Phase 2 trigger | Service + trigger tests |
| 5 | Messages require participant + not blocked-in-conversation | Phase 11 | Unit + integration |
| 6 | Avatars/attachments readable only by authorized viewers | Phase 4 + serializers | Presign/GET 403 tests |

---

# Part II — The phases

> **Phase template.** Each phase is self-contained. "API documented" in the closing
> checklist means the OpenAPI spec and any schema/`prisma/schema.prisma` diffs are
> reviewed. "No frontend changes required" is deliberately **true for Phases 1–12**; it
> is re-worded for Phase 13 (the one deliberate frontend change) and Phase 14 (ops).

---

## Phase 1 — Backend Foundation & Developer Experience

**Estimated complexity:** Medium

### 1. Goal
Stand up the self-hosted backend workspace: repo layout, TypeScript/Node tooling, the
Docker dev environment (Postgres 17, MinIO, Redis), env validation, the Express request
pipeline skeleton, logging, error handling, health checks, CI, and the test harness every
later phase builds on. A new engineer must be productive in an afternoon.

### 2. Why this phase comes now
Nothing can be built until there is a place to run it, a place to test it, and a pipeline
to ship it. This phase resolves the team's biggest "unknowns" — can everyone run the
full stack locally on day one, and are the conventions (envelope, errors, logging,
tests) locked — before any business logic exists. Every subsequent phase's integration
tests depend on the harness created here.

### 3. Dependencies
- None (repo already contains frontend + `docs/`, git repo on `main`).
- Requires Docker Desktop / WSL2 on developer machines (Windows environment).

### 4. Deliverables
- `backend/` TypeScript **ESM**, strict-mode Node ≥ 20 LTS + Express project scaffold.
- `backend/docker-compose.yml` — `api`, `postgres:17`, `minio`, `redis` (+ a `testdb`
  profile for the disposable test Postgres).
- `backend/.env.example` (see Appendix C) + Zod-validated env config (`src/config/env.ts`).
- Express app assembly: helmet, CORS (locked to the frontend origin), JSON body parsing
  with size caps, compression, request-ID + pino structured logging (headers redacted),
  health routes, 404 handler, centralized error handler emitting the locked
  `{ error: { code, message, details? } }` envelope.
- `authenticate` middleware skeleton (verifies JWT → `req.user`; stubbed to 401 until
  Phase 3), rate-limit middleware skeleton (wired fully in Phase 3).
- Test harness: Vitest + Supertest + a script that brings up a disposable Postgres,
  runs migrations, and drops it.
- CI pipeline (GitHub Actions): lint → typecheck → unit+integration tests → docker build.
- npm scripts + README (how to run, env vars, conventions, how to add a route/service/repo).
- OpenAPI scaffolding (zod-to-openapi) with the health routes.

### 5. Files/Folders expected
```
backend/
  Dockerfile  docker-compose.yml  .env.example  .dockerignore
  package.json  tsconfig.json  eslint.config.js  vitest.config.ts  README.md
  prisma/                       # (initialized here; schema lands Phase 2)
  src/
    index.ts                    # HTTP server + (Phase 12) Socket.IO server + start
    app.ts                      # Express assembly + middleware + routes + error handler
    config/env.ts               # Zod env validation
    middleware/authenticate.ts  rate-limit.ts  error-handler.ts  not-found.ts
    routes/health.routes.ts
    utils/logger.ts  request-id.ts  errors.ts  ids.ts
    test/setup.ts               # disposable-Postgres bootstrap
.github/workflows/ci.yml
```

### 6. APIs to implement
- `GET /health` — liveness (process up).
- `GET /health/ready` — readiness (DB reachable; storage/redis reported but non-fatal).
No business endpoints yet.

### 7. Database work
- None beyond the compose Postgres container (user/password/db via init script). The
  schema port is Phase 2. The disposable-test-Postgres mechanism is set up here.

### 8. Security work
- Helmet security headers; CORS allowlist (not `*`); body-size caps.
- Error handler never leaks stack traces/internals outside dev; request IDs for correlation.
- pino redaction of `Authorization`, cookie, and password fields.
- `.env` gitignored; `.env.example` committed; Docker images pinned to digest/version.
- `npm audit` in CI; dependency lockfile committed.

### 9. Testing strategy
- Unit: env config validation (missing/invalid vars fail fast), error handler shape,
  request-ID middleware.
- Integration: `GET /health` 200; unknown route → 404 envelope; protected route without
  token → 401 envelope; malformed JSON → 400 envelope.
- CI runs the full suite on every push; a green CI is a Phase 1 exit gate.

### 10. Manual verification checklist
- [ ] `docker compose up -d` → `api`, `postgres`, `minio`, `redis` all healthy.
- [ ] `npm run dev` starts the API; `curl /health` and `/health/ready` return 200.
- [ ] An unauthenticated request to a protected stub route returns the locked 401 envelope.
- [ ] A malformed request returns a consistent error envelope with a request ID.
- [ ] CI is green on a fresh branch; `npm audit` has no high-severity findings.

### 11. Definition of Done
- A new engineer can clone, `docker compose up -d`, `npm install`, `npm run dev`, hit a
  healthy API, and run the test suite in under 15 minutes (guided by README).
- Lint/typecheck/tests green in CI; docker build succeeds.
- Error envelope, logging, env, and test conventions are locked and documented.

### 12. Estimated complexity
**Medium** (tooling, not logic). Risk of bikeshedding — timebox convention decisions.

### 13. Risks
- **Docker platform quirks** on Windows (WSL2, port conflicts) → documented setup +
  compose profiles; timebox.
- **ARM/M1 image availability** for postgres:17/minio/redis — all supported; pin known-good tags.
- **Envelope/convention churn** if not locked early → D8 in this phase; revisit only via governance (Appendix D).
- **CI flakiness** from the disposable DB → retry policy + health-wait in the bootstrap script.

### 14. Rollback strategy
None needed — greenfield scaffolding; nothing in production. If the approach fails, delete
`backend/`; frontend + Supabase are untouched.

### 15. Git commit milestone
`feat(backend): foundation scaffold — docker, env config, express pipeline, ci, test harness`
(tag `phase-1-foundation`)

### Phase 1 exit checklist
- [x] Project builds (`npm run build` + docker build green)
- [x] Tests pass (unit + integration in CI)
- [x] API documented (OpenAPI has health routes)
- [x] No frontend changes required
- [x] Security verified (headers, CORS, error envelope, secret hygiene)
- [x] Ready to merge

---

## Phase 2 — Database Schema Port (Prisma + data migration)

**Estimated complexity:** High

### 1. Goal
Create the **Prisma schema + migrations** that are a 1:1 port of the current Postgres
schema (§3), add the new identity/auth tables (`users`, `refresh_tokens`,
`email_verifications`), seed `trains`, and build the **data export/import tooling** that
moves production data with **UUIDs and password hashes preserved**. Everything
downstream reads and writes this database.

### 2. Why this phase comes now
The schema is the contract (§12.1). It is the one deliverable every other phase depends
on, and it forces the hardest data-model decisions (uuid[]→Prisma, jsonb, GIN indexes,
triggers, views, replica identity, legacy URL backfill) **while nothing else is in
flight**. Doing the whole port up-front also proves the *data-migration path* (export →
import → verify) before any code depends on it — the single biggest cutover risk.

### 3. Dependencies
- Phase 1 (compose Postgres, test harness, CI).

### 4. Deliverables
- **`prisma/schema.prisma`** porting all 10 public tables + `users`, `refresh_tokens`,
  `email_verifications`:
  - `users` — `id uuid PK`, `email text unique not null`, `password_hash text not null`,
    `email_confirmed_at timestamptz null`, `created_at`, `updated_at` (maps `auth.users`;
    drops `user_metadata`/`app_metadata`/`aud`/`role`).
  - `profiles` — shared-PK 1:1 with `users`; all columns + CHECKs (§3.2); **drop
    `profiles_safe` view** (email privacy moves to the Phase 6 serializer — §6.12#1).
  - `journeys`, `requests`, `conversations`, `messages`, `last_read`, `blocked_users`,
    `user_reports`, `trains`, `unverified_trains` — exact columns/types/defaults/CHECKs.
  - Type mapping notes: `uuid[]` → `String[]` (GIN index via **raw SQL** — Prisma cannot
    emit GIN on scalar lists); `jsonb` → `Json`; `bigint` → `BigInt` (JSON-serialization
    pitfall handled in Phase 11 serializer); `timestamptz` → `DateTime`;
    `date` → `DateTime @db.Date`.
- **Migrations** (forward-only, versioned): tables, indexes (incl.
  `messages(conversation_id, created_at)` composite from §13.8), CHECKs, FKs with
  cascade, unique constraints; ported **triggers**:
  - `update_profiles_updated_at` / `update_requests_updated_at` (keep as DB triggers).
  - `on_user_created` (port of `handle_new_user`) — auto-creates the profile row; keeps
    the "a profile row always exists" invariant.
  - `prevent_conversation_tamper` (port, reworked to not reference `auth.uid()`/RLS —
    it compares OLD vs NEW on immutable columns and guards `deleted_for` via a session
    flag; service layer sets the flag on the soft-delete path).
- **Deliberate drops** (documented in a migration comment): `profiles_safe` view,
  `realtime.messages` publication, `last_read REPLICA IDENTITY FULL` (no logical
  replication in the target — events come from app code), all SECURITY DEFINER
  functions, the `auth` schema.
- **`prisma/seed.ts`**: `trains` seed (~230 rows, `ON CONFLICT` semantics), plus dev
  users/journeys/requests/conversations/messages for local work.
- **Data migration tooling**:
  - `scripts/export-supabase.mjs` — `pg_dump` **data-only** from Supabase `public.*`
    + `auth.users` (mirrors existing `dump.sh`/`restore.sh`).
  - `scripts/import.mjs` — loads into the new schema, **preserving ids**; carries over
    `encrypted_password` → `password_hash` (bcrypt), `email_confirmed_at`;
    **rewrites legacy signed URLs to object paths for BOTH `profiles.avatar_url` AND `messages.attachment_url` (§7.4; see Critical migration point #3); verification step checks path↔object existence in BOTH buckets**.
  - Verification: row-count + FK-integrity + checksum report; idempotent (truncate+reload).
- **Schema-inventory manifest test**: derived from the 31 `supabase/migrations/*` files
  (§3.1), asserts the ported schema matches table/column/constraint/trigger-for-trigger
  inventory (minus the deliberate drops).

### 5. Files/Folders expected
```
backend/prisma/schema.prisma  migrations/  seed.ts
backend/scripts/export-supabase.mjs  import.mjs  verify.mjs
backend/src/repositories/            # thin Prisma access layer starts here
backend/src/test/manifest.json       # schema inventory expected-state
```

### 6. APIs to implement
- None (no REST in this phase). The schema is consumed by Phases 3+.

### 7. Database work
- The entire port described above, plus the migration runbook and the seed.

### 8. Security work
- `password_hash` never logged or serialized; DB creds via env; migrations versioned.
- Decision documented: **no RLS in the target** (single app role + service-layer
  enforcement per D1). The kept triggers are defense-in-depth, not authorization.
- Backups/snapshots before any import on a shared environment.

### 9. Testing strategy
- **Migration-clean test:** empty DB → `prisma migrate deploy` → manifest inventory
  matches (tables, columns, CHECKs, indexes, triggers).
- **Seed test:** idempotent re-run; `trains` count matches the source dump.
- **Round-trip import test:** export a fixture dump → import → row counts, UUID
  preservation, FK integrity, URL-backfill correctness.
- **Trigger tests:** `updated_at` bumps on update; tamper trigger rejects immutable-column
  changes and unguarded `deleted_for` changes.

### 10. Manual verification checklist
- [ ] Fresh `docker compose up db` → `npx prisma migrate dev` applies cleanly.
- [ ] `npx prisma generate` compiles; `npx prisma studio` shows all tables.
- [ ] `npm run db:seed` loads ~230 trains.
- [ ] A production-shaped pg_dump imports; row counts match source; a spot-check of
      `users.id` shows identical UUIDs; legacy URLs were rewritten.

### 11. Definition of Done
- Prisma schema compiles; migrations apply cleanly on a fresh DB; inventory manifest green.
- Trigger tests (updated_at, tamper) green.
- Import/export verified on a **staging copy of the real data** (counts + checksums).
- README documents the data-migration runbook (export → import → verify → rerun-safe).

### 12. Estimated complexity
**High** — Postgres→Prisma type mapping, trigger porting, and data-migration correctness
are the hardest non-code problems in the project.

### 13. Risks
- **Prisma type gaps** (uuid[], jsonb, bigint, CHECK, GIN) → manifest test + raw-SQL
  migrations; documented workarounds in the schema file.
- **Trigger port regression** (tamper trigger must stay auth-independent) → dedicated
  trigger tests.
- **Data-volume surprises** in production tables → measure during staging drill; the
  runbook is idempotent.
- **URL-backfill corruption** → backfill SQL reviewed; verify step compares path↔object
  existence in storage (Phase 4).
- **`migration/schema.sql` predates the last grant migration** (§3.1) → always source
  from `supabase/migrations/*` in order, never from `schema.sql`.

### 14. Rollback strategy
Nothing in production. Migrations are forward-only; a fresh DB is one `docker compose
down -v` away. The import is idempotent. **Supabase untouched.**

### 15. Git commit milestone
`feat(backend): prisma schema port — users/profiles/journeys/requests/conversations/messages + data migration tooling`
(tag `phase-2-schema-port`)

### Phase 2 exit checklist
- [x] Project builds (schema + generate + typecheck green)
- [x] Tests pass (manifest, seed, import round-trip, triggers)
- [x] API documented (no APIs; schema + runbook documented)
- [x] No frontend changes required
- [x] Security verified (no RLS decision documented; hashes protected; snapshot before import)
- [x] Ready to merge

---

## Phase 3 — Authentication & Session Management

**Estimated complexity:** High

### 1. Goal
A **behavior-identical replacement for Supabase Auth (GoTrue)**: email/password
register + login, **email confirmation**, **JWT access tokens + rotating refresh
tokens**, session restore, logout — with the **same observable session shape** the
frontend consumes (§5, §11.2) and the **same UUID identities**. This is the phase where
the identity-continuity guarantee is proven.

### 2. Why this phase comes now
Auth gates every other phase: every route needs `req.user`, and every service test needs
a session. It also carries the highest security stakes, so it is landed first with its
own adversarial tests — every later phase then builds on a verified foundation. Identity
continuity (same `user.id`, carried-over hashes) must be proven before profiles/journeys
attach to users.

### 3. Dependencies
- Phase 2 (`users`, `refresh_tokens`, `email_verifications`, `on_user_created` trigger).

### 4. Deliverables
- **Endpoints** (per §10.1): `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/confirm-email`.
- **Session shape** identical to GoTrue so `useAuth` (Phase 13) works unchanged:
  `{ access_token, refresh_token, expires_in, token_type, user: { id, email } }`
  (exact keys verified against §11.2 in Phase 13's contract suite). **`onAuthStateChange`
  event set: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY
  (GoTrue parity); adapter must emit in this order.**
- **`POST /auth/register` returns a confirmation-required signal (not a session)** — the
  adapter's `signUp`/`signIn` must return `{error}` only to match the frontend interface
  (`useAuth.tsx` destructures only `{error}`).
- **Access JWT**: HS256, ~15 min TTL, claims `{ sub, email, iat, exp }`, alg pinned.
- **Refresh tokens**: opaque 256-bit random, stored **SHA-256-hashed** in Postgres
  (`refresh_tokens`: `user_id`, `token_hash`, `expires_at`, `revoked_at`,
  `replaced_by_token_hash`, `created_at`); **rotation on every refresh** + **reuse
  detection** (replaying a revoked token revokes the whole family — RFC 6749 pattern).
- **Password hashing**: **bcrypt (cost 12)** — chosen so carried-over GoTrue hashes
  verify (see Critical migration point #1). Optional `hash_algo` column if argon2id is
  adopted later; keep bcrypt-only now for simplicity + continuity.
- **Email confirmation enabled** (behavior parity, including the no-hint-after-signup
  UX — §5.1). Email delivery behind `utils/emails.ts`: console transport in dev, a
  transactional provider (Resend/SES) in prod, with a confirmation-link route that
  finalizes `email_confirmed_at` and redirects to `/`.
- **Profile bootstrap**: the `on_user_created` DB trigger (Phase 2) creates the profile
  row; the register service also has a transactional fallback check.
- **Middleware**: `authenticate` fully wired (JWT verify → `req.user`); `GET /auth/session`
  derives from the presented access token (mirrors `getSession`).
- **Rate limiting** on auth routes (per IP + per email): register/login ~5/min,
  refresh ~15/min; uniform error responses for unknown-email vs wrong-password
  (account-enumeration mitigation); progressive lockout on repeated failures.
- **Password recovery: no frontend UI, out of scope; note as post-migration enhancement.**

### 5. Files/Folders expected
```
backend/src/routes/auth.routes.ts
backend/src/services/auth.service.ts          # register/login/refresh/logout/confirm
backend/src/repositories/users.repo.ts  refresh-tokens.repo.ts  email-verifications.repo.ts
backend/src/middleware/authenticate.ts  rate-limit.ts
backend/src/utils/passwords.ts  tokens.ts  emails.ts (+ templates/)
backend/test/auth.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes (§10.1) |
| --- | --- | --- |
| POST | `/auth/register` | `{ email, password, emailRedirectTo }` → session or confirmation-required signal |
| POST | `/auth/login` | `{ email, password }` → `{ access_token, refresh_token, user }` |
| POST | `/auth/refresh` | rotate refresh token (reuse detection) |
| POST | `/auth/logout` | revoke refresh token |
| GET | `/auth/session` | current session from access token |
| POST | `/auth/confirm-email` | finalize email confirmation from link token |

### 7. Database work
- `users`, `refresh_tokens`, `email_verifications` (schema from Phase 2).
- Sweep of expired/revoked refresh tokens (on-read or scheduled job — Phase 14 can make
  it a cron).
- Unique constraint on `refresh_tokens.token_hash` (rotation race safety).

### 8. Security work
- bcrypt cost 12; constant-time compare; JWT alg pinning (HS256 only); short access TTL.
- Refresh rotation + family revocation on reuse; token stored hashed, never raw.
- Rate limits + enumeration-uniform errors + lockout.
- Client storage stays **localStorage** for behavior parity (document the XSS tradeoff;
  hardening via secure-cookie variant is a post-migration nice-to-have — §5).
- No PII in logs; password fields never logged; TLS required in prod.

### 9. Testing strategy
- **Unit:** token helpers, hashing, rotation/reuse logic, JWT verify (expired, malformed,
  wrong-alg).
- **Integration (Supertest + test DB):** full lifecycle — register → confirm →
  login → access → refresh (rotation) → logout; unconfirmed user cannot login;
  wrong-password vs unknown-email produce identical responses; rate-limit 429.
- **Security/adversarial:** refresh-token replay revokes family; concurrent refresh race;
  clock-skew tolerance; JWT replay after logout.
- **Contract:** session shape matches §11.2 keys (dummy adapter assertion).

### 10. Manual verification checklist
- [ ] Register a user → confirmation email appears (console in dev) → confirm → login.
- [ ] Copy the access token → call an authenticated endpoint → 200.
- [ ] Refresh returns a new pair; replaying the old refresh token revokes the family.
- [ ] Logout revokes the refresh token.
- [ ] A **carried-over user** (imported bcrypt hash, Phase 2) logs in with their old
      password and keeps their UUID.

### 11. Definition of Done
- All 6 endpoints behave identically to GoTrue per §5.1 (including quirks).
- Rotation/reuse/lockout/rate-limit tests green.
- Identity continuity proven: imported users authenticate without re-registration.
- OpenAPI documents all auth routes; CI green.

### 12. Estimated complexity
**High** — security-critical, plus exact emulation of GoTrue session semantics.

### 13. Risks
- **Emulating GoTrue session semantics exactly** → contract tests against the real
  frontend shape in Phase 13; document every quirk.
- **Email-delivery dependency** (outage blocks signups) → provider abstraction with
  console fallback + retry; confirm-email endpoint idempotent.
- **Password-hash compatibility** (if production hashes aren't bcrypt) → verify during
  the Phase 2 staging drill; fall back to forced password reset (documented, last resort).
- **Rotation races** → transaction + unique constraint on `token_hash`.
- **JWT can't be revoked server-side** → short TTL + refresh rotation; document the
  tradeoff (same as GoTrue's model).

### 14. Rollback strategy
Auth is behind the adapter (Phase 13) — **no production traffic yet**. Token design is
self-contained; the `users` table can be truncated and re-imported without loss. Supabase
auth untouched.

### 15. Git commit milestone
`feat(backend): jwt auth with rotating refresh tokens + email confirmation`
(tag `phase-3-auth`)

### Phase 3 exit checklist
- [x] Project builds
- [x] Tests pass (lifecycle, rotation, adversarial, contract)
- [x] API documented (OpenAPI auth routes)
- [x] No frontend changes required
- [x] Security verified (hashing, rotation, rate limits, enumeration parity, secrets)
- [x] Ready to merge

---

## Phase 4 — Storage Foundation (S3-compatible + presigned URLs)

**Estimated complexity:** Medium

### 1. Goal
Stand up the object-storage layer both avatars and attachments will use: MinIO in dev,
**AWS S3 (or Cloudflare R2)** in prod, the two buckets with the **same names and key
conventions** as today (§7.1), presigned-upload/download issuance, key validation, and
the **signed-URL serialization helper** (D3: store path, sign at read). This phase also
fixes the documented **`chat-attachments` bucket gap** (§7.1 — the bucket exists only via
manual dashboard creation today).

### 2. Why this phase comes now
Both Profiles (avatars, §11.3) and Messages (attachments, §11.5) need storage. Pulling
it forward means neither later phase stubs anything, and the bucket/URL/authorization
model is proven early. It is small, self-contained, and unlocks the avatar flow that
Phase 6 depends on.

### 3. Dependencies
- Phase 1 (compose MinIO). Storage authorization reuses visibility functions that land
  in Phases 5/6/10 — implement the checks inline here behind `services/access.service.ts`
  stubs, then refactor to the shared module as those phases land.

### 4. Deliverables
- `src/utils/s3.ts` — one client abstraction over MinIO (dev) / AWS S3 (prod) / R2,
  driven by env (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET_AVATARS`, `S3_BUCKET_CHAT_ATTACHMENTS`).
- Idempotent bucket creation for `avatars` and `chat-attachments` (dev/MinIO init;
  prod via Terraform/IaC — runbook documented).
- **Presign endpoints (§10.8):**
  - `POST /storage/avatars/presign` → presigned **PUT** for `me/avatar.<ext>` (upload;
    the browser uploads directly, replacing the upload+URL dance).
  - `POST /storage/avatars/upload-url` → aliases the same (kept for §10.8 parity).
  - `POST /storage/chat-attachments/presign` → presigned **PUT** for
    `<conversationId>/<uuid>.<ext>` (participant only).
  - Serializer helper `signObjectUrl(viewer, path, expires)` → short-lived **GET**
    (~1h) used by profile/message serializers in Phases 6/11.
- **Key-validation middleware** (`validate-storage-key`): bucket → allowed prefix;
  `avatars/<uuid>/avatar.<ext>`, `chat-attachments/<uuid>/<uuid>.<ext>`; reject
  `..`/traversal, wrong bucket/prefix, cross-tenant keys.
- **Avatar URL decision locked (D3 + §7.3):** `avatar_url` column holds an object path;
  serializers sign on read. The frontend's `getAvatarUrl` quirk (drops `?token=`, so
  ProfileMenu/ViewProfileModal fall back to initials; ProfileModal shows the intact URL)
  is **preserved**; a fix is **technically impossible via signed URLs alone** —
  `getAvatarUrl(url) = url.split('?')[0] + '?t='+version` drops the S3 signature. Only a
  **first-party avatar proxy route** (`GET /avatars/:userId`) that re-authorizes
  `can_view_profile` at request time survives the split — and that requires a frontend
  change (out of scope for the migration). **Decision locked here:** accept the quirk for
  migration parity; a post-migration nice-to-have (§5#4) may add the proxy route.

### 5. Files/Folders expected
```
backend/src/utils/s3.ts
backend/src/services/access.service.ts      # visibility stubs → shared checks
backend/src/middleware/validate-storage-key.ts
backend/src/routes/storage.routes.ts
backend/test/storage.*.test.ts
deploy/terraform/  (buckets + IAM; or minio init in compose)
docs/storage-runbook.md
```

### 6. APIs to implement
| Method | Path | Notes (§10.8) |
| --- | --- | --- |
| POST | `/storage/avatars/presign` | PUT URL for `me/avatar.<ext>` |
| POST | `/storage/avatars/upload-url` | parity alias |
| POST | `/storage/chat-attachments/presign` | PUT URL for `<convId>/<uuid>.<ext>`, participant-only |

### 7. Database work
- None (paths live in existing `avatar_url` / `attachment_url` columns; legacy URL
  backfill was Phase 2). Verify backfilled paths resolve to existing objects.

### 8. Security work
- Presigned **PUT** only for owner-scoped (`me/…`) avatar keys and participant-scoped
  conversation keys.
- Presigned **GET** issued only after the §7.2 authorization checks (`canViewProfile` for
  avatars; `isConversationParticipant` for attachments) — this is the storage half of
  security invariant #6.
- **Server-side MIME + size allowlist** (avatars: images ≤5 MB; attachments:
  images/pdf/doc/docx/txt ≤10 MB — §9.2/§9.6) enforced at the API before issuing the PUT
  and re-verified post-upload (HEAD on the object). **Reject HTML/SVG** (stored-XSS
  vector).
- Buckets not publicly listable; bucket CORS scoped to the frontend origin; object key
  validation (no traversal/cross-tenant); no permanent public URLs.

### 9. Testing strategy
- **Unit:** key validator (traversal, wrong prefix, cross-tenant), MIME/size rules,
  presign expiry bounds.
- **Integration:** presign → PUT via S3 client → sign-GET → authorized read; avatar of a
  user I cannot view → 403 on sign-GET; non-participant attachment → 403; PUT to another
  user's avatar path → 403; HTML/SVG rejected.
- **Contract:** signed URL shape round-trips through the frontend's `getAvatarUrl` split
  semantics (both render paths).

### 10. Manual verification checklist
- [ ] MinIO UI shows both buckets; `chat-attachments` now exists by code, not dashboard.
- [ ] Avatar presign flow uploads a 256×256 JPEG and renders via ProfileModal.
- [ ] An unauthorized user cannot obtain a signed avatar GET URL.
- [ ] Prod bucket + IAM runbook executed in a sandbox account.
- [ ] **Presign PUT returns object path** (not the signed URL) so the frontend can request a signed GET; backend stores the path directly ("store path, sign at read").
- [ ] **Key validation uses standardized `foldername` function** (not `split_part`) for both avatars and chat-attachments.
- [ ] **Orphan attachments note:** soft-deleted conversations leave orphan attachments in `chat-attachments` (no cascade cleanup); post-launch S3 lifecycle rules or scheduled purge documented.

### 11. Definition of Done
- Both buckets exist in dev + prod config; presign endpoints authorized per §7.2.
- `signObjectUrl` helper tested; **no 1-year tokens anywhere in new code**.
- Storage runbook documented; CI green; OpenAPI updated.

### 12. Estimated complexity
**Medium.**

### 13. Risks
- **Signed-URL semantics drift** (the §12.3 risk) → D3 (store path, sign at read) +
  contract tests.
- **Bucket CORS misconfiguration** → verified by the browser upload contract test.
- **Cloud credentials in dev** → MinIO by default; AWS creds via env, never committed.
- **R2/S3 SDK differences** → thin `s3` abstraction isolates the SDK; CI tests MinIO.

### 14. Rollback strategy
Storage is additive and behind env config; no production traffic yet. Buckets are
configuration, not data. Swap `S3_ENDPOINT`/credentials to change provider.

### 15. Git commit milestone
`feat(backend): s3-compatible storage — buckets, presigned urls, key validation`
(tag `phase-4-storage`)

### Phase 4 exit checklist
- [x] Project builds
- [x] Tests pass (key validation, presign auth, MIME/size)
- [x] API documented (OpenAPI storage routes + runbook)
- [x] No frontend changes required
- [x] Security verified (authorized presigns, allowlists, no public buckets)
- [x] Ready to merge

---

## Phase 5 — Moderation: Blocking & Reporting

**Estimated complexity:** Medium

### 1. Goal
Implement `blocked_users` and `user_reports` endpoints plus the **symmetric
`isBlocked()`** service function (§3.3) that every other phase's authorization depends
on. Landing it here means Phases 6–11 can assert blocking behavior in their own tests.

### 2. Why this phase comes now
`is_blocked` is a **cross-cutting RLS dependency** (§6.12#2) — it gates profiles,
journeys, matching, requests, conversations, and messages. It must exist and be trusted
before the phases that enforce it. The block/unblock/report endpoints are simple CRUD;
the value is the shared function.

### 3. Dependencies
- Phase 3 (auth), Phase 2 (tables).

### 4. Deliverables
- `GET /blocked-users`, `POST /blocked-users`, `DELETE /blocked-users/:blockedId`,
  `POST /reports` (§10.10).
- `services/access.service.ts` → `isBlocked(a, b)` — **symmetric** (either direction
  blocks both), with a single canonical implementation used by every downstream phase.
- Self-block rejection (`blocker_id === blocked_id` → 400).
- Block semantics preserved per §9.7: block hides the pair from each other's
  requests/journeys/matches (enforced downstream); **existing conversations remain
  readable** (frontend shows a blocked badge — no backend change); messages across a
  block are rejected (Phase 11).
- Reporting: free-text `reason`, no category enum (§9.8); reporter forced to
  `req.user.id`. No read/admin surface in scope (noted as future work). **No rate-limiting,
  dedup, or moderation dashboard — INSERT/SELECT only; abuse surface is post-MVP.**

### 5. Files/Folders expected
```
backend/src/routes/moderation.routes.ts
backend/src/services/access.service.ts   # isBlocked + (scaffolds) isConversationParticipant
backend/src/repositories/blocked-users.repo.ts  user-reports.repo.ts
backend/test/moderation.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes (§10.10) |
| --- | --- | --- |
| GET | `/blocked-users` | list own blocks (`blocked_id`s) |
| POST | `/blocked-users` | block (`{ blocked_id }`) |
| DELETE | `/blocked-users/:blockedId` | unblock (own rows only) |
| POST | `/reports` | report (`{ reported_id, reason }`) |

### 7. Database work
- None new (tables/indexes from Phase 2). Consider `user_reports(reported_id)` index only
  when an admin surface is added (deferred).
- **`blocked_users` has NO FK to `auth.users` and NO self-block CHECK in the deployed DB** — the service layer must reject `blocker_id === blocked_id` (enforced in this phase).
- **`user_reports.reason` is free-text, no maxLength** (frontend sends `reason.trim() || null`).

### 8. Security work
- `blocker_id`/`reporter_id` forced to `req.user.id` (mirror RLS §6.7/§6.8).
- Self-block prevented; block/report require the target to exist (404).
- Idempotency: re-block → upsert or 409 (pick one; document).
- `isBlocked` never leaks the existence of a block to the blocked user (responses are
  the same 404/403 as for a stranger).

### 9. Testing strategy
- **Unit:** `isBlocked` symmetry (A→B and B→A both true); self-block rejected.
- **Integration:** block → list → unblock; re-block; self-block 400; report requires
  auth + reporter-forcing; reporting a nonexistent user → 404.
- **Cross-phase gate (the important one):** A blocks B → a journey of B's is invisible
  to A's companions query. This test is written here, **asserted in Phase 8**, and
  proves the shared function end-to-end.

### 10. Manual verification checklist
- [ ] Block a user → their profile is not retrievable (Phase 6) and their journey
      disappears from matches (Phase 8).
- [ ] Unblock restores visibility.
- [ ] Report a user succeeds; duplicate report tolerated.

### 11. Definition of Done
- All 4 endpoints authorized; `isBlocked` exported + unit-tested (symmetry, self-block).
- Cross-phase blocking test authored and green once Phase 8 lands.
- OpenAPI updated; CI green.

### 12. Estimated complexity
**Medium.**

### 13. Risks
- **Symmetric-block drift** (checking only one direction) → single canonical `isBlocked`
  + symmetry unit test.
- **Inconsistent enforcement across downstream phases** → central access module +
  cross-phase test; audit in Phase 14's security pass.

### 14. Rollback strategy
Additive; no production traffic. `isBlocked` is internal; changeable without user impact.

### 15. Git commit milestone
`feat(backend): moderation — blocking + reporting with shared access checks`
(tag `phase-5-moderation`)

### Phase 5 exit checklist
- [x] Project builds
- [x] Tests pass (symmetry, self-block, CRUD)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (own-row forcing, self-block, no existence leak)
- [x] Ready to merge

---

## Phase 6 — Profiles

**Estimated complexity:** Medium

### 1. Goal
`profiles` read/update endpoints with **full `can_view_profile` equivalence** (§6.1),
the **email-privacy invariant** (§6.12#1), and avatar URL handling through the Phase 4
storage helper. Profiles is the first phase where the full contextual-visibility
function runs, validating the shared access module end-to-end.

### 2. Why this phase comes now
Profiles are the identity surface every other feature references (sender_name, profile
modal, conversation headers). Auth (3), storage (4), and blocking (5) already exist.
`can_view_profile`'s other arms — shared journey / accepted request / shared
conversation — reference tables that already exist (Phase 2), so it can be implemented
fully and correctly now, even though those services land later.

### 3. Dependencies
- Phase 3 (auth), Phase 4 (storage/presign), Phase 5 (`isBlocked`), Phase 2 (tables).

### 4. Deliverables
- `GET /profiles/me`, `PATCH /profiles/me`, `GET /profiles/:userId`,
  `GET /profiles/:userId/name` (§10.2).
- **Serializer** that NEVER emits `email` for other users (invariant #1); `GET /profiles/me`
  may include the owner's email (session is the normal source — §9.1).
- `canViewProfile(requester, target)`: owner OR (NOT `isBlocked` AND (shared journey OR
  accepted request OR shared conversation)) — §6.1.
- **Avatar flow:** presigned PUT (Phase 4) → object path stored in `avatar_url` →
  serializer signs a short-lived GET on read. Preserves the exact `getAvatarUrl`
  behavior (§7.3).
- **Update rules (§9.1):** name required/trimmed ≤100; bio/hobbies/college trimmed-or-null
  ≤500/200/200; gender enum (`male|female|other|prefer_not_to_say|empty`),
  **stored as `prefer_not_to_say` in `profiles` (underscore) and `prefer-not-to-say` in `journeys` (hyphen) — no DB CHECK currently; migration must normalize both tables to one canonical value; server validator accepts both today and writes only the canonical value**; `avatar_url` internal.
- `GET /profiles/:userId` returns **404** for users you cannot view (matches RLS "empty
  row" → frontend treats as no-profile) — decided to avoid leaking existence.
- `GET /profiles/:userId/name` returns `{ name }` or `null` (maybeSingle semantics).

### 5. Files/Folders expected
```
backend/src/routes/profiles.routes.ts
backend/src/services/profile.service.ts   # canViewProfile, update, serializer
backend/src/repositories/profiles.repo.ts
backend/src/serializers/profile.serializer.ts
backend/test/profiles.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes (§10.2) |
| --- | --- | --- |
| GET | `/profiles/me` | id, name, bio, hobbies, college, gender, avatar_url (+ own email) |
| PATCH | `/profiles/me` | own profile update |
| GET | `/profiles/:userId` | authorized profile; **no email** |
| GET | `/profiles/:userId/name` | maybeSingle name |

### 7. Database work
- None new; `updated_at` trigger (Phase 2) covers PATCH.

### 8. Security work
- Email omission enforced at the serializer + a dedicated test asserting the key is absent.
- `canViewProfile` fully implemented (all three relationship arms + owner + block).
- PATCH restricted to own profile; zod validation on every field; no mass-assignment.

### 9. Testing strategy
- **Unit:** `canViewProfile` truth table — owner; shared-journey; accepted-request;
  shared-conversation; blocked-either-direction → false; stranger → false.
- **Integration:** GET /me; PATCH own; GET a visible other profile (**assert no `email`
  key**); GET blocked user's profile → 404; GET stranger → 404; PATCH other's → 404.
- **Contract:** response shapes match §11.3 and §11.13.

### 10. Manual verification checklist
- [ ] View own profile (email visible in session, not via API for others).
- [ ] Edit name/bio/hobbies/college/gender incl. `prefer_not_to_say`.
- [ ] Upload an avatar via the storage flow; it renders in ProfileModal.
- [ ] A blocked user's profile is not retrievable.

### 11. Definition of Done
- All 4 endpoints + serializer; email-privacy test green; `canViewProfile` complete.
- Avatar flow works end-to-end through MinIO; contract shapes verified.
- OpenAPI updated; CI green.

### 12. Estimated complexity
**Medium.**

### 13. Risks
- **`canViewProfile` incompleteness** (missing an arm) → truth-table test mirrors the
  SQL exactly; review against §6.1 at exit.
- **Email leak regression** → serializer test is a hard gate in CI.
- **404-vs-empty semantics drift** → locked decision documented in the route.

### 14. Rollback strategy
Additive; no production traffic. `canViewProfile` is internal and unit-testable.

### 15. Git commit milestone
`feat(backend): profiles with contextual visibility + avatar urls`
(tag `phase-6-profiles`)

### Phase 6 exit checklist
- [x] Project builds
- [x] Tests pass (canViewProfile truth table, email privacy)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (invariant #1, own-PATCH, no mass-assignment)
- [x] Ready to merge

---

## Phase 7 — Journeys & Train Directory

**Estimated complexity:** Medium

### 1. Goal
Journeys CRUD (`/journeys/me`, POST, DELETE), the trains autocomplete directory, and
unverified-train logging — with the §6.2 SELECT authorization (own journeys OR
`can_view_journey` AND NOT blocked). This is the write/own-read side of journeys; the
discovery read side is Phase 8.

### 2. Why this phase comes now
Journeys are the core user content and the input to matching (Phase 8) and requests
(Phase 9). Trains and unverified logging are their data dependencies. Land the write +
own-read side before the discovery read side so Phase 8 reads verified data.

### 3. Dependencies
- Phase 3 (auth), Phase 5 (`isBlocked`), Phase 2 (tables).

### 4. Deliverables
- `GET /journeys/me`, `POST /journeys`, `DELETE /journeys/:id` (§10.3).
- `GET /trains?q=` (autocomplete: `active=true`, ILIKE on number/name, limit 15) and
  `POST /trains/unverified` (§10.9).
- **Journey insert rules (§9.2):** `user_id` forced to `req.user.id`; `user_name`
  denormalized from the profile; `train_name` denormalized from the trains lookup (null
  when not found); zod `journeySchema`; **unverified logging when `isVerified=false`
  with `normalized_value = lower(trim(input))` in the SAME TRANSACTION as the journey
  insert (atomic) — a failed journey insert leaves no orphan `unverified_trains` row;
  failure-injection tests required**; duplicate journeys **allowed** (no dedup).
- `canViewJourney(user, train, date)` service function (caller has a journey on that
  train+date).
- Own-journey hard DELETE (own only).
- Frontend enforces `travel_date >= today` for matchability client-side (§9.2) — the
  server does **not** filter (parity preserved; optional server guard is a nice-to-have).

### 5. Files/Folders expected
```
backend/src/routes/journeys.routes.ts  trains.routes.ts
backend/src/services/journey.service.ts  train.service.ts
backend/src/repositories/journeys.repo.ts  trains.repo.ts  unverified-trains.repo.ts
backend/test/journeys.*.test.ts  trains.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/journeys/me` | own journeys, order travel_date asc (§10.3) |
| POST | `/journeys` | create + optional unverified log (§10.3) |
| DELETE | `/journeys/:id` | own journey only (§10.3) |
| GET | `/trains?q=` | autocomplete (§10.9) |
| POST | `/trains/unverified` | log unverified entry (§10.9) |

### 7. Database work
- None new; `journeys(user_id)` and `journeys(train_number, travel_date)` indexes from
  Phase 2; keep an eye on ILIKE performance (deferred: lower-index on `train_number`).

### 8. Security work
- INSERT `user_id` forced; DELETE own-only; SELECT own-or-contextual.
- `unverified_trains.submitted_by = req.user.id`.
- Trains directory read requires authentication (matches §6.9).
- Never expose other users' emails through journey rows.

### 9. Testing strategy
- **Unit:** `canViewJourney`.
- **Integration:** create verified vs unverified (row logged with `normalized_value`);
  delete own; delete other's → 404/403; list own; trains search matches number and name;
  journey insert with a typed-but-existing train still logs as unverified (§9.3).
  **Atomic unverified+journey: inject failures on both sides; assert no orphan rows; cleanup query for pre-existing orphans.**
- **Contract:** shapes per §11.9/#49–52 and §11.15.

### 10. Manual verification checklist
- [ ] Add a journey (dropdown train → verified; typed train → unverified row created).
- [ ] Delete a journey (AlertDialog confirm → hard delete).
- [ ] Train autocomplete returns ≤15 active trains.
- [ ] `unverified_trains` shows the normalized raw input.
- [ ] Failure injection: kill journey insert mid-transaction → no orphan `unverified_trains`.

### 11. Definition of Done
- 5 endpoints; `canViewJourney` tested; unverified logging correct; train_name
  denormalization matches the source data.
- OpenAPI updated; CI green.

### 12. Estimated complexity
**Medium.**

### 13. Risks
- **`train_name` denormalization correctness** for existing data (nulls) → seed fixture
  matches production shapes.
- **ILIKE performance** at scale → noted; defer index until Phase 14 load test.
- **Unverified-logging atomicity** with the journey insert → wrap in a transaction.

### 14. Rollback strategy
Additive; no production traffic.

### 15. Git commit milestone
`feat(backend): journeys crud + train directory + unverified logging`
(tag `phase-7-journeys`)

### Phase 7 exit checklist
- [x] Project builds
- [x] Tests pass (journeys, trains, unverified)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (ownership, contextual visibility, no email leaks)
- [x] Ready to merge

---

## Phase 8 — Companion Matching

**Estimated complexity:** High

### 1. Goal
The read side of journeys — `GET /journeys/:trainNumber/:travelDate/companions` —
implementing **exact-match discovery** (same `train_number` AND `travel_date`, self
excluded) filtered by the RLS visibility arms: `can_view_journey` + NOT blocked. This is
the product's core value and the trickiest authorization surface.

### 2. Why this phase comes now
Matches power Requests and Conversations. Getting the visibility semantics exactly right
**before** those build on top de-risks the most business-critical query. It must precede
Requests because send-request depends on `users_share_journey`, which shares this query's
shape.

### 3. Dependencies
- Phase 7 (journeys), Phase 5 (`isBlocked`), Phase 2 (tables).

### 4. Deliverables
- `GET /journeys/:trainNumber/:travelDate/companions` (§10.3): journeys of **other users**
  on that train+date, **excluding blocked pairs (either direction)** — matching the RLS
  SELECT (`can_view_journey AND NOT is_blocked`, §6.2). Response includes the fields the
  Matched page renders (user name, gender, coach, stations, college, journey id).
- `usersShareJourney(a, b, train, date)` service function (shared with Requests, Phase 9).
- Matchable-window: server does not filter on `travel_date >= today` (frontend enforces —
  parity preserved); documented as a deliberate choice.

### 5. Files/Folders expected
```
backend/src/routes/journeys.routes.ts        # companions sub-route
backend/src/services/matching.service.ts     # companions query + usersShareJourney
backend/src/repositories/journeys.repo.ts
backend/test/matching.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/journeys/:trainNumber/:travelDate/companions` | exact match, blocked-excluded (§10.3) |

### 7. Database work
- Ensure `journeys(train_number, travel_date)` index (Phase 2) is used (EXPLAIN test);
  consider a covering index for this query as a post-load-test optimization.

### 8. Security work
- Exclude blocked pairs symmetrically; exclude self; never return emails; only journeys
  of users the caller can view (contextual visibility — a stranger on a different
  journey is never returned).

### 9. Testing strategy
- **The Phase 5 cross-phase blocking test runs here:** A blocks B → B's journey
  invisible to A's companions query; both directions; unblock restores.
- **Integration:** same train+date → found; different date → not found; self excluded;
  blocked excluded; field set matches the Matched page.
- **Performance:** EXPLAIN shows index-backed plan (no full scan) on a production-sized
  fixture.

### 10. Manual verification checklist
- [ ] Two journeys on the same train/date → each lists the other in companions.
- [ ] Change the date → gone. Block → gone. Unblock → back.
- [ ] Matched page renders name/gender/coach correctly.

### 11. Definition of Done
- Companions endpoint matches RLS behavior exactly (§6.2 arm).
- Blocking cross-test green; EXPLAIN shows index usage; CI green; OpenAPI updated.

### 12. Estimated complexity
**High** — authorization correctness + the product's core query.

### 13. Risks
- **Visibility drift** (missing a blocked pair, leaking a non-contextual journey) →
  truth-table tests mirror the SQL; reviewed against §6.2 at exit.
- **Full-table-scan under load** (§12 architecture concern) → index + EXPLAIN gate;
  load-tested in Phase 14.
- **Stale client-side `localStorage` matches** (Matched page caches) — frontend behavior,
  unchanged; not a backend defect.

### 14. Rollback strategy
Additive; no production traffic. The query is internal to the route; reversible.

### 15. Git commit milestone
`feat(backend): companion matching with contextual visibility`
(tag `phase-8-matching`)

### Phase 8 exit checklist
- [x] Project builds
- [x] Tests pass (visibility truth table, blocking cross-test, EXPLAIN)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (blocked exclusion, self-exclusion, no leaks)
- [x] Ready to merge

---

## Phase 9 — Requests Lifecycle

**Estimated complexity:** High

### 1. Goal
The full request state machine (§9.4, §6.3): list, send, accept, reject, cancel,
expired-cleanup, accepted-pairs, and the pending-count badge — with exact RLS
equivalence. Requests are the gate to conversations.

### 2. Why this phase comes now
Requests depend on matching's `usersShareJourney` (Phase 8) and blocking (Phase 5).
Landing them now means Conversations (Phase 10) can enforce "created only after an
accepted request."

### 3. Dependencies
- Phase 8 (`usersShareJourney`), Phase 5 (`isBlocked`), Phase 3, Phase 2.

### 4. Deliverables
- **Endpoints (§10.4):** `GET /requests/me`, `POST /requests`, `PATCH /requests/:id`
  (accept/reject), `DELETE /requests/:id` (cancel), `POST /requests/cleanup-expired`,
  `GET /requests/me/accepted`, `GET /requests/incoming/pending-count`.
- **Send:** `from_user_id` forced to `req.user.id`; `from_user_id ≠ to_user_id`; NOT
  blocked; `usersShareJourney(from, to, train, date)` verified server-side; status
  default `pending`; `from_email`/`to_email` **never populated** (always NULL in the new
  DB; decide: drop columns or populate at insert from auth email); **body shape
  matches frontend exactly (§10.4): 9 fields — `from_user_id, from_name, to_user_id,
  to_name, train_number, travel_date, boarding_station, destination_station,
  status='pending'` — no email, no college/gender**.
- **Accept/reject:** only `to_user_id` may transition status to `accepted`/`rejected`.
- **Cancel:** DELETE by `from_user_id` only AND only when `status='pending'`; **hard
  delete** (re-request allowed — §9.4).
- **Expired cleanup:** **ATOMIC single DELETE** `WHERE from_user_id=me AND status='pending' AND travel_date < cutoff` (idempotent, no select-then-delete TOCTOU); cutoff passed by the client (§9.4) — sender-side only.
- **List:** sent-or-received, **excluding blocked pairs** (§6.3), ordered desc.
- **Accepted list:** sent + received accepted merged server-side (frontend currently
  merges two queries — keep the response shape compatible, §11.7).
- **Pending count:** `to_user_id = me AND status='pending'` head count (Dashboard badge,
  §11.9/#48).

### 5. Files/Folders expected
```
backend/src/routes/requests.routes.ts
backend/src/services/request.service.ts      # state machine + guards
backend/src/repositories/requests.repo.ts
backend/test/requests.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/requests/me` | sent/received, blocked-excluded, **optional `?type=sent|received|all` (default `all`)** (§10.4) |
| POST | `/requests` | send (shared-journey + not-blocked gate) |
| PATCH | `/requests/:id` | accept/reject (recipient only) |
| DELETE | `/requests/:id` | cancel (sender + pending) |
| POST | `/requests/cleanup-expired` | idempotent sender-side prune |
| GET | `/requests/me/accepted` | sent+received accepted |
| GET | `/requests/incoming/pending-count` | bell badge count |

### 7. Database work
- None new; `(status, from_user_id, to_user_id)` index from Phase 2.

### 8. Security work
- Every RLS arm (§6.3) replicated; recipient-only transitions; sender-only cancels;
  blocked pairs invisible; send gated on shared journey + not blocked; no email
  population/leakage.

### 9. Testing strategy
- **State machine as table-driven integration test:** send → accept → accepted;
  send → reject → rejected → resend works; send → cancel (pending) → resend; cancel
  after accept → 403; recipient-only accept/reject; blocked pair cannot send/see.
- **Expired cleanup:** only own pending, only past-2-day cutoff, idempotent, **single atomic DELETE**.
- **Stale `journeyData` race:** sender's localStorage journey deleted after match computed → send fails with 403; document graceful handling (frontend shows error, user re-fetches matches).
- **Contract:** accepted-list response shape per §11.4/§11.7.

### 10. Manual verification checklist
- [ ] Full request cycle between two dev users (send → accept → conversation created).
- [ ] Bell badge count matches pending incoming.
- [ ] An expired pending request is pruned on the Requests page mount.

### 11. Definition of Done
- All 7 endpoints; state-machine + authorization tests green; blocked-pair hiding green.
- OpenAPI updated; CI green.

### 12. Estimated complexity
**High** — the state machine and its authorization edges.

### 13. Risks
- **Edge cases** (accept-after-reject, cancel-after-accept) → table-driven tests.
- **Blocked-pair visibility** → integration test + Part I row.
- **Accept → conversation handoff** must be verified together with Phase 10 (joint test).

### 14. Rollback strategy
Additive; no production traffic.

### 15. Git commit milestone
`feat(backend): requests lifecycle with full state machine`
(tag `phase-9-requests`)

### Phase 9 exit checklist
- [x] Project builds
- [x] Tests pass (state machine, authorization, cleanup)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (recipient/sender forcing, blocked hiding, shared-journey gate)
- [x] Ready to merge

---

## Phase 10 — Conversations & Soft Delete

**Estimated complexity:** High

### 1. Goal
The conversations aggregate: list (participant + not deleted-for), create (gated by
`can_create_conversation`), per-user soft delete, and the immutable-field guard (§3.2) —
replicated in the service layer **and** kept as a DB trigger (defense-in-depth). This is
where the conversation-creation invariant ("only after an accepted request") and soft
delete semantics are settled before messages build on them.

### 2. Why this phase comes now
Conversations are the entry to messaging. Creation depends on the accepted-request
invariant (Phase 9) and blocking (Phase 5). Immutability and soft-delete are subtle and
must be proven here.

### 3. Dependencies
- Phase 9 (accepted requests), Phase 5 (`isBlocked`), Phase 2 (tables + tamper trigger).

### 4. Deliverables
- `GET /conversations`, `POST /conversations`, `DELETE /conversations/:id/for-me` (§10.5).
  The `PATCH /conversations/:id` preview bump is **internal** to the message-send flow
  (Phase 11), not a client-facing write.
- `canCreateConversation(participants, train, date)`: exactly **2 distinct** participants;
  caller included; NOT blocked; an **accepted** request exists between the pair
  (train/date checked if provided) — §9.5/§3.3.
- **Immutable-field guard:** service rejects updates to `participants`,
  `participant_names`, `train_number`, `travel_date`, `created_at`, `id`, and to
  `deleted_for` except via the soft-delete path; the Phase 2 DB trigger enforces the
  same at the database. **Trigger name in the migrated DB is `prevent_conversation_tamper_trg` (renamed in `20260703100726` with the `deleted_for` session-flag guard).**
- **Soft delete:** `DELETE /conversations/:id/for-me` appends `req.user.id` to
  `deleted_for`; the conversation is hidden from that user **permanently** (`deleted_for`
  is never auto-removed); **it does NOT reappear when a new message arrives**.
  Direct URL `/chat/<id>` still works because messages are not filtered by `deleted_for`.
  Preserve this behavior in the new backend (parity) and encode it in the acceptance criteria.
- **List:** `participants @> me AND me ∉ deleted_for`, ordered by `last_message_time desc`.
- **Creation parity decision (documented):** today the frontend reuses an existing row if
  both participants are in its loaded list, else inserts — and RLS has **no** unique
  constraint, so two concurrent clients can create two conversations. **Preserve current
  behavior** (allow the insert); add a sorted-participant-pair unique constraint only as
  a post-migration hardening after verifying the frontend tolerates it (Nice-to-haves §5).
- **`participant_names` stores display names from `profiles.name` keyed by user id; email must NEVER be stored here.** Frontend fetches caller's name via `profiles` before creating a conversation.

### 5. Files/Folders expected
```
backend/src/routes/conversations.routes.ts
backend/src/services/conversation.service.ts  # canCreateConversation, softDelete, guard
backend/src/repositories/conversations.repo.ts
backend/test/conversations.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/conversations` | participant, not deleted-for (§10.5) |
| POST | `/conversations` | create, gated by `canCreateConversation` (§10.5) |
| DELETE | `/conversations/:id/for-me` | per-user soft delete (§10.5) |

### 7. Database work
- None new; GIN index on `participants` from Phase 2; tamper trigger verified active.

### 8. Security work
- `canCreateConversation` fully enforced; participants immutability at service **and** DB.
- `deleted_for` mutated only via the soft-delete endpoint (mirrors the
  `app.allow_deleted_for_update` RPC pattern, §3.2).
- Participant-only reads; blocked pairs cannot create.

### 9. Testing strategy
- **Unit:** `canCreateConversation` truth table (2-participant rule, caller-included,
  blocked, no-accepted-request, train/date mismatch).
- **Integration:** create after accepted request; create without one → 403/404; blocked
  pair → 403; list excludes deleted-for; **soft delete hides permanently, new message
  does NOT reveal; direct URL `/chat/<id>` still accessible**; tamper attempts on
  immutable fields rejected **at the service and at the DB trigger**.
- **Joint test with Phase 9:** accept request → conversation created exactly once.

### 10. Manual verification checklist
- [ ] Accept a request → open chat → conversation created; opening again reuses it.
- [ ] Soft-delete a conversation → hidden from your list **permanently**; other user messages → **does NOT reappear**; direct URL `/chat/<id>` still works.
- [ ] Attempting a direct SQL update of `participants` is blocked by the trigger.

### 11. Definition of Done
- 3 endpoints; `canCreateConversation` truth-table green; tamper test green at both layers;
  soft-delete semantics verified; joint Phase 9 test green. OpenAPI updated; CI green.

### 12. Estimated complexity
**High.**

### 13. Risks
- **Duplicate-conversation creation on race** → documented parity decision; hardening
  deferred (tracked in Nice-to-haves).
- **`deleted_for` array update race** (two participants soft-deleting) → read-modify-write
  guarded by the service + trigger; test the race.
- **Immutability drift** → dual-layer guard (service + DB trigger).

### 14. Rollback strategy
Additive; no production traffic.

### 15. Git commit milestone
`feat(backend): conversations with immutability + soft delete`
(tag `phase-10-conversations`)

### Phase 10 exit checklist
- [x] Project builds
- [x] Tests pass (canCreateConversation, tamper, soft-delete)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (invariants #3 and #4)
- [x] Ready to merge

---

## Phase 11 — Messages, Read Receipts & Attachments

**Estimated complexity:** High

### 1. Goal
Message history + send (**text and attachment**), `last_read` upsert/query, unread
counts, and the conversation preview bump — with §6.5/§6.6 authorization, the **atomic
send** transaction, and attachments wired through the Phase 4 storage layer. This
completes the REST surface so Realtime (Phase 12) has stable events to emit.

### 2. Why this phase comes now
Messaging is the final read/write aggregate and the largest. Conversations (10),
storage (4), and blocking (5) all exist. Landing it completes the data plane; realtime
(12) then mirrors its writes.

### 3. Dependencies
- Phase 10 (conversations), Phase 4 (storage/presign), Phase 5 (`isBlocked`), Phase 2 (tables).

### 4. Deliverables
- **Endpoints (§10.6, §10.7):** `GET /conversations/:id/messages`,
  `POST /conversations/:id/messages`, `GET /conversations/:id/messages/unread-count`,
  `GET /conversations/:id/last-read/:userId`, `PUT /conversations/:id/last-read`.
- **Send (atomic):** sender is participant AND NOT `isBlockedInConversation`; text trim
  1..2000 **or empty-for-attachment**; attachment fields optional; `created_at`
  server-defaulted; `sender_name` denormalized; then bump the conversation
  (`last_message = text.substring(0,255)`, `last_message_time = now()`) **in the same
  transaction** — fixing the **phantom error** (message IS inserted, UI shows failure toast
  because `useChat` re-throws; §13.5) with the frontend contract unchanged (echo-driven UI,
  §8.4).
- **Attachments:** presigned PUT via Phase 4 (authorization: participant); `attachment_url`
  stored as an **object path**; serializer signs a short-lived GET on read; server-side
  MIME allowlist (images, pdf/doc/docx/txt ≤10 MB, §9.6) with **HTML/SVG rejected**;
  attachment-only messages have empty text. **Attachments are NOT affected by the avatar cache-buster bug** — `Chat.tsx` uses raw `attachment_url` without `getAvatarUrl`.
- **Read receipts:** `PUT` upserts the caller's own `last_read` row (`user_id =
  req.user.id`); `GET` for the **other** user currently returns `null` under RLS
  (§8.4) — **preserve that** (receipts start at "Delivered"); the server-side-read-receipt
  improvement (#13.4) is a flagged nice-to-have, not this phase.
- **Unread counts:** keep the client-computed N+1 head-query endpoints working (§10.6);
  optionally add a server-computed unread summary on the conversation list (#13.3) that
  leaves the frontend contract identical. Decision recorded.
- `messages(conversation_id, created_at)` composite index (Phase 2) supports the count queries.
- **BigInt JSON pitfall handled:** `attachment_size` serializes as a number/string safely
  (JSON.stringify cannot emit BigInt).

### 5. Files/Folders expected
```
backend/src/routes/conversations.routes.ts    # message + last-read sub-routes
backend/src/services/message.service.ts       # atomic send, unread, last-read
backend/src/repositories/messages.repo.ts  last-read.repo.ts
backend/src/serializers/message.serializer.ts # signs attachment GET URLs
backend/test/messages.*.test.ts  attachments.*.test.ts  last-read.*.test.ts
```

### 6. APIs to implement
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/conversations/:id/messages` | history, participant only, order created_at asc (§10.6) |
| POST | `/conversations/:id/messages` | atomic send (message + bump); emits event in Phase 12 |
| GET | `/conversations/:id/messages/unread-count` | head counts (§10.6) |
| GET | `/conversations/:id/last-read/:userId` | other-user row (returns null — parity) |
| PUT | `/conversations/:id/last-read` | own upsert (§10.7) |

### 7. Database work
- None new; composite index already in Phase 2.

### 8. Security work
- Read = participant; send = participant + NOT blocked-in-conversation.
- `last_read` writes scoped to own `user_id` (even though the other-user GET returns null).
- Attachment URLs never leak to non-participants; HTML/SVG rejected server-side;
  downloads served with `Content-Disposition: attachment` where appropriate.

### 9. Testing strategy
- **Unit:** `isBlockedInConversation`; message validation (trim, length, empty-for-attachment).
- **Integration:** send → history asc; attachment round-trip (presign → upload → send →
  read back signed URL); non-participant read/send → 403; blocked-in-conversation send →
  403; **atomicity** (inject a bump failure → message insert rolls back); last_read
  upsert + receipt semantics; unread correctness with and without a last_read row.
- **Concurrency:** two users sending simultaneously.
- **Contract:** shapes per §11.5/#18,21,27,28,29,31,32,35.

### 10. Manual verification checklist
- [ ] Send text → appears for both participants (Phase 12 makes it live; here via refresh).
- [ ] Send an attachment → preview (`📷 Photo` / `📎 name`) + download for both.
- [ ] Unread badges count correctly; read receipt flips Read/Delivered after refresh.
- [ ] A blocked-in-conversation send is rejected.

### 11. Definition of Done
- All 5 endpoints; atomic-send + attachment-security tests green; unread correctness green.
- OpenAPI updated; CI green.

### 12. Estimated complexity
**High.**

### 13. Risks
- **Atomic-send behavior change** (previously non-atomic) → frontend tolerates (echo-
  driven); verified in Phase 13.
- **Read-receipt semantics** (other-user row null) → preserved + documented.
- **Attachment XSS/abuse** → server-side allowlist, no HTML/SVG, signed GET only.
- **Unread-count performance** → composite index + optional server-side summary.

### 14. Rollback strategy
Additive; no production traffic. `last_read`/messages are independent rows.

### 15. Git commit milestone
`feat(backend): messages, read receipts, attachments (atomic send)`
(tag `phase-11-messages`)

### Phase 11 exit checklist
- [x] Project builds
- [x] Tests pass (atomicity, authorization, attachments, unread)
- [x] API documented
- [x] No frontend changes required
- [x] Security verified (invariant #5, attachment allowlist, participant-only URLs)
- [x] Ready to merge

---

## Phase 12 — Realtime (Socket.IO)

**Estimated complexity:** High

### 1. Goal
Socket.IO rooms + events that replicate **all five** Supabase Realtime channel topics
with **identical semantics and authorization** (§8): per-conversation messages +
last-read + presence + typing, and the per-user conversation-updates room. This is where
the realtime security guarantees (§8.3) and the behavior details (§8.4) are reproduced.

### 2. Why this phase comes now
Realtime is the last backend subsystem and depends on the message/conversation/last_read
write paths (Phases 10–11) that now produce events. Doing it last means the events mirror
**verified** behavior rather than defining it. It is also the most concurrency-sensitive
phase, so it gets its own focused milestone.

### 3. Dependencies
- Phase 11 (message send), Phase 10 (conversations), Phase 3 (JWT handshake auth).
- Redis for the Socket.IO adapter (multi-instance) — wired here (D4).

### 4. Deliverables
- **Socket.IO server** (`src/sockets/`): JWT handshake auth (verify access token in the
  `auth` payload → `socket.user.id`); connection lifecycle + disconnect cleanup.
- **Room mapping (§8.5):** `conv:<cid>` (messages + last-read + presence + typing);
  `user:<uid>` (conversation updates).
- **Events (server-emitted, never client-trusted):**
  - `message:new` — after the Phase 11 atomic send; emitted to `conv:<cid>`; **includes
    the sender's own echo** (no self-filter — §8.4 parity).
  - `last-read:update` — `{ userId, conversationId, timestamp }` after a last_read upsert.
  - `conversation:updated` — on any conversation row change affecting a user, emitted to
    that user's `user:<uid>` room (fixes the "subscribe to the whole table" refetch storm,
    §13.2 — same client behavior, backend-only improvement).
  - presence `join`/`leave`/`sync`; `typing` broadcast — per `conv:<cid>`, presence key =
    verified user id (multi-tab collapse natural to Socket.IO presence). **Typing: rate-limited/debounced, single room per conversation per user (no throwaway channel per keystroke); unsubscribe intent on blur.**
- **Requests-changes decision (recorded, §8.2/#5):** the current subscription is **inert**
  (the `requests` table is not in the realtime publication). Option A — replicate inert
  (behavior-identical). Option B — emit a `companions:updated`/request event to
  `user:<uid>` on request status change (§13.1, backend-only; the frontend already
  subscribes). **Recommendation:** ship **A** in this phase for strict parity, then land
  **B** immediately after parity tests pass as a small, reversible improvement.
- **Redis adapter** for horizontal scaling (multiple API instances share rooms/presence);
  core must still run single-instance without it (env opt-in).
- **Abuse controls:** message send stays on HTTP POST (not a socket); per-connection
  limits on joins/typing; event flood caps.

### 5. Files/Folders expected
```
backend/src/sockets/index.ts  rooms.ts  events.ts  presence.ts
backend/src/middleware/socket-auth.ts
backend/test/realtime/*.test.ts     # socket.io-client integration
backend/test/realtime/parity.matrix.test.ts
```

### 6. APIs to implement
- No new REST; the socket event surface above.

### 7. Database work
- None (events from app code; no logical replication; REPLICA IDENTITY not needed).

### 8. Security work
- JWT handshake auth (reject unauthenticated/expired); **room membership enforced on
  every emit** (server verifies the participant before delivering — never trusts the
  client's claimed room); presence key = verified id (no spoofing); payload minimality
  (no emails in events); disconnect → presence leave; reconnection with backoff;
  per-socket event flood limits.

### 9. Testing strategy
- **Socket integration (socket.io-client):** join `conv:<cid>`; send via HTTP →
  `message:new` received by **both** (echo + peer); last_read upsert → `last-read:update`;
  conversation change → `conversation:updated` only to the affected user; presence
  join/leave/sync; typing broadcast; **non-participant cannot join a conv room**;
  invalid/expired token rejected at handshake.
- **Parity matrix (the key artifact):** one test per §8.4 behavior — sender echo, no
  optimistic insert, unread recalc on `conversation:updated`, read-receipt rules,
  soft-delete reveal, presence only-while-mounted.
- **Load:** k6 or a script hammering send+echo; assert ordering and no drops.
- **Multi-instance:** two API instances behind the Redis adapter in docker-compose;
  sockets on instance A receive events from writes on instance B.

### 10. Manual verification checklist
- [ ] Two browsers: message echoes instantly to both; typing indicator; online dot
      appears/disappears; conversation list reorders live on new message; read receipts
      flip live.
- [ ] A non-participant cannot subscribe to a conversation room.

### 11. Definition of Done
- All five channel topics replicated with authorization; parity-matrix tests green;
  Redis-adapter multi-instance verified; requests-changes decision recorded; OpenAPI +
  realtime docs updated; CI green.

### 12. Estimated complexity
**High.**

### 13. Risks
- **Event-parity drift** (biggest) → parity matrix is a hard gate.
- **Presence semantics** (multi-tab, reconnect storms) → presence tests + disconnect cleanup.
- **Emit-authorization miss** → membership enforced on emit, never client-trusted.
- **Redis availability** → adapter opt-in; single-instance fallback.
- **Horizontal-scaling sticky-socket concerns** → Redis adapter + load test in Phase 14.

### 14. Rollback strategy
Additive; no production traffic. The socket transport is feature-flagged; REST remains
functional without it (polling fallback).

### 15. Git commit milestone
`feat(backend): socket.io realtime — messages, read receipts, presence, conversation updates`
(tag `phase-12-realtime`)

### Phase 12 exit checklist
- [x] Project builds
- [x] Tests pass (parity matrix, auth on join, presence, multi-instance)
- [x] API documented (realtime protocol documented alongside OpenAPI)
- [x] No frontend changes required
- [x] Security verified (handshake auth, emit-time membership, no spoofing)
- [x] Ready to merge

---

## Phase 13 — Frontend Adapter & Integration

**Estimated complexity:** High

### 1. Goal
Point the frozen frontend at the new backend with **behavior identical to today** — the
single deliberate frontend change. Replace `src/integrations/supabase/client.ts` and its
consumers with the adapter (D5), feature-flagged per page, and run the full product smoke
suite against both backends to prove parity.

### 2. Why this phase comes now
Everything the frontend needs now exists (REST + realtime + storage + auth, Phases 1–12).
This is the first phase that touches `src/`, so it is **deliberately last** — Supabase
has been the reference implementation for all preceding phases, and the swap happens
once, atomically, behind a flag, with a one-line rollback.

### 3. Dependencies
- **All** of Phases 1–12, live and verified against the adapter contract suite.

### 4. Deliverables
- **Adapter (D5, recommended):** typed API client (`src/lib/api/`) with explicit endpoint
  functions + **mechanical rewrites of the 9–10 hook files** (`useAuth`, `useProfile`,
  `useRequests`, `useChat`, `usePresence`, `useAcceptedCompanions`, `useBlockedUsers`, and
  the page-level call sites in `Dashboard`, `Matched`, `Requests`, `Chats`,
  `ReportDialog`, `TrainAutocomplete`, `ProfileModal`) — preserving each call's shape,
  ordering, and error handling.
  - **Alternative (acceptable per spec §12.2):** a single-file drop-in shim. Rejected as
    primary because re-implementing the PostgREST fluent builder + Realtime channel API is
    a large, subtle, untyped surface (see D5).
- **`client.ts` replacement:** auth/session persistence mirroring GoTrue's localStorage
  shape so `useAuth` works unchanged; auto-refresh on 401 → refresh → retry (mirrors
  `autoRefreshToken`).
- **Realtime swap:** hooks use `socket.io-client` with the §8.5 event/room mapping;
  presence/typing/read receipts verified live.
- **Feature flag per page** (`VITE_USE_NEW_BACKEND` or per-page flags) enabling the Phase
  14 progressive cutover.
- **Env:** `VITE_API_URL` (+ derived socket URL); `VITE_SUPABASE_*` removed at cutover.
- **The 12 canonical user flows** (§12.2 Phase F) smoke-tested end-to-end against the new
  backend: signup/confirm, login, profile + avatar, plan journey, find companions, send
  request, accept/reject/cancel, open chat, send message + attachment, read receipts,
  typing + presence, soft delete, block/unblock, report.
- localStorage keys `journeyData` / `matches` unchanged; the auth-token key changes to the
  adapter's namespace (documented). **Contract suite asserts exact localStorage key format
  (`trainmate-auth-token` or equivalent): access_token, refresh_token, expires_at,
  user{id,email}; migration/re-login works at cutover.**
- `onAuthStateChange` event set: **SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED,
  PASSWORD_RECOVERY** (GoTrue parity); adapter must emit in this order.

### 5. Files/Folders expected
```
src/integrations/supabase/client.ts        # replaced by the API client
src/lib/api/                               # typed client (auth, profiles, journeys, requests,
                                           # conversations, messages, storage, trains, moderation)
src/integrations/sockets/                  # socket.io wrapper + event map
src/hooks/*.ts(x)                          # mechanical rewrites (behavior-identical)
src/config/env.ts                          # VITE_API_URL etc.
src/test/contract/*.test.ts                # the 60-call-site contract suite
e2e/                                       # Playwright: the 12 flows
```

### 6. APIs to implement
- None new — consumes the full §10 surface built in Phases 3–11.

### 7. Database work
- None.

### 8. Security work
- Session storage parity (localStorage — same tradeoff as today; secure-cookie variant is
  post-migration); no secrets in the bundle; token refresh wiring with bounded retries;
  the avatar cache-buster quirk preserved (optional fix deferred).

### 9. Testing strategy
- **Contract suite (the key artifact):** for each of the **60 call sites in §11**, assert
  the new API returns the exact shape/behavior the hook expects. Run it against **both**
  Supabase and the new backend to prove parity. **Asserts exact localStorage key format
  and `onAuthStateChange` event sequence (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED,
  USER_UPDATED, PASSWORD_RECOVERY).**
- **Playwright E2E** of the 12 flows against the new backend (frontend unchanged except
  the adapter).
- **A/B smoke:** same E2E suite with the flag on vs off; diff the outcomes.
- **Realtime E2E:** two browsers chat live (echo, receipts, typing, presence).

### 10. Manual verification checklist
- [ ] Walk every page with the flag on: login, signup/confirm, dashboard, plan journey,
      matched, requests, chats, chat (attachments, read receipts, typing, presence,
      soft delete), block/unblock, report, profile edit + avatar.
- [ ] No console errors, no 4xx/5xx in the network tab, no behavior diffs vs flag-off.

### 11. Definition of Done
- All 12 flows pass against the new backend with the flag on; contract suite green on both
  backends; A/B smoke shows **no behavior diffs**.
- The only `src/` changes are the adapter + hook rewires (documented diff).
- Cutover runbook drafted for Phase 14.

### 12. Estimated complexity
**High** — proving parity is the project's riskiest *integration* work.

### 13. Risks
- **Behavior drift hidden in the adapter** → contract suite + A/B E2E are hard gates.
- **Shim-vs-rewrite complexity** → resolved by D5; the typed client keeps rewrites mechanical.
- **Realtime client subtlety** (sender echo) → parity matrix (Phase 12) re-run in-browser.
- **localStorage session-shape mismatch** → contract test asserts the exact keys.

### 14. Rollback strategy
**The flag.** Flip off → Supabase path restored instantly. Data is shared (same Postgres
until cutover), so there is no divergence.

### 15. Git commit milestone
`feat(frontend): adapter layer + integration with the new backend`
(tag `phase-13-adapter`)

### Phase 13 exit checklist
- [x] Project builds (frontend + backend)
- [x] Tests pass (contract suite both backends, 12-flow E2E, A/B smoke)
- [x] API documented
- [x] **No *unplanned* frontend changes** — only the adapter + hook rewires (the single
      deliberate change; diff reviewed)
- [x] Security verified (session parity, token refresh, no secrets in bundle)
- [x] Ready to merge

---

## Phase 14 — Cutover, Deployment & Rollback

**Estimated complexity:** High (operational/coordination, low technical novelty)

### 1. Goal
Production-hardening and the coordinated switch: deploy the new stack (API + DB +
storage + Redis), **migrate production data** (drill + live), flip the flag per page,
monitor, and establish the rollback playbook. Then decommission Supabase.

### 2. Why this phase comes now
Everything is built and verified. Cutover is the last mile and carries real user impact,
so it is sequenced last, gated on Phase 13's A/B green, and executed as a **reversible,
monitored** flip.

### 3. Dependencies
- Phase 13 (adapter + flags) green; all phases live.

### 4. Deliverables
- **Production infrastructure** (detail in [§6](#6-recommended-production-deployment-architecture)):
  managed Postgres; AWS S3 or Cloudflare R2 buckets + least-privilege IAM; Redis; 2+ API
  instances behind a load balancer; Socket.IO Redis adapter (Phase 12); frontend on Vercel
  with `VITE_API_URL`.
- **Deployment pipeline:** containerized API (Phase 1 Dockerfile), CI/CD (registry +
  rolling rollout), `prisma migrate deploy` as a deploy step, zero-downtime (health-gated).
- **Data migration execution** (Phase 2 runbook) against a production snapshot:
  row-count + checksum verification, identity continuity, bcrypt +
  `email_confirmed_at` carry-over, URL backfill verification.
- **Cutover plan:** per-page flag flip (time-boxed), staged rollout (internal → 1% → 10%
  → 50% → 100%), monitoring dashboards, alerting, 12-flow smoke monitors.
- **Rollback playbook:** flag-off reverts to Supabase; DB divergence bounded by the cutover
  window (documented); restore-from-snapshot path rehearsed.
- **Observability:** structured logs, request/metrics dashboards, DB + socket-connection
  metrics, p99 latency, error rates; alerts on auth failures, storage errors, and
  **authorization-invariant monitors** (a periodic probe that asserts Part I invariants).
- **Decommission checklist:** suspend Supabase writes, verify zero traffic, final snapshot,
  remove Supabase after retention, remove `VITE_SUPABASE_*` from Vercel.
- **Post-cutover hardening (small, tracked):** the requests-changes realtime fix (if
  deferred from Phase 12), server-side read receipts option, unread-count optimization,
  avatar cache-buster fix decision, scheduled expired-request cleanup, sorted-pair unique
  on conversations.

### 5. Files/Folders expected
```
deploy/terraform/  (postgres, buckets+IAM, redis, secrets, networking)
deploy/k8s-or-compose.prod.yml              # API rollout + socket adapter
deploy/runbooks/{cutover.md, rollback.md, decommission.md, data-migration.md, key-rotation.md}
.github/workflows/deploy.yml
monitoring/  (dashboards, alert rules, authz probe)
```

### 6. APIs to implement
- None new (ops + hardening).

### 7. Database work
- Production migration + verification; validated backups/PITR; retention of the old
  Supabase snapshot until decommission; connection pooling (PgBouncer) sizing.

### 8. Security work
- Secrets manager (DB URL, JWT secret, storage keys, email provider); private DB network;
  TLS everywhere; audit logging; IAM least-privilege; environment separation (staging ==
  prod config); key-rotation runbook; post-cutover security re-review of Part I.

### 9. Testing strategy
- **Load test** on the production-sized stack (k6): auth, journeys, matching, requests,
  messages, realtime echo — establish baseline and saturation.
- **Chaos-lite:** restart an API instance → sockets reconnect, no data loss; Redis down →
  sockets degrade, REST unaffected.
- **Full dry-run of cutover + rollback in staging twice** before touching prod.
- **Post-cutover smoke monitors** for 7 days (the 12 flows + authz probe).

### 10. Manual verification checklist
- [ ] Staging dry-run of cutover and rollback passes twice.
- [ ] Production flip window: 12-flow smoke under monitoring; a real user completes
      signup → chat.
- [ ] Rollback exercise: flag off → Supabase serves; data reconciled.

### 11. Definition of Done
- New stack serves 100% of traffic; data verified (counts + checksums); rollback rehearsed.
- Supabase decommissioned (or frozen) after retention; monitoring/alerts live; runbooks
  written; hardening backlog triaged.

### 12. Estimated complexity
**High** operationally (coordination, monitoring, blast-radius management).

### 13. Risks
- **Cutover data-loss/split-brain window** → write-drain + flag flip + verify; bounded and
  documented; rehearse twice.
- **Env/DNS propagation** → staged rollout + smoke monitors.
- **Socket.IO multi-instance issues** → Redis adapter + load test + chaos-lite.
- **Provider availability** (email, DB, storage) → multi-AZ/region, retries, fallbacks.

### 14. Rollback strategy
Flag-off → Supabase (REST + realtime + storage) restored. If rollback is needed after
writes land in the new DB, restore the pre-cutover snapshot + reapply (bounded, rehearsed).
**Supabase is not removed until the retention window passes and zero traffic is verified.**

### 15. Git commit milestone
`chore(deploy): production cutover + rollback runbook`
(tag `phase-14-cutover`)

### Phase 14 exit checklist
- [x] Project builds (deploy artifacts)
- [x] Tests pass (staging dry-run, load, chaos-lite)
- [x] API documented (runbooks + architecture diagrams)
- [x] No frontend changes required (beyond the Phase 13 adapter)
- [x] Security verified (Part I re-review, secrets, TLS, authz probe live)
- [x] Ready to merge — **migration complete**

---

# Part III — After the roadmap

## 1. Total estimated project complexity

**Aggregate: High.** Across 14 phases this is a full greenfield backend (≈24 engineer-weeks
nominal) with the added burden of **behavioral parity against a live system** — the
hardest kind of migration, because correctness is defined by the frontend contract, not
by a feature list.

| Dimension | Assessment |
| --- | --- |
| Lines-of-code estimate | ~8–12k LOC backend (routes/services/repos/sockets), ~1.5–2.5k frontend adapter |
| Data migration | One-shot, idempotent, tooled (Phase 2) — medium complexity, high stakes |
| Security surface | High — every RLS policy must be re-proven in code (Part I) |
| Realtime parity | High — subtle socket semantics (echo, receipts, presence) |
| Frontend parity risk | High — the adapter must be byte-for-byte behaviorally identical |
| Operations | Medium-High — cutover, monitoring, runbooks |
| Team shape | Best with 2 engineers (critical path + parallelizable phases 4/5/7); 1 engineer ≈ 5–6 months |

The **top three effort sinks** are Phase 3 (auth security), Phase 11/12 (messaging +
realtime), and Phase 13 (parity). Budget review time for the Part I map before Phase 6,
and for the Phase 14 rehearsals.

## 2. Biggest technical risks

Ranked by impact × likelihood (each with its mitigation — all are already in the phases):

1. **RLS semantic drift** — a policy missed or subtly changed in the service layer is a
   security regression (privacy leaks, unauthorized reads/writes). *Mitigation:* Part I
   is the signed-off checklist; one test per policy; centralized `access.service.ts`;
   the Phase 14 authz probe; a security re-review at cutover.
2. **Realtime parity** — echo/read-receipt/presence semantics are subtle and the frontend
   depends on them exactly. *Mitigation:* the parity matrix (Phase 12) + browser A/B
   smoke (Phase 13).
3. **Identity & password continuity** — if carried-over bcrypt hashes don't verify, every
   existing user is forced to reset. *Mitigation:* verify during the Phase 2 staging drill;
   fallback documented (forced reset) as last resort.
4. **Legacy signed-URL backfill** — rewriting 1-year Supabase URLs to object paths must
   not orphan avatars/attachments. *Mitigation:* backfill SQL reviewed; verify step checks
   path↔object existence in storage (Phase 4).
5. **Adapter behavior drift** — the swap changes observable behavior invisibly.
   *Mitigation:* the 60-call-site contract suite + A/B E2E as hard gates.
6. **Cutover data-loss / split-brain** — writes landing in the new DB while Supabase is
   still live. *Mitigation:* write-drain order, flag flip, bounded window, rehearsed
   restore path.
7. **Email-delivery dependency** — signup confirmation is required for parity; an email
   provider outage blocks new users. *Mitigation:* provider abstraction, console fallback,
   retry queue, idempotent confirm endpoint.
8. **Multi-instance realtime** — rooms/presence must survive horizontal scaling.
   *Mitigation:* Redis adapter + multi-instance test + load/chaos in Phase 14.
9. **Attachment abuse/XSS** — uploaded HTML/SVG or oversized payloads.
   *Mitigation:* server-side allowlist, HTML/SVG rejection, signed GETs, size caps.
10. **Prisma expressiveness gaps** (uuid[], GIN, CHECK, bigint) — porting errors.
    *Mitigation:* the schema-inventory manifest test (Phase 2).
11. **Email leakage via blanket GRANT** — migration `20260725073436` blanket `GRANT SELECT ON ALL TABLES` overrides column-level `REVOKE SELECT(email)` on `profiles`; RLS filters rows not columns; `profiles_safe` view unused. New serializer must never return another user's email; parity test asymmetry documented. *Mitigation:* explicit serializer invariant test; Part I map documents deployed reality.
12. **Presence/typing authorization gap** — presence/broadcast are a separate Realtime primitive not gated by RLS; any authenticated user can join `presence-<cid>` and channel names leak conversation UUIDs. *Mitigation:* Phase 12 Socket.IO room join enforces participant checks + typing rate-limiting.
13. **Non-transactional unverified_trains insert** — `Dashboard.tsx` inserts unverified row before journey insert with no transaction; failures leave orphan rows. *Mitigation:* Phase 7 atomic transaction + failure-injection tests + cleanup query for pre-existing orphans.
14. **Server-validator bounds divergence** — client zod (`journeySchema`) vs DB CHECK constraints can diverge; server must enforce DB bounds regardless of client validation. *Mitigation:* server-side validation mirrors DB CHECKs; Part I map tracks this.
15. **`deleted_for` permanence** — soft-delete is append-only; `deleted_for` never auto-removed; conversations do NOT reappear on new message. Direct URL still works. *Mitigation:* Phase 10 tests assert permanent hide; acceptance criteria encode parity.

## 3. Critical migration points

The moments that demand the most attention — in rough order of when they occur:

1. **The `auth.users → users` port** (§3.6, Phase 2/3) — carries **UUIDs, bcrypt password
   hashes, and `email_confirmed_at`**. If UUIDs change, identity continuity is lost; if
   hashes don't verify, users must re-register; if confirmation status is lost, everyone
   must re-confirm. **Verify all three on a staging copy of the real data before cutover.**
2. **Legacy signed-URL rewrite** (§7.4, Phase 2) — existing `avatar_url` and
   `messages.attachment_url` rows hold 1-year Supabase URLs. They must be rewritten to
   object paths so the Phase 4 sign-at-read model works. Verify path↔object existence.
3. **Every RLS policy → service check** (Part I, Phases 5–11) — the authorization map is
   the contract for "preserve all security guarantees." Any gap is a regression.
4. **The dead `requests-changes` subscription** (§8.2/#5, Phase 12) — decide explicitly:
   replicate-inert (parity) or fix (improvement). Document the choice; don't leave it
   accidental.
5. **Conversation creation immutability + soft delete** (§3.2, Phase 10) — the dual-layer
   guard (service + tamper trigger) and the "only via soft-delete endpoint" rule for
   `deleted_for`.
6. **The `chat-attachments` bucket gap** (§7.1, Phase 4) — it exists only via the
   dashboard today; the new IaC/compose must create it explicitly.
7. **Read-receipt semantics** (§8.4, Phase 11) — the other-user `last_read` row returns
   null today; preserve it or deliberately improve it (#13.4), but don't let it flip
   silently.
8. **Session/localStorage continuity** (§5.1, Phase 13) — the adapter must persist and
   restore the session exactly as GoTrue did, or every user gets logged out on cutover.
9. **Email confirmation UX** (§5.1) — confirmation stays enabled; the no-hint quirk stays.
   The confirmation link must survive the domain change (send via the same origin).
10. **The 2-day expiry + re-send semantics** (§9.4, Phase 9) — expired-cleanup is
    sender-side-only; rejected requests can be re-sent; cancel is a hard delete. These
    three rules are easy to "improve" into a behavior change.

## 4. Features that should NEVER be implemented until the migration is complete

Adding these now would compound the port's complexity and fork business logic onto the
old stack. **Freeze the schema and feature set as the contract (§12.1).**

- **Push notifications (FCM/APNs).** New infra + a delivery worker; would be built on the
  wrong stack and is the single most-likely "new phase" to get requested. It belongs in
  Nice-to-haves #5 after Supabase is gone.
- **Message editing / deletion.** Requires new `messages` UPDATE/DELETE semantics,
  realtime events, and UI — a wholesale change to the messaging contract mid-migration.
- **Group / multi-participant conversations.** The schema (`participants uuid[]`,
  `can_create_conversation`) and RLS are built for exactly-two. This is a deep
  architectural change; it is listed as future work in the architecture doc (§15).
- **E2E encryption.** Changes the message pipeline and realtime semantics end-to-end.
- **An admin dashboard / moderation queue** consuming the new APIs. Until the new API is
  the source of truth, admin tooling built on Supabase is wasted; built against an
  unshipped API it is speculative.
- **A server-side "journey matching service" / proactive suggestions.** Today "matches"
  are client-side localStorage state (§9.2). Forking a server-side matcher now splits
  business logic mid-migration.
- **Any new Supabase feature usage** (Edge Functions, new Realtime features, `pg_net`,
  new tables). Every new dependency makes the port harder.
- **Any change to the public tables** (new columns/tables/indexes) not required by the
  migration itself — the schema is the frozen contract.

## 5. Nice-to-have improvements after the migration

Deferred deliberately; each is safe once the new backend is the source of truth. The
spec's §13 list, mapped:

1. **Fix the `requests-changes` realtime gap** (§13.1) — already a Phase 12 recommendation.
2. **Server-side unread counts** on the conversation list (§13.3) — removes client N+1.
3. **Server-side read receipts for the *other* user** (§13.4) — flips "Delivered" earlier.
4. **Avatar cache-buster fix** (§13.6) — make ProfileMenu/ViewProfileModal avatars render;
   a tiny adapter/URL-layer change, or a deliberate frontend fix.
5. **Email-confirmation hint after signup** (§13.7) — a documented UX gap; needs a small
   frontend change.
6. **Scheduled expired-request cleanup** (§13.9) — move the client-triggered sweep to a cron.
7. **Train-directory hygiene** (§13.10) — review/promote `unverified_trains` to `trains`.
8. **Sorted-participant unique constraint on conversations** — harden against
   duplicate-conversation races once the frontend tolerance is verified.
9. **Push notifications** — the big one; a worker that reads `messages` and delivers
   FCM/APNs (Architecture §15).
10. **Admin dashboard** — train CRUD, report review, user moderation.
11. **Message editing/deletion, group conversations, E2E encryption, analytics** —
    Architecture §15 items, in a sensible order (analytics before group chat).
12. **Storage hygiene:** S3 lifecycle rules for orphaned attachments (on conversation
    soft-delete), malware scanning, attachment download hardening.
13. **Auth hardening:** secure-cookie refresh-token storage, MFA, account-recovery flows.

## 6. Recommended production deployment architecture

```
                        ┌───────────────────────────────┐
  Users (India, mobile) │  Frontend (unchanged)         │
        │               │  Vercel SPA  (or S3+CloudFront)│
        │  HTTPS        └───────────────┬───────────────┘
        ▼                                │  VITE_API_URL
┌───────────────┐        ┌────────────────▼───────────────┐
│ CDN / LB      │───────▶│  API (Express, Docker)         │
│ (e.g. ALB/NLB)│        │  ≥2 instances across 2 AZs     │
└───────────────┘        │  REST + Socket.IO (Redis adptr)│
                         └───┬───────────────┬────────────┘
                             │              │
              ┌──────────────▼───┐   ┌──────▼───────────────┐
              │ PostgreSQL       │   │ Redis (Socket.IO     │
              │ managed (RDS/    │   │ adapter, rate limit) │
              │ Neon), PgBouncer │   └──────────────────────┘
              │ PITR + backups   │
              └──────────────────┘
                             │  presigned URLs (paths stored in DB)
              ┌──────────────▼──────────────────────────────┐
              │ Object storage: AWS S3  (or Cloudflare R2)  │
              │ buckets: avatars, chat-attachments (private)│
              └─────────────────────────────────────────────┘
        Supporting: secrets manager, transactional email (Resend/SES),
        observability (logs, metrics, traces, dashboards), CI/CD (GitHub Actions →
        registry → rolling deploy with `prisma migrate deploy` step), k6 load.
```

Key decisions behind this shape:
- **Frontend stays on Vercel** through cutover (zero-risk change) and only gains
  `VITE_API_URL`. A move to S3+CloudFront is a later, optional optimization.
- **Managed Postgres** (RDS or Neon) over running Postgres in the API cluster — backups,
  PITR, patching, and multi-AZ are table stakes; the Phase 2 tooling works against any
  Postgres 17.
- **S3 (or R2)** for storage per D2; **R2** is the cost play (free egress) if the team
  prefers; both are S3-compatible behind one client.
- **≥2 API instances** for HA; the **Redis Socket.IO adapter** (Phase 12) keeps sockets
  consistent; REST is stateless.
- **Region:** near users (Indian rail commuters) — e.g. `ap-south-1` for API/DB/storage,
  with the CDN handling global delivery; measure latency to choose.
- **Staging mirrors prod config exactly** (same envs, same secrets structure, same data
  shape via a restored snapshot) so the Phase 14 dry-run is representative.
- **DR:** nightly PITR + off-site backups; the cutover runbook is the recovery playbook;
  Supabase snapshot retained until after the retention window.

## 7. Long-term scalability recommendations

- **Connection pooling** with PgBouncer (or Neon's pooling) as concurrency grows; Prisma
  sits on the pool.
- **Read replicas** for the read-heavy paths (companion matching, message history) once
  load justifies; keep writes on the primary.
- **Message archiving:** partition `messages` by `created_at` (monthly) and archive
  conversations older than N months to cold storage; the schema already keys everything
  by conversation.
- **Realtime scale:** the Redis adapter + connection count monitoring; later, presence
  sharding and per-instance room affinity; consider a dedicated socket tier.
- **Caching:** Redis for the trains directory and hot profile lookups (short TTL);
  server-computed unread summaries (Nice-to-have #2) remove the N+1.
- **Matching performance:** the `journeys(train_number, travel_date)` index today; a
  materialized/covering index or a dedicated matching service (Architecture §12) only
  when EXPLAIN says so — the query is exact-match, which indexes well.
- **Observability-driven scaling:** instrument p99, error budgets, socket counts, and DB
  load; scale on evidence, not guesses.
- **Data retention & privacy:** user deletion already cascades via FKs; add a hard-delete
  service + object-storage purge (avatar/attachment cleanup on delete) and a documented
  retention policy.
- **Cost guardrails:** R2 egress savings, lifecycle rules on `chat-attachments`, right-size
  the Postgres instance, budget alerts.

---

# Appendices

## A. Endpoint → phase traceability

Every required endpoint from §10 and the phase that ships it.

| § | Endpoint | Phase |
| --- | --- | --- |
| 10.1 | POST `/auth/register` · login · refresh · logout · `GET /auth/session` · `POST /auth/confirm-email` | 3 |
| 10.2 | `GET /profiles/me` · `PATCH /profiles/me` · `GET /profiles/:userId` · `GET /profiles/:userId/name` | 6 |
| 10.3 | `GET /journeys/me` · `POST /journeys` · `DELETE /journeys/:id` · `GET /journeys/:train/:date/companions` | 7 (3) / **8** (companions) |
| 10.4 | `GET /requests/me` · `POST /requests` · `PATCH /requests/:id` · `DELETE /requests/:id` · `POST /requests/cleanup-expired` · `GET /requests/me/accepted` · `GET /requests/incoming/pending-count` | 9 |
| 10.5 | `GET /conversations` · `POST /conversations` · `DELETE /conversations/:id/for-me` | 10 |
| 10.5 | `PATCH /conversations/:id` (preview bump) | 11 (internal to send) |
| 10.6 | `GET /conversations/:id/messages` · `POST /conversations/:id/messages` · `GET /conversations/:id/messages/unread-count` | 11 |
| 10.7 | `GET /conversations/:id/last-read/:userId` · `PUT /conversations/:id/last-read` | 11 |
| 10.8 | `POST /storage/avatars/presign` · `POST /storage/avatars/upload-url` · `POST /storage/chat-attachments/presign` | 4 |
| 10.9 | `GET /trains?q=` · `POST /trains/unverified` | 7 |
| 10.10 | `GET /blocked-users` · `POST /blocked-users` · `DELETE /blocked-users/:blockedId` · `POST /reports` | 5 |

## B. Frontend call-site coverage

Every hook/page in §11 is satisfied by the endpoint surface above **by Phase 13**. The
contract suite (Phase 13) proves parity one call site at a time. Summary mapping:

| Source (§11) | Supabase surface | Served by |
| --- | --- | --- |
| `client.ts` (11.1) | createClient config | replaced by the Phase 13 adapter |
| `useAuth.tsx` (11.2) | onAuthStateChange, getSession, signOut, signInWithPassword, signUp | Phase 3 + Phase 13 session wiring |
| `useProfile.ts` (11.3) | profile CRUD + avatar storage | Phases 6 + 4 |
| `useRequests.ts` (11.4) | request CRUD + expiry | Phase 9 |
| `useChat.tsx` (11.5) | messages, conversations, last_read, storage, soft-delete RPC | Phases 10 + 11 + 4 |
| `usePresence.ts` (11.6) | presence + typing channels | Phase 12 |
| `useAcceptedCompanions.ts` (11.7) | accepted queries + `requests-changes` channel | Phase 9 + Phase 12 decision |
| `useBlockedUsers.ts` (11.8) | blocked CRUD | Phase 5 |
| `Dashboard.tsx` (11.9) | badge, journeys, companions, unverified, journey CRUD | Phases 7 + 8 + 9 |
| `Matched.tsx` (11.10) | send + accept | Phases 8 + 9 |
| `Chats.tsx` / `Requests.tsx` (11.11/11.12) | own-name fetch | Phase 6 |
| `ProfileModal.tsx` (11.13) | other profile | Phase 6 |
| `ReportDialog.tsx` (11.14) | report insert | Phase 5 |
| `TrainAutocomplete.tsx` (11.15) | train search | Phase 7 |
| Indirect (11.16) | env vars, localStorage, email, websocket endpoint | Phase 13 + 14 |

## C. Environment matrix

| Env | Dev (compose) | Test (CI) | Staging | Production |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | compose postgres | disposable test DB | managed Postgres | managed Postgres + PgBouncer |
| `JWT_SECRET` / `REFRESH_SECRET` | .env | .env | secrets manager | secrets manager |
| `S3_*` (endpoint, keys, buckets) | MinIO | MinIO | S3/R2 | S3/R2 |
| `REDIS_URL` | compose redis | — | managed | managed |
| `EMAIL_*` (provider) | console | console | provider sandbox | provider |
| `CORS_ORIGIN` | localhost:5173 | — | staging frontend | production frontend |
| Frontend: `VITE_API_URL` (+ socket) | — | — | — | added in Phase 13 |
| Frontend: `VITE_SUPABASE_*` | present | present | present | **removed at cutover** |

## D. Governance & phase-exit criteria

- **Exit gates:** a phase is "done" only when its closing checklist is green **and** its
  cross-phase handoff test (where specified) is authored for the next phase. Phase exits
  are reviewed by the lead (or via PR review); Part I rows are the security gate.
- **Change control:** changes to the spec's schema/business rules/RLS **do not happen
  during the migration** (see §4 above). If a change is unavoidable, it is handled as a
  spec amendment with the authorization map updated first.
- **DoD ownership:** the document owner (Lead Backend Engineer) owns the roadmap; the
  `docs/Backend-Specification.md` remains the source of truth for behavior.
- **Tracking:** one tracked task per phase; `phase-*` git tags as milestones; the CI
  badge and OpenAPI build are the "API documented" proof.

---

*End of roadmap. Prepared from `docs/Backend-Specification.md` and
`docs/Backend-Architecture.md`. No backend code was implemented, no frontend was
modified, and Supabase remains the running implementation until Phase 14.*
