# TrainMate v2 — Backend Architecture Document

**Status:** Draft for Review  
**Last Updated:** 2026-08-05  
**Frontend Stack:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui  
**Backend Platform:** Supabase (PostgreSQL + Auth + Realtime + Storage)

---

## 1. System Overview

TrainMate v2 is a **train travel companion discovery and messaging platform** for Indian railway passengers. Users create journey profiles (train number, date, boarding/destination stations, coach/class), discover other passengers on the same train/date, send travel companion requests, and chat once requests are accepted.

### Core User Flows
1. **Plan Journey** → Create journey record with train, date, stations, coach
2. **Find Companions** → Query other users on same train + date (RLS-enforced visibility)
3. **Send/Receive Requests** → Pending → Accepted/Rejected state machine
4. **Chat** → Real-time messaging (Supabase Realtime) with attachments
5. **Safety** → Block users, report users, soft-delete conversations

---

## 2. Data Model (PostgreSQL Schema)

### 2.1 Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User profile (extends `auth.users`) | `id` (PK, FK→auth.users), `email`, `name`, `college`, `gender` (stored as `prefer_not_to_say` underscore), `bio`, `hobbies`, `avatar_url`, `created_at`, `updated_at` |
| `journeys` | Planned train journey | `id`, `user_id` (FK), `user_name`, `train_number`, `train_name`, `travel_date`, `coach`, `boarding_station`, `destination_station`, `college`, `gender` (stored as `prefer-not-to-say` hyphen), `created_at` |
| `requests` | Companion request state machine | `id`, `from_user_id`, `from_name`, `from_email`, `to_user_id`, `to_name`, `to_email`, `train_number`, `travel_date`, `boarding_station`, `destination_station`, `status` (pending/accepted/rejected), `created_at`, `updated_at` |
| `conversations` | Chat room between 2 accepted companions | `id`, `participants` (uuid[]), `participant_names` (jsonb), `train_number`, `travel_date`, `last_message`, `last_message_time`, `deleted_for` (uuid[], soft-delete), `created_at` |
| `messages` | Chat messages | `id`, `conversation_id` (FK), `sender_id`, `sender_name`, `text`, `attachment_url`, `attachment_type`, `attachment_name`, `attachment_size`, `created_at` |
| `last_read` | Read receipts per user per conversation | `id`, `user_id`, `conversation_id`, `timestamp`, `UNIQUE(user_id, conversation_id)` |
| `blocked_users` | Mutual block list | `id`, `blocker_id`, `blocked_id`, `created_at`, `UNIQUE(blocker_id, blocked_id)` |
| `user_reports` | Abuse reports | `id`, `reporter_id`, `reported_id`, `reason`, `created_at` |
| `trains` | Verified Indian train catalog | `train_number` (PK), `train_name`, `active`, `created_at` |
| `unverified_trains` | User-submitted trains not in catalog | `id`, `train_number`, `train_name`, `submitted_by`, `entered_value`, `normalized_value`, `created_at` |

### 2.2 Security Views

| View | Purpose |
|------|---------|
| `profiles_safe` | Hides `email` from non-owners; `security_invoker = on`. **Unused by the frontend.** **Deployed reality:** migration `20260725073436` blanket `GRANT SELECT ON ALL TABLES` overrides column-level `REVOKE SELECT (email)` on `profiles`; any user passing `can_view_profile` can read `profiles.email` directly. |

---

## 3. Row Level Security (RLS) — The Security Backbone

All tables have **RLS enabled**. Policies implement **contextual visibility** — users only see data they have a legitimate relationship with (same train/date, accepted request, active conversation).

### 3.1 Policy Summary by Table

#### `profiles`
- **SELECT:** `can_view_profile(profile_id)` — Owner OR matching journey OR accepted request OR active conversation
- **INSERT/UPDATE/DELETE:** Own profile only

#### `journeys`
- **SELECT:** Own journeys OR `can_view_journey(train_number, travel_date)` (user has journey on same train+date) AND NOT blocked
- **INSERT/UPDATE/DELETE:** Own journeys only

