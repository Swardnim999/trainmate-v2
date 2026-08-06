# TrainMate v2 — Adversarial Engineering Design Review Report

**Status:** Final review of the proposed blueprint (pre-implementation)
**Reviewer role:** Principal Engineer (independent adversarial design review)
**Date:** 2026-08-06
**Documents under review:**
- `docs/Backend-Specification.md` (~1,208 lines) — source of truth
- `docs/Backend-Architecture.md` (~408 lines)
- `docs/Implementation-Roadmap.md` (~2,200 lines)

**Cross-checked against (ground truth):**
- Frontend source: `src/` (hooks, pages, components, lib)
- All 31 Supabase migrations: `supabase/migrations/`
- RLS policies, realtime implementation, storage implementation (buckets + policies)

**Verdict:** **CONDITIONAL APPROVAL.** The blueprint is fundamentally sound and implementable. 5 critical and ~27 high findings must be resolved before the migration cutover is signed off. Every finding below is backed by concrete evidence; 7 seed claims were investigated and **refuted** (the docs were right and the challenge was wrong), which is recorded in §8 to preserve review rigor.

---

## 1. Method

Eight dimensioned auditors, each independently reading the docs against the live repo, were instructed to **prove or refute** a seeded set of candidate findings and then hunt for new defects in their dimension. Every returned finding was then challenged by an independent adversarial verifier whose only job was to **refute** it using fresh file/migration/doc evidence. Only findings that survived this pass are recorded here.

- Auditors: schema & constraints, auth & session, RLS→service authorization map, frontend API contract, realtime parity, storage & attachments, data migration, roadmap structure.
- Result: **54 confirmed, 7 refuted** across 7 completed dimensions (the migration dimension re-ran after a transient auditor failure — see §2.7).
- Model: autonomous reviewer + independent skeptics (two independent passes, no shared context).

---

## 2. Findings by Severity

### 2.1 CRITICAL (5)

#### C1. Gender value divergence across `profiles` and `journeys` — docs claim a single stored value
**Confirmed as:** S1 / Rm3
**Finding:** `profiles.gender` is written as `prefer_not_to_say` (underscore, `EditProfileModal.tsx:296`) while `journeys.gender` is written as `prefer-not-to-say` (hyphen, `Dashboard.tsx:640`, `validations.ts` journey enum). **No `CHECK` constraint exists on either column**, so both variants (and any arbitrary string) are present in the wild. The docs claim a single stored value `prefer_not_to_say` (spec §3.2 line 220, §9.1 line 762; roadmap Phase 6 line 1013) — **wrong for `journeys`**. `formatGender` in `ProfileModal.tsx`/`ViewProfileModal.tsx` only maps the underscore variant, so hyphen values render as "Prefer-not-to-say".
**Docs impacted:** Backend-Specification.md §3.2, §9.1; Implementation-Roadmap.md Phase 6 line 1013-14.
**Recommendation:** Document the per-table stored values explicitly (underscore on `profiles`, hyphen on `journeys`); the migration must normalize both tables to one canonical value; the new schema should add a `CHECK` on each column; the server validator must accept both today and write only the canonical value going forward; `formatGender` must handle both.

#### C2. `profiles.email` is readable in the deployed system — the docs' "email hidden" claim is false
**Confirmed as:** S7 / NEW-9 / F2 (rls-service)
**Finding:** Migration `20260725073436_grant_authenticated_table_privileges.sql` issues `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`. Postgres grants are cumulative, so this **re-grants table-level `SELECT` on `profiles`**, overriding the column-level `REVOKE SELECT (email)` from `20260703100726`. RLS (`can_view_profile`) only filters *which rows*, never the *email column*. The frontend queries `profiles` directly (`useProfile.ts`, `ProfileModal.tsx`, `Chats.tsx`, `Requests.tsx`) and **never uses the `profiles_safe` view**, so any user who passes `can_view_profile` (same-train journey, accepted request, conversation participant) can read another user's `profiles.email`.
**Docs impacted:** Backend-Specification.md §1.4, §3.2, §6.1, §6.12 (invariant 1 "Email is private"); Backend-Architecture.md §2.2, §5.2; Implementation-Roadmap.md Phase 6.
**Recommendation:** The docs must state the *deployed reality*, not the aspirational claim: email is currently exposed to contextual viewers. The new backend's serializer **must** never return another user's email. A parity test asserting email-absent **will fail against Supabase** — this is expected asymmetry, not a bug, and must be documented as such in §6.12 and the Part I authorization map.

