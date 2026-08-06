# TrainMate v2 — Backend Specification

**Migration blueprint: Supabase → Self-hosted Node.js / Express / PostgreSQL / Prisma / JWT / Socket.IO**

> Status: **DRAFT** — produced by a read-only production migration assessment.
> No backend code exists yet. This document describes the *current production system*
> (frontend + Supabase) and specifies the *target backend* it will be rebuilt on,
> in enough detail that a future implementation phase can be started without
> reverse-engineering anything.
>
> Constraint honored throughout: **the React frontend is the contract.** Every rule,
> every endpoint, every schema shape below is derived from what the frontend
> actually calls and expects. The migration must keep frontend behavior identical.

---

## Table of contents

1. [System overview](#1-system-overview)
2. [Folder architecture](#2-folder-architecture)
3. [Complete database schema](#3-complete-database-schema)
4. [Table relationships](#4-table-relationships)
5. [Authentication flow](#5-authentication-flow)
6. [Authorization (RLS rules)](#6-authorization-rls-rules)
7. [Storage architecture](#7-storage-architecture)
8. [Realtime messaging architecture](#8-realtime-messaging-architecture)
9. [Business rules](#9-business-rules)
10. [Required REST API endpoints](#10-required-rest-api-endpoints)
11. [Existing frontend dependencies on Supabase](#11-existing-frontend-dependencies-on-supabase)
12. [Migration strategy from Supabase to Express](#12-migration-strategy-from-supabase-to-express)
13. [Possible improvements while keeping frontend behavior identical](#13-possible-improvements-while-keeping-frontend-behavior-identical)

---

## 1. System overview

**TrainMate** is a train-companion social application. Users register with
email/password, plan rail journeys (Indian Railways train number + travel date),
get matched with other users travelling on the *exact same train and date*, send
mutual companion requests, and — once a request is accepted — chat in real time.
Moderation features (blocking, reporting) and a train-number reference directory
round out the system.

### Current production architecture

| Layer | Technology | Notes |
| --- | --- | --- |
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query + react-router | SPA served statically (Vercel) |
| Backend | **Supabase** (Postgres + GoTrue auth + Realtime + Storage) | No custom server code exists |
| Database | PostgreSQL 17.6 (Supabase managed, project ref `dfkbtusmnrhzaonouhsk`, region `ap-northeast-1`) | 10 public tables, all RLS-enabled |
| Auth | Supabase Auth (GoTrue), email/password only | JWT access tokens + refresh tokens, persisted in `localStorage` |
| Realtime | Supabase Realtime v2 (websockets): postgres_changes + presence + broadcast | 5 channel topics, 3 tables in the realtime publication |
| Storage | Supabase Storage (S3-compatible): buckets `avatars` and `chat-attachments` | Both **private**; all access via 1-year signed URLs |
| Deployment | Vercel (SPA only) + managed Supabase | Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` |

### Product flows (as implemented)

```
Sign up / log in  →  create profile (auto-created by DB trigger)
         ↓
Plan journey (train_number + travel_date + coach + route + college/gender)
         ↓
"Find companions" = exact match on (train_number == train_number AND travel_date == travel_date)
         ↓
Send companion request (status=pending) → recipient accepts/rejects
         ↓
Accepted pair  →  conversation created → realtime chat + presence + read receipts + attachments
         ↓
Moderation: block (hides user app-wide), report (moderation queue)
```

### Key architectural facts (verified against source)

1. **Zero custom backend code.** Everything the app does is the frontend calling the
   Supabase PostgREST/Realtime/Storage/GoTrue APIs directly through `@supabase/supabase-js`.
   There is exactly **one RPC** the frontend invokes: `soft_delete_conversation`.
2. **Authorization is 100% database-enforced** via RLS policies backed by a set of
   `SECURITY DEFINER` helper functions (`can_view_profile`, `is_blocked`, ...). The
   frontend does not filter on authorization anywhere that matters.
3. **Business logic is split between the DB (integrity rules) and the frontend
   (UX rules).** Matching, request status transitions, and privacy boundaries live in
   Postgres; journey categorization, "today/past/upcoming", coach/college/gender
   filtering, and unread-count computation live in React.
4. **Email is a sensitive field.** Column `SELECT` on `profiles.email` is revoked; the
   only sanctioned read path is the `profiles_safe` view (email visible to the owner only).
   `journeys.user_email` was dropped after a leak.
5. **Realtime has a latent dead subscription** (`requests-changes`): the `requests`
   table is **not** in the `supabase_realtime` publication, so the companion list only
   refreshes on hook mount, not live.
6. **Storage is signed-URL based** and the frontend has a cache-buster that *drops the
   signed token* in some render paths — a documented quirk that must be preserved or
   deliberately fixed (see §7 and §13).

### Target architecture (planned — NOT built)

| Layer | Target technology |
| --- | --- |
| Backend | **Node.js + Express.js** (TypeScript) |
| Database | **PostgreSQL** (self-hosted or managed) + **Prisma ORM** |
| Auth | **JWT access tokens + refresh tokens** (stateless access, rotating refresh) |
| Realtime | **Socket.IO** rooms mirroring the current channel topics |
| Storage | S3-compatible object storage (MinIO in Docker dev, AWS S3 / R2 in prod) |
| Runtime | **Docker** (compose: api, postgres, minio, redis) |
| Migration path | Direct database port of the existing schema, behavior-identical API layer |

---

## 2. Folder architecture

### 2.1 Current frontend structure (read-only reference)

```
src/
  App.tsx                    # Router + providers (AuthProvider, QueryClient, Theme)
  main.tsx
  components/
    ProfileMenu.tsx          # Header avatar → ViewProfileModal (own profile)
    ViewProfileModal.tsx     # Own profile + logout + theme toggle
    EditProfileModal.tsx     # Edit name/bio/hobbies/college/gender + avatar upload
    ProfileModal.tsx         # OTHER user's profile (fetched on open)
    ImageCropModal.tsx       # react-easy-crop avatar crop → 256×256 JPEG blob
    ProfileImageViewer.tsx   # Full-screen avatar viewer
    ReportDialog.tsx         # Report a user (free-text reason)
    TrainAutocomplete.tsx    # Debounced train search (trains table) + unverified fallback
    TypingIndicator.tsx / OnlineStatus.tsx / UnreadBadge.tsx
    ProtectedRoute.tsx       # Auth gate (spinner while loading, redirect to /login)
    SkeletonCard.tsx / EmptyState.tsx
  hooks/
    useAuth.tsx              # AuthProvider context (user/session/signIn/signUp/logout)
    useProfile.ts            # Own + other profile, avatar upload/signed URL, cache-buster
    useRequests.ts           # Requests list, send/accept/reject/cancel, expiry cleanup
    useChat.tsx              # Messages, conversations, read receipts, unread counts, chat RPC
    usePresence.ts           # Presence channel + typing broadcast
    useAcceptedCompanions.ts # Accepted requests (sent + received), realtime refresh
    useBlockedUsers.ts       # blocked_users CRUD
  pages/
    Login.tsx  Dashboard.tsx  Matched.tsx  Requests.tsx  Chats.tsx  Chat.tsx  NotFound.tsx
  integrations/supabase/
    client.ts                # createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)
    types.ts                 # GENERATED database types (schema reference; not authoritative)
  lib/
    validations.ts           # zod: journeySchema, messageSchema, requestStatusSchema
    chatFormat.ts            # message time / date separator formatting
    utils.ts
```

### 2.2 Target backend structure (planned)

```
backend/
  Dockerfile
  docker-compose.yml          # api, postgres, minio, redis (dev)
  .env.example
  package.json / tsconfig.json
  prisma/
    schema.prisma             # 1:1 port of the Postgres schema (see §3)
    migrations/               # Prisma migrate history
  src/
    index.ts                  # Entry: HTTP server + Socket.IO server + start
    app.ts                    # Express app assembly (middleware, routes, error handler)
    config/
      env.ts                  # Zod-validated env (JWT_SECRET, DATABASE_URL, S3_*, ...)
    middleware/
      authenticate.ts         # Verify access JWT → req.user
      refresh.ts              # Verify refresh JWT (rotating) → new token pair
      authorize.ts            # Application-level policy checks (mirrors RLS)
      error-handler.ts
      rate-limit.ts
    routes/
      auth.routes.ts          # register, login, refresh, logout
      profiles.routes.ts
      journeys.routes.ts
      requests.routes.ts
      conversations.routes.ts
      messages.routes.ts
      storage.routes.ts       # presigned upload/download URL issuance
      trains.routes.ts        # train directory + unverified submissions
      moderation.routes.ts    # block, unblock, report
    services/                 # Business logic (one module per aggregate)
      profile.service.ts
      journey.service.ts
      request.service.ts
      conversation.service.ts # incl. soft-delete, tamper guard
      message.service.ts
      presence.service.ts
    repositories/             # Prisma data access (thin)
    sockets/
      index.ts                # Socket.IO setup + JWT handshake auth
      rooms.ts                # conversation room membership (mirrors realtime topics)
      events.ts               # message:new, conversation:updated, last-read:updated,
                              # presence (join/leave/sync), typing
    utils/
      jwt.ts  ids.ts  s3.ts  sanitize.ts
```

---

## 3. Complete database schema

### 3.1 Source of truth

The authoritative schema is the concatenation of the 31 migrations in
`supabase/migrations/` (also rendered as `migration/schema.sql`, generated
2026-07-23). The final state is described below. **Postgres 17.6, public schema.**

> ⚠️ `migration/schema.sql` predates the last migration
> `20260725073436_grant_authenticated_table_privileges.sql` (which grants
> `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` + sequences to
> `authenticated`). When porting, prefer `supabase/migrations/*` in order.

### 3.2 Tables (final state)

#### `public.profiles`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | — | PK; FK → `auth.users(id)` ON DELETE CASCADE |
| `email` | `text` | YES | — | **Column SELECT revoked** from `authenticated`/`anon`; owner-email source is `auth.users.email` |
| `name` | `text` | YES | — | CHECK ≤ 100 |
| `college` | `text` | YES | — | CHECK ≤ 200 |
| `gender` | `text` | YES | — | **Profiles:** `prefer_not_to_say` (underscore, `EditProfileModal.tsx:296`). **Journeys:** `prefer-not-to-say` (hyphen, `Dashboard.tsx:640`). No CHECK constraint on either column — both variants coexist. |
| `created_at` | `timestamptz` | NO | `now()` | |
| `updated_at` | `timestamptz` | NO | `now()` | `update_profiles_updated_at` trigger |
| `bio` | `text` | YES | — | CHECK ≤ 500 |
| `hobbies` | `text` | YES | — | CHECK ≤ 200 (comma-separated) |
| `avatar_url` | `text` | YES | — | stored **1-year signed URL** (not a path) |

RLS policies: see §6.1.

#### `public.journeys`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `user_email` | `text` | YES | — | **LEGACY — always NULL; column dropped** (was removed for email leak) |
| `user_name` | `text` | YES | — | CHECK ≤ 100 |
| `train_number` | `text` | NO | — | CHECK ≤ 20 |
| `travel_date` | `date` | NO | — | |
| `coach` | `text` | YES | — | CHECK ≤ 50 |
| `boarding_station` | `text` | YES | — | CHECK ≤ 200 |
| `destination_station` | `text` | YES | — | CHECK ≤ 200 |
| `college` | `text` | YES | — | CHECK ≤ 200 |
| `gender` | `text` | YES | — | |
| `created_at` | `timestamptz` | NO | `now()` | |
| `train_name` | `text` | YES | — | denormalized from `trains` at insert time |

Indexes: `(user_id)`, `(train_number, travel_date)`.

#### `public.requests`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `from_user_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE (sender) |
| `from_email` | `text` | YES | — | not populated by frontend |
| `from_name` | `text` | YES | — | sender display name |
| `to_user_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE (recipient) |
| `to_email` | `text` | YES | — | not populated by frontend |
| `to_name` | `text` | YES | — | recipient display name |
| `train_number` | `text` | YES | — | |
| `travel_date` | `date` | YES | — | |
| `boarding_station` | `text` | YES | — | |
| `destination_station` | `text` | YES | — | |
| `status` | `text` | NO | `'pending'` | CHECK `IN ('pending','accepted','rejected')` |
| `created_at` | `timestamptz` | NO | `now()` | |
| `updated_at` | `timestamptz` | NO | `now()` | `update_requests_updated_at` trigger |

Indexes: `(from_user_id)`, `(to_user_id)`, `(status)`, `(status, from_user_id, to_user_id)`.

#### `public.conversations`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `participants` | `uuid[]` | NO | — | exactly 2; GIN index; **immutable after insert** |
| `participant_names` | `jsonb` | NO | `'{}'` | keyed by user id; **immutable** |
| `train_number` | `text` | YES | — | **immutable** |
| `travel_date` | `date` | YES | — | **immutable** |
| `last_message` | `text` | YES | — | updatable (≤255 stored) |
| `last_message_time` | `timestamptz` | YES | — | updatable |
| `created_at` | `timestamptz` | NO | `now()` | **immutable** |
| `deleted_for` | `uuid[]` | YES | `'{}'` | per-user soft delete; **only via `soft_delete_conversation` RPC** |

**Column-level UPDATE privileges:** The migration `20260630153027` restricted `UPDATE` to `(last_message, last_message_time, deleted_for)` for `authenticated`; `service_role` has ALL. **However**, migration `20260725073436` issues a blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`, which **overrides** the column-level restriction. In the deployed system, the `prevent_conversation_tamper_trg` trigger is the **sole guard** preventing client mutation of `participants`, `participant_names`, `train_number`, `travel_date`, `created_at`, `id`, and `deleted_for` (unless `app.allow_deleted_for_update='on'` is set inside the `soft_delete_conversation` RPC).

#### `public.messages`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `conversation_id` | `uuid` | NO | — | FK → `conversations(id)` CASCADE |
| `sender_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `sender_name` | `text` | YES | — | denormalized display name |
| `text` | `text` | NO | — | trimmed, 1..2000 (client zod); may be `''` for attachment-only. **Frontend bypasses `min(1)` when an attachment is present** (`useChat.tsx:202-210`). Consider a DB CHECK: `text <> '' OR attachment_url IS NOT NULL`. |
| `created_at` | `timestamptz` | NO | `now()` | server-defaulted (never set client-side) |
| `attachment_url` | `text` | YES | — | 1-year signed URL into `chat-attachments` |
| `attachment_type` | `text` | YES | — | mime type |
| `attachment_name` | `text` | YES | — | original filename |
| `attachment_size` | `bigint` | YES | — | bytes; **Prisma returns `BigInt` — API layer must serialize to string/number before `JSON.stringify`** |

Index: `(conversation_id)`.

#### `public.last_read`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `user_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `conversation_id` | `uuid` | NO | — | FK → `conversations(id)` CASCADE |
| `timestamp` | `timestamptz` | NO | `now()` | |

UNIQUE `(user_id, conversation_id)`. **REPLICA IDENTITY FULL** (for realtime). In the realtime publication.

#### `public.blocked_users`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `blocker_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `blocked_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `created_at` | `timestamptz` | NO | `now()` | |

UNIQUE `(blocker_id, blocked_id)`. Index `(blocker_id, blocked_id)`. **Symmetric**: `is_blocked(a,b)` returns true if *either* direction exists.

#### `public.user_reports`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `reporter_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `reported_id` | `uuid` | NO | — | FK → `auth.users(id)` CASCADE |
| `reason` | `text` | YES | — | free text (no category enum, no maxLength; frontend sends `reason.trim() || null`) |
| `created_at` | `timestamptz` | NO | `now()` | |

#### `public.trains`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `train_number` | `text` | NO | — | PK |
| `train_name` | `text` | NO | — | |
| `active` | `boolean` | NO | `true` | |
| `created_at` | `timestamptz` | NO | `now()` | |

Seeded with ~230 Indian Railway trains (Rajdhani/Shatabdi/Duronto/etc.) via
`INSERT ... ON CONFLICT (train_number) DO NOTHING`.

#### `public.unverified_trains`
| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `train_number` | `text` | NO | — | |
| `train_name` | `text` | YES | — | |
| `submitted_by` | `uuid` | YES | — | FK → `auth.users(id)` (no cascade) |
| `created_at` | `timestamptz` | NO | `now()` | |
| `entered_value` | `text` | YES | — | raw input |
| `normalized_value` | `text` | YES | — | `lower(trim(input))` |

#### `public.profiles_safe` (VIEW)
```sql
CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = on) AS
SELECT id, created_at, updated_at,
       CASE WHEN auth.uid() = id THEN email ELSE NULL END AS email,
       name, college, gender, bio, hobbies, avatar_url
FROM public.profiles;
```
The only sanctioned way to read a profile `email`. Currently **unused by the frontend** (own email is read from the auth session; other users' profiles never select email).

### 3.3 Functions (SECURITY DEFINER unless noted)

| Function | Signature | Purpose |
| --- | --- | --- |
| `handle_new_user()` | trigger | On `auth.users` INSERT: `INSERT INTO profiles(id, email) VALUES (NEW.id, NEW.email)`. |
| `update_updated_at_column()` | trigger, invoker | `NEW.updated_at = now()`. |
| `prevent_conversation_tamper()` | trigger, invoker | Guards immutable conversation fields + `deleted_for` (see §3.2). |
| `is_conversation_participant(conv_id)` | `(uuid) → bool` | `auth.uid() = ANY(participants)`. |
| `can_view_journey(train_number, travel_date)` | `(text, date) → bool` | Caller has a journey on that train+date. |
| `is_blocked(user_a, user_b)` | `(uuid, uuid) → bool` | Symmetric block check. |
| `can_view_profile(profile_id)` | `(uuid) → bool` | Own OR (not blocked AND (shared journey OR accepted request OR shared conversation)). |
| `is_blocked_in_conversation(conv_id, uid)` | `(uuid, uuid) → bool` | Any *other* participant of `conv_id` is blocked by `uid`. |
| `can_create_conversation(parts[], train, tdate)` | `(uuid[], text, date) → bool` | 2 distinct participants, self included, not blocked, and an **accepted** request between them (optionally matching train/date). |
| `users_share_journey(a, b, train, tdate)` | `(uuid, uuid, text, date) → bool` | Both have a journey on the same train+date. |
| `soft_delete_conversation(conv_id, user_id_to_add)` | `(uuid, uuid) → void` | **RPC** — appends to `deleted_for` for self; sets `app.allow_deleted_for_update`; SECURITY DEFINER. |

### 3.4 Triggers
| Trigger | Table | Event | Function |
| --- | --- | --- | --- |
| `update_profiles_updated_at` | `profiles` | BEFORE UPDATE | `update_updated_at_column()` |
| `update_requests_updated_at` | `requests` | BEFORE UPDATE | `update_updated_at_column()` |
| `on_auth_user_created` | `auth.users` | AFTER INSERT | `handle_new_user()` |
| `prevent_conversation_tamper_trg` | `conversations` | BEFORE UPDATE | `prevent_conversation_tamper()` |

### 3.5 Grants & hardening (final)
- `authenticated`: SELECT/INSERT/UPDATE/DELETE on all public tables + sequences (final grant migration `20260725073436` — **blanket grant overrides prior column-level restrictions**).
- `anon`: revoked from SELECT on all data tables + `profiles_safe`; revoked from INSERT/UPDATE/DELETE on `blocked_users`, `unverified_trains`, `user_reports`, `conversations`, `requests`, `profiles`.
- `conversations`: **Column-level UPDATE grant is overridden** by the blanket grant; the trigger `prevent_conversation_tamper_trg` is the sole guard on immutable fields (see §3.2).
- `profiles.email`: column SELECT revoked from `authenticated` and `anon` — **but the blanket table-level GRANT on `profiles` re-enables table SELECT**, so email is readable by any user passing `can_view_profile` (deployed reality). The new backend serializer must never return another user's email.
- SECURITY DEFINER functions revoked from `anon`/`public`, granted to `authenticated` (`users_share_journey`, `can_create_conversation` also to `service_role`).
- `handle_new_user` revoked from `PUBLIC`, `anon`.
- GraphQL: `pg_graphql` extension dropped; `graphql_public` usage revoked.
- Seed cleanup row `11111111-1111-1111-1111-111111111111` deleted from conversations.

### 3.6 Supabase-generated `auth` schema (external dependency)
The public tables reference `auth.users(id)`; `auth.uid()` is used throughout
policies/functions. When migrating, this becomes the **local `users` table** and the
`users.id` is the app's universal identity key (the frontend treats `user.id` from the
Supabase User object as the identity for profiles, journeys, requests, messages,
presence, reports, and storage paths).

---

## 4. Table relationships

```
auth.users  (source of identity; becomes users table)
   │  1─N  profiles.id                      (ON DELETE CASCADE)
   │  1─N  journeys.user_id                 (ON DELETE CASCADE)
   │  1─N  requests.from_user_id            (ON DELETE CASCADE)
   │  1─N  requests.to_user_id              (ON DELETE CASCADE)
   │  1─N  messages.sender_id               (ON DELETE CASCADE)
   │  1─N  last_read.user_id                (ON DELETE CASCADE)
   │  1─N  blocked_users.blocker_id         (ON DELETE CASCADE)
   │  1─N  blocked_users.blocked_id         (ON DELETE CASCADE)
   │  1─N  user_reports.reporter_id         (ON DELETE CASCADE)
   │  1─N  user_reports.reported_id         (ON DELETE CASCADE)
   │  1─N  unverified_trains.submitted_by   (no cascade)

conversations 1─N  messages.conversation_id  (ON DELETE CASCADE)
conversations 1─N  last_read.conversation_id (ON DELETE CASCADE)
conversations participants: uuid[2]  (array — no formal join table; GIN-indexed)

requests ⟷ conversations: implicit — a conversation is only created after an
  ACCEPTED request between the pair (enforced by can_create_conversation()).

trains.train_number —(denormalized into)— journeys.train_number (+ train_name)
```

Notes:
- The pair relationship (user A ↔ user B) is modeled three times, each with its own
  RLS semantics: `requests` (by request), `conversations.participants[]` (by
  conversation), `blocked_users` (by block). There is **no `matches` table** — matches
  are computed on demand from `journeys` (exact train + date).
- `participant_names` jsonb denormalizes display names into conversations so the chat
  header works without a join. `messages.sender_name` does the same per message.

---

## 5. Authentication flow

### 5.1 Current behavior (Supabase Auth / GoTrue)

- **Client**: `src/integrations/supabase/client.ts`
  ```ts
  createClient<Database>(URL, PUBLISHABLE_KEY, {
    auth: { storage: localStorage, persistSession: true, autoRefreshToken: true }
  })
  ```
- **Methods used** (the entire auth API surface):
  `auth.onAuthStateChange`, `auth.getSession`, `auth.signInWithPassword`,
  `auth.signUp`, `auth.signOut`.
- **Session restore** (`useAuth.tsx`): registers `onAuthStateChange` **first**, then
  calls `getSession()`. Both callbacks set `session`/`user`/`loading`.
- **Sign up**: `signUp({ email, password, options: { emailRedirectTo: `${origin}/` } })`.
  **The response body (`data.session`, `data.user`) is ignored** — only `error` is
  checked. With email confirmation enabled (Supabase default), the newly created user
  gets `session = null`, sees a success toast, then `ProtectedRoute` bounces them to
  `/login` with no "check your email" hint.
- **Sign in**: `signInWithPassword({ email, password })`; on success navigates to `/dashboard`.
- **Sign out**: `signOut()`; `SIGNED_OUT` event clears context; redirect to `/login`.
- **Token refresh**: implicit, GoTrue `POST /auth/v1/token?grant_type=refresh_token`;
  `onAuthStateChange` fires `TOKEN_REFRESHED`. Refresh token lives in `localStorage`
  (key `sb-<ref>-auth-token`).
- **Identity key**: the app uses only `user.id` and `user.email`. `user_metadata` /
  `app_metadata` are never read.
- **Profile bootstrap**: `handle_new_user` trigger inserts `profiles(id, email)` on
  every signup, so a profile row always exists.
- **Email confirmation workflow**: The email-confirmation link (handled by Supabase GoTrue) points to `${origin}/` and finalizes account confirmation. The **confirmation step is handled at the frontend** (A5), not a backend GET endpoint. The frontend extracts the token and calls `POST /auth/confirm-email`.

### 5.2 Target design (JWT access + refresh)

> **Must preserve observable behavior**: `user.id` must remain a UUID that is stable
> across the migration (so existing data stays keyed). JWT claims must expose `sub`
> (= user id) and `email`. The frontend's `onAuthStateChange`-style flow must keep
> working: a token pair with the same shape.

1. **Access token**: short-lived (e.g. 15 min), JWT signed with `HS256`, claims
   `{ sub, email, iat, exp }`. Sent as `Authorization: Bearer <access>`.
2. **Refresh token**: opaque random string (or JWT with `type: refresh`), stored
   server-side (DB table `refresh_tokens` with `user_id`, `token_hash`, `expires_at`,
   `revoked_at`, rotation + reuse detection). Issued on login/register/refresh;
   returned in the response body so the SPA can persist it in `localStorage` exactly as
   it does today.
3. **Endpoints**: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`,
   `POST /auth/logout`. Each returns `{ access_token, refresh_token, expires_in, user }`
   shaped so `useAuth`/`supabase.auth` equivalents keep working.
4. **Email confirmation**: to stay behavior-identical, keep confirmation *enabled* and
   implement `POST /auth/confirm-email?token=...` (or a link route) that finalizes the
   account and redirects to `/`. (The current UX quirk — no hint after signup — is
   preserved; see §13 for the optional fix.)
5. **Middleware** (`authenticate.ts`): verify access JWT → attach `req.user = { id, email }`.
   All routes behind it.

---

## 6. Authorization (RLS rules)

RLS is the **authorization backbone**. Every rule below is currently enforced inside
Postgres; the Express backend must replicate **each** of them in middleware/service
code (Prisma does not enforce row-level security). The mapping is
**policy → service check** and is exhaustive.

### 6.1 `profiles`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view contextual profiles | SELECT | `can_view_profile(id)` |
| Users can insert own profile | INSERT | `auth.uid() = id` |
| Users can update own profile | UPDATE | `auth.uid() = id` |
| Users can delete own profile | DELETE | `auth.uid() = id` |

`can_view_profile(profile_id)` =
```
auth.uid() = profile_id
OR ( NOT is_blocked(auth.uid(), profile_id)
     AND ( exists(journey with same train+date)   -- shared journey
        OR exists(accepted request between pair)
        OR exists(conversation containing both) ) )
```

> **⚠️ Deployed reality — email leak:** The blanket `GRANT SELECT ON ALL TABLES` from migration `20260725073436` overrides the column-level `REVOKE SELECT (email)` on `profiles`. In the live system, any user passing `can_view_profile` (same-train journey, accepted request, conversation participant) **can read `profiles.email`**. The `profiles_safe` view (which masks email for non-owners) is **unused by the frontend**. The new backend **must never return another user's email** in any serializer — a parity test asserting email-absent **will fail against Supabase**; this asymmetry is expected and must be documented in §6.12.

### 6.2 `journeys`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view own journeys or matching journeys | SELECT | `auth.uid() = user_id OR (can_view_journey(train_number, travel_date) AND NOT is_blocked(auth.uid(), user_id))` |
| Users can create own journeys | INSERT | `auth.uid() = user_id` |
| Users can update own journeys | UPDATE | `auth.uid() = user_id` |
| Users can delete own journeys | DELETE | `auth.uid() = user_id` |

### 6.3 `requests`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view requests they sent or received | SELECT | `(auth.uid() = from_user_id OR auth.uid() = to_user_id) AND NOT is_blocked(from_user_id, to_user_id)` |
| Users can create requests | INSERT | `auth.uid() = from_user_id AND from_user_id <> to_user_id AND NOT is_blocked(from_user_id, to_user_id) AND users_share_journey(from_user_id, to_user_id, train_number, travel_date)` |
| Users can update requests they received | UPDATE | `auth.uid() = to_user_id` |
| Users can delete their pending outgoing requests | DELETE | `auth.uid() = from_user_id AND status = 'pending'` |

### 6.4 `conversations`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view conversations they participate in | SELECT | `auth.uid() = ANY(participants) AND NOT (auth.uid() = ANY(COALESCE(deleted_for,'{}')))` |
| Users can create accepted-companion conversations | INSERT | `can_create_conversation(participants, train_number, travel_date)` |
| Users can update conversations they participate in | UPDATE | USING + WITH CHECK: `auth.uid() = ANY(participants)` — but **column-restricted** to `(last_message, last_message_time, deleted_for)` |

Plus the immutable-field guard (`prevent_conversation_tamper`) and the
`deleted_for`-only-via-RPC rule.

### 6.5 `messages`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view messages in their conversations | SELECT | `is_conversation_participant(conversation_id)` |
| Users can send messages in their conversations | INSERT | `auth.uid() = sender_id AND is_conversation_participant(conversation_id) AND NOT is_blocked_in_conversation(conversation_id, auth.uid())` |

### 6.6 `last_read`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view own last_read | SELECT | `auth.uid() = user_id` |
| Users can insert own last_read | INSERT | `auth.uid() = user_id` |
| Users can update own last_read | UPDATE | `auth.uid() = user_id` |

### 6.7 `blocked_users`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can view their own blocks | SELECT | `auth.uid() = blocker_id` |
| Users can block others | INSERT | `auth.uid() = blocker_id` |
| Users can unblock others | DELETE | `auth.uid() = blocker_id` |

> **⚠️ DB gap:** `blocked_users` has **no FK to `auth.users`** and **no self-block CHECK** (`blocker_id <> blocked_id`). The service layer must enforce `blocker_id !== blocked_id` at insert time (assigned to Phase 5 in roadmap).

### 6.8 `user_reports`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can create reports | INSERT | `auth.uid() = reporter_id` |
| Users can view their own reports | SELECT | `auth.uid() = reporter_id` |

### 6.9 `trains`
| Policy | Command | Expression |
| --- | --- | --- |
| Anyone can view trains | SELECT | `true` (role: public; effective access via grants = authenticated) |

### 6.10 `unverified_trains`
| Policy | Command | Expression |
| --- | --- | --- |
| Users can submit unverified trains | INSERT | `auth.uid() = submitted_by` |
| Users can view own unverified submissions | SELECT | `auth.uid() = submitted_by` |

### 6.11 Storage objects (see §7) and realtime (see §8)

The storage and realtime policies are **also** part of the authorization model and
must be ported. They are enumerated in their respective sections.

### 6.12 Key security invariants to replicate in Express

1. **Email is private.** `GET /profiles/:id` must never return `email` for another user.
   `GET /profiles/me` may. (Mirror `profiles_safe`.)
   > **Parity note:** The deployed Supabase system **leaks email** to contextual viewers (see §3.5, §6.1). A test asserting email-absent **fails against Supabase** — this is expected asymmetry; the new backend must enforce the intended invariant regardless.
2. **Requests hide blocked pairs.** A request list must exclude rows where either
   direction is blocked.
3. **Conversation creation is gated** on an accepted request (and not blocked).
4. **Conversation rows are immutable** except `last_message`, `last_message_time`,
   and `deleted_for`; `deleted_for` only via the soft-delete endpoint.
5. **Messages require participant + not blocked-in-conversation.**
6. **Avatars/attachments** are readable only by authorized viewers (§7), not
   anonymously.
7. **Soft-delete is permanent for the conversation list.** `deleted_for` is append-only;
   nothing removes a user id. A soft-deleted conversation **stays hidden from the list
   permanently**. Direct URL `/chat/<id>` still works because messages are not filtered
   by `deleted_for`. This behavior must be preserved (parity).
8. **Presence & typing have no DB authorization today.** Any authenticated user can join
   `presence-<cid>` and broadcast `typing`. The Socket.IO backend **must** enforce
   participant checks on room join + rate-limit typing (§8.5).

---

## 7. Storage architecture

### 7.1 Buckets

| Bucket | Visibility | Object key convention | Who can read |
| --- | --- | --- | --- |
| `avatars` | **private** | `<user_id>/avatar.<ext>` (first path segment = user UUID) | owner OR `can_view_profile(first_segment_uuid)` |
| `chat-attachments` | **private** | `<conversation_id>/<crypto.randomUUID()>.<ext>` (first path segment = conversation UUID) | `is_conversation_participant(first_segment_uuid)` |

> ⚠️ **Operational gap**: the `avatars` bucket is created in a migration
> (`20251227101646`), but **no migration creates `chat-attachments`** — only its
> storage policies exist. The bucket is currently created manually in the Supabase
> dashboard. Any fresh environment must create it explicitly.

### 7.2 Storage objects policies

**avatars**
```sql
-- SELECT
bucket_id = 'avatars' AND (
  (storage.foldername(name))[1] = auth.uid()::text
  OR public.can_view_profile(((storage.foldername(name))[1])::uuid)
)
-- INSERT
bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
-- UPDATE / DELETE
bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
```

**chat-attachments**
```sql
-- SELECT
bucket_id = 'chat-attachments' AND public.is_conversation_participant((split_part(name,'/',1))::uuid)
-- INSERT
bucket_id = 'chat-attachments' AND is_conversation_participant(split_part(name,'/',1)::uuid) AND owner = auth.uid()
-- UPDATE (USING + CHECK)
bucket_id = 'chat-attachments' AND owner = auth.uid() AND is_conversation_participant(split_part(name,'/',1)::uuid)
-- DELETE
bucket_id = 'chat-attachments' AND owner = auth.uid()
```

### 7.3 Frontend flow (must be reproduced exactly)

**Avatar (useProfile.ts `uploadAvatar`)**
1. Validate client-side: `image/*`, ≤ 5 MB.
2. Crop in `ImageCropModal` → 256×256 JPEG blob (quality 0.9).
3. `storage.from('avatars').remove([`${user.id}/avatar.${ext}`])` (best-effort, error ignored).
4. `storage.from('avatars').upload(`${user.id}/avatar.${ext}`, file, { upsert: true })`.
5. `storage.from('avatars').createSignedUrl(path, 60*60*24*365)` → **1-year signed URL**.
6. `profiles.update({ avatar_url: signedUrl }).eq('id', user.id)`.
7. Renders via `getAvatarUrl(url) = url.split('?')[0] + '?t=' + avatarVersion` (cache-buster).

**Chat attachment (useChat.tsx `uploadAttachment`)**
1. Validate: image (any) or `pdf/doc/docx/txt`; ≤ 10 MB.
2. `storage.from('chat-attachments').upload(`${conversationId}/${crypto.randomUUID()}.${ext}`, file, { contentType: file.type, upsert: false })`.
3. `storage.from('chat-attachments').createSignedUrl(path, 60*60*24*365)` → stored as `messages.attachment_url`.

> ⚠️ **Frontend quirk to preserve or fix deliberately** (§13.6): `getAvatarUrl()`
> discards the `?token=` query param. `<AvatarImage>` in `ProfileMenu` /
> `ViewProfileModal` therefore requests an *unsigned* URL against a **private**
> bucket (would 403 → initials fallback). `ProfileModal` renders the raw signed URL
> (token intact). **Chat attachments (`attachment_url` in `Chat.tsx`) are NOT affected** — they render the raw signed URL directly. Behavior is currently inconsistent; verify during migration and fix
> the cache-buster to `url + (url.includes('?') ? '&' : '?') + 't=...'` if avatars must
> show.

### 7.4 Target storage design (S3-compatible)

- Keep the same bucket names and object-key conventions so `avatar_url` /
  `attachment_url` rewrite is mechanical.
- **Issue presigned PUT URLs** for uploads and **presigned GET URLs** for reads
  (signed, not public) to mirror the private-bucket + signed-URL model. A 1-year
  signed URL is unusual for S3 (max ~7 days) — the alternative is issuing short-lived
  URLs at read time, which changes `avatar_url` semantics. **Behavior-preserving
  choice:** store the *object path* in the DB instead of a signed URL, and have the API
  return a freshly signed URL when serializing the profile/message. This keeps the
  frontend's `src={url}` contract working while removing 1-year tokens.
- Enforcement: on every `GET /profiles/:id` and `GET /messages` serialization, apply
  the same `can_view_profile` / `is_conversation_participant` checks from §6.11 before
  emitting a signed URL.

---

## 8. Realtime messaging architecture

### 8.1 Current implementation (Supabase Realtime v2)

Three transport features, all websocket:
- **postgres_changes** (DB change streams): `messages`, `conversations`, `last_read`.
- **presence** (member tracking) and **broadcast** (arbitrary messages) on
  per-conversation topics.

### 8.2 Channel inventory (exact strings — the migration contract)

| # | Channel topic | Hook | Type | Subscription / behavior |
| --- | --- | --- | --- | --- |
| 1 | `` `messages-${conversationId}` `` | `useChat.tsx` | postgres_changes INSERT on `messages`, filter `conversation_id=eq.<id>` | Append `payload.new` to message state (dedup by id). Not self-filtered — sender's own message arrives via echo. |
| 2 | `` `last-read-${conversationId}-${otherUserId}` `` | `useChat.tsx` | postgres_changes `*` on `last_read`, filter `conversation_id=eq.<id>` | Updates `otherUserLastRead` when `row.user_id === otherUserId` (read receipts). |
| 3 | `` `conversations-updates-${user.id}` `` | `useChat.tsx` | postgres_changes `*` on `conversations`, **no filter** | On any conversations change → full refetch of user's list + unread counts. |
| 4 | `` `presence-${conversationId}` `` | `usePresence.ts` | presence `sync`/`join`/`leave` + broadcast `typing` | `channel.track({ online_at })` on SUBSCRIBED; presence key = `user.id`. A second throwaway channel with the same name broadcasts `typing` on every keystroke (no throttle, never removed). |
| 5 | `` `requests-changes` `` | `useAcceptedCompanions.ts` | postgres_changes `*` on `requests`, filters `from_user_id=eq.<uid>` and `to_user_id=eq.<uid>` | **INERT**: `requests` is not in the `supabase_realtime` publication; companion list refreshes only on hook mount. |

### 8.3 Realtime authorization (must be replicated)

`realtime.messages` (payload table) SELECT policy — authenticated only:
```sql
(realtime.topic() LIKE 'messages-%'   AND is_conversation_participant(NULLIF(replace(realtime.topic(),'messages-',''),'')::uuid))
OR (realtime.topic() LIKE 'last-read-%' AND is_conversation_participant(substring(realtime.topic() from 11 for 36)::uuid))
OR (realtime.topic() = 'conversations-updates-' || auth.uid()::text)
```
**Presence/broadcast topics (`presence-<cid>`) are NOT gated by this policy.** In Supabase Realtime v2, presence and broadcast are separate primitives with no RLS authorization — any authenticated user can join any `presence-<conversationId>` channel and broadcast `typing`. The channel name itself leaks conversation UUIDs. The Socket.IO backend **must** enforce participant checks on room join and rate-limit typing (§8.5).

### 8.4 Behavior details (verified)

- **Send message** = `INSERT messages` then `UPDATE conversations SET last_message = substring(255), last_message_time = now()`. **No optimistic insert** — the sender's own message renders only after the realtime echo.
- **Read receipts**: `last_read.upsert({ user_id, conversation_id, timestamp }, { onConflict: 'user_id,conversation_id' })` fires on Chat mount and whenever the last message `sender_id !== user.id`. "Read" iff `isOwn && otherUserLastRead >= sentAt`, else "Delivered".
- **Unread counts**: computed client-side, per conversation, N+1 exact `head` counts:
  - if user has no `last_read` row: count `messages` where `conversation_id = X AND sender_id != user.id`;
  - else count `created_at > last_read.timestamp AND sender_id != user.id`.
  Recalculated only inside `fetchConversations` (initial + `conversations-updates` event).
- **Presence** is per-conversation and only live while the Chat page is mounted; there is **no global presence**. Multi-tab same user collapses to one key.
- **Soft delete**: `rpc('soft_delete_conversation', { conv_id, user_id_to_add: user.id })`. **`deleted_for` is append-only — nothing ever removes a user id.** The conversations SELECT policy (`NOT (auth.uid() = ANY(COALESCE(deleted_for,'{}')))`) therefore hides the row **permanently from the conversation list**. Direct URL `/chat/<id>` still works because the `messages` policy checks only participant membership, not `deleted_for`. A new message does **NOT** cause reappearance in the list.
- **Conversation open**: reuse existing row if both participant ids present in loaded list; else insert new conversation (`last_message=''`, `last_message_time=now()`); navigate to `/chat/<id>`.
- **`requests-changes` is dead** — accepted requests do not push the companion list; it refreshes on navigation/remount only.

### 8.5 Target Socket.IO design (behavior-identical)

| Realtime topic → | Socket.IO room |
| --- | --- |
| `messages-<cid>` | room `conv:<cid>` — server emits `message:new` after INSERT (authorized: participant only). |
| `last-read-<cid>-<uid>` | room `conv:<cid>` — server emits `last-read:update` (`{ userId, conversationId, timestamp }`) after upsert. |
| `conversations-updates-<uid>` | room `user:<uid>` — server emits `conversation:updated` on any conversation row change affecting that user. |
| `presence-<cid>` | room `conv:<cid>` presence via Socket.IO `join`/`leave` + `presence:sync`; typing via `typing` broadcast. |
| `requests-changes` | **Fix or replicate the current gap** — see §13.2. |

- **Handshake auth**: verify access JWT in the `auth` handshake payload → `socket.user.id`.
- **Authorization on emit**: the server must enforce §8.3 semantics in code:
  only emit `message:new`/`last-read:update` to members of the conversation room;
  only emit `conversation:updated` to the affected user; presence/typing only in the
  conversation room.
- **Read receipts**: keep the DB upsert; the server broadcasts the `last-read:update`
  event (this currently works via postgres_changes on `last_read`, REPLICA IDENTITY FULL).

---

## 9. Business rules

Compiled from `lib/validations.ts`, hooks, and pages. Each rule is currently enforced
**client-side (UX)**, **database-side (integrity)**, or **both** — noted explicitly.

### 9.1 Profiles
- Own profile is read as `profiles` where `id = user.id`; **email never selected** from
  `profiles` (owner email comes from the auth session).
- Edit saves only: `name` (required, trimmed), `bio`/`hobbies`/`college` (trimmed or
  coerced to `null`), `gender` (values: `male` | `female` | `other` |
  `prefer_not_to_say` | empty). **`prefer_not_to_say` (underscore)** is the stored value **in `profiles`**.
- **`journeys.gender` stores `prefer-not-to-say` (hyphen)** — `Dashboard.tsx:640` and the `journeySchema` enum use the hyphen variant. **No CHECK constraint exists on either column**, so both variants (and arbitrary strings) coexist in the wild.
- Other users' profiles are fetched on modal open: `name, college, gender, bio,
  hobbies, avatar_url` (email deliberately excluded).
- `profiles_safe` exists but is unused by the frontend.
- Profile row is auto-created at signup (trigger). Client tolerates a missing row
  (`PGRST116`) by treating profile as `null`.

### 9.2 Journeys
- Form (`journeySchema`): `name` 1..100; `trainNumber` 1..20 regex
  `[A-Za-z0-9\s-]`; `travelDate` ≥ local today; `coach` ≤10 optional; boarding &
  destination stations 1..100; `college` ≤200 optional; `gender` optional enum.
- Journey insert writes `user_id, user_name, train_number, train_name, travel_date,
  coach, boarding_station, destination_station, college, gender`. `train_name` is
  denormalized from the train lookup.
- **Matching is exact `train_number` AND `travel_date` only.** Coach, college, gender,
  route are display/filter-only, never part of the match query.
- A journey is matchable while `travel_date >= today`; `past` journeys cannot be
  matched ("Find Companions" aborts with a toast). `today` journeys are matchable.
- Duplicate journeys (same user, same train+date) are **allowed** (no dedup).
- Deleting a journey requires an AlertDialog confirm → hard DELETE.
- Matches are written to `localStorage` (`journeyData`, `matches`) and read by the
  Matched page — they are **not** stored in the DB.

### 9.3 Trains / autocomplete
- Search: `trains` where `active = true` and (`train_number` ILIKE `%q%` OR
  `train_name` ILIKE `%q%`), debounced 300 ms, min 2 chars, limit 15.
- Selecting a suggestion → `verified = true`. Free text → `verified = false`; a
  warning shows and the raw entry is logged to `unverified_trains` (with
  `normalized_value = lower(trim(input))`). An unverified journey is still created.
- **A manually typed train that exists in `trains` but is not picked from the dropdown
  is still treated as unverified** (logged).
- **⚠️ Non-transactional insert**: `Dashboard.tsx:246-258` inserts to `unverified_trains`
  **before** the `journeys` insert, with no `.select()` and no error check. A failed
  journey insert leaves an orphan `unverified_trains` row; a failed unverified insert is
  silently ignored. The migration **must** make this atomic (single transaction or
  `ON CONFLICT` idempotent insert) with failure-injection tests (Phase 7).

### 9.4 Requests (the core lifecycle)
- **DB statuses**: `pending` | `accepted` | `rejected` only. There is **no**
  `cancelled`/`declined`.
- **UI statuses** (derived): `none` | `outgoing_pending` | `incoming_pending` |
  `accepted` | `rejected` (direction from `from_user_id`/`to_user_id`).
- Sending: INSERT `requests` with `from_user_id, from_name, to_user_id, to_name,
  train_number, travel_date, boarding_station, destination_station, status='pending'`.
  `from_email`/`to_email` are **not** populated by the frontend (always NULL; §3.2).
- **⚠️ Stale-journeyData race**: `sendRequest` reads `journeyData` from `localStorage`
  (`Matched.tsx:72-86`); RLS `users_share_journey` checks the live `journeys` table. If
  the sender deleted their journey after computing matches, the insert fails with 403.
  The endpoint must handle this gracefully (return 409/400 with clear message).
- **Only the recipient can accept/reject** (UI + RLS). Accept → `status='accepted'`.
  Reject → `status='rejected'`.
- **Cancel = hard DELETE** of the pending row (not a status transition). After cancel
  the pair can immediately re-request.
- **Rejected requests can be re-sent** (no cooldown/flag).
- `getRequestStatus(other, train?, date?)`: finds a request between the pair; when
  train/date provided, must match `train_number` AND `travel_date`; otherwise returns
  the first request between the pair regardless of journey.
- **Expired cleanup** (on Requests page mount only): delete pending requests where
  `from_user_id = me AND status='pending' AND travel_date < (today − 2 days)`.
  Only sender-side pending requests are pruned; the "2 days past travel" window is the
  only expiry rule. **Current implementation is select-then-delete (`useRequests.ts:155-189`)** —
  TOCTOU risk; service layer must use a single atomic `DELETE WHERE ...`.
- **Accept → conversation**: from Requests page, accepting immediately creates a
  conversation and navigates to `/chat/<id>`. From Matched page, accepting only
  updates status; the conversation is created lazily when the user clicks Chat.

### 9.5 Conversations
- Created only after an **accepted** request between the pair (server-enforced).
- Exactly 2 participants; `participant_names` jsonb keyed by user id; `train_number` /
  `travel_date` from the journey context; `last_message=''`, `last_message_time=now()`.
- Immutable fields (participants, names, train, date, created_at, id) — see §3.2.
- Soft delete: `deleted_for` appends the caller's id; conversation hidden from that
  user but not deleted. **`deleted_for` is append-only — nothing ever removes a user
  id.** The conversation **stays hidden from the list permanently**. Direct URL
  `/chat/<id>` still works because messages are not filtered by `deleted_for`. A new
  message does **NOT** cause reappearance in the conversation list.
- Blocked pair cannot create a conversation (server).
- **`participant_names` stores display names only (`profiles.name`), keyed by user id;
  email is never stored here.**

### 9.6 Messages
- `text` trimmed, 1..2000 chars (zod). Attachment-only messages have empty `text`
  (preview `📷 Photo` / `📎 name`).
- Inserted fields: `conversation_id, sender_id, sender_name, text,
  attachment_url/type/name/size`. `created_at` server-defaulted.
- After send, `conversations.last_message = text.substring(0,255)` and
  `last_message_time = now()` (**error on this update is re-thrown by the frontend** —
  `useChat.tsx:221-249` catches and shows a failure toast while the message remains
  inserted; the "phantom error" is a UX bug, not silent swallowing). The Phase 11
  atomic-transaction fix wraps both in one DB transaction.
- Attachments: images (any) or `pdf`/`doc`/`docx`/`txt`; ≤ 10 MB.
- Read receipt semantics: `last_read` upsert; message shows **Read** iff
  `isOwn && otherReadAt >= sentAt`, else **Delivered**.
- Unread counts: client-computed (see §8.4).

### 9.7 Blocking
- Block = INSERT `blocked_users(blocker_id, blocked_id)`; unblock = DELETE matching row.
- Blocking is **symmetric** in effect: `is_blocked(a,b)` true if either direction exists.
- A blocked pair's requests disappear from queries (RLS); a blocked user's journey rows
  are excluded from match queries; messages cannot be sent to a blocked participant;
  new conversations cannot be created with a blocked user.
- **Frontend caveat**: the Matched page lists `blockedUsers` in a filter effect's
  dependency array but **does not filter on it** — a blocked match stays visible until
  the next "Find Companions" query (RLS then excludes them). The Chats page rebuilds
  blocked entries from conversations (since the accepted request row is hidden).
- There is no unblock entry point on the Matched page; unblock lives inside Chat.

### 9.8 Reporting
- INSERT `user_reports(reporter_id, reported_id, reason)`; `reason` is optional
  free-text (no category enum). No admin/back-office surface exists in the frontend.

### 9.9 Validation summary (zod)
| Schema | Rule |
| --- | --- |
| `journeySchema` | see §9.2 |
| `messageSchema` | text trim 1..2000 |
| `requestStatusSchema` | `z.enum(['pending','accepted','rejected'])` (types only) |

---

## 10. Required REST API endpoints

Every endpoint below corresponds 1:1 to a Supabase call the frontend makes today
(§11). **Response shapes must match** what the frontend consumes (the React hooks read
`.data` arrays / rows / `{ error }`). The target backend should return
`{ data, error }`-compatible JSON or plain REST with error codes; the adapter layer
decides the exact envelope.

### 10.1 Auth
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | `auth.signUp` | `{ email, password, emailRedirectTo }`. Return `{ user, session }` or confirmation-required signal. |
| POST | `/auth/login` | `auth.signInWithPassword` | `{ email, password }` → `{ access_token, refresh_token, user }`. |
| POST | `/auth/refresh` | GoTrue refresh grant | rotate refresh token. |
| POST | `/auth/logout` | `auth.signOut` | revoke refresh token. |
| GET | `/auth/session` | `auth.getSession` | return current session from access token. |
| POST | `/auth/confirm-email` | GoTrue verification | confirm email from link token (keeps email confirmation on). |

### 10.2 Profiles
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/profiles/me` | `profiles.select(...).eq('id', user.id).single()` | id, name, bio, hobbies, college, gender, avatar_url. |
| PATCH | `/profiles/me` | `profiles.update(...).eq('id', user.id)` | name/bio/hobbies/college/gender (and avatar_url internally). |
| GET | `/profiles/:userId` | `profiles.select('name, college, gender, bio, hobbies, avatar_url').eq('id', uid).single()` | **authorize via can_view_profile; never return email.** |
| GET | `/profiles/:userId/name` | `profiles.select('name').eq('id', uid).maybeSingle()` | used before conversation creation. |

### 10.3 Journeys
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/journeys/me` | `journeys.select('*').eq('user_id', me).order('travel_date', asc)` | |
| POST | `/journeys` | `journeys.insert({...}).select().single()` | body per §9.2; also log to `unverified_trains` when `isVerified=false`. |
| DELETE | `/journeys/:id` | `journeys.delete().eq('id', id)` | own journey only. |
| GET | `/journeys/:trainNumber/:travelDate/companions` | `journeys.select('*').eq('train_number', X).eq('travel_date', Y).neq('user_id', me)` | exact match; RLS excludes blocked + non-contextual (via can_view_journey arm). |

### 10.4 Requests
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/requests/me` | `requests.select('*').or('from_user_id.eq.ME,to_user_id.eq.ME').order('created_at', desc)` | RLS hides blocked pairs. **Optional `?type=sent|received|all` (default `all`) to filter server-side.** |
| POST | `/requests` | `requests.insert({... status:'pending'})` | authorize: `users_share_journey` + not blocked + self as `from_user_id`. **Body (exact 9 fields, no email/college/gender):** `from_user_id, from_name, to_user_id, to_name, train_number, travel_date, boarding_station, destination_station, status='pending'`. |
| PATCH | `/requests/:id` | `requests.update({status}).eq('id', id)` | accept/reject; recipient only (`to_user_id`). |
| DELETE | `/requests/:id` | `requests.delete().eq('id', id)` | cancel; sender only, `status='pending'`. |
| POST | `/requests/cleanup-expired` | select + delete `.in('id', ids)` | sender-side pending with `travel_date < today−2d`; idempotent. **Service layer must use atomic `DELETE WHERE ...` (not select-then-delete).** |
| GET | `/requests/me/accepted` | `requests.select('*').eq('from_user_id', me).eq('status','accepted')` and `.eq('to_user_id', me)...` | two queries merged by frontend (sent + received). |
| GET | `/requests/incoming/pending-count` | `requests.select(count:head).eq('to_user_id', me).eq('status','pending')` | Dashboard bell badge. |

### 10.5 Conversations
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/conversations` | `conversations.select('*').contains('participants', [me]).order('last_message_time', desc)` | participant + not deleted-for. **Service layer must enforce `deleted_for` exclusion server-side (no client filter).** |
| POST | `/conversations` | `conversations.insert({participants, participant_names, train_number, travel_date, last_message:'', last_message_time}).select().single()` | authorize via `can_create_conversation`; idempotent reuse handled client-side. |
| DELETE | `/conversations/:id/for-me` | `rpc('soft_delete_conversation', { conv_id, user_id_to_add })` | per-user soft delete. |
| PATCH | `/conversations/:id` | `conversations.update({last_message, last_message_time}).eq('id', id)` | after message send (restricted to those columns). |

### 10.6 Messages
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/conversations/:id/messages` | `messages.select('*').eq('conversation_id', id).order('created_at', asc)` | participant only. |
| POST | `/conversations/:id/messages` | `messages.insert({...})` then update conversation | sender participant, not blocked-in-conversation; then emit Socket.IO `message:new`. |
| GET | `/conversations/:id/messages/unread-count` | two `messages.select(count:head)` queries | if last_read missing: `conversation_id=X AND sender_id != me`; else also `created_at > ts`. |

### 10.7 Read receipts
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/conversations/:id/last-read/:userId` | `last_read.select('timestamp').eq('conversation_id', X).eq('user_id', uid).maybeSingle()` | **other user's** row — currently returns null due to RLS (see §8.4); keep semantics. |
| PUT | `/conversations/:id/last-read` | `last_read.upsert({user_id, conversation_id, timestamp}, {onConflict})` | upsert own row; broadcast `last-read:update`. |

### 10.8 Storage (presigned URLs)
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| POST | `/storage/avatars/presign` | `storage.from('avatars').createSignedUrl(path, 365d)` | path `me/avatar.<ext>`; returns URL to store into `profiles.avatar_url`. |
| POST | `/storage/chat-attachments/presign` | `storage.from('chat-attachments').createSignedUrl(path, 365d)` | path `convId/<uuid>.<ext>`. |
| POST | `/storage/avatars/upload-url` | `storage.from('avatars').upload(...)` | **recommended:** return a presigned PUT URL so the browser uploads directly (replaces upload+url dance). |

### 10.9 Trains / directory
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/trains?q=` | `trains.select('train_number, train_name').eq('active', true).or('train_number.ilike.%q%,train_name.ilike.%q%').limit(15)` | autocomplete (min 2 chars, 300 ms debounce client-side). |
| POST | `/trains/unverified` | `unverified_trains.insert({...})` | only when autocomplete not verified. |

### 10.10 Moderation
| Method | Path | Supabase equivalent | Notes |
| --- | --- | --- | --- |
| GET | `/blocked-users` | `blocked_users.select('blocked_id').eq('blocker_id', me)` | |
| POST | `/blocked-users` | `blocked_users.insert({blocker_id, blocked_id})` | |
| DELETE | `/blocked-users/:blockedId` | `blocked_users.delete().eq('blocker_id', me).eq('blocked_id', id)` | |
| POST | `/reports` | `user_reports.insert({reporter_id, reported_id, reason})` | |

---

## 11. Existing frontend dependencies on Supabase

This is the **complete dependency surface** (60 call sites across 9 files) that a
replacement backend must satisfy. The adapter can be a thin `api` client wrapping
fetch/websockets, or a drop-in shim implementing the same method signatures used below.

### 11.1 `src/integrations/supabase/client.ts`
- `createClient(URL, PUBLISHABLE_KEY, { auth: { storage: localStorage, persistSession: true, autoRefreshToken: true } })`
- Generated `types.ts` (Database types) — schema reference only; not a runtime dep.
- **localStorage key**: `sb-<project-ref>-auth-token` (Supabase) → adapter must use a compatible key (e.g., `trainmate-auth-token`) containing `{ access_token, refresh_token, expires_at, user: { id, email } }`. Contract test must assert key shape and that migration/re-login works at cutover.

### 11.2 `src/hooks/useAuth.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 1 | `supabase.auth.onAuthStateChange((event, session) => ...)` | session restore / changes. **Event names contract: `SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`, `PASSWORD_RECOVERY` (GoTrue parity). Adapter must emit these exact events.** |
| 2 | `supabase.auth.getSession()` | initial session |
| 3 | `supabase.auth.signOut()` | logout |
| 4 | `supabase.auth.signInWithPassword({ email, password })` | login |
| 5 | `supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin + '/' } })` | register |

**Adapter contract:** The frontend destructures only `{ error }` from `signUp`/`signIn` (`useAuth.tsx:45-64`). The backend endpoints (§10.1) return full session/user; the adapter wrapper must expose the same `{ error }`-only shape to the hooks. `POST /auth/register` returns a confirmation-required signal (not a session).

### 11.3 `src/hooks/useProfile.ts`
| # | Call | Purpose |
| --- | --- | --- |
| 6 | `profiles.select('id, name, bio, hobbies, college, gender, avatar_url').eq('id', user.id).single()` | own profile |
| 7 | `profiles.update(updates).eq('id', user.id)` | update own profile |
| 8 | `storage.from('avatars').remove([`${user.id}/avatar.${ext}`])` | delete old avatar |
| 9 | `storage.from('avatars').upload(path, file, { upsert: true })` | upload avatar |
| 10 | `storage.from('avatars').createSignedUrl(path, 365d)` | signed avatar URL |
| 11 | `profiles.select('id, name, bio, hobbies, college, gender, avatar_url').eq('id', userId).single()` | **other** user's profile |

### 11.4 `src/hooks/useRequests.ts`
| # | Call | Purpose |
| --- | --- | --- |
| 12 | `requests.select('*').or('from_user_id.eq.ME,to_user_id.eq.ME').order('created_at', false)` | all my requests |
| 13 | `requests.delete().eq('id', requestId)` | cancel request |
| 14 | `requests.update({status:'accepted'}).eq('id', requestId)` | accept |
| 15 | `requests.update({status:'rejected'}).eq('id', requestId)` | reject |
| 16 | `requests.select('id').eq('from_user_id', me).eq('status','pending').lt('travel_date', cutoff)` | find expired |
| 17 | `requests.delete().in('id', ids)` | bulk-delete expired |

### 11.5 `src/hooks/useChat.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 18 | `messages.select('*').eq('conversation_id', cid).order('created_at', true)` | history |
| 19 | `channel('messages-<cid>').on('postgres_changes', {INSERT}, filter).subscribe()` | live messages |
| 20 | `removeChannel(...)` | cleanup |
| 21 | `last_read.select('timestamp').eq('conversation_id', cid).eq('user_id', other).maybeSingle()` | other's last-read |
| 22 | `channel('last-read-<cid>-<other>').on('postgres_changes', {*}, filter).subscribe()` | live read receipts |
| 23 | `removeChannel(...)` | cleanup |
| 24 | `conversations.select('*').contains('participants', [me]).order('last_message_time', false)` | conversation list |
| 25 | `channel('conversations-updates-<me>').on('postgres_changes', {*}, () => fetchConversations()).subscribe()` | live list refresh |
| 26 | `removeChannel(...)` | cleanup |
| 27 | `last_read.select('timestamp').eq('user_id', me).eq('conversation_id', cid).maybeSingle()` | own last-read (per conv, inside unread loop) |
| 28 | `messages.select('*', {count:'exact', head:true}).eq('conversation_id', cid).neq('sender_id', me)` | unread when no last_read |
| 29 | `messages.select('*', {count:'exact', head:true}).eq('conversation_id', cid).gt('created_at', lastRead).neq('sender_id', me)` | unread when last_read exists |
| 30 | `profiles.select('name').eq('id', me).maybeSingle()` | own display name for sender_name |
| 31 | `messages.insert({conversation_id, sender_id, sender_name, text, attachment_url, attachment_type, attachment_name, attachment_size})` | send message |
| 32 | `conversations.update({last_message, last_message_time}).eq('id', cid)` | bump conversation preview |
| 33 | `storage.from('chat-attachments').upload(path, file, {contentType, upsert:false})` | upload attachment |
| 34 | `storage.from('chat-attachments').createSignedUrl(path, 365d)` | signed attachment URL |
| 35 | `last_read.upsert({user_id, conversation_id, timestamp}, {onConflict:'user_id,conversation_id'})` | mark as read |
| 36 | `conversations.insert({participants, participant_names, train_number, travel_date, last_message:'', last_message_time}).select().single()` | create conversation |
| 37 | `rpc('soft_delete_conversation', {conv_id, user_id_to_add})` | delete chat (soft) |

### 11.6 `src/hooks/usePresence.ts`
| # | Call | Purpose |
| --- | --- | --- |
| 38 | `channel('presence-<cid>', {config:{presence:{key: user.id}}}).on(presence sync/join/leave).on(broadcast 'typing').subscribe()` | presence + typing receive |
| 39 | `removeChannel(...)` | cleanup |
| 40 | `channel('presence-<cid>').send({type:'broadcast', event:'typing', payload:{userId}})` | typing send (fresh throwaway channel, never removed) |

### 11.7 `src/hooks/useAcceptedCompanions.ts`
| # | Call | Purpose |
| --- | --- | --- |
| 41 | `requests.select('*').eq('from_user_id', me).eq('status','accepted')` | accepted sent |
| 42 | `requests.select('*').eq('to_user_id', me).eq('status','accepted')` | accepted received |
| 43 | `channel('requests-changes').on(postgres_changes *, from).on(postgres_changes *, to).subscribe()` | **inert** live refresh |
| 44 | `removeChannel(...)` | cleanup |

### 11.8 `src/hooks/useBlockedUsers.ts`
| # | Call | Purpose |
| --- | --- | --- |
| 45 | `blocked_users.select('blocked_id').eq('blocker_id', me)` | list blocked |
| 46 | `blocked_users.insert({blocker_id, blocked_id})` | block |
| 47 | `blocked_users.delete().eq('blocker_id', me).eq('blocked_id', id)` | unblock |

### 11.9 `src/pages/Dashboard.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 48 | `requests.select('*', {count:'exact', head:true}).eq('to_user_id', me).eq('status','pending')` | bell badge |
| 49 | `journeys.select('*').eq('user_id', me).order('travel_date', true)` | my journeys |
| 50 | `journeys.select('*').eq('train_number', X).eq('travel_date', Y).neq('user_id', me)` | find companions (→ localStorage) |
| 51 | `unverified_trains.insert({train_number, train_name, submitted_by, entered_value, normalized_value})` | log unverified train |
| 52 | `journeys.insert({...}).select().single()` | create journey |
| 53 | `journeys.delete().eq('id', journeyId)` | delete journey |

### 11.10 `src/pages/Matched.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 54 | `requests.insert({from_user_id, from_name, to_user_id, to_name, train_number, travel_date, boarding_station, destination_station, status:'pending'})` | send request |
| 55 | `requests.update({status:'accepted'}).eq('id', requestId)` | accept (Matched) |

### 11.11 `src/pages/Chats.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 56 | `profiles.select('name').eq('id', me).maybeSingle()` | own name before conversation creation |

### 11.12 `src/pages/Requests.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 57 | `profiles.select('name').eq('id', me).maybeSingle()` | own name before conversation creation |

### 11.13 `src/components/ProfileModal.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 58 | `profiles.select('name, college, gender, bio, hobbies, avatar_url').eq('id', userId).single()` | other profile on open |

### 11.14 `src/components/ReportDialog.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 59 | `user_reports.insert({reporter_id, reported_id, reason})` | report user |

### 11.15 `src/components/TrainAutocomplete.tsx`
| # | Call | Purpose |
| --- | --- | --- |
| 60 | `trains.select('train_number, train_name').eq('active', true).or('train_number.ilike.%q%,train_name.ilike.%q%').limit(15)` | train search |

### 11.16 Indirect dependencies (non-code)
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` env vars.
- **localStorage** keys: Supabase auth token (`sb-<ref>-auth-token`), plus app data
  `journeyData`, `matches` (not Supabase, but part of the flow).
- Email delivery (GoTrue): signup confirmation, reset (unused by UI), verification.
- Realtime websocket endpoint, Storage REST endpoint, PostgREST endpoint.

---

## 12. Migration strategy from Supabase to Express

### 12.1 Guiding principles
1. **Frontend frozen.** No changes to `src/` during the backend migration. The
   Supabase client stays; a future adapter swaps the data layer behind the same API.
2. **Schema is the contract.** The target Postgres schema is a 1:1 port of the
   current one (rename `auth.users` → `users`; drop PostgREST/RLS-only artifacts like
   `profiles_safe`, `security_invoker`, `realtime.messages`; keep all business
   columns, constraints, defaults, enums).
3. **RLS → service-layer enforcement.** Every policy in §6 becomes an explicit check in
   an Express route/middleware or Prisma repository. **Do not rely on Prisma to
   enforce row security.**
4. **Preserve behaviors, including quirks** (§8.4, §7.3, §5.1): no optimistic message
   insert, sender-echo delivery, client-computed unread counts, dead `requests-changes`
   (or deliberately fix — §13.2), private-bucket signed-URL model, signup-without-email-hint UX.
5. **Data continuity.** Keep the UUID identity keys and `avatar_url` semantics so the
   production data (auth users, profiles, journeys, requests, conversations, messages,
   last_read, blocks, reports) moves over with no remapping.

### 12.2 Phases

**Phase A — Schema port (Prisma)**
- Create Prisma schema mirroring §3 (tables, columns, types, constraints, indexes).
- Map `auth.users` → `users` with the same UUID `id`; add `refresh_tokens`,
  `email_verifications` tables.
- Seed `trains` from the existing dump.
- Write a one-off SQL migration that imports the current production data with
  `user_id`/`id` values preserved (use `--data-only` pg_dump of the current public
  tables + auth.users, as the existing `dump.sh`/`restore.sh` already do for
  Supabase→Supabase).

**Phase B — Auth service (JWT)**
- Implement register/login/refresh/logout (§5.2, §10.1) with behavior matching
  Supabase Auth: email confirmation enabled, session shape identical, refresh rotation.
- Ensure `user.id` values are the **same** UUIDs as today's `auth.users.id`.

**Phase C — Core read/write API**
- Implement profiles, journeys, requests, conversations, messages, last_read,
  blocked_users, user_reports, trains, unverified_trains endpoints (§10.2–§10.10)
  with RLS-equivalent authorization (§6).
- Wire `can_create_conversation`, `users_share_journey`, `is_blocked`,
  `is_blocked_in_conversation` as service functions called before writes.

**Phase D — Storage**
- Deploy S3-compatible storage (MinIO dev / S3 prod) with `avatars` and
  `chat-attachments` buckets and the same key conventions.
- Presign upload/download URLs; serialize avatar/attachment URLs at read time so the
  frontend `src={...}` contract holds (§7.4).

**Phase E — Realtime (Socket.IO)**
- Implement rooms + events per §8.5, mirroring all 5 current channel topics with the
  same authorization semantics. Preserve sender-echo and no-optimistic-insert.
- Decision point: keep `requests-changes` inert (behavior-identical) or fix it (§13.2).

**Phase F — Adapter swap (frontend)**
- Only after all phases are live and verified: introduce a thin adapter module so
  `src/integrations/supabase/client.ts` is the **only** file replaced, and every hook
  keeps its exact method-call shape (§11). Run a full smoke test of all 12 flows.
- This is deliberately last: the Supabase client remains the reference implementation
  throughout.

**Phase G — Cutover & rollback**
- Dual-run (new backend alongside Supabase) with feature-flag per page, then flip.
- Rollback = revert the adapter import; data continues to live in the shared Postgres.

### 12.3 Risks & mitigations
| Risk | Mitigation |
| --- | --- |
| RLS semantic drift (a policy missed in service layer) | Keep §6 as a checklist; add an authorization test per policy. |
| Signed-URL semantics (1-year vs short-lived) | Store object **paths**; sign at serialization time (§7.4). |
| Realtime event parity | Map channel→room 1:1 (§8.5); test sender-echo, read receipts, typing, presence. |
| Identity continuity | Reuse UUIDs; do not generate new ids. |
| Email privacy regressions | Enforce email-omission in the profiles serializer + tests (§6.12). |
| `chat-attachments` bucket not in migrations | Explicitly create in Terraform/compose; document. |
| **Blanket grant re-opens email read** (§3.5, §6.1) | Serializer must never return email; parity test documents asymmetry. |
| **Presence/typing has no authorization** (§8.3, §8.5) | Socket.IO room join must check participant; rate-limit typing. |
| **Non-atomic unverified+journey insert** (§9.3, S11) | Single transaction or ON CONFLICT; failure-injection tests (Phase 7). |
| **Server validator bounds divergence** (S4) | DB CHECKs are authoritative; document both sets explicitly. |
| **Soft-delete permanence** (§8.4, C5) | Document parity decision: permanent hide from list, direct URL works. |

---

## 13. Possible improvements while keeping frontend behavior identical

> Each item is **optional** and must not change observable frontend behavior unless
> the frontend is changed deliberately (which is out of scope for the backend phase).
> They are ordered by value.

1. **Fix the `requests-changes` realtime gap.** Add `requests` to the realtime
   publication (or, in Socket.IO, emit `companions:updated` on request status change)
   so the companion list updates live. *Backend-only change; frontend already
   subscribes.*
2. **Reduce the `conversations-updates` refetch storm.** The current channel
   subscribes to the **whole** `conversations` table with no filter. In Socket.IO,
   only emit `conversation:updated` to the affected user room — same client code, no
   change to frontend.
3. **Eliminate N+1 unread counting.** Compute unread counts in one SQL query
   (or a materialized/incremental counter) and return them with the conversation list.
   Frontend still consumes the same per-conversation numbers.
4. **Server-side read receipts for the *other* user.** The current `last_read`
   SELECT policy hides the other user's row, so read receipts start at "Delivered"
   until the next upsert. The backend can expose the other user's last-read through an
   authorized endpoint without changing the frontend.
5. **Atomic send: message + conversation bump in one transaction.** Currently the
   conversation preview update failure produces a **phantom error** (message IS inserted
   and UI shows a failure toast because `useChat` re-throws; `useChat.tsx:221-249`).
   A transaction keeps them consistent; the frontend contract (insert then update,
   echo-driven UI) is unchanged.
6. **Fix the avatar cache-buster token drop** (§7.3) in the *adapter/URL* layer rather
   than the frontend: **the proposed fix ("return short-lived signed URLs so the split works") is technically impossible** — `getAvatarUrl(url) = url.split('?')[0] + '?t='+version` drops the S3 signature. The only viable fix is a **first-party avatar proxy route** (`GET /avatars/:userId`) that re-authorizes `can_view_profile` at request time and returns a fresh signed URL (or redirects). This requires a frontend change (out of scope for the migration). **Decision must be locked before Phase 4**: accept the quirk (avatars break in ProfileMenu/ViewProfileModal) OR build the proxy route post-migration.
7. **Add an email-confirmation hint after signup** (requires a tiny frontend change;
   optional, improves a documented UX gap).
8. **Index/performance:** add a composite index for unread-count queries
   `messages(conversation_id, created_at)`; the current index is
   `messages(conversation_id)`.
9. **Expired-request cleanup as a scheduled job** instead of client-triggered
   deletes (idempotent endpoint already defined, §10.4). Frontend calls are unchanged;
   the cron removes the need for the client-side sweep.
10. **Train directory hygiene:** `unverified_trains` rows could be reviewed and
    promoted to `trains` (a moderation/admin job) — no frontend change.

---

*End of specification. Prepared from a read-only analysis of the current production
frontend + Supabase backend. No frontend was modified, no backend code was created,
and Supabase remains the running implementation until a future phase.*