#### `requests`
- **SELECT:** Sent or received by user AND NOT blocked between parties
- **INSERT:** Sender = current user AND NOT blocked
- **UPDATE:** Receiver = current user (accept/reject)
- **DELETE:** Sender = current user AND status = pending (cancel)

#### `conversations`
- **SELECT:** Participant AND NOT in `deleted_for`
- **INSERT:** `can_create_conversation(participants)` — exactly 2 participants, caller is one, NOT blocked, accepted request exists
- **UPDATE:** Participant (only `last_message`, `last_message_time`, `deleted_for` allowed). **Note:** Migration `20260725073436` blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES TO authenticated` overrides the prior column-level UPDATE restriction; the `prevent_conversation_tamper_trg` trigger is the sole guard on immutable fields (`participants`, `participant_names`, `train_number`, `travel_date`, `created_at`, `id`, and `deleted_for` unless `app.allow_deleted_for_update='on'`).

#### `messages`
- **SELECT:** `is_conversation_participant(conversation_id)`
- **INSERT:** Sender = current user AND participant AND NOT blocked in conversation

#### `last_read`
- **SELECT/INSERT/UPDATE:** Own records only

#### `blocked_users`
- **SELECT/INSERT/DELETE:** `blocker_id = auth.uid()`

#### `user_reports`
- **INSERT:** `reporter_id = auth.uid()`
- **SELECT:** Own reports only

#### `trains`
- **SELECT:** All authenticated users

#### `unverified_trains`
- **INSERT/SELECT:** Own submissions only

### 3.2 Helper Functions (SECURITY DEFINER)

| Function | Purpose |
|----------|---------|
| `is_blocked(user_a, user_b)` | Mutual block check |
| `can_view_journey(train_number, travel_date)` | Caller has journey on same train+date |
| `can_view_profile(profile_id)` | Contextual profile visibility |
| `is_conversation_participant(conv_id)` | Caller in `participants` array |
| `is_blocked_in_conversation(conv_id, uid)` | Caller blocked by/blocking any other participant |
| `can_create_conversation(parts)` | Validates 2 participants, caller included, not blocked, accepted request exists |
| `soft_delete_conversation(conv_id, user_id_to_add)` | Append to `deleted_for` array (bypasses RLS) |
| `update_updated_at_column()` | Trigger for `updated_at` timestamps |
| `handle_new_user()` | Auto-create profile on signup |
| `prevent_conversation_tamper()` | BEFORE UPDATE trigger — blocks changes to `participants`, `participant_names`, `train_number`, `travel_date`, `created_at`, `id` |

### 3.3 Realtime Channel Authorization

Supabase Realtime messages are filtered via policies on `realtime.messages`:

```sql
-- Per-conversation channel: "messages-<uuid>"
realtime.topic() LIKE 'messages-%' AND is_conversation_participant(...)

-- Last-read updates: "last-read-%"
realtime.topic() LIKE 'last-read-%'