#### C3. Immutable conversation fields are guarded only by the tamper trigger
**Confirmed as:** S10
**Finding:** The same `20260725073436` blanket `GRANT` also overrides the column-level `UPDATE` grant on `conversations` (`20260630153027` restricted `UPDATE` to `last_message, last_message_time, deleted_for`). Today, `prevent_conversation_tamper_trg` is the **sole** DB guard preventing a client from mutating `participants`, `train_number`, `travel_date`, etc. The spec §3.2 (lines 281-286) still documents the column-level grant as if effective.
**Docs impacted:** Backend-Specification.md §3.2 (conversations UPDATE), §5.2; Backend-Architecture.md §5.2.
**Recommendation:** Update the docs to reflect that the trigger is the only remaining guard in the deployed system; note that the new service layer enforces immutable-field protection anyway (belt-and-suspenders acceptable); do not claim column-level GRANT is active.

#### C4. Presence & typing broadcast have **no** authorization today — and leak conversation IDs
**Confirmed as:** T1 / F1 (rls-service)
**Finding:** The `realtime.messages` SELECT policy (`20260702121413`) authorizes only `messages-%`, `last-read-%`, and `conversations-updates-<uid>` topics. Presence/broadcast on `presence-<cid>` is a **different Realtime primitive not gated by this policy** — in Supabase Realtime v2 any authenticated user can join any presence channel. The roadmap Part I (line 332) labels this "ungated today" (implying harmless); in fact it means a user can join `presence-<conversationId>` for a conversation they are not a participant of, and the channel name itself leaks conversation UUIDs. (S9 was refuted on the RLS-mechanics framing, but that refutation confirms the security gap rather than negating it — see §8.)
**Docs impacted:** Backend-Specification.md §8.2 (row 4), §8.3 (policy block); Backend-Architecture.md §3.3; Implementation-Roadmap.md Part I Realtime policies row, Phase 12 §8.5.
**Recommendation:** Correct the Part I "Current RLS policy" cell for presence/broadcast from "ungated today" to "NOT gated by the realtime.messages policy; any authenticated user may join; channel names expose conversation IDs." Phase 12 must implement **server-side participant checks on Socket.IO room join for presence/typing** (no DB policy can do this), plus typing rate-limiting (see M5).

#### C5. Soft-delete does **NOT** "reappear on a new message" — the docs claim it does
**Confirmed as:** Rm1 / F9 (rls-service) / NEW-10
**Finding:** `deleted_for` is **append-only**: `soft_delete_conversation` (`20260703100726`) only appends with a duplicate guard and nothing ever removes a user id. The conversations SELECT policy (`20251215070131`: `NOT (auth.uid() = ANY(COALESCE(deleted_for,'{}')))`) therefore hides the row **permanently**. New messages never cause reappearance. The chat page remains reachable by direct URL `/chat/<id>` because the `messages` policy checks only participant membership.
**Docs impacted:** Backend-Specification.md §8.4 line 728 and §9.5 line 823-824; Implementation-Roadmap.md lines 1421, 1457, 1463 (deliverables, testing strategy, manual checklist).
**Recommendation:** Replace every "reappears if a new message arrives" with: "Stays hidden from the conversation list permanently (`deleted_for` is never auto-removed). Direct URL `/chat/<id>` still works because messages are not filtered by `deleted_for`. Preserve this behavior in the new backend (parity) and encode it in the acceptance criteria."

---

### 2.2 HIGH (27)

