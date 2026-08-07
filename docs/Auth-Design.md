# TrainMate v2 — Authentication Module Design (Sprint 2A)

**Status:** Draft for review — not yet approved for implementation
**Author:** Lead Backend Engineer (Principal Security Engineering lens)
**Date:** 2026-08-06
**Inputs (source of truth):** `docs/Backend-Specification.md` (the contract — read first),
`docs/Backend-Architecture.md`, `docs/Implementation-Roadmap.md` (Phase 3, D4/D6/D8,
Appendices), `backend/DECISIONS.md` (Sprint 1 conventions)
**Scope:** Design only. No code, no Prisma schema, no Express routes, no frontend changes.
**Deliverable:** A reviewable design of the complete authentication module that Phase 2/3
will implement, and that the Phase 13 adapter must satisfy byte-for-byte.

> **How to read this document.** Every section states a **Decision** (what we will build)
> followed by **Why** (the reasoning, including what was rejected). Sections 1–18 are the
> module design; §19 is the Supabase-auth migration; §20 is the rollback strategy; §21 is
> the future-enhancements backlog. The document closes with a decision log, open questions
> awaiting approval, and assumptions.

---

## Executive summary — the key decisions

| # | Decision | Why (one line) |
| --- | --- | --- |
| K1 | **Stateless HS256 access JWT** (15 min) + **server-side opaque refresh token** (32-byte CSPRNG, SHA-256-hashed in Postgres, rotating family) | Access stays cheap/stateless for horizontal scale; refresh keeps server-side revocation state. This is the spec's target model (§5.2) and GoTrue's observable model. |
| K2 | **Refresh rotation + reuse detection**: every refresh rotates the token; replaying a revoked token revokes the whole family | Turns token theft into a detectable, contained event (OAuth Security BCP §4.14.2). |
| K3 | **bcrypt cost 12**, carried-over GoTrue `$2a$` hashes verify unchanged | Identity continuity: users keep passwords (D6; roadmap Critical Point #1). |
| K4 | **Email confirmation enabled**; register returns a confirmation-required signal (never a session) | GoTrue parity (§5.1, §10.1) + prevents fake/unconfirmed accounts. |
| K5 | **Confirmation link ends in a hash-fragment redirect** (`#access_token=…&refresh_token=…`) so the frozen frontend's existing supabase-js `detectSessionInUrl` logs the user in with zero `src/` changes | The frontend is the contract; §5.2 requires the token pair with the same shape. |
| K6 | **`redirect_to` is allowlist-validated** against the configured frontend origins | An open redirect here would leak a fresh session pair into the URL fragment of an attacker origin (token theft). |
| K7 | **Enumeration-uniform responses** for register/login/reset/resend; progressive lockout keyed on **email** (not just IP) | Prevents account enumeration and avoids blocking shared NATs (dorm / railway wifi). |
| K8 | **Rate limiting** per-IP + per-email on auth routes, Redis-backed with in-memory fallback (D4) | bcrypt cost 12 makes auth the CPU hot path; unbounded auth is a DoS. |
| K9 | **Logout revokes the user's refresh-token families**; access token lives to expiry (documented tradeoff, GoTrue-equivalent) | Matches GoTrue's default `signOut()` (scope `global`); short TTL bounds the JWT window. |
| K10 | **Migration carries UUIDs + bcrypt hashes + `email_confirmed_at`; does NOT carry GoTrue sessions** → one-time re-login at cutover | Hashes are portable and verified; GoTrue refresh tokens are internal, not portable. Re-login is bounded and honest. |
| K11 | **`REFRESH_SECRET` is dropped** from env | Refresh tokens are opaque + hashed; no signing secret exists for them. The roadmap's env matrix assumed signed refresh (spec §5.2 offered either). |
| K12 | All failure responses use the **locked Sprint 1 envelope** `{ error: { code, message, details? } }` with `x-request-id` | Contract-locked in Sprint 1 (DECISIONS.md #9); auth is not exempt. |

---

## 1. Authentication architecture

### 1.1 Shape of the system

Authentication is a **self-contained vertical** inside the Express backend: a router
(`src/routes/auth.routes.ts`), a pure service (`src/services/auth.service.ts`), three
repositories (`users`, `refresh-tokens`, `email-verifications`), three utilities
(`jwt.ts`, `tokens.ts`, `passwords.ts`), a transactional-email abstraction
(`utils/emails.ts`), and two middleware that Sprint 1 already stubbed (`authenticate`,
`rate-limit`) — this phase wires them for real.

The model is a **two-token pair**, matching the spec's target (§5.2) and GoTrue's
observable behavior:

| Token | Purpose | Lifetime | Where it lives | Verifiable how |
| --- | --- | --- | --- | --- |
| **Access token** | Authorization on every API call + the Socket.IO handshake | 15 min | `Authorization: Bearer` header on the client | Statelessly — HS256 signature + claims (no DB hit) |
| **Refresh token** | Obtain a new pair when the access token expires | 30 days (sliding) | Request body of `POST /auth/refresh` only | Statefully — SHA-256 hash lookup in Postgres |

**Why a split, and why these two types.** A single long-lived token cannot be both
stateless (cheap to verify at scale) and revocable (cheap to kill on logout/theft). The
standard resolution — and the spec's — is a short-lived stateless access token plus a
long-lived server-side refresh token. The access token is *stateless* so every API
instance and socket server can verify it without a database round-trip; the refresh
token is *stateful* so it can be revoked, rotated, and audited. §5 and §8 explain each
half in detail.

### 1.2 Trust boundaries

```
[ Browser SPA ] ── TLS ──▶ [ Express API ]
   │   │                        │  access JWT verified statelessly
   │   └─ refresh token ───────▶│  refresh token hashed in Postgres
   │                            │  │
   │                            │  └─▶ [ Postgres: users, refresh_tokens,
   │                            │       email_verifications ]
   └─ confirmation/reset links ─┘  └─▶ [ email provider ]
```

- The **client is untrusted** and owns only what it must: the access token (to present)
  and the refresh token (to redeem). It never sees the signing secret, password hashes,
  or token hashes.
- The **server** is the only writer of `users.password_hash`, `refresh_tokens.*`, and
  `email_verifications.*`.
- Secrets (`JWT_SECRET`, DB URL, email API keys) exist only in the server environment,
  never in the bundle, logs, or response bodies.

**Why this boundary.** It is the minimum surface that preserves the frontend contract:
the SPA must *hold* tokens to authenticate, so token theft from a compromised client is
the primary threat (see §15). Everything server-side is hashed so a database leak does
not leak credentials.

### 1.3 Failure posture

Every auth failure — invalid token, expired token, wrong password, unknown email,
unconfirmed email, rate-limited — returns the locked envelope with a stable code:

| Code | Status | Meaning |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | No credentials presented |
| `AUTH_INVALID_TOKEN` | 401 | Token present but malformed / wrong signature / wrong type |
| `AUTH_TOKEN_EXPIRED` | 401 | Access token past `exp` |
| `AUTH_INVALID_CREDENTIALS` | 401 | Login: unknown email **or** wrong password (identical body) |
| `EMAIL_NOT_CONFIRMED` | 403 | Login/refresh blocked until email confirmation |
| `EMAIL_CONFIRMATION_REQUIRED` | 200 (with no session) | Register: confirmation needed before first login |
| `RATE_LIMITED` | 429 | Auth route over its quota (with `Retry-After`) |
| `TOKEN_REUSE_DETECTED` | 401 | Refresh replay (family revoked server-side; body stays uniform) |
| `VALIDATION_ERROR` | 400 | Zod body/query validation failed |
| `INVALID_TOKEN` | 400 | Email-verification / reset token bad or expired |

**Why a fixed code set.** Sprint 1 locked the envelope and the principle that every
failure is machine-parseable (DECISIONS.md #9). Stable codes let the Phase 13 adapter map
errors to the exact `{ error }`-only shape `useAuth.tsx` destructures, and let monitoring
distinguish "expired" from "invalid" without parsing prose.

---

## 2. Registration flow

### 2.1 The flow

1. Client calls `POST /auth/register` with `{ email, password, emailRedirectTo }`.
2. Server normalizes the email (trim + lowercase), validates it and the password (§13).
3. Server looks up the normalized email:
   - **Not registered:** create the user row (new UUID), `password_hash = bcrypt(password, cost 12)`, `email_confirmed_at = null`.
   - **Registered but unconfirmed:** no new user row; regenerate the verification token (same observable result).
   - **Registered and confirmed:** no new user row; **no token is sent** — but the response is identical.
4. A `signup` verification token (32-byte CSPRNG, hashed in Postgres, 24 h TTL, single-use — §6) is created and emailed.
5. The profile row is created by the Phase 2 `on_user_created` DB trigger; the register service also runs a **transactional fallback** that inserts the profile row if the trigger is absent (defense in depth, preserves "a profile row always exists").
6. Response: **confirmation-required, no session** — `{ user: { id, email }, confirmationRequired: true }`. The adapter maps this to `{ error: null }` for `useAuth.tsx`.

### 2.2 Why these decisions

- **Confirmation-required (no session).** GoTrue with email confirmation enabled returns a
  null session for a new signup (§5.1: "the newly created user gets `session = null`").
  The frozen frontend already handles this: it shows a success toast and `ProtectedRoute`
  bounces to `/login`. Issuing a session here would *change* observable behavior and skip
  the confirmation gate.
- **Identical response for new / unconfirmed / confirmed emails.** This is the
  account-enumeration mitigation: the response never reveals whether an address is
  registered. The current frontend reads only `{ error }` (§11.2), so a uniform success
  is also exactly what the UI expects.
- **bcrypt cost 12.** The roadmap pins cost 12 (Phase 3 §8). Cost 12 (~100–300 ms per
  verify on modern hardware) is the accepted 2026 balance between offline-guessing
  resistance and login latency; cost 10 is the floor, cost 13+ becomes a login-DoS cost.
  Cost 12 also keeps carried-over GoTrue `$2a$` hashes verifiable (§19).
- **UUID generated server-side.** New users get a fresh UUID; existing (imported) users
  keep their Supabase UUID (identity continuity, D6). The `users.id` value **is** the
  app's universal identity key (§3.6) — profiles, journeys, requests, messages, storage
  paths all key on it, so it must be stable and server-owned, never client-supplied.

---

## 3. Login flow

### 3.1 The flow

1. Client calls `POST /auth/login` with `{ email, password }`.
2. Normalize the email; look up the user.
3. **Always** run a bcrypt compare:
   - Unknown email → compare against a fixed **dummy hash** so the response time is
     indistinguishable from a real comparison (timing equalization).
   - Known email → compare the presented password; on failure record the failure against
     the email (lockout state, §16).
4. Both failure paths return the **identical** `401 AUTH_INVALID_CREDENTIALS` envelope.
5. On success: clear the failure counter; check `email_confirmed_at` — if null, return
   `403 EMAIL_NOT_CONFIRMED`.
6. Create the first refresh token of a new family (§5) and an access JWT (§4).
7. Respond with the **GoTrue Session shape** (§5.2/§10.1): access_token, refresh_token,
   `expires_in` (seconds), `token_type: "bearer"`, `user: { id, email }`.

### 3.2 Why these decisions

- **Session shape parity is a hard requirement.** The Phase 13 adapter persists this
  object to localStorage under a `trainmate-auth-token` key and `useAuth`/supabase-js
  consume its exact fields (§11.2, roadmap Phase 13 contract). Any key rename is a
  contract break caught only in Phase 13 — so it is specified now, exactly.
- **Uniform login errors.** "Unknown email" and "wrong password" must not be
  distinguishable by body or timing. This is the canonical enumeration defense, and it is
  cheap. The lockout state (§16) is keyed on email so a single shared IP (dorm, station
  wifi) doesn't lock out a building.
- **`EMAIL_NOT_CONFIRMED` is the one deliberate non-uniform case.** GoTrue surfaces this
  as a distinct error, and the frontend's current code path treats a blocked login as a
  plain `{ error }`. It is not an enumeration signal (it only fires for an *already-known*
  email+password pair that has not been confirmed), so it does not weaken enumeration
  protection.
- **Fresh family on every login.** Each login starts a new refresh-token family. Nothing
  from a previous session is reused (no session fixation), and a stolen old token cannot
  outlive the session it belonged to.

---

## 4. JWT strategy

### 4.1 The access token

| Property | Value |
| --- | --- |
| Algorithm | **HS256** (pinned at verify) |
| Signing key | `JWT_SECRET` — a single random secret ≥ 32 bytes (base64url), required by env validation |
| Lifetime | **15 minutes (locked — D-A13)** |
| Claims | `sub` (user UUID, string), `email`, `iat`, `exp`, `type: "access"` |
| Verification | Parse; **require** `algorithms: ['HS256']`; require `type === "access"`; require `sub` to be a UUID; allow ±30 s clock skew |

### 4.2 Why HS256, not RS256/ES256

- **Single service, single consumer.** The only verifier of access tokens is this Express
  API (REST + Socket.IO handshake). Symmetric HS256 with one shared secret is the simplest
  correct choice; the spec pins it (§5.2 #1, roadmap Phase 3 §4) and it needs no public/
  private key distribution.
- **Upgrade path documented, not pre-built.** If auth ever splits into its own service,
  or another service must validate tokens without sharing a secret, the design moves to
  **RS256/ES256** with a public key or JWKS. That is a key-rotation-time change, not a
  schema change; noted so it is not a surprise later.
- **Algorithm confusion is the classic HS256 failure mode.** A verifier that trusts the
  token's `alg` header can be tricked into accepting `alg: none` or a forged RS256→HS256
  token. The defense is: pin `algorithms: ['HS256']`, reject a missing `type` claim, and
  reject any token whose `alg` header differs from HS256. This is a hard requirement, not
  a default — the library default may be too permissive.

### 4.3 Why 15 minutes (locked)

The access-token TTL is **locked at 15 minutes** — a fixed decision, not a tunable
default (decision log D-A13; former open question #1 resolved). The spec targets
"short-lived (e.g. 15 min)" (§5.2 #1) and the roadmap repeats it (Phase 3 §4). 15
minutes:
- **Bounds the stolen-access-token window.** A JWT cannot be revoked server-side (§8.3);
  its lifetime *is* its revocation latency.
- **Is behavior-compatible with GoTrue's model.** supabase-js auto-refreshes *before*
  expiry (`autoRefreshToken: true`, §11.1); the Phase 13 adapter does the same. The
  frontend never observes the difference between 15 min and 1 h.

**Why the `email` claim.** The spec requires `{ sub, email }` (§5.2 #1). Note the
implication: a JWT is base64 — the email is *visible* to anyone holding the token, and is
PII. That is identical to GoTrue's access token and is accepted; the mitigations are that
the token is short-lived, TLS-only, and never logged (Sprint 1 redaction). The refresh
token is opaque (§5) and never contains PII.

### 4.4 Secret hygiene

- `JWT_SECRET` is generated at deploy time (`crypto.randomBytes(48).toString('base64url')`),
  injected via the environment, validated **required** by Zod (Phase 3 flips the Sprint 1
  placeholder to required), never committed.
- **Key rotation** (§14): the verifier accepts a small set of recent secrets (matched by a
  `kid` claim) so rotation can overlap old and new without invalidating live tokens.

---

## 5. Refresh token strategy

### 5.1 Token design

| Property | Value |
| --- | --- |
| Value | 32 bytes from `crypto.randomBytes` (CSPRNG), base64url (~43 chars) |
| Stored | **SHA-256 hash only** — the raw value exists only on the client and in the request body of `/auth/refresh` |
| Expiry | **30 days sliding** — each rotation issues a token valid 30 days from issue |
| Family | One `family_id` per login chain; every rotation extends the same family |
| Uniqueness | `token_hash` has a unique constraint (rotation race safety, roadmap Phase 3 §7) |

### 5.2 Rotation and reuse detection

**Rotation.** On `POST /auth/refresh` with token `T`:
1. Hash `T`; look up the row.
2. If the row is missing, revoked, or expired → `401` (uniform).
3. In **one transaction**: mark `T` revoked (`revoked_at = now`, `replaced_by_token_hash = hash(new)`), insert the new token with the **same `family_id`** and a fresh 30-day expiry, return the new pair + a fresh access JWT.

**Reuse detection.** If `T` is found but already revoked, that is either a replay of a
rotated-away token (theft signature) or a client race:
1. **Revoke the entire family** (`UPDATE refresh_tokens SET revoked_at = now WHERE family_id = …`).
2. Log a `warn`-level security event (request id, user id — no token material, no PII).
3. Return `401` with the uniform `TOKEN_REUSE_DETECTED` body — the attacker learns nothing
   beyond "invalid," but the legitimate user's remaining sessions are dead, which is the
   correct default when a credential may be stolen.

### 5.3 Why these decisions

- **Opaque random, not a JWT.** The spec allows either (§5.2 #2) but an opaque server-side
  token is strictly better here: (a) it is *revocable by state* — a JWT refresh token
  would need a server-side blacklist anyway, re-introducing the exact state we want and
  making it harder; (b) it carries **no PII** — a leaked refresh token is a random string,
  not an email-bearing JWT; (c) rotation + hashing gives theft containment without a
  signature key. Consequence: **`REFRESH_SECRET` is not needed** and is dropped from the
  env design (the roadmap's env matrix listed it on the assumption of signed refresh —
  this is a deliberate, recorded deviation, K11).
- **Stored hashed.** A database dump yields SHA-256 digests of 256-bit random values —
  useless to an attacker (no offline cracking angle, unlike password hashes). It also
  means the app never holds plaintext credentials at rest.
- **Rotation + reuse detection (OAuth Security BCP §4.14.2).** A rotated-away token is
  worthless to a thief who waited; a thief who replays it within the token's 30-day
  window triggers family revocation and alerts. This converts "refresh token stolen" from
  a silent, indefinite compromise into a detected, contained event.
- **Family, not per-token, revocation on replay.** A single replayed token is the
  strongest signal that *all* tokens from that chain may be compromised — revoking one
  token alone would leave sibling sessions live. Revoking the family is the conservative,
  correct default.
- **30-day sliding expiry.** An active user is never logged out; a user silent for 30
  days must re-login (acceptable, and identical in spirit to GoTrue's model). Sliding (not
  fixed-from-login) is chosen because TrainMate users are mobile-first with intermittent
  connectivity; a hard absolute cap would log out otherwise-active users on schedule.
- **Transaction + unique constraint on rotation.** Two racing rotations of the same token
  must not both succeed. The `UPDATE … WHERE revoked_at IS NULL RETURNING` + unique
  `token_hash` makes exactly one winner; the loser hits the reuse path (§5.4).
- **The client must single-flight refreshes.** The two-tab refresh race is real: two tabs
  each holding the same refresh token can race the rotation. The **server** stays strict
  (family revocation is the safe default); the **adapter** (Phase 13) serializes refreshes
  within a tab and coordinates across tabs (BroadcastChannel / a localStorage lock, as
  supabase-js does), so the race is designed out of the common path. The residual risk —
  a true cross-tab race in a pathological client — is bounded: the user re-logs in once.
  This is a deliberate, documented tradeoff, not a silent one.
- **Pruning.** Expired/revoked rows are swept by a daily job (Phase 14 cron) and lazily on
  read; the table stays small and the hashes stay short-lived.

---

## 6. Email verification flow

### 6.1 Token design

| Property | Value |
| --- | --- |
| Token | 32-byte CSPRNG, base64url |
| Stored | SHA-256 hash in `email_verifications` (`type = 'signup'`) |
| TTL | 24 hours (locked — D-A15) |
| Single-use | `consumed_at` set atomically; a consumed token is rejected |
| Deliverable | Email link built by the server |

### 6.2 The link and the redirect (frozen-frontend parity)

The email contains a link to the **backend**:

```
<API_PUBLIC_ORIGIN>/auth/verify-email?token=<T>&redirect_to=<allowlisted origin>
```

When clicked:
1. Validate `T` (exists, `type = 'signup'`, not consumed, not expired).
2. In one transaction: set `consumed_at`, set `users.email_confirmed_at = now()`.
3. Issue a fresh token pair (new family).
4. `redirect_to` is **validated against an allowlist** (env `AUTH_ALLOWED_REDIRECT_ORIGINS`,
   defaulting to the configured frontend origin). Only an allowlisted origin is honored;
   anything else falls back to the default frontend origin — never a 400, never followed.
5. Redirect `302` to:
   ```
   <allowlisted origin>/#access_token=<JWT>&refresh_token=<opaque>&expires_at=<epoch>&token_type=bearer
   ```
   The frozen frontend's existing supabase-js client has `detectSessionInUrl` on by
   default (§11.1 config does not disable it); on load it parses this hash, persists the
   session to localStorage, and fires `SIGNED_IN`. **The user is logged in with zero
   `src/` changes.**

A **programmatic** twin exists for the Phase 13 adapter: `POST /auth/confirm-email`
`{ token }` → validates, finalizes, and returns the session object as JSON. The adapter
may use either path; both are idempotent for already-confirmed accounts (confirming twice
succeeds and is a no-op security-wise).

### 6.3 Resend

`POST /auth/resend-verification` `{ email }`: regenerates a `signup` token and emails it.
Always returns success (enumeration-safe), rate-limited (§16). An already-confirmed
address gets no email but the same response.

### 6.4 Why these decisions

- **High-entropy single-use hashed token.** 256 bits make URL guessing infeasible;
  hashing means a DB leak cannot be replayed; single-use stops a captured link from being
  reused; **24 h (locked — D-A15)** bounds a stale link.
- **Hash-fragment redirect is the only zero-frontend-change login path.** GoTrue's verify
  flow delivers the session to the SPA by redirecting with a token fragment; supabase-js
  is built to consume exactly that (§5.1, §12.2 Phase F). Any design that *didn't* do this
  would either force a frontend change now (forbidden) or silently break the "confirm →
  logged in" behavior the app has today. This is the single most load-bearing parity
  decision in the module.
- **`redirect_to` allowlisting is a security requirement, not a nicety.** The redirect
  target receives a **fresh session pair** in its URL fragment — any script on that origin
  can read `document.location.hash` and take over the account. If `redirect_to` were an
  open value, a crafted confirmation link would exfiltrate a valid session. GoTrue
  validates redirects against `SiteURL + AdditionalRedirectURLs`; we mirror that. This
  threat is itemized in §15.
- **`consumed_at` set atomically with the confirmation.** No window where a token is both
  valid and consumed; replay is structurally impossible (a second click finds the token
  consumed and re-renders success or redirects harmlessly).
- **Idempotent for confirmed accounts.** The frontend quirk is "no check-your-email hint"
  (§5.1); a user who re-registers a confirmed email, or clicks an old link, must not be
  error-pathed. Idempotence keeps the UX smooth and prevents confirmation-state regressions.
- **The verify endpoint is `GET` because the click that drives it can only be a GET.** A
  confirmation link is opened by a browser or email client as a plain link navigation —
  a link click cannot issue `POST`. And the hash-fragment redirect (§6.2) requires a full
  top-level navigation so supabase-js's `detectSessionInUrl` runs on the landing page
  load. The token consumption is a side effect, but it is **idempotent by design** (a
  re-click finds the token consumed and renders success — §6.2), which is exactly the
  repeat-safe semantics `GET` expresses. The *programmatic* twin, `POST /auth/confirm-email`,
  exists for the adapter where a body is natural and the caller controls the verb.

---

## 7. Password reset flow

### 7.1 Scope note (roadmap alignment)

The roadmap explicitly defers the **frontend** password-reset UI to post-migration
(Phase 3 §4: "no frontend UI, out of scope; note as post-migration enhancement") and
lists `PASSWORD_RECOVERY` in the GoTrue event set the adapter must emit (§11.2, Phase 13).
This section designs the **complete backend capability** so it can be built, tested, and
adapter-ready now, with the UI wiring flagged as the deferred half. The **request**
endpoint is safe to ship immediately; the **reset** endpoint is inert until the adapter/
UI lands in Phase 13.

### 7.2 Request

`POST /auth/password-reset/request` `{ email }`:
1. Normalize the email.
2. **Always return 200** (uniform). If the email is registered and confirmed: create a
   `password_reset` token (32-byte CSPRNG, hashed, **60 min TTL (locked — D-A14)**, single-use) and email a
   link `<APP_ORIGIN>/reset-password?token=<T>` (the Phase 13 route) — or, until that UI
   exists, a link that lands on the login page. If the email is unregistered or
   unconfirmed: no token, no email, same 200.
3. Rate-limited (§16).

### 7.3 Reset

`POST /auth/password-reset` `{ token, newPassword }`:
1. Validate `T` (exists, `type = 'password_reset'`, not consumed, not expired).
2. In one transaction: set `users.password_hash = bcrypt(newPassword, cost 12)`, consume
   the token.
3. **Revoke every refresh-token family for the user** — all sessions are dead.
4. Clear the user's lockout counters.
5. Return success. The client is then logged out everywhere and signs in again with the
   new password.

### 7.4 Why these decisions

- **Uniform 200 on request.** Password-reset requests are the highest-friction
  enumeration channel (they cause emails). Never revealing whether an address exists is
  the standard defense (NIST 800-63B / OWASP). Cost: a spammer can trigger emails for
  real addresses — bounded by the request rate limit (§16).
- **60-minute TTL (locked — D-A14) + single-use.** Short enough to defeat link replay in
  transit or in logs; single-use defeats double-click and capture-replay.
- **Session revocation on reset.** If an attacker *does* complete a reset, revoking all
  sessions forces the victim's real sessions dead and surfaces the event; if the owner
  resets, they are signing in fresh everywhere anyway. This is the same "revoke family"
  primitive as logout/reuse-detection — one mechanism, three callers.
- **Rehash, don't update-in-place semantics.** The new password goes through the same
  cost-12 bcrypt as registration; nothing about the reset path is weaker than the
  registration path.
- **Deliberately not force-resetting on hash incompatibility (§19).** If a carried-over
  GoTrue hash ever fails verification, forced reset is the *documented last resort*, not
  the default design (roadmap Phase 3 §13 risk).

---

## 8. Logout flow

### 8.1 The flow

1. Client calls `POST /auth/logout` with the refresh token (or a valid access token).
2. Server resolves the user (refresh-token hash lookup, or access-token `sub`), then
   **revokes all of the user's refresh-token families** (`UPDATE refresh_tokens SET
   revoked_at = now WHERE user_id = … AND revoked_at IS NULL`).
3. Returns `204 No Content` — even if the presented token was already invalid (idempotent,
   no existence signal).
4. The adapter clears the localStorage session and emits `SIGNED_OUT`; `useAuth` sets
   `user = null` and `ProtectedRoute` redirects to `/login` — exactly the current behavior
   (§5.1).

### 8.2 Why revoke *all* families

The frontend calls `supabase.auth.signOut()` with no arguments, which GoTrue defaults to
**scope `global`** — sign out every session. Revoking all families is the parity behavior:
logging out on one device kills the account's sessions everywhere. This is also the safest
default for a social app; a narrower "this device only" is a future enhancement, not a
parity requirement.

### 8.3 The access-token-until-expiry tradeoff

A JWT cannot be revoked server-side without a blacklist. After logout, a stolen access
token remains valid for **up to 15 minutes**. This is the same property GoTrue has when
its JWT blacklist is disabled, and it is the documented reason the access TTL is short
(§4.3). The design does **not** add a JWT blacklist in this phase: it reintroduces
server-side state on the access path (the exact thing stateless access buys us) for a
15-minute window. This is a deliberate, recorded tradeoff (roadmap Phase 3 §13 risk
"JWT can't be revoked server-side → short TTL + refresh rotation; document").

### 8.4 Idempotence

Logout with an expired, already-revoked, or garbage token still returns 204. The client
should always be able to "sign out locally" even if the server already forgot the session.

---

## 9. Protected route flow

### 9.1 The `authenticate` middleware (wiring the Sprint 1 stub)

**Authenticated API requests authenticate with the `Authorization: Bearer <access_token>`
HTTP header — that is the single, canonical way the access token is presented** (§12
design notes). The access token is never a cookie, query parameter, or body field; the
only places a token rides outside this header are the refresh and confirmation flows, in
the exact spots §5/§6/§12 define.

Every protected route passes through `authenticate` **before** its handler. The stub in
`src/middleware/authenticate.ts` (currently a hard 401) becomes:

1. Extract `Authorization: Bearer <token>`. Missing/malformed → `401 AUTH_REQUIRED`.
2. Verify the JWT (§4): signature + pinned `alg`, `type === 'access'`, `exp`, `sub` is a
   UUID. Expired → `401 AUTH_TOKEN_EXPIRED`; invalid → `401 AUTH_INVALID_TOKEN`.
3. Attach `req.user = { id, email }` to the request.
4. Route handlers and services use `req.user.id` to **force ownership** — the RLS
   equivalent. Every service write that mirrors a policy from the spec's §6 (Part I map)
   starts from `req.user.id`, never from a client-supplied id.

**Deliberately no database hit in the middleware.** Access verification is stateless so
API instances and socket servers stay horizontally scalable (Phase 14 topology). The
consequence — a hard-deleted user's access token works for routes that never touch the
DB until its 15-minute expiry — is accepted and bounded. Services that read/write user
data re-resolve the row (most routes) and get the normal 404/403 for a vanished user.
A `loadUser` guard is available for routes that need profile context.

### 9.2 The `authorize` extension point

Authorization *capability* checks (profile visibility, conversation participation, block
gates — the spec's §6.12 invariants) land in later phases as a separate `authorize`
middleware / access-service module (roadmap Part I). This design defines the contract:
`authenticate` answers **who** (identity), `authorize` answers **may they** (capability).
Auth never enforces application policy; it only establishes identity.

### 9.3 Socket.IO handshake (Phase 12 dependency, designed now)

The realtime server verifies the **access token** in the Socket.IO `auth` handshake
payload at connect time and rejects invalid/expired tokens before any room join (§8.5).
It reuses the exact same verification function as `authenticate` — one token path, REST
and sockets.

### 9.4 Failure behavior

Every rejection is the locked envelope with an `x-request-id` response header (Sprint 1
conventions). No HTML, no stack, no "valid-but-denied" leakage: blocked vs. nonexistent
resources render identically (404) so authorization gaps cannot be probed (spec §6.12
note on non-leakage).

---

## 10. Database schema

Three new tables, designed in Phase 2 and consumed here. Columns, types, constraints, and
**why**:

### 10.1 `users` (maps `auth.users`; the identity anchor)

| Column | Type | Constraints | Why |
| --- | --- | --- | --- |
| `id` | uuid | PK | **Preserved Supabase UUID** (identity continuity, D6); server-generated for new users |
| `email` | text | NOT NULL, **UNIQUE** | Normalized (lowercased, trimmed) at the app layer; unique index enforces no case-duplicate registration |
| `password_hash` | text | NOT NULL | bcrypt `$2a$12$…` (60 chars); never logged, never returned |
| `email_confirmed_at` | timestamptz | NULL | Carried over from GoTrue; `NULL` blocks login/refresh |
| `created_at` | timestamptz | NOT NULL, `now()` | Auditing / retention |
| `updated_at` | timestamptz | NOT NULL, `now()` | `update_updated_at` trigger (Phase 2 keeps it) |

**Deliberate drops from `auth.users`** (Phase 2 already documents): `user_metadata`,
`app_metadata`, `aud`, `role`, `raw_app_meta_data`, `raw_user_meta_data` — the frontend
never reads them (§5.1: "only `user.id` and `user.email` are used").

### 10.2 `refresh_tokens`

| Column | Type | Constraints | Why |
| --- | --- | --- | --- |
| `id` | uuid | PK | Row identity |
| `user_id` | uuid | NOT NULL, FK → `users.id` ON DELETE CASCADE | Sessions die with the account (hard-delete story, Phase 14) |
| `family_id` | uuid | NOT NULL | Groups a rotation chain for **reuse detection** (§5.2) |
| `token_hash` | text | NOT NULL, **UNIQUE** | SHA-256 of the opaque token; unique constraint = rotation race safety (roadmap Phase 3 §7) |
| `expires_at` | timestamptz | NOT NULL | 30-day sliding window; drives pruning |
| `created_at` | timestamptz | NOT NULL, `now()` | Audit |
| `revoked_at` | timestamptz | NULL | Set on rotation/logout/reset/reuse-detection |
| `replaced_by_token_hash` | text | NULL | Chain pointer — the reuse-detection forensics field |

Indexes: `(user_id)`, `(family_id)`, `(expires_at)` (pruning scan), unique `(token_hash)`.

### 10.3 `email_verifications`

| Column | Type | Constraints | Why |
| --- | --- | --- | --- |
| `id` | uuid | PK | Row identity |
| `user_id` | uuid | NOT NULL, FK → `users.id` ON DELETE CASCADE | Token belongs to an identity |
| `type` | text | NOT NULL, CHECK `IN ('signup','password_reset')` | One table for both one-time-token kinds |
| `token_hash` | text | NOT NULL, **UNIQUE** | SHA-256; unique = single-use race safety |
| `expires_at` | timestamptz | NOT NULL | 24 h (signup) / 60 min (reset) |
| `created_at` | timestamptz | NOT NULL, `now()` | Audit |
| `consumed_at` | timestamptz | NULL | Single-use; set atomically with the consuming write |

### 10.4 Why this shape (design principles)

- **Everything the client ever sees is stored hashed.** Password → bcrypt; tokens →
  SHA-256. A database dump is inert. This is the single most important storage property.
- **Foreign keys cascade from `users`.** Deleting an account (post-migration hardening)
  removes its sessions and verification rows in one operation — no orphan credentials.
- **No RLS in the target** (roadmap D1). One application role; authz is service-layer.
  The three tables above are protected by *app code* (only `auth.service` writes them)
  and by the hashed storage itself.
- **The profile bootstrap trigger stays.** `on_user_created` (Phase 2 port of
  `handle_new_user`) guarantees a profile row exists for every user; auth's register
  service adds a transactional fallback (§2.1). "A profile row always exists" is a spec
  invariant (§5.1, §9.1) and must survive the migration.

---

## 11. Prisma models (design only — no schema generated)

The three tables map to Prisma as follows. **Field names and constraints only — this is
design, not a schema file.**

| Prisma model | Field | Prisma type mapping | Notes |
| --- | --- | --- | --- |
| `User` | `id` | `String @db.Uuid` | PK; maps `users.id` |
| | `email` | `String` | `@unique`; store **normalized** (lowercased) at write time |
| | `passwordHash` | `String` | bcrypt hash text; mapped to `password_hash` |
| | `emailConfirmedAt` | `DateTime?` | mapped to `email_confirmed_at` |
| | `createdAt` / `updatedAt` | `DateTime @default(now())` | `updatedAt` auto-updated |
| | `refreshTokens` / `emailVerifications` | relations | `onDelete: Cascade` |
| `RefreshToken` | `id` | `String @db.Uuid` | PK |
| | `userId` | `String @db.Uuid` | FK → User |
| | `familyId` | `String @db.Uuid` | indexed |
| | `tokenHash` | `String` | `@unique` — the rotation race guarantee |
| | `expiresAt` | `DateTime` | indexed for pruning |
| | `revokedAt` | `DateTime?` | |
| | `replacedByTokenHash` | `String?` | |
| `EmailVerification` | `id` | `String @db.Uuid` | PK |
| | `userId` | `String @db.Uuid` | FK → User |
| | `type` | `String` | app-enforced `signup` / `password_reset`; Prisma has no native enum need |
| | `tokenHash` | `String` | `@unique` |
| | `expiresAt` | `DateTime` | |
| | `consumedAt` | `DateTime?` | |

Mapping notes for the Phase 2 schema port:
- `uuid` → `String @db.Uuid` (Prisma's canonical mapping; the DB column is `uuid`).
- `timestamptz` → `DateTime`.
- The `type` CHECK on `email_verifications` is expressed at the **app layer** (Zod) plus
  a raw-SQL CHECK in the migration (Prisma cannot express CHECK constraints); both are
  recorded in the Phase 2 manifest test.
- Indexes beyond `@unique` (family, expires_at) are created as raw SQL in the migration —
  Prisma creates `@unique`/`@@index` natively but the pruning index shape is explicit SQL.
- The `users.email` uniqueness is a **Prisma `@unique` + a DB unique index**; the app also
  normalizes so the two can never disagree.

**Why no code here.** The instruction is design-only; the Phase 2 deliverable will emit
the actual schema. What matters for this design is that the field set, constraints, and
relations above are exactly what Phase 2 implements, so auth never re-litigates its data
model.

---

## 12. API endpoints

All auth endpoints live under `/auth`. Request/response fields are specified in tables
(no code). Errors use the locked envelope (§1.3).

| Method | Path | Auth | Request | Response (200/2xx) | Notable errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/register` | none | `email`, `password`, `emailRedirectTo?` | `{ user: {id,email}, confirmationRequired: true }` | 400 validation |
| POST | `/auth/login` | none | `email`, `password` | Session: `access_token`, `refresh_token`, `expires_in`, `token_type: "bearer"`, `user: {id,email}` | 401 invalid creds (uniform) · 403 email not confirmed · 429 |
| POST | `/auth/refresh` | none (body token) | `refresh_token` | New session pair (rotated) | 401 expired/invalid · 401 reuse (family revoked) · 403 unconfirmed |
| POST | `/auth/logout` | refresh or access token | `refresh_token?` | 204 | idempotent — always 204 |
| GET | `/auth/session` | access token | — | `{ user: {id,email}, expires_at }` (validates the presented token) | 401 expired/invalid |
| POST | `/auth/confirm-email` | none | `token` | Session pair (finalizes confirmation) | 400 invalid/expired token · idempotent for confirmed |
| GET | `/auth/verify-email` | none | query: `token`, `redirect_to?` | 302 redirect with session fragment (§6.2) | 400 invalid/expired token |
| POST | `/auth/resend-verification` | none | `email` | 200 (uniform) | 429 |
| POST | `/auth/password-reset/request` | none | `email` | 200 (uniform) | 429 |
| POST | `/auth/password-reset` | none | `token`, `newPassword` | 200 | 400 invalid/expired token · 429 |

**Design notes on the surface:**
- **Every authenticated request presents the access token in the `Authorization: Bearer
  <access_token>` header.** That header is the sole mechanism for authenticated API calls:
  the access token is never a cookie, query parameter, or JSON body field. `authenticate`
  parses it once, in one place (§9.1); the Socket.IO handshake presents the same token in
  its `auth` payload (§9.3). The refresh and confirmation flows are the only deliberate
  exceptions — their request bodies carry their own credential (below).
- **`/auth/session` is a validator, not the source of truth for session restore.** The
  SPA restores its session locally from localStorage (GoTrue `getSession` parity — §11.2).
  `/auth/session` exists for the adapter to (re)validate a stored session and to drive the
  401 → refresh → retry decision, exactly as §10.1 specifies.
- **`refresh` and `confirm-email` need no `Authorization` header** — their request bodies
  carry their own credential. This is intentional: the refresh token *is* the credential.
- **`logout` accepts either token** so a client with an expiring access token can still
  sign out; the server resolves the user either way and revokes all families (§8).
- **No `GET /auth/session`-style session list, no admin/user-management endpoints** in
  this phase — the spec defines none (§10.1), and adding management surfaces now is scope
  creep (roadmap §4 "features that should NEVER be implemented until migration is
  complete").

---

## 13. Validation rules

Validation is Zod at the route boundary (Sprint 1 convention — every body/query/param is
validated) **and** mirrored at the service for the invariants that matter cross-route.

### 13.1 Email

| Rule | Why |
| --- | --- |
| Trim, then **lowercase** before any lookup/insert | Canonical form; Postgres unique index is case-sensitive, so normalization is the dedupe mechanism. Matches GoTrue's lowercasing; existing data is already lowercase |
| ≤ 254 characters, RFC-approximate format (a standard email regex; no exotic parsing) | Bounds input; rejects structural garbage |
| **No Unicode normalization games** | Prevents visually-identical-but-different addresses; normalized at the same code path everywhere (register, login, reset, resend) |
| Reject if it fails the above | Never silently truncate an address |

### 13.2 Password

| Rule | Why |
| --- | --- |
| **Minimum 8 characters** | NIST 800-63B: length over complexity; composition rules (require number/symbol…) measurably produce *weaker* passwords and are rejected as a design choice |
| **Maximum 72 bytes** — reject, never truncate | bcrypt silently truncates input at 72 bytes; accepting longer input means two different passwords could hash identically. Hard reject closes that hazard |
| Reject NUL bytes and control characters | bcrypt and some DB/email paths misbehave on them |
| No max-composition rules, no common-password blocklist in this phase | Blocklists need a maintained list; defer to post-migration hardening (§20). Minimum length is the 2026 baseline |

### 13.3 Tokens, headers, inputs

| Rule | Why |
| --- | --- |
| Opaque tokens: exactly 32 bytes decoded, base64url; any malformed token → uniform invalid | Structural check before DB hashing; rejects garbage cheaply |
| `Authorization: Bearer` parsing is strict; a second `Authorization` header, or a missing scheme, → 401 | Header-smuggling hygiene; Express duplicate-header behavior is not a place to be lenient |
| All auth request bodies ≤ the Sprint 1 JSON body cap | Already enforced; refresh/reset bodies are tiny |
| `redirect_to` must be on the allowlist (else default origin, never an error) | §6.4 — the token-theft-by-redirect defense |
| Emails in request bodies never echo into logs | Sprint 1 redaction + curated serializers (§14) |

---

## 14. Security considerations

### 14.1 Secrets

| Control | Why |
| --- | --- |
| `JWT_SECRET` required (Zod), ≥ 32 bytes random, injected per environment, never committed | A weak/committed signing secret is total JWT forgery (the single worst auth failure mode) |
| **`REFRESH_SECRET` removed** from the env design | Opaque refresh needs no secret (K11). Keeping a dead secret invites misuse (e.g., "signing" the refresh with it) |
| Rotation runbook with overlapping acceptance (`kid`-matched secret list, both old+new valid during the window) | Zero-downtime key rotation; immediate invalidation on compromise |
| All other secrets (DB URL, email provider keys) stay in the env manager, never logged | Baseline hygiene |

### 14.2 Credential storage

- bcrypt cost 12, per-registration salt; **constant-time verify**; dummy-hash compare for
  unknown emails (§3).
- Refresh + verification tokens stored SHA-256-hashed, single-use, with TTLs (§5, §6).
- **Never** log: passwords, tokens, email addresses from request bodies, or the `email`
  JWT claim. Sprint 1's pino redaction + curated serializers already never log request
  bodies or query strings; auth adds no exception. A regression test asserts a request
  carrying a token in a header produces no token material in the log (§18).

### 14.3 Client-side session storage (the localStorage tradeoff)

The session pair is persisted in **localStorage** for behavior parity with GoTrue
(§11.1 — the current client config stores there). This is a documented XSS-exposure
tradeoff: any script executing on the origin can read the session. Mitigations layered in
without touching the frontend:
- Access TTL 15 min — a stolen access token dies fast (§4.3).
- Refresh rotation + reuse detection — a stolen refresh token triggers family revocation
  the moment it is *used* (§5.2).
- The Phase 13 adapter adds **no** secrets to the bundle and the confirmation flow never
  puts a token in a URL that gets logged.
- The **secure-cookie / httpOnly refresh** variant is a recorded post-migration
  hardening item (roadmap Nice-to-have #13), not this phase — it would require an
  auth-aware client change.

### 14.4 Transport, headers, CORS

- TLS everywhere (already required in prod; the dev compose is localhost-only).
- Helmet security headers + HSTS already in the Sprint 1 pipeline (DECISIONS.md/D8).
- CORS locked to the configured frontend origin(s) — already Sprint 1.
- **CSRF is not a threat to this design** because no auth credential is sent as a cookie:
  the access token rides in an explicit `Authorization` header, the refresh token in a
  body field the browser never auto-attaches. (If a cookie variant is adopted later, CSRF
  must be re-reviewed — flagged.)

### 14.5 Operational security

- Security events (family revocation, lockout threshold hit, reset) log at `warn`/`error`
  with request-id and **no PII**.
- Rate limiter store: Redis in prod with an in-memory fallback (D4) so a Redis outage
  degrades to per-instance limiting instead of failing open against the bcrypt path (§16).
- Auditable: `refresh_tokens` retention + pruning keeps the audit trail bounded.
- No stack traces outside dev; envelope only (Sprint 1).

---

## 15. Threat model

Actors: **Anonymous attacker**, **registered abuser**, **token thief** (XSS/phishing/
exfiltration), **insider with DB access**, **network observer**. Table order ≈ severity.

| # | Threat | Vector | Impact | Likelihood | Controls | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | **Refresh-token theft / replay** | localStorage XSS; link fragment leak; shoulder-surf | Full account takeover, lasting | Medium | Rotation + reuse detection → family revocation; hashed storage; redirect allowlist; short access TTL | A thief who *never uses* the stolen token harms nothing; a thief who uses it is detected and contained |
| T2 | **Access-token theft** | XSS; logs; unencrypted transport | Account access up to 15 min | Medium | Short TTL; TLS; no tokens in logs; redaction test | Token valid until expiry after logout (documented §8.3) |
| T3 | **JWT forgery / algorithm confusion** | Attacker crafts token, `alg: none` / RS256→HS256 | Full auth bypass | Low (needs secrets awareness) | HS256 pinned at verify; secret ≥ 32 bytes; `type` claim required; `sub` must be UUID | Forged tokens rejected structurally |
| T4 | **Password brute force / credential stuffing** | Online guessing at login | Account takeover | Medium | bcrypt cost 12; per-email+IP rate limit; progressive lockout; uniform errors | Rate-limit bypass via distributed IPs — bounded, monitored |
| T5 | **Account enumeration** | Register/login/reset/resend responses & timing | Target discovery for phishing/abuse | Medium | Uniform responses; dummy-hash timing; rate-limited resend | Register still reveals *whether a signup email arrived* only via email receipt — accepted (GoTrue-equivalent) |
| T6 | **Account pre-hijacking** | Attacker registers victim's email before victim | Locked-out identity | Low | Email confirmation required (attacker can't confirm victim's address); register is idempotent-uniform | Victim's first action is to confirm their own address |
| T7 | **Confirmation/reset link theft (bearer in transit)** | Link in email forwarded/logged/sniffed | Account confirmation or password takeover | Low | TLS; single-use tokens; 24 h/60 min TTL; reset revokes all sessions | Email transport is out of our control — TTLs bound it |
| T8 | **Open-redirect session exfiltration** | Crafted `redirect_to` puts a fresh session fragment on an attacker origin | Instant session theft | Low (if §6.4 enforced) | **Allowlist validation**; non-allowlisted value falls back to default origin | Allowlist misconfiguration would re-open this — config-reviewed |
| T9 | **Timing attacks on login** | Measure response time to distinguish unknown vs wrong-password | Enumeration | Low | Dummy-hash compare; bcrypt dominates timing | Statistical noise; monitored |
| T10 | **Database exfiltration** | DB dump/read via compromised backup/insider | Password/token material | Medium | bcrypt cost 12 hashes; SHA-256 token hashes; no plaintext at rest | Offline password cracking of weak passwords possible → mitigated by cost + minimum length |
| T11 | **Auth-endpoint DoS (bcrypt CPU burn)** | Flood login/register with garbage | Availability | Medium | Rate limit *before* bcrypt; per-IP caps; Redis store | Distributed floods partially bypass per-IP — scaled limits + alerting |
| T12 | **Log injection / PII leak** | Hostile email or token embedded in logs | PII breach / ops poisoning | Low | Sprint 1 redaction + curated serializers; no bodies/query logged; request-id sanitized | Addressed at the logger, tested |
| T13 | **X-Forwarded-For spoofing** | Forge `X-Forwarded-For` to bypass IP rate limits | Rate-limit evasion | Medium | Trust proxy configured to the LB only; email-keyed limits as the primary account control | Misconfigured proxy trust re-opens it — reviewed in Phase 14 |
| T14 | **Session fixation** | Attacker sets a known session id | Takeover | Low | Fresh family + fresh tokens on every login; never accept client session ids | Structurally closed |
| T15 | **Shared-NAT collateral** | Dorm/station wifi — many users behind one IP | False 429s / lockouts | Medium | Email-keyed (not IP-keyed) lockout; generous IP caps (§16) | Residual per-IP caps may still throttle shared networks under attack — monitored |
| T16 | **Insider DB tampering** | Admin edits rows | Forge/disable accounts | Low | Least-privilege DB roles; audit logging; hashes prevent password forgery | App role cannot read plaintext passwords; audit trail exists |

**Why a table, why these rows.** The threat model is the acceptance test for §1–§14:
every control in the design maps to a row above, and every row has a named residual. The
Phase 18 test matrix asserts the controls; the residual risks are the explicit
assumptions handed to the Phase 14 security re-review.

---

## 16. Rate limiting strategy

### 16.1 Where and what

Rate limiting applies to the **auth routes** (§12) — the expensive (bcrypt) and
abuse-prone surface. Business routes get per-user limits in their own phases.

| Route | Key 1 (throughput) | Key 2 (account-targeted) | Limit |
| --- | --- | --- | --- |
| `register` | IP | email | 5 / min |
| `login` | IP | email | 5 / min (matches roadmap Phase 3 §4) |
| `refresh` | IP | — | 15 / min (roadmap Phase 3 §4) |
| `confirm-email` / `verify-email` | IP | — | 10 / min |
| `resend-verification` | IP | email | 5 / min |
| `password-reset/request` | IP | email | 5 / min |
| `password-reset` | IP | — | 5 / min |

**Progressive lockout** (login only): after 10 consecutive failures for an email (from any
IP) within 15 min, that **email** is blocked for 15 min (the count is keyed on email —
T15). The IP is additionally throttled, but never the *sole* key for a lockout, so shared
NAT users aren't collateral (roadmap Phase 3 §4).

### 16.2 Storage

- Dev / single-instance: an **in-memory sliding-window store** (the `rate-limit` stub
  becomes a real limiter with an injectable store).
- Prod / multi-instance: the same interface backed by **Redis** (`REDIS_URL`, optional per
  D4). Limits become approximate across instances (sliding window via sorted sets or a
  fixed-window counter with jitter) — precise across-instance windows are not required;
  bounded over-limit is the accepted cost of horizontal scale.
- **On Redis failure: fail over to the in-memory store and log loudly.** Per-instance
  limiting continues; availability beats cross-instance precision, and the bcrypt path
  still has a ceiling on each instance.

### 16.3 Why this strategy

- **bcrypt is the CPU hot path.** Cost 12 makes each login a 100–300 ms CPU burn;
  unbounded `/auth/login` is a self-service DoS amplifier. Limiting *before* the hash
  work is what makes the ceiling real.
- **Two keys because the threats are two.** IP caps stop floods and scripted abuse; email
  caps stop account-targeted credential stuffing and spam-reset emails. Neither alone is
  sufficient (T11, T4).
- **Email-keyed lockout avoids shared-NAT collateral** (T15) — the single most likely
  production support ticket for an Indian-railways social app is "I can't log in, the
  whole dorm got locked." The design refuses to let that happen by construction.
- **429 envelope + `Retry-After`** keeps the response machine-parseable (Sprint 1
  envelope) and lets the adapter back off cleanly instead of hammering.
- **Trust-proxy note.** `req.ip` is only trusted when the proxy chain is configured
  (Express `trust proxy` = the LB). Without that, `X-Forwarded-For` is attacker-controlled
  and IP limits are meaningless (T13). This is a Phase 14 deployment check, recorded here
  so it is not discovered under attack.

---

## 17. Middleware sequence

### 17.1 The request pipeline (auth + protected)

```
1  helmet                     – security headers (HSTS, nosniff, …)
2  cors                       – allowlisted frontend origin(s)
3  request-id + pino-http     – x-request-id set/echoed; structured log (curated serializers)
4  express.json (size-capped) – body parsing for all routes
5  rate-limit (auth routes)   – per-IP + per-email windows, BEFORE any bcrypt work
6  /auth router               – register · login · refresh · logout · session ·
                                 confirm-email · verify-email · resend · password-reset
7  authenticate               – verify access JWT → req.user (protected routes only)
8  authorize (later phases)   – capability checks (spec §6 / Part I map)
9  business routers           – profiles · journeys · requests · conversations · messages · …
10 not-found                   – 404 envelope
11 error-handler               – single envelope producer (Sprint 1)
```

### 17.2 Why this order

- **1–2 first:** security headers and CORS are cheap, global, and should never be skipped
  by a route error path.
- **3 before 4:** every request (even a 413 for an oversized body) carries a
  correlatable request id.
- **4 before routes:** the JSON parser must run before any handler reads the body; its
  failures (malformed JSON → `INVALID_JSON`, oversized → `PAYLOAD_TOO_LARGE`) are handled
  by the same error handler (Sprint 1 taxonomy).
- **5 before 6 (and before bcrypt):** the rate limiter is the *first* thing the auth
  routes see, so abusive traffic is shed before any hashing work (T11).
- **6 (public) before 7 (protected):** auth endpoints are unauthenticated by design; the
  `authenticate` middleware is mounted on the protected routers, not globally.
- **7 before 9:** identity is established once and every downstream handler reads
  `req.user.id`. 8 slots between identity and policy so application authorization is an
  explicit, testable layer (roadmap Part I).
- **10–11 last:** the 404 handler and the error handler are terminal; nothing after them
  can produce a non-envelope response. Express 5 auto-forwards async rejections to the
  error handler (Sprint 1 decision #1), so `auth.service` throws `AppError` and never
  writes a response itself.

### 17.3 The socket handshake (Phase 12)

The Socket.IO `auth` payload is verified with the **same JWT function as `authenticate`**
at connect time; failed handshakes are rejected before room membership is evaluated
(§9.3). This keeps one token-verification code path for REST and realtime.

---

## 18. Testing strategy

Testing is adversarial by construction (this is auth), layered unit → integration →
adversarial → contract, on the Sprint 1 harness (Vitest + Supertest + disposable Postgres
via the `testdb` profile and `src/test/setup.ts`).

### 18.1 Unit

- Token generation: length, base64url charset, uniqueness/entropy (statistical).
- Hashing: bcrypt round-trip, cost honored, **72-byte reject** (73 bytes → error, and
  never a silent truncation), NUL/control rejection.
- JWT: sign/verify round-trip; **expired → `AUTH_TOKEN_EXPIRED`; wrong alg → rejected;
  missing/wrong `type` → rejected; `sub` not a UUID → rejected; `alg: none` → rejected**;
  clock-skew tolerance ±30 s.
- Normalization: lowercase, trim, Unicode variation handled identically in register/
  login/reset/resend.
- Refresh rotation: revoke+insert atomicity (a forced second rotate on the same token
  fails); family chaining; reuse detection revokes the family.
- Lockout state machine: failure counting, threshold, window expiry, email-keyed.
- Rate limiter: window semantics, per-key isolation, in-memory + Redis-backed store
  behavior, fail-over.

### 18.2 Integration (Supertest + test Postgres)

- **Full lifecycle:** register → (email captured from the console/dev transport) →
  confirm via `verify-email` link → login → access a protected route → refresh (rotation)
  → logout → refresh with the revoked token → 401.
- Unconfirmed user cannot login (`403 EMAIL_NOT_CONFIRMED`) or refresh.
- **Unknown-email vs wrong-password produce byte-identical bodies** (and, leniently
  asserted, comparable timing).
- Rate limit 429 with `Retry-After`; lockout after the threshold.
- `redirect_to` allowlist: allowlisted → redirect honored; non-allowlisted → default
  origin (never the hostile value).
- Confirm/reset token: expired → 400; already consumed → 400; double-click → no
  double-effect.
- Password reset: request (uniform 200), reset, **all families revoked**, old refresh
  dead, new password works, old password fails.
- Session shape: exact GoTrue keys (`access_token`, `refresh_token`, `expires_in`,
  `token_type`, `user.id`, `user.email`).

### 18.3 Adversarial / security

- **Replay:** refresh with a rotated-away token → family revoked → sibling tokens 401;
  assert a `warn` security event is logged.
- **Concurrent refresh race:** fire two refreshes with the same token; assert exactly one
  succeeds and the outcome is the documented behavior (winner succeeds; loser 401s or
  triggers family revocation per §5.4), never two valid siblings.
- **Log hygiene:** send a request carrying a token in an unredacted header and in a query
  string; assert the request log contains no token material (Sprint 1 redaction +
  no-query-logging).
- **Header smuggling:** duplicate `Authorization` headers → 401, not leniency.
- **JWT forgery attempts:** `alg: none`, RS256 header, wrong secret → 401.
- **Timing** (best-effort statistical): login response for unknown vs wrong-password not
  distinguishable beyond noise.
- **Identity continuity:** import a fixture (GoTrue `$2a$` hash, `email_confirmed_at`,
  UUID) → login with the original password → **same UUID** returned; unconfirmed state
  preserved.

### 18.4 Contract (Phase 13 gate, designed now)

- Session shape keys (§18.2) — the hard adapter assertion.
- `onAuthStateChange` event sequence **SIGNED_IN → SIGNED_OUT → TOKEN_REFRESHED →
  USER_UPDATED → PASSWORD_RECOVERY** (roadmap Phase 13; the adapter must emit in this
  order).
- localStorage key format `trainmate-auth-token` with `{ access_token, refresh_token,
  expires_at, user{id,email} }` (roadmap Phase 13 contract).
- Register returns confirmation-required; signUp/signIn expose `{ error }`-only to
  `useAuth.tsx`.

### 18.5 Sign-off gate

Per the project convention, the phase exits through **three adversarial QA auditors**
(scope, roadmap/compliance, robustness/security) before sign-off; auth additionally
re-runs the §18.3 matrix. Load (k6, Phase 14) covers bcrypt-under-load and rate-limit
saturation.

---

## 19. Migration from Supabase Auth

### 19.1 What carries over (identity continuity — D6, Critical Point #1)

| Data | Carried? | How | Verification |
| --- | --- | --- | --- |
| `auth.users.id` (UUID) | **Yes** | `users.id` imported verbatim | Spot-check exact UUID equality on a staging copy |
| `auth.users.email` | **Yes** | Imported; already lowercase (GoTrue normalizes) | Count check |
| `auth.users.encrypted_password` | **Yes** | Imported as `password_hash` — it is **bcrypt (`$2a$`)**, which Node bcrypt verifies | Sample a set of users and log them in with their existing password on staging |
| `auth.users.email_confirmed_at` | **Yes** | Imported; confirmed users stay confirmed (no re-confirm — D6) | Null/non-null distribution matches source |
| `created_at` / `updated_at` | **Yes** | Imported | — |
| **Sessions (refresh tokens)** | **No** | See §19.2 | — |

**Hash-compatibility fallback (documented, last resort):** if a sample hash fails
verification during the Phase 2 staging drill, the runbook falls back to a **forced
password reset** for affected users (roadmap Phase 3 §13 risk). This is expected to be
unnecessary — GoTrue writes standard `$2a$` bcrypt — but it is the honest contingency.

### 19.2 What does NOT carry: sessions

GoTrue refresh tokens are GoTrue-internal (JWTs bound to GoTrue's own secret and storage)
and are **not portable**. The design therefore does **one-time re-login at cutover**:

- After the flag flips, the client still holds a GoTrue session in localStorage. Its
  access token fails our verification immediately → the adapter's 401 → refresh flow
  fires; the carried refresh token also fails → the adapter clears the session and
  redirects to `/login` (mirroring `SIGNED_OUT`, no scary error). The user signs in once
  with the existing password (which works — §19.1). Thereafter, sessions persist in the
  `trainmate-auth-token` key normally.

**Why reject the alternative (import GoTrue refresh tokens).** It is technically possible
to hash-import GoTrue's refresh rows so the first refresh after cutover "just works." It
is rejected because: (a) it imports tokens we cannot verify into our token table, mixing
untrusted state into the rotation/family model; (b) GoTrue stores some tokens in a form
that forces a plaintext-read import step (weakened hygiene at the exact moment we want a
clean break); (c) the benefit is a single login, which the email-keyed lockout and short
access TTL make cheap and safe. The cost is bounded, user-visible once, and fully
documented — the honest engineering choice.

### 19.3 Unconfirmed users

Unconfirmed users import with `email_confirmed_at = null` and are **not** given a
fabricated confirmation. They remain unable to log in (parity — the same gate they had on
Supabase) and can trigger `resend-verification` to receive a fresh link from the new
backend. No re-confirmation mass email is sent.

### 19.4 New users and dual-run sequencing

Until the final cutover (Phase 14), **register is gated by the adapter flag**: the new
backend authenticates imported users and new logins, but new *registrations* stay on
Supabase (or are disabled) so the user table doesn't diverge from Supabase before the
flip. At cutover, the flag enables register on the new backend and new signups land in
`users`. This removes the "users created on the new backend during rollback" divergence
entirely (§20).

### 19.5 Verification checklist

1. Staging: import a full production-shaped dump; row counts + checksums match.
2. UUID spot-checks identical; a sample of users logs in with their old password.
3. Confirmed/unconfirmed distribution matches source.
4. A staged flag-on smoke: existing session → re-login once → persisted; new signup →
   confirm → login works end to end.
5. The 12 canonical flows (roadmap Phase 13) pass against imported data.

---

## 20. Rollback strategy

### 20.1 The mechanism

Auth is behind the Phase 13 adapter flag (roadmap D5 / Phase 13 §14). Rollback = **flip
the flag off** → the frontend reverts to Supabase. This is the primary rollback and it is
one line. It holds until the final cutover; the pre-cutover state has **zero production
traffic** on the new backend.

### 20.2 What is disposable vs. what is durable

| Artifact | Rollback behavior |
| --- | --- |
| `users` | Imported data is idempotently re-importable (Phase 2 tooling truncate+reload). **New** registrations are gated to the cutover (§19.4), so the table never diverges before the flip — no orphaned new users to reconcile |
| `refresh_tokens` / `email_verifications` | Wholly disposable. On rollback, revoke/truncate; users re-login / re-confirm via the restored path |
| `JWT_SECRET` | Rotate it as a **global kill-switch**: flipping the secret invalidates every access token instantly (the one lever that beats the 15-minute expiry, §8.3) |
| Supabase auth | Untouched until Phase 14 decommission; snapshot retained through the retention window |

### 20.3 Post-cutover rollback

If rollback is needed *after* the flip (writes live on the new DB):
1. Flip the flag off → Supabase serves REST + realtime + storage immediately.
2. Reconcile the bounded divergence window (users created / sessions rotated on the new
   backend) per the Phase 14 runbook — the window is deliberately small because register
   was the last thing to flip.
3. Revoke all new-backend refresh families; rotate `JWT_SECRET`; re-import the last
   pre-cutover snapshot if needed (rehearsed twice in staging per roadmap Phase 14).
4. The 12-flow smoke + authz probe monitor the rollback; an auth error-rate spike is the
   tripwire.

### 20.4 Why this is safe

Every failure mode has a named, rehearsed path: flag-off (behavioral), idempotent import
(data), secret rotation (session invalidation), snapshot restore (last resort). The
design's load-bearing choices — gated register, disposable session tables, hashed
credentials — exist precisely so that rollback never has to "unmake" a credential or a
user. The one deliberate user-visible cost of any rollback is a re-login, which is
acceptable and bounded.

---

## 21. Future enhancements — session management

Out of scope for Sprint 2B by design: the spec defines no session-management surface
(§12), and the frontend is frozen until Phase 13. Recorded here as the agreed backlog so
the schema (§10) and the session model leave room for it — every item below is additive
and requires no change to decisions D-A1–D-A15.

### 21.1 Active devices

A per-user list of live sessions — one row per refresh-token **family** (a login chain is
a device session). A user sees every logged-in device (browser, mobile app, …) with a
friendly name and last-active time. Requires a `user_agent`/`device` column on
`refresh_tokens` (§10.2) captured at login/rotation, plus a read endpoint.

### 21.2 Login history

An append-only audit of sign-ins: timestamp, IP, device, and outcome (success / lockout /
reset). Supports "was this me?" security review and suspicious-activity triage. Requires a
`login_events` table (or an extension of an existing audit store) written by `auth.service`
at each login attempt.

### 21.3 Revoke individual sessions

Per-device logout — revoke **one** family instead of every family (§8.2). The data model
already supports this (revocation is per-row/family, §5); what is missing is a stable
client-visible session identifier and an endpoint (`DELETE /auth/sessions/:id`). Logout
stays scope-global until this lands.

### 21.4 Why deferred

- **Not a parity requirement.** GoTrue's `signOut()` defaults to scope `global`; "this
  device only" is a GoTrue opt-in the frozen frontend does not use (§8.2).
- **Needs frontend changes.** Each of these surfaces requires UI — impossible before the
  Phase 13 adapter un-freezes `src/`.
- **Schema is additive.** The column/table additions above do not disturb the §10 model,
  so nothing here blocks implementation later.
- **Not security-critical.** Token theft is already handled by rotation + reuse detection
  (§5.2); session management is UX and hygiene, not a control gap.

---

## Decision log (locked in this design)

| # | Decision | Rejects / notes |
| --- | --- | --- |
| D-A1 | Stateless HS256 access (15 min) + opaque rotating refresh (30 d, hashed) | Signed-refresh (spec offered it) — rejected: needs a blacklist + key, carries PII |
| D-A2 | Refresh rotation + reuse detection → family revocation | Per-token-only revocation — rejected: leaves siblings live |
| D-A3 | bcrypt cost 12, carry over `$2a$` hashes | argon2id now — rejected: breaks hash continuity |
| D-A4 | Email confirmation on; confirmation-required register | Auto-confirm or session-on-register — rejected: parity + abuse prevention |
| D-A5 | Confirmation link ends in hash-fragment redirect (frozen-frontend login) | Backend-only session cookie — rejected: impossible without frontend change |
| D-A6 | `redirect_to` allowlisted; default-origin fallback | Open redirect — rejected: session exfiltration (T8) |
| D-A7 | Enumeration-uniform responses; email-keyed lockout | Distinguishable errors — rejected: enumeration (T5) |
| D-A8 | Rate limit per-IP + per-email, Redis with in-memory fallback | IP-only — rejected: shared-NAT collateral (T15) |
| D-A9 | Logout revokes all families; access lives to expiry | JWT blacklist now — rejected: statelessness + short window |
| D-A10 | Migration carries UUIDs + hashes + confirmation; **no session carryover** (one re-login) | Import GoTrue refresh tokens — rejected: untrusted state, weak hygiene |
| D-A11 | `REFRESH_SECRET` dropped | Roadmap's env matrix listed it — deliberate deviation (opaque refresh) |
| D-A12 | No auth management/admin endpoints in this phase | Scope discipline (roadmap §4) |
| D-A13 | Access-token TTL **locked at 15 min** | Former open question #1 (raise to 30 min for flaky mobile) — resolved: fixed, not a tunable knob |
| D-A14 | Password-reset token TTL **locked at 60 min** | Was stated in §7.2; now fixed — no shorter/longer variant |
| D-A15 | Email-verification token TTL **locked at 24 h** | Was stated in §6.1; now fixed — no shorter/longer variant |

## Open questions for approval

1. **Password reset UI timing:** the backend reset capability (§7) is designed now; the
   roadmap defers the UI to post-migration. Approve shipping the request endpoint now
   (safe) and the reset endpoint with the Phase 13 adapter.
2. **One-time re-login at cutover:** confirmed acceptable? (It is the price of not
   importing GoTrue sessions — §19.2.)

## Assumptions

1. The frontend is frozen until Phase 13; the design therefore only touches `src/`
   indirectly through the Phase 13 adapter (and the supabase-js `detectSessionInUrl`
   default remains enabled, which the hash-redirect relies on).
2. Production carries standard GoTrue `$2a$` bcrypt hashes; a staging sample is verified
   in Phase 2 before cutover (contingency: forced reset, §19.1).
3. Supabase remains live and authoritative for auth until Phase 14; register is gated so
   `users` cannot diverge pre-cutover (§19.4).
4. Email delivery is available behind the `utils/emails.ts` abstraction (console in dev,
   transactional provider in prod), matching the roadmap Phase 3 deliverables.
5. Redis availability in prod for the distributed rate limiter (D4); the in-memory
   fallback keeps single-instance dev and degraded prod functional.
6. The Sprint 1 conventions — locked error envelope, `x-request-id`, pino redaction,
   Zod env validation, Vitest/Supertest harness, `testdb` disposable Postgres — are the
   unchanged substrate this module builds on.

---

*End of Auth-Design.md — design only. No backend code, Prisma schema, Express routes, or
frontend changes were produced. Awaiting approval before Sprint 2B (implementation).*