-- Per-user conversations updates: "conversations-updates-<user_id>"
realtime.topic() = ('conversations-updates-' || auth.uid()::text)
```

**Presence/broadcast on `presence-<cid>` is NOT gated by this policy.** In Supabase Realtime v2, presence and broadcast are separate primitives with no RLS authorization — any authenticated user can join any `presence-<conversationId>` channel and broadcast `typing`. The channel name itself leaks conversation UUIDs. The Socket.IO backend **must** enforce participant checks on room join and rate-limit typing.

---

## 4. API Layer — Supabase Client (Frontend-Direct)

The frontend uses **Supabase JS client directly** (`@supabase/supabase-js`) with the **anon key**. No custom backend API layer exists. All data access goes through:

- **PostgREST** (auto-generated REST from schema + RLS)
- **Realtime** (WebSocket for live updates)
- **Storage** (avatars, chat attachments)
- **Auth** (email/password + email confirmation)

### 4.1 Client Configuration
```typescript
// src/integrations/supabase/client.ts
createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
})
```

### 4.2 Type Safety
- **Generated types** from `supabase gen types typescript` → `src/integrations/supabase/types.ts`
- All queries use `Database` generic for full type inference

---

## 5. Authentication & Authorization

### 5.1 Auth Flow
- **Email/Password** signup + signin
- **Email confirmation** required (redirect to `/`)
- **Auto-profile creation** via `handle_new_user()` trigger on `auth.users` INSERT
- **Session persistence** in `localStorage` with auto-refresh

### 5.2 Authorization Model
- **RLS is the single source of truth** — no application-level permission checks
- **Security Definer functions** encapsulate complex visibility logic
- **Column-level GRANT** on `conversations` restricts UPDATE to `last_message`, `last_message_time`, `deleted_for`
- **REVOKE EXECUTE FROM anon** on all SECURITY DEFINER functions

---

## 6. Real-time Architecture

### 6.1 Channels & Subscriptions

| Channel | Topic Pattern | Purpose | Payload Table |
|---------|---------------|---------|---------------|
| Messages | `messages-{conversationId}` | Live chat messages | `messages` |
| Last Read | `last-read-{conversationId}-{otherUserId}` | Read receipts | `last_read` |
| Conversations List | `conversations-updates-{userId}` | Conversation list changes | `conversations` |

### 6.2 Frontend Hooks
- `useChat(conversationId?, otherUserId?)` — messages, conversations, unread counts, send, upload, markAsRead, createConversation, deleteChat
- `useRequests()` — request CRUD, status helpers, cleanup
- `useAcceptedCompanions()` — derived from accepted requests
- `useBlockedUsers()` — block/unblock, list
- `usePresence()` — online status (if implemented)

### 6.3 Message Flow
```
User sends message
    → supabase.from('messages').insert() [RLS: participant + not blocked]
    → Realtime broadcasts to `messages-{conversationId}`
    → Other participant receives via on('postgres_changes')
    → Conversation updated (last_message, last_message_time)
    → `conversations-updates-{userId}` notifies conversation list
```

### 6.4 Attachments
- **Bucket:** `chat-attachments` (private)
- **Path:** `{conversationId}/{uuid}.{ext}`
- **RLS on storage.objects:** Participant check via `is_conversation_participant(split_part(name, '/', 1)::uuid)`
- **Signed URLs:** 1-year expiry for delivery

---

## 7. Storage Architecture

| Bucket | Public | Purpose | RLS Policy |
|--------|--------|---------|------------|
| `avatars` | **false** (private) | Profile photos | `auth.uid()::text = foldername(name)[1]` for write; authenticated read |
| `chat-attachments` | **false** | Chat file attachments | Participant check via `is_conversation_participant()` |

---

## 8. Business Logic — Key Flows

### 8.1 Journey Creation & Companion Discovery
```
POST journeys (train_number, travel_date, ...)
    → If train not in `trains`, INSERT into `unverified_trains`
    → SELECT from `journeys` WHERE train_number = X AND travel_date = Y AND user_id != current
    → RLS `can_view_journey()` ensures only users on same train+date see each other
```

### 8.2 Request State Machine
```
PENDING → ACCEPTED → (create conversation) → CHAT
    → REJECTED (terminal)
    → CANCELLED (sender only, while PENDING)
```
- **Auto-cleanup:** `cleanupExpiredRequests()` deletes sender's pending requests where `travel_date < (now - 2 days)`

### 8.3 Conversation Creation Guard
`can_create_conversation(participants)` enforces:
1. Exactly 2 participants
2. Caller is one participant
3. Participants NOT blocked
4. **Accepted request exists** between them

### 8.4 Blocking Enforcement
- `is_blocked()` checked in RLS for: journeys, requests, profiles, conversations, messages
- Blocks are **mutual** — either direction hides both users from each other
- Blocked users' conversations remain readable but show "Blocked" badge; unblock restores messaging

### 8.5 Soft Delete Conversations
- `deleted_for` array tracks per-user deletion
- `soft_delete_conversation()` RPC appends to array (SECURITY DEFINER bypasses RLS)
- SELECT policy excludes `deleted_for` participants
- **`deleted_for` is append-only — nothing ever removes a user id.** A soft-deleted conversation **stays hidden from the list permanently**. Direct URL `/chat/<id>` still works because messages are not filtered by `deleted_for`. A new message does **NOT** cause reappearance in the conversation list.

---

## 9. Database Functions & Triggers

### 9.1 Triggers
| Trigger | Table | Timing | Function |
|---------|-------|--------|----------|
| `update_profiles_updated_at` | profiles | BEFORE UPDATE | `update_updated_at_column()` |
| `update_requests_updated_at` | requests | BEFORE UPDATE | `update_updated_at_column()` |
| `on_auth_user_created` | auth.users | AFTER INSERT | `handle_new_user()` |
| `prevent_conversation_tamper_trg` | conversations | BEFORE UPDATE | `prevent_conversation_tamper()` |

### 9.2 Realtime Publication
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.last_read;
```