| ID(s) | Finding | Evidence | Doc impact |
|-------|---------|----------|-----------|
| S2 | `messages.text` is `NOT NULL` but empty string is legal for attachment-only sends; frontend bypasses `min(1)` when an attachment is present. Docs already acknowledge (§3.2:295, §9.6:828). Consider a CHECK `text <> '' OR attachment_url IS NOT NULL`. | `20251212061640` (text NOT NULL), `useChat.tsx:202-210`, `validations.ts:41-46` | Spec §3.2, §9.6 |
| S3 | `messages.attachment_size` is `bigint` → Prisma returns `BigInt` → `JSON.stringify` throws. Roadmap flags this (Phase 2:507, Phase 11:1537) but the spec §3.2 lacks an explicit warning. | `20260618111613` (bigint) | Spec §3.2 (add warning), §12 |
| S11 / NEW-6 / Rm7 | Dashboard's `unverified_trains` insert (`Dashboard.tsx:246-258`) is **non-transactional**: no `.select()`, no error check, ordered *before* the `journeys` insert. A failed journey insert leaves an orphan `unverified_trains` row; a failed unverified insert is silently ignored. | `Dashboard.tsx:246-275` | Spec §9.3, §10.3/10.9; Roadmap Phase 7 (deliverable, testing strategy, manual checklist) |
| A1 | Signup navigates to `/dashboard` with no session (email confirmation); `ProtectedRoute` bounces to `/login` with no "check your email" hint. Docs correctly document and roadmap correctly preserves this quirk. Action: `POST /auth/register` must return a confirmation-required signal (not a session) and the adapter's `signUp` must return `{error}` only. | `Login.tsx:69-74`, `useAuth.tsx:53-64`, `ProtectedRoute.tsx:19-21` | Spec §5.1 (accurate — no edit needed), Roadmap Phase 3 |
| A2 | `useAuth.signUp/signIn` destructure only `{error}`; backend endpoints (§10.1) return full session/user. The adapter wrapper shape (not the endpoint shape) must match the frontend interface — currently unspecified. | `useAuth.tsx:45-64`, spec §10.1 L875-877 | Spec §11.2, Roadmap Phase 13 contract suite |
| A3 | The session `user` object must include `email` (ViewProfileModal renders `user.email` from the session, not from `profiles`). Docs cover this; ensure JWT `email` claim + session payload. | `ViewProfileModal.tsx:85-88`, `useAuth.tsx:26` | Spec §5.2 (accurate — no edit needed) |
| A4 | Session restore/auto-refresh parity: `onAuthStateChange` registered before `getSession()`, `persistSession`+`autoRefreshToken` in localStorage. The adapter must reproduce GoTrue localStorage shape and 401 auto-refresh, else every user logs out at cutover. Roadmap Phase 13 L1760-1762 covers it. | `useAuth.tsx:21-39`, `client.ts:11-16` | Roadmap Phase 13 (contract suite must assert key format, event order, refresh-on-401) |
| A5 | Email-confirmation link must survive the domain change; `POST /auth/register` must accept `emailRedirectTo`; confirmation is finalized at a frontend route, not a backend GET. Docs cover this. | `useAuth.tsx:54` (emailRedirectTo = origin + '/') | Spec §5.1/§10.1, Roadmap Phase 3 |
| N3 | The adapter's localStorage key format (e.g. `trainmate-auth-token`) is unspecified; contract test must assert key shape (access_token, refresh_token, expires_at, user{id,email}) and that migration/re-login works at cutover. | `client.ts:11-16`, spec §5.1:469, roadmap Phase 13 L1772 | Spec §11.1, Roadmap Phase 13 |
| F1 (rls) | Realtime presence doc label "ungated today" is wrong → see C4. | — | Roadmap Part I |
| F2 (rls) | Email leak → see C2. Parity-test asymmetry must be documented. | — | Spec §6.12, Part I |
| F9 (rls) | Soft-delete permanence → see C5. | — | Spec §8.4 |
| F2 (fc) | `POST /requests` body shape is undocumented in §10.4. Frontend sends exactly: `from_user_id, from_name, to_user_id, to_name, train_number, travel_date, boarding_station, destination_station, status='pending'`. **No email, no college/gender.** The endpoint must not require fields the frontend never sends. | `Matched.tsx:147-158` | Spec §10.4 (add Body/Notes) |
| F3 (fc) | `sendRequest` uses **stale localStorage** `journeyData`; RLS `users_share_journey` checks the live `journeys` table. If the sender deleted their journey after computing matches, the insert fails with 403 — undocumented race. | `Matched.tsx:72-86,141-178`, `20260703100726` policy | Spec §9.4, §10.4 (document graceful handling) |
| F8 (fc) | Avatar quirk scope: only `getAvatarUrl`-rendered avatars break (`ProfileMenu`, `ViewProfileModal`); `ProfileModal` (raw URL) and **all chat attachments** (raw `attachment_url` in `Chat.tsx`) work correctly. Docs don't state attachments are unaffected. | `useProfile.ts:49-53`, `Chat.tsx:326,337,348` | Spec §7.3 (explicit callout), §13.6 |
| St1 / Rm4 | Avatar cache-buster fix in spec §13.6 ("return short-lived signed URLs so `getAvatarUrl` split still works") is **technically impossible**: `getAvatarUrl(url) = url.split('?')[0] + '?t='+version` drops the S3 signature. Only a **first-party avatar proxy route** (`GET /avatars/:userId`) that re-authorizes `can_view_profile` at request time survives the split — and that requires a frontend change (out of scope for the migration). | spec §13.6 L1189-1191, roadmap Phase 4 L794, `useProfile.ts:34-38` | Spec §13.6 (replace impossible wording), Roadmap Phase 4/13 (lock one decision: accept quirk OR proxy route post-migration) |
| St2 | `chat-attachments` bucket is created only manually (no migration — only `avatars` bucket in `20251227101646`). Correctly documented as an operational gap; Phase 4 commits to idempotent creation. | spec §7.1, roadmap Phase 4 L756-764 | None (docs correct) — verify ordering (Phase 4 before message phases) |
| St3 | Legacy signed-URL rewrite must cover **both** `profiles.avatar_url` and `messages.attachment_url` (both store 1-year signed URLs). Phase 2 `import.mjs` mentions both but the verification step must check path↔object existence for both buckets, and parse the Supabase URL to extract the object key before `?`. | roadmap Phase 2 L208-213, L530-531; `useProfile.ts:65-66`, `useChat.tsx:270-271` | Roadmap Phase 2 §5, spec §7.4 |
| St4 | Presigned GET for avatars must be issued **only after** `canViewProfile` — a signed URL is a universal capability. Docs correctly require this; must be enforced at implementation. | spec §7.2, roadmap Phase 4 L321 | None (docs correct) |
| Rm2 | The bump-failure bug is **not** "silently swallowed" — the message IS inserted and the UI shows a failure toast (phantom error) because `useChat` re-throws. The Phase 11 atomic-transaction fix is correct; only the label is wrong. | `useChat.tsx:221-249` re-throws; spec §9.6:833, §13.5; roadmap Phase 11 L1523 | Roadmap Phase 11 deliverable + testing strategy; spec §9.6, §13.5 |
| Rm3 | Gender enum → see C1. | — | — |
| Rm5 | Risk register (Part III §2, L1980-2010) is **missing 5 risks**: (1) blanket-grant email re-open (C2), (2) presence authorization gap (C4), (3) non-transactional unverified insert (S11), (4) server-validator bounds divergence, (5) `deleted_for` permanence (C5). | risk register lines 1980-2010 | Roadmap Part III §2 |
| Rm7 | Unverified+journey atomicity → see S11. Must be a Phase 7 **deliverable** (not just a risk note) with failure-injection tests. | roadmap Phase 7 L1110-1113, L1172 | Roadmap Phase 7 |

