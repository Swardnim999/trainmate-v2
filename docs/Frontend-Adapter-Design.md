# Milestone 13 — Frontend Adapter & Integration Architectural Design

## Executive Summary

Milestone 13 establishes the frontend adapter layer and completes the migration of TrainMate v2 from legacy Supabase client direct invocations to the typed TrainMate v2 REST API (M1–M11) and Socket.IO realtime layer (M12).

This design ensures:
1. **Zero UI/UX Regression**: All existing user interfaces, visual design tokens, loading states, error toasts, and navigation flows remain byte-for-byte consistent.
2. **Typed Client Architecture (D5)**: A clean, modular HTTP client (`src/lib/api/`) and Socket.IO client (`src/integrations/sockets/`) replace direct `@/integrations/supabase/client` calls across all 60 traced frontend call sites.
3. **Session & Auth Parity**: Auth state persistence in `localStorage` under `trainmate-auth-token`, automatic 401 refresh interceptor with queue-and-replay, and GoTrue-compatible `onAuthStateChange` event sequence (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`).
4. **Realtime Socket.IO Integration**: Direct connection with JWT handshake authentication, automatic room joins, message delivery without toast glitches, read receipts, and presence/typing indicator syncing.
5. **Strict Privacy Invariants**: Strict email privacy (omitted from all public profile views, companion queries, and realtime payloads), avatar cache-busting, and symmetric blocking enforcement.

---

## 1. Inventory of 60 Traced Call Sites

| Call Site # | Domain | Source File | Legacy Supabase Pattern | TrainMate v2 Target Endpoint / Socket Event |
|---|---|---|---|---|
| **#1** | Auth | `src/hooks/useAuth.tsx` | `supabase.auth.getSession()` | Local storage restore / `GET /auth/session` |
| **#2** | Auth | `src/hooks/useAuth.tsx` | `supabase.auth.onAuthStateChange()` | `authApi.onAuthStateChange()` event listener |
| **#3** | Auth | `src/hooks/useAuth.tsx` | `supabase.auth.signOut()` | `POST /auth/logout` + storage clearance |
| **#4** | Auth | `src/pages/Login.tsx` | `supabase.auth.signInWithPassword()` | `POST /auth/login` |
| **#5** | Auth | `src/pages/Login.tsx` | `supabase.auth.signUp()` | `POST /auth/register` |
| **#6** | Profile | `src/hooks/useProfile.ts` | `supabase.from('profiles').select().eq('id', user.id)` | `GET /profiles/me` |
| **#7** | Profile | `src/hooks/useProfile.ts` | `supabase.from('profiles').upsert()` | `PATCH /profiles/me` |
| **#8** | Profile | `src/hooks/useProfile.ts` | `supabase.storage.from('avatars').upload()` | `PATCH /profiles/me` (data URI / multipart) |
| **#9** | Profile | `src/hooks/useProfile.ts` | `supabase.storage.from('avatars').getPublicUrl()` | Avatar version cache-busting query `?t=...` |
| **#10** | Profile | `src/hooks/useProfile.ts` | `supabase.from('profiles').update({ avatar_url })` | `PATCH /profiles/me` |
| **#11** | Profile | `src/hooks/useProfile.ts` | `supabase.from('profiles').select().eq('id', strangerId)` | `GET /profiles/:userId` (Strictly omits email) |
| **#12** | Requests | `src/hooks/useRequests.ts` | `supabase.from('companion_requests').select()` | `GET /requests/me` |
| **#13** | Requests | `src/hooks/useRequests.ts` | `supabase.from('companion_requests').delete()` | `DELETE /requests/:id` |
| **#14** | Requests | `src/hooks/useRequests.ts` | `supabase.from('companion_requests').update('accepted')` | `PATCH /requests/:id` |
| **#15** | Requests | `src/hooks/useRequests.ts` | `supabase.from('companion_requests').update('rejected')` | `PATCH /requests/:id` |
| **#16** | Requests | `src/hooks/useRequests.ts` | `supabase.from('companion_requests').select(created_at)` | `POST /requests/cleanup-expired` |
| **#17** | Requests | `src/hooks/useRequests.ts` | `supabase.from('companion_requests').delete().in(expired)` | `POST /requests/cleanup-expired` |
| **#18** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').select().eq('conversation_id')` | `GET /conversations/:id/messages` |
| **#19** | Messages | `src/hooks/useChat.tsx` | `supabase.channel('messages').on('INSERT')` | Socket.IO event `message:new` |
| **#20** | Messages | `src/hooks/useChat.tsx` | `supabase.channel('messages').subscribe()` | `socket.emit('join:conversation')` |
| **#21** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').select(read_at).limit(1)` | `GET /conversations/:id/last-read/:userId` |
| **#22** | Messages | `src/hooks/useChat.tsx` | `supabase.channel('last_read').on('UPDATE')` | Socket.IO event `last-read:update` |
| **#23** | Messages | `src/hooks/useChat.tsx` | `supabase.channel('last_read').subscribe()` | `socket.on('last-read:update')` |
| **#24** | Messages | `src/hooks/useChat.tsx` | `supabase.from('conversations').select()` | `GET /conversations` |
| **#25** | Messages | `src/hooks/useChat.tsx` | `supabase.channel('conversations').on('UPDATE')` | Socket.IO event `conversation:updated` |
| **#26** | Messages | `src/hooks/useChat.tsx` | `supabase.channel('conversations').subscribe()` | `socket.on('conversation:updated')` |
| **#27** | Messages | `src/hooks/useChat.tsx` | `supabase.from('conversations').select(unread)` | `GET /conversations/:id/messages/unread-count` |
| **#28** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').select('id', { count: 'exact' })` | `GET /conversations/:id/messages/unread-count` |
| **#29** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').select().gt('created_at', read_at)` | `GET /conversations/:id/messages/unread-count` |
| **#30** | Messages | `src/hooks/useChat.tsx` | `supabase.storage.from('chat-attachments').upload()` | Encoded payload in `POST /conversations/:id/messages` |
| **#31** | Messages | `src/hooks/useChat.tsx` | `supabase.storage.from('chat-attachments').getPublicUrl()` | Server-managed attachment URL |
| **#32** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').insert(text + attachment)` | `POST /conversations/:id/messages` (Atomic send) |
| **#33** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').insert(attachment only)` | `POST /conversations/:id/messages` (Atomic send) |
| **#34** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').insert(text only)` | `POST /conversations/:id/messages` (Atomic send) |
| **#35** | Messages | `src/hooks/useChat.tsx` | `supabase.from('messages').update({ read_at })` | `PUT /conversations/:id/last-read` |
| **#36** | Messages | `src/hooks/useChat.tsx` | `supabase.from('conversations').insert()` | `POST /conversations` |
| **#37** | Messages | `src/hooks/useChat.tsx` | `supabase.from('conversations').update({ deleted_for })` | `DELETE /conversations/:id/for-me` |
| **#38** | Presence | `src/hooks/usePresence.ts` | `supabase.channel('presence').track()` | Socket.IO event `presence:sync` / `joinPresence` |
| **#39** | Presence | `src/hooks/usePresence.ts` | `supabase.channel('presence').on('sync')` | Socket.IO event `presence:sync` |
| **#40** | Presence | `src/hooks/usePresence.ts` | `supabase.channel('presence').send('broadcast')` | Socket.IO event `typing` |
| **#41** | Companions | `src/hooks/useAcceptedCompanions.ts` | `supabase.from('companion_requests').select(accepted)` | `GET /requests/me/accepted` |
| **#42** | Companions | `src/hooks/useAcceptedCompanions.ts` | `supabase.channel('accepted_requests').on('UPDATE')` | Polling & `conversation:updated` events |
| **#43** | Companions | `src/hooks/useAcceptedCompanions.ts` | `supabase.channel('accepted_requests').subscribe()` | Sockets listener |
| **#44** | Companions | `src/hooks/useAcceptedCompanions.ts` | `supabase.removeChannel()` | Sockets teardown |
| **#45** | Moderation | `src/hooks/useBlockedUsers.ts` | `supabase.from('blocked_users').select('blocked_id')` | `GET /blocked-users` |
| **#46** | Moderation | `src/hooks/useBlockedUsers.ts` | `supabase.from('blocked_users').insert()` | `POST /blocked-users` |
| **#47** | Moderation | `src/hooks/useBlockedUsers.ts` | `supabase.from('blocked_users').delete()` | `DELETE /blocked-users/:blockedId` |
| **#48** | Dashboard | `src/pages/Dashboard.tsx` | `supabase.from('companion_requests').select(count)` | `GET /requests/incoming/pending-count` |
| **#49** | Dashboard | `src/pages/Dashboard.tsx` | `supabase.from('user_journeys').select()` | `GET /journeys/me` |
| **#50** | Dashboard | `src/pages/Dashboard.tsx` | `supabase.from('user_journeys').select(companions)` | `GET /journeys/:trainNumber/:travelDate/companions` |
| **#51** | Dashboard | `src/pages/Dashboard.tsx` | `supabase.from('unverified_trains').insert()` | `POST /trains/unverified` |
| **#52** | Dashboard | `src/pages/Dashboard.tsx` | `supabase.from('user_journeys').insert()` | `POST /journeys` |
| **#53** | Dashboard | `src/pages/Dashboard.tsx` | `supabase.from('user_journeys').delete()` | `DELETE /journeys/:id` |
| **#54** | Matched | `src/pages/Matched.tsx` | `supabase.from('companion_requests').insert()` | `POST /requests` |
| **#55** | Matched | `src/pages/Matched.tsx` | `supabase.from('companion_requests').select(existing)` | `GET /requests/me` |
| **#56** | Chats | `src/pages/Chats.tsx` | `supabase.from('profiles').select('name').eq('id')` | `GET /profiles/:userId/name` |
| **#57** | Requests | `src/pages/Requests.tsx` | `supabase.from('profiles').select('name').eq('id')` | `GET /profiles/:userId/name` |
| **#58** | ProfileModal | `src/components/ProfileModal.tsx` | `supabase.from('profiles').select().eq('id')` | `GET /profiles/:userId` |
| **#59** | ReportDialog | `src/components/ReportDialog.tsx` | `supabase.from('user_reports').insert()` | `POST /reports` |
| **#60** | Autocomplete | `src/components/TrainAutocomplete.tsx` | `supabase.from('trains').select()` | `GET /trains?q=...` |

---

## 2. Typed Client Architecture

### 2.1 HTTP Client (`src/lib/api/client.ts`)
- Configurable base URL via `VITE_API_URL` (defaulting to `http://localhost:3000`).
- Generates `X-Request-ID` UUID on every outgoing request for end-to-end tracing.
- Automatically attaches `Authorization: Bearer <access_token>` from `localStorage` (`trainmate-auth-token`).
- Centralized 401 Interceptor:
  - If a request returns `401 Unauthorized` and a refresh token exists, pauses incoming requests in a queue.
  - Calls `POST /auth/refresh` with the stored refresh token.
  - Updates tokens in storage.
  - Replays all queued requests with the new access token.
  - Emits `TOKEN_REFRESHED` auth state event.
  - If refresh fails, purges session and emits `SIGNED_OUT`.

### 2.2 Domain API Modules (`src/lib/api/`)
- `auth.api.ts`: Login, register, logout, refresh, reset password, get session, auth state emitter.
- `profiles.api.ts`: Own profile retrieval/update, public profile querying (strictly omitting email), avatar update.
- `journeys.api.ts`: User journeys listing, creation, deletion, companion search.
- `trains.api.ts`: Train directory autocomplete search, unverified train submission.
- `requests.api.ts`: Companion request dispatch, status update (accept/reject), cancellation, incoming pending count, accepted companions, expired cleanup.
- `conversations.api.ts`: Conversation rooms listing, get or create, soft deletion for user.
- `messages.api.ts`: Message history listing, atomic message send (text + attachments), unread count, read receipt query, mark conversation read.
- `moderation.api.ts`: Blocked users query, block user, unblock user, report user.

### 2.3 Socket.IO Client Manager (`src/integrations/sockets/`)
- Single shared Socket.IO instance attached to `VITE_SOCKET_URL` or `VITE_API_URL`.
- JWT handshake authentication via `{ auth: { token: accessToken } }`.
- Automatically reconnects and re-authenticates when token refreshes.
- Methods:
  - `connect(token)` / `disconnect()`
  - `joinConversation(conversationId)` / `leaveConversation(conversationId)`
  - `onMessage(handler)` / `onLastRead(handler)` / `onConversationUpdated(handler)`
  - `joinPresence(channel, userMetadata)` / `leavePresence(channel)`
  - `sendTyping(conversationId, isTyping)` / `onTyping(handler)`

---

## 3. Hook & Component Migration Strategy

Each existing hook and component is migrated to the typed client while strictly maintaining its outward signature and return types:
1. `useAuth.tsx`: Wraps `authApi`, exposes `user`, `session`, `loading`, `signIn`, `signUp`, `signOut`.
2. `useProfile.ts`: Uses `profilesApi`, maintains avatar cache-buster `?t=${Date.now()}`.
3. `useRequests.ts`: Uses `requestsApi`, maintains status filtering and automated cleanup.
4. `useAcceptedCompanions.ts`: Uses `requestsApi.getAcceptedCompanions()` and listens for realtime updates.
5. `useChat.tsx`: Uses `conversationsApi`, `messagesApi`, and Socket.IO manager. Provides atomic message sending (fixing the legacy double-insert toast bug).
6. `usePresence.ts`: Uses `socketManager.joinPresence()` and typing indicators.
7. `useBlockedUsers.ts`: Uses `moderationApi`.

---

## 4. Verification & QA Plan

1. **Unit & Contract Suite**:
   - Run 60 call-site contract tests (`backend/test/contract/frontend-adapter-60-callsites.contract.test.ts`).
   - Run backend unit tests (`npm test` in `backend/`).
   - Run backend integration tests (`npm run test:integration` in `backend/`).
2. **Frontend Quality Gates**:
   - `npm run build` (Vite production bundle verification).
   - `npm run lint` (ESLint clean).
3. **Supabase Codebase Audit**:
   - Verify 0 active files in `src/` import `@/integrations/supabase/client`.
4. **Adversarial QA & Live UI Verification**:
   - Start backend server on port 3000 and frontend dev server on port 8080.
   - Execute all 12 canonical user flows in browser.
   - Capture screenshots of key UI pages for review.