---

## 10. Indexes (Performance)

```sql
-- Journeys
CREATE INDEX idx_journeys_user_id ON journeys(user_id);
CREATE INDEX idx_journeys_train_date ON journeys(train_number, travel_date);

-- Requests
CREATE INDEX idx_requests_from_user ON requests(from_user_id);
CREATE INDEX idx_requests_to_user ON requests(to_user_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_status_users ON requests(status, from_user_id, to_user_id);

-- Messages
CREATE INDEX idx_messages_conversation ON messages(conversation_id);

-- Conversations
CREATE INDEX idx_conversations_participants ON conversations USING GIN(participants);

-- Blocked users
CREATE INDEX idx_blocked_users_lookup ON blocked_users(blocker_id, blocked_id);
```

---

## 11. Security Hardening Checklist

- [x] RLS enabled on **all** user-facing tables
- [x] No `SELECT *` policies — all use helper functions
- [x] `security_invoker = on` on `profiles_safe` view
- [ ] **Column-level GRANT on `conversations` overridden** by blanket grant `20260725073436`; trigger `prevent_conversation_tamper_trg` is sole guard
- [x] REVOKE EXECUTE FROM anon on all SECURITY DEFINER functions
- [x] Trigger prevents tampering of immutable conversation fields
- [x] `user_email` column **dropped** from `journeys` (was leaking via policy)
- [ ] **`profiles.email` column SELECT revoked — BUT blanket grant `20260725073436` re-enables table SELECT; email exposed to contextual viewers** (`profiles_safe` view unused)
- [x] Avatars bucket **private** (no anonymous enumeration)
- [x] Chat attachments bucket private + participant-scoped RLS
- [ ] **Realtime presence/broadcast on `presence-<cid>` has NO authorization** — any authenticated user can join; channel names leak conversation IDs
- [x] Blocking enforced at RLS layer (not just app logic)
- [x] Request creation blocked if users are blocked
- [x] Conversation creation requires accepted request + no block
- [x] Message sending blocked if blocked in conversation

---

## 12. Scalability Considerations

| Concern | Current Approach | Future Mitigation |
|---------|------------------|-------------------|
| Journey matching | Full table scan via `can_view_journey()` | Materialized view or dedicated matching service |
| Realtime connections | Per-user conversation channel | Connection pooling, presence sharding |
| Message history | Unbounded growth | Archival partition by date |
| Train catalog | Static seed data | Admin API for CRUD, versioning |
| Unverified trains | Growing unbounded | Periodic review + promotion to `trains` |

---

## 13. Deployment & Environment