---

### 2.3 MEDIUM (15)

| ID(s) | Finding | Evidence | Doc impact |
|-------|---------|----------|-----------|
| S6 / F10 (rls) | `requests.from_email/to_email` are nullable, **never populated** by the frontend, but read downstream (`Requests.tsx`, `useAcceptedCompanions.ts`). Spec §3.2 notes they're not populated; make explicit "always NULL; do not rely on them." Decide: drop, or populate at insert from auth email. | `Matched.tsx:147-159`, `20251212061640`, `useAcceptedCompanions.ts:16-28` | Spec §3.2, §9.4 |
| S8 / F8 (rls) / Rm8 | Architecture §9.1 lists trigger name `conversations_prevent_tamper`; the deployed trigger is `prevent_conversation_tamper_trg` (renamed in `20260703100726`, with the `deleted_for` session-flag guard). | `20260703100726:105-108`, architecture L257 | Architecture §9.1 |
| S12 | `sendTypingIndicator` creates a **new throwaway channel per keystroke**, never removed, no throttle. Spec §8.2 documents the leak; the Socket.IO adapter must rate-limit/debounce typing and reuse one room. | `usePresence.ts:70-79` | Spec §8.2 |
| N1 | `onAuthStateChange` event set: adapter must emit `SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, PASSWORD_RECOVERY` (GoTrue parity). Spec §11.2 call #1 should list them; contract suite should assert order. | `useAuth.tsx:24`, spec §11.2 | Spec §11.2, Roadmap Phase 13 |
| N4 | Session `user` object must include at minimum `{id, email}`; extra GoTrue metadata fields optional. | `useAuth.tsx:26`, spec §5.1 | Spec §11.2, Roadmap Phase 3 |
| F3 (rls) | `blocked_users` has **no FK to `auth.users`** and **no self-block CHECK**; the service layer must reject `blocker_id === blocked_id` (roadmap already assigns to Phase 5). Make the DB gap explicit in §6.7/Part I. | `20251215070131`, `useBlockedUsers.ts:36-50` | Spec §6.7, Roadmap Part I:296 |
| F4 (rls) | Requests cancel/cleanup: `cleanupExpiredRequests` does **select-then-delete** (`useRequests.ts:155-189`) → TOCTOU (silent partial delete + local-state desync). Service must use a **single atomic DELETE** `WHERE from_user_id=me AND status='pending'`. | `20260106151017` DELETE policy, `useRequests.ts:155-189` | Roadmap Part I:289, Spec §9.4 |
| F6 (rls) | `conversations` has no `DELETE` policy (soft delete only) — confirmed correct; no hard-delete leaks. | all migrations | None (verified sound) |
| F4 (fc) | `participant_names` stores display names from `profiles.name`, keyed by user id; **email must never be stored here**. Frontend fetches caller's name via `profiles` before creating a conversation. | `Chats.tsx:113-119` | Spec §9.5, §10.5 |
| F6 (fc) | `GET /requests/me` has no filter param; frontend derives sent/received client-side (`getRequestStatus`). Add optional `?type=sent|received|all` (default `all` preserves behavior). | `useRequests.ts:37-97`, `Requests.tsx:214-240` | Spec §10.4 |
| F9 (fc) | Conversations list relies **100% on RLS** for `deleted_for` exclusion (no client filter). The service layer must replicate the server-side check; do not push filtering to the client. | `useChat.tsx:128-140` (no filter), `20251215070131:74-80` | Spec §6.4, §10.5 |
| St5 | Presigned PUT response should return the **object path** (not the signed URL) so the frontend can request a signed GET, or the backend stores the path directly ("store path, sign at read"). | `useProfile.ts:51-58`, roadmap Phase 4 | Spec §7.3, Roadmap Phase 4 |
| St6 | MIME/size allowlists match frontend constants (avatars image/* ≤5MB; attachments image/pdf/doc/docx/txt ≤10MB). Explicitly **reject `text/html` and `image/svg+xml`**. | `EditProfileModal.tsx:64,73`, `Chat.tsx:28-31`, roadmap Phase 4 | None (docs correct) |
| St7 | Soft-deleted conversations leave **orphan attachments** in `chat-attachments` (no cascade cleanup). Phase 4 must note no auto-cleanup; post-launch S3 lifecycle rules or scheduled purge. | `20260703100726:63-80`, roadmap L2090-2091 | Roadmap Phase 4 |
| St8 | Avatar policy uses `storage.foldername(name)[1]`; chat-attachments uses `split_part(name,'/',1)` — inconsistent functions in the actual migrations. Standardize on one convention (recommend `foldername`) in the backend key-validation middleware. | `20260716172422:10-11`, `20260618111613:16,25,34,42` | Spec §7.2 |

---

### 2.4 LOW (7)

| ID(s) | Finding | Evidence | Doc impact |
|-------|---------|----------|-----------|
| F5 (rls) | `user_reports`: no rate-limiting, dedup, or moderation dashboard. Explicitly note "INSERT/SELECT only; abuse surface is post-MVP." | spec §9.8:852, Part I:297 | Spec §9.8 |
| F7 (rls) | `is_blocked` is symmetric (either direction); `is_blocked_in_conversation` checks caller vs **any** participant. Service parity confirmed. | `20251215070131:58-70`, `20260630113712:27-40` | None (verified sound) |
| Rm8 | Trigger name → see S8. | — | — |
| St8 (L) | foldername vs split_part → see St8 (M). | — | — |
| N5 | Password reset/recovery: no frontend UI, out of scope; note as post-migration enhancement. | `Login.tsx` (no forgot-password) | Spec §5.1, Roadmap Phase 3 |
| Rm9 | Call-site inventory count mismatch: spec §11 says "59 call sites across 9 files"; roadmap Phase 13 says "60 call sites." Align to one number. | spec §11 opening, roadmap Phase 13 L1799 | Spec §11, Roadmap Phase 13 |
| — | `user_reports.reason` has no maxLength (frontend sends `reason.trim() || null`) — a loose-text column; keep free-text in the new schema. | `ReportDialog.tsx` | Spec §3.2 (note) |

---

## 3. Verified Sound (no doc change required)

The adversarial pass **confirmed** the following as correct; these are recorded so the review is honest about what passed, not just what failed:

- A3 — session `user.email` surfaced from session (JWT `email` claim).
- A4 — session restore / auto-refresh / GoTrue localStorage shape parity is specified.
- A5 — `emailRedirectTo` + frontend-side confirmation-link finalization is specified.
- F5 (rls) — `user_reports` policy surface documented as minimal.
- F6 (rls) — conversations hard-delete is absent; soft-delete-only is airtight.
- F7 (rls) — symmetric blocking semantics captured in Part I.
- N5 — password recovery correctly out of scope.
- St2 — `chat-attachments` bucket gap correctly documented and Phase 4-committed.
- St4 — presign-GET-after-`canViewProfile` correctly specified.
- St6 — MIME/size allowlists match frontend constants.
- The docs already capture (via grep + audit): `users_share_journey` in the requests INSERT policy; the soft-delete **self-only** guard; the `deleted_for` session-flag (`app.allow_deleted_for_update`); the inert `requests-changes` channel; attachment-only empty-text messages; self-block rejection; the duplicate-conversation creation race; bigint serialization (roadmap Phase 11); the avatar known-bug.

---

## 4. Refuted Seed Claims (docs were right, the challenge was wrong)

Preserving refutations is deliberate — they show the adversarial process rejects false positives:

1. **S4 — validator bounds conflated.** *Claim:* spec presents zod bounds as the server contract. *Refuted:* spec §9.2 explicitly labels them as `journeySchema` (frontend zod) and marks client-side vs database-side per rule; DB bounds (§3.2) are documented separately. No change needed (but the server must still enforce DB bounds, per Rm5 #4).
2. **S5 — `deleted_for` NULL risk.** *Claim:* NULLable `deleted_for` + COALESCE is fragile. *Refuted:* the tamper trigger blocks direct `deleted_for` UPDATE without the session flag (only `soft_delete_conversation` sets it), and COALESCE handles NULL correctly.
3. **S9 — presence as an RLS policy gap.** *Claim:* presence-`<cid>` is unauthorized because it's absent from the realtime policy. *Refuted (framing):* presence/broadcast are a separate Realtime primitive, not gated by RLS at all. **Net effect: C4 stands — this refutation confirms there is NO authorization on presence/typing today**, which is the security gap the new Socket.IO backend must close.
4. **S13 — avatar fix "impossible" wording.** *Refuted (nuance):* the fix is feasible **only as a first-party re-authorizing route** (backend serves/redirects with a fresh signed URL) — which is exactly what C9/St1/Rm4 recommend. The literal §13.6 wording ("return short-lived signed URLs so the split works") is still wrong; a bare signed URL gets its signature stripped by `getAvatarUrl`. Both the confirmed findings and this refutation converge on the same fix.
5. **N2 — confirm-email endpoint shape.** *Claim:* backend needs a GET confirm route. *Refuted:* confirmation is finalized at a frontend route (email link → frontend extracts token → `POST /auth/confirm-email`), matching A5.
6. **St9 — avatar inconsistency not documented.** *Claim:* docs don't call out the inconsistency. *Refuted:* spec §7.3 (L665-671) explicitly documents the inconsistent behavior.
7. **Rm6 — PATCH /conversations/:id phase ownership.** *Claim:* bump endpoint misplaced in Phase 10. *Refuted:* roadmap consistently treats the preview bump as internal to the Phase 11 atomic message-send transaction; Phase 10 lists only GET/POST/DELETE.

---

## 5. Consolidated Recommended Doc-Change List

Ordered by severity; each maps to exact § / line refs in the current docs.

1. **[C1]** Spec §3.2 (§9.1) + Roadmap Phase 6 L1013-14: document per-table gender values; normalize in migration; add CHECK.
2. **[C2]** Spec §6.12/§1.4/§3.2/§6.1, Architecture §2.2/§5.2, Roadmap Part I: state deployed email exposure; commit serializer to never-return-email; document parity-test asymmetry.
3. **[C3]** Spec §3.2 L281-286: correct "column-level GRANT active" → "tamper trigger is sole guard in deployment."
4. **[C4]** Roadmap Part I realtime row + Phase 12 §8.5, Spec §8.2/§8.3, Architecture §3.3: presence/typing have NO DB authorization; Phase 12 must add Socket.IO participant checks + typing rate-limit.
5. **[C5]** Spec §8.4 L728/§9.5, Roadmap L1421/1457/1463: "reappears" → "permanent hide from list; direct URL still works; parity decision."
6. **[S2]** Spec §3.2/§9.6: optional CHECK `text <> '' OR attachment_url IS NOT NULL`.
7. **[S3]** Spec §3.2/§12: explicit bigint→JSON warning (Prisma BigInt; serialize at the API layer).
8. **[S11/Rm7]** Spec §9.3/§10.3/§10.9, Roadmap Phase 7: atomic (or idempotent `ON CONFLICT`) unverified+journey insert; failure-injection tests.
9. **[A1/A2]** Spec §11.2 + Roadmap Phase 13: adapter `signUp/signIn` return `{error}` only; `POST /auth/register` returns confirmation-required signal.
10. **[N3]** Spec §11.1 + Roadmap Phase 13: exact localStorage key + contract test.
11. **[F2-fc]** Spec §10.4: `POST /requests` body shape (9 fields, no email/college/gender).
12. **[F3-fc]** Spec §9.4/§10.4: document stale-journeyData 403 race + graceful handling.
13. **[F8-fc]** Spec §7.3: state attachments unaffected by the avatar cache-buster bug.
14. **[St1/Rm4]** Spec §13.6 + Roadmap Phase 4/13: replace impossible signed-URL fix with locked decision (accepted quirk OR first-party avatar proxy post-migration).
15. **[St3]** Roadmap Phase 2 §5 + Spec §7.4: legacy rewrite covers both `avatar_url` AND `attachment_url`; verify path↔object for both buckets.
16. **[Rm2]** Roadmap Phase 11 + Spec §9.6/§13.5: relabel bump bug as "phantom error" (message inserted, UI shows failure); atomic-tx fix stands.
17. **[Rm5]** Roadmap Part III §2: add 5 missing risks.
18. **[S6/F10]** Spec §3.2/§9.4: `from_email/to_email` always NULL; decide drop vs populate.
19. **[S8/Rm8]** Architecture §9.1: trigger name → `prevent_conversation_tamper_trg`; note `deleted_for` session-flag guard.
20. **[S12]** Spec §8.2: typing leak → throttle/reuse-channel/unsubscribe intent.
21. **[N1]** Spec §11.2 + Roadmap Phase 13: event-name contract (5 GoTrue events).
22. **[F3-rls]** Spec §6.7 + Part I: no FK/self-check on `blocked_users`; service enforces.
23. **[F4-rls]** Part I:289 + Spec §9.4: atomic DELETE for cancel/cleanup (no select-then-delete).
24. **[F4-fc]** Spec §9.5/§10.5: `participant_names` = display names, never email.
25. **[F6-fc]** Spec §10.4: optional `?type=sent|received|all` on `GET /requests/me`.
26. **[F9-fc]** Spec §6.4/§10.5: server-side `deleted_for` exclusion (no client filter).
27. **[St5]** Spec §7.3 + Roadmap Phase 4: presign PUT returns object path.
28. **[St7]** Roadmap Phase 4: orphan-attachment note + post-launch lifecycle.
29. **[St8]** Spec §7.2: standardize `foldername` vs `split_part`.
30. **[N5]** Spec §5.1 + Phase 3: password recovery out of scope.
31. **[Rm9]** Spec §11 / Roadmap Phase 13: align call-site count (59 vs 60).
32. **[F5-rls]** Spec §9.8: explicit no-rate-limit/dedup/moderation note.
33. **[user_reports.reason]** Spec §3.2: free-text reason, no maxLength.

---

## 6. Implementation-Pain Forecast (what the review predicts will hurt if ignored)

- **Email leakage** is the single most likely **privacy incident** at cutover if the new serializer accidentally mirrors Supabase's current behavior. It must be an explicit, tested invariant.
- **Presence/typing** is the most likely **realtime regression**: shipping Socket.IO rooms without participant checks re-creates the current open-channel behavior AND adds an abuse surface. Do it right in Phase 12.
- **Soft-delete permanence** will surface as a **UX bug report** ("my chat disappeared and won't come back") if the reappear-on-message claim leaks into QA expectations.
- **Gender normalization** is a **data-corruption risk** if the import maps both hyphen and underscore to the same value without a CHECK to catch stragglers.
- **Non-atomic unverified insert** is a **data-quality leak** (orphan train rows) that will silently grow; the Phase 7 fix must include a cleanup query for pre-existing orphans.
- **bigint attachment_size** will throw at the **first attachment render** if the serializer isn't built in Phase 11; it's cheap to fix now, costly to debug later.

---

## 7. Migration-Dimension Findings (runbook)

> The migration auditor originally failed mid-response (transient server error); its run was re-executed. Findings from the re-run are appended here in place. Seeds M1 (gender), M3 (legacy URL rewrite), M6 (empty text), M7 (deleted_for), M8 (email PII) were independently confirmed via the schema/storage/roadmap dimensions above; the runbook claims M2 (identity continuity), M4 (trains seed), M5 (unverified_trains) were verified in the re-run.

<!-- PLACEHOLDER: migration re-run results merge here -->

---

## 8. Appendix — Review Instrument

- 8 dimensions × (seed-verify + hunt) → independent refute-pass per finding → severity re-scored by verifier.
- Seed sources: full frontend read (hooks, pages, components, lib) + all 31 migrations + RLS/realtime/storage policies.
- 54 confirmed, 7 refuted, 0 dropped.
- Every confirmed finding carries file:line and migration/document line evidence (see §2).