### 13.1 Required Environment Variables
```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

### 13.2 Supabase Project Settings
- **Auth:** Email confirmations enabled, redirect to production URL
- **Realtime:** Enabled for `messages`, `conversations`, `last_read`
- **Storage:** Buckets `avatars`, `chat-attachments` created with policies
- **Database:** All migrations applied in order

### 13.3 Migration Strategy
- Migrations in `supabase/migrations/` are **sequential, immutable**
- New changes → new migration file (timestamped)
- **Never edit applied migrations** — create reversal/new migration

---

## 14. Frontend-Backend Contract (TypeScript Types)

The `Database` type in `src/integrations/supabase/types.ts` is the **single source of truth** for:
- Table Row/Insert/Update types
- View types
- Function Args/Returns
- RPC calls (e.g., `supabase.rpc('soft_delete_conversation', {...})`)

All hooks and components consume these types — **no manual type duplication**.

---

## 15. Open Questions / Future Work

1. **Push Notifications** — Supabase Edge Functions + FCM/APNs for background message alerts
2. **Journey Matching Service** — Dedicated worker for proactive companion suggestions
3. **Admin Dashboard** — Train catalog management, user moderation, report review
4. **Analytics** — Journey completion rates, match success, retention
5. **Multi-participant Conversations** — Group chat for same coach/college (requires schema + RLS changes)
6. **Message Editing/Deletion** — Currently not supported; would need `messages` UPDATE/DELETE policies
7. **E2E Encryption** — Client-side encryption for messages (Web Crypto API)

---

## 16. Appendix: Migration History (Chronological)

| Date | Migration | Key Changes |
|------|-----------|-------------|
| 2025-12-12 | `5dc954fa...` | Core schema: profiles, journeys, requests, conversations, messages, last_read, blocked_users, user_reports, trains, unverified_trains, triggers, RLS, indexes |
| 2025-12-12 | `d0b54a4d...` | Fix `update_updated_at_column` search_path |
| 2025-12-14 | `42a91877...` | Restrict journeys SELECT to matching train/date via `can_view_journey()` |
| 2025-12-15 | `3ca540b1...` | `deleted_for` on conversations, blocked_users, user_reports, `is_blocked()`, soft delete |
| 2025-12-17 | `2708c889...` | Restrict profiles SELECT via `can_view_profile()` (matching journey, accepted request, conversation) |
| 2025-12-19 | `91965447...` | Verified `trains` table + seed data, `unverified_trains`, `train_name` on journeys |
| 2025-12-23 | `e2b06a2d...` | `entered_value`, `normalized_value` on unverified_trains |
| 2025-12-26 | `ac8f402f...` | DELETE policy for pending outgoing requests (cancel) |
| 2025-12-26 | `0942da88...` | Conversations UPDATE policy WITH CHECK |
| 2025-12-27 | `bdb97748...` | `soft_delete_conversation()` RPC |
| 2025-12-27 | `069edbb0...` | Same UPDATE policy fix |
| 2025-12-27 | `40a0784f...` | Profile fields (bio, hobbies, avatar_url), avatars bucket + policies |
| 2026-01-06 | `8892ae92...` | Profile DELETE policy, blocking in RLS (journeys, requests, profiles), constraints, avatars private |
| 2026-01-06 | `96b6e5c5...` | Avatars public again (profile photos viewable by others) |
| 2026-01-19 | `86245a52...` | Drop `user_email` from journeys, `profiles_safe` view hides email |
| 2026-04-18 | `e29f8b04...` | Avatars private again, authenticated-only read |
| 2026-04-18 | `779f9022...` | Drop `user_email` column, Realtime channel auth policies |
| 2026-06-18 | `86bde92e...` | Message attachments columns, chat-attachments bucket policies |
| 2026-06-18 | `b0dcdda5...` | `last_read` REPLICA IDENTITY FULL + realtime publication |
| 2026-06-30 | `da08abd9...` | Tamper prevention trigger, `is_blocked_in_conversation`, `can_create_conversation`, tightened INSERT policies, per-user realtime topic, storage UPDATE policy, REVOKE/GRANT on functions |
| 2026-06-30 | `2abc8ebe...` | Column-level GRANT on conversations (last_message, last_message_time, deleted_for) |
| 2026-07-02 | `f44b81c6...` | (Check file) |
| 2026-07-03 | `1ec62bfb...` | (Check file) |
| 2026-07-16 | `8500280b...` | (Check file) |
| 2026-07-16 | `6c4b51cb...` | (Check file) |
| 2026-07-17 | `c521be6a...` | (Check file) |
| 2026-07-17 | `a522a1fb...` | (Check file) |
| 2026-07-17 | `a364f2b9...` | (Check file) |
| 2026-07-17 | `2f6b2246...` | (Check file) |
| 2026-07-22 | `820a8bb7...` | (Check file) |
| 2026-07-25 | `grant_authenticated_table_privileges` | **Blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated` + sequences** — overrides prior column-level REVOKE/GRANT; current deployed grants |

---

**Document Owner:** Backend Engineering Lead  
**Review Cadence:** Per major schema change or quarterly  
**Next Review:** After push notification implementation