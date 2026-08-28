# TrainMate v2 — Milestone 15 Design Document
# Post-Cutover Verification, Supabase Decommissioning & System Hardening

**Master Execution Plan: Production Verification, Canary Health Auditing, Supabase Dependency Decommissioning, Legacy Code Purge, and Post-Migration System Hardening**

| | |
| :--- | :--- |
| **Milestone** | Milestone 15 (`phase-15-post-cutover-hardening`) |
| **Status** | DESIGN COMPLETE & LOCKED — Awaiting Implementation Authorization |
| **Owner** | Lead Backend Engineer / Technical Architect |
| **Inputs (Source of Truth)** | `docs/Implementation-Roadmap.md` (§11 DoD, Part III §1–5), `docs/Backend-Specification.md` (§12, §13), `docs/Backend-Architecture.md` (§6, §15), `docs/Design-Review-Report.md`, `deploy/runbooks/decommission.md`, `docs/Cutover-Deployment-Design.md` |
| **Prerequisites** | Milestone 1 through 14 verified, committed, pushed, and green in CI (`93a7af4`) |
| **Output Document** | `docs/Post-Cutover-Hardening-Design.md` |

---

## 1. Executive Summary & Objective

Milestone 15 is the concluding milestone of the TrainMate v2 platform migration. Having constructed the typed Node.js/Express backend (M1–M11), validated the Socket.IO realtime layer (M12), seamlessly integrated the frontend adapter layer across all 60 call sites (M13), and established the AWS production infrastructure, containerization, and cutover playbooks (M14), Milestone 15 executes the post-cutover stabilization, legacy dependency decommissioning, and post-migration hardening phase.

The primary objectives of Milestone 15 are:
1. **Full Verification & Invariant Auditing**: Execute the canonical 12-flow Playwright E2E verification suite (`e2e/m13-all-flows.spec.ts`) and authorization probe canary (`monitoring/authz-probe.ts`) against the integrated platform to prove zero functional or authorization regressions.
2. **Complete Supabase Decommissioning**: Execute the Stage 16 Decommissioning Protocol (`deploy/runbooks/decommission.md`): completely purge `@supabase/supabase-js` from root `package.json`, eliminate legacy client code (`src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`), sanitize `.env` of legacy Supabase keys, and archive historical Supabase migrations to `deploy/archive/supabase-legacy/`.
3. **Targeted Post-Migration Hardening**: Implement the approved high-impact improvements cataloged in `docs/Implementation-Roadmap.md` Part III §5 and `docs/Backend-Specification.md` §13:
   * **Scheduled Expired-Request Background Worker (Spec §13.9, Roadmap Part III §5 Item 6)**: Replace client-side ad-hoc sweeps with an automated server-side background job.
   * **Realtime Request & Companion Parity (Spec §13.1, Roadmap Part III §5 Item 1)**: Dispatch `request:new`, `request:updated`, and `companions:updated` events over Socket.IO user rooms (`user:<userId>`), closing the legacy `requests-changes` channel gap.
   * **Server-Side Conversation & Message Performance Optimization (Spec §13.3, §13.8)**: Leverage composite index `messages(conversation_id, created_at)` and single-roundtrip unread counting to eliminate client N+1 query patterns.
   * **Attachment & Storage Hygiene Audit (Roadmap Part III §5 Item 12)**: Verify S3 presigned URL expiration policies, least-privilege bucket access, and orphan attachment cleanup guidelines.

---

## 2. Milestone 15 Scope

### 2.1 Explicit IN-SCOPE Functionality

1. **Supabase SDK & Client Elimination:**
   * Uninstall `@supabase/supabase-js` from root `package.json` and prune `package-lock.json`.
   * Safely delete `src/integrations/supabase/client.ts` and `src/integrations/supabase/types.ts`.
   * Verify that root `npm run build` and `npm run lint` succeed with zero unresolved `@supabase` imports across all frontend modules.
   * Cleanse `.env` and `.env.example` of `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_URL`, leaving only `VITE_API_URL` and `VITE_SOCKET_URL`.
   * Archive `supabase/migrations/` and `supabase/config.toml` to `deploy/archive/supabase-legacy/` for permanent auditability.

2. **Automated Background Expired-Request Worker:**
   * Implement `backend/src/jobs/request-cleanup.job.ts` invoking `RequestService.cleanupExpiredRequests()` on a configurable schedule (default: every 60 minutes).
   * Support both in-process interval execution (for development and single-instance deployments) and a standalone CLI entrypoint (`npm run job:cleanup-requests`) for external cron/AWS EventBridge execution.
   * Graceful lifecycle management in `backend/src/index.ts` (start on server boot, stop on `SIGTERM`/`SIGINT`).
   * Provide comprehensive unit tests verifying error handling, non-blocking execution, and database rollback safety.

3. **Realtime Request & Companion Notifications (`requests-changes` Parity):**
   * Extend `RealtimeBroadcaster` in `backend/src/sockets/broadcaster.ts` with `broadcastRequestCreated()`, `broadcastRequestUpdated()`, and `broadcastCompanionsUpdated()`.
   * Wire request lifecycle mutations in `backend/src/services/request.service.ts` (`sendRequest`, `acceptRequest`, `rejectRequest`, `cancelRequest`) to dispatch targeted notifications to `user:<userId>` rooms.
   * Add client-side Socket.IO event listeners in `src/hooks/useRequests.ts` and `src/hooks/useAcceptedCompanions.ts` to automatically refresh request lists and companion rosters in real time without page reload.

4. **Query & Unread Count Optimization:**
   * Verify the composite index `@@index([conversationId, createdAt])` on the `Message` model in `backend/prisma/schema.prisma`.
   * Ensure `GET /conversations` efficiently includes unread counts or provides an optimized batch query preventing N+1 HTTP fetches during conversation list hydration.

5. **End-to-End Verification & Health Auditing:**
   * Run `monitoring/authz-probe.ts` against the live backend to validate all authorization invariants:
     * `INV-1`: Health status check (`GET /health` returns 200 `status: "ok"`).
     * `INV-2`: Unauthenticated access gate (`GET /journeys` returns 401).
     * `INV-3`: Stranger profile masking (`GET /profiles/:strangerId` returns 404, never 403 or email leakage).
     * `INV-4`: Conversation and message isolation (non-participant access returns 404).
     * `INV-5`: Mutual blocking invariant (blocked users excluded from matching and prohibited from messaging).
     * `INV-6`: Strict email privacy (email omitted from all public serializers and companion feeds).
   * Run the full canonical Playwright E2E suite (`e2e/m13-all-flows.spec.ts`) validating all 12 flows.

---

### 2.2 Explicit OUT-OF-SCOPE Functionality (Non-Goals)

Per `docs/Implementation-Roadmap.md` Part III §4 ("Features that should NEVER be implemented until the migration is complete"), the following items remain strictly out of scope:
1. **Push Notifications (FCM / APNs)**: Mobile background push notifications require external service credentials and service worker architecture; deferred to a future dedicated release.
2. **Multi-Participant / Group Chat**: Retains the 1-to-1 conversation aggregate; group chats require schema and UI overhauls.
3. **Message Editing & Deletion**: Modifying or retracting sent chat messages alters the tamper-prevention model and requires new UI interactions.
4. **End-to-End Encryption (E2E Web Crypto)**: Radical redesign of server-side attachment and message processing.
5. **Admin Moderation Dashboard**: Full back-office CRUD portal for train directory management and user bans.
6. **Destructive Cloud Operations**: No live AWS infrastructure creation, DNS cutover, or live Supabase database drops will be performed during this milestone without explicit user instructions.

---

## 3. Dependencies & Architectural Invariants

### 3.1 Dependencies on Prior Milestones
* **Milestone 1–11 (Backend API)**: Provides the typed domain services, controllers, Prisma repositories, and database schemas.
* **Milestone 12 (Realtime Socket.IO)**: Provides the Socket.IO server, JWT authentication middleware, and `RealtimeBroadcaster` room dispatch mechanisms.
* **Milestone 13 (Frontend Adapter)**: Successfully severed all 60 direct Supabase calls in `src/`, enabling safe deletion of `@supabase/supabase-js`.
* **Milestone 14 (Cutover & Deployment Tooling)**: Authored the decommissioning runbook (`deploy/runbooks/decommission.md`) and canary probe (`monitoring/authz-probe.ts`) executed in M15.

### 3.2 Security, Privacy & Authorization Invariants
| Invariant | Specification Reference | Enforcement Mechanism |
| :--- | :--- | :--- |
| **Strict Email Privacy** | Spec §6.12, Design Review C2 | Serializers (`profile.serializer.ts`, `request.serializer.ts`) strictly omit `email` for all users other than `auth.userId == profile.id`. |
| **Stranger Profile Existence Masking** | Spec §6.1, Roadmap Part I | Service layer returns `404 Not Found` when a stranger profile is queried, preventing user enumeration. |
| **Conversation & Message Isolation** | Spec §6.4, §6.5 | `ConversationService` and `MessageService` verify participant membership before read/write; non-participants receive 404. |
| **Mutual Blocking Invariant** | Spec §6.7, Roadmap Phase 5 | `BlockedUserRepository` checks are enforced prior to journey matching, request sending, conversation creation, and message insertion. |
| **Tamper Prevention Invariant** | Spec §3.2, Design Review C3 | `Conversation` aggregate immutable fields (`participants`, `train_number`, `travel_date`) protected by service logic and DB trigger. |
| **Presence & Typing Room Authorization** | Spec §8.5, Design Review C4 | Socket.IO room joins require JWT authentication and verified participant checks before room membership is granted. |

---

## 4. Proposed Architecture & System Design

```
+----------------------------------------------------------------------------------------------------+
|                                    TRAINMATE v2 CLIENT (BROWSER)                                   |
|                                                                                                    |
|   +--------------------------+    +--------------------------+    +----------------------------+   |
|   |   React UI Components    |    |  src/lib/api/ (REST)     |    | src/integrations/sockets/  |   |
|   |  (Zero Supabase Imports) |<-->|  - Auth, Profiles, Trains|    | - Realtime Socket.IO       |   |
|   |                          |    |  - Journeys, Requests    |    | - Room join/leave          |   |
|   |                          |    |  - Conversations, Chat   |    | - 'request:updated'        |   |
|   +--------------------------+    +--------------------------+    | - 'companions:updated'     |   |
+-------------------------------------------------|-----------------+----------------------------+---+
                                                  | (HTTPS REST)                 | (WebSocket)
                                                  v                              v
+----------------------------------------------------------------------------------------------------+
|                                   TRAINMATE v2 BACKEND API SERVER                                  |
|                                                                                                    |
|   +--------------------------------------------------------------------------------------------+   |
|   | Express App & Middleware (Auth, CORS, Security Headers, Rate Limiter)                      |   |
|   +--------------------------------------------------------------------------------------------+   |
|                                                  |                                                 |
|   +----------------------------------------------v---------------------------------------------+   |
|   | Domain Services:                                                                           |   |
|   | - AuthService, ProfileService, JourneyService, MatchingService                             |   |
|   | - RequestService --------[ Emits request/companion events ]--------+                       |   |
|   | - ConversationService, MessageService, ModerationService           |                       |   |
|   +--------------------------------------------------------------------+                       |   |
|                                                  |                     |                       |   |
|   +----------------------------------------------+                     |                       |   |
|   |                                              v                     v                       |   |
|   |   +------------------------------------+  +--------------------------------------------+   |   |
|   |   | Prisma ORM Repositories            |  | RealtimeBroadcaster (Socket.IO Gateway)    |   |   |
|   |   | - PostgreSQL 17 Database           |  | - conv:<cid> (messages, last-read, typing) |   |   |
|   |   | - Composite Index Optimization     |  | - user:<uid> (conv:updated, request:event) |   |   |
|   |   +------------------------------------+  +--------------------------------------------+   |   |
|   |                                                                                                |
|   |   +----------------------------------------------------------------------------------------+   |
|   |   | Background Workers (Scheduled Jobs)                                                    |   |
|   |   | - RequestCleanupJob (Hourly sweep of expired pending requests past travel date + 2d)  |   |
|   |   +----------------------------------------------------------------------------------------+   |
+----------------------------------------------------------------------------------------------------+
```

---

## 5. File-Level Change Plan

### 5.1 New Files
| File Path | Component | Purpose |
| :--- | :--- | :--- |
| `docs/Post-Cutover-Hardening-Design.md` | Documentation | Milestone 15 Master Architecture & Execution Plan (this document). |
| `backend/src/jobs/request-cleanup.job.ts` | Backend Jobs | Automated background runner for expired request cleanup. |
| `backend/test/unit/jobs/request-cleanup.job.test.ts` | Backend Tests | Unit tests validating schedule execution, error handling, and database interaction. |
| `deploy/archive/supabase-legacy/README.md` | Deployment | Documentation noting archive date, legacy status, and historical migration index. |

### 5.2 Modified Files
| File Path | Component | Planned Changes |
| :--- | :--- | :--- |
| `package.json` | Root Dependency | Remove `@supabase/supabase-js` from `dependencies`. |
| `package-lock.json` | Root Lockfile | Prune `@supabase/supabase-js` and transitive dependencies. |
| `.env` & `.env.example` | Root Config | Remove legacy `VITE_SUPABASE_*` environment variables; document `VITE_API_URL` and `VITE_SOCKET_URL`. |
| `backend/src/index.ts` | Server Lifecycle | Instantiate `RequestCleanupJob` on server startup; register clean shutdown on `SIGTERM`/`SIGINT`. |
| `backend/src/sockets/broadcaster.ts` | Realtime Gateway | Add `broadcastRequestCreated`, `broadcastRequestUpdated`, and `broadcastCompanionsUpdated`. |
| `backend/src/services/request.service.ts` | Domain Services | Inject `RealtimeBroadcaster` and emit companion events upon request lifecycle transitions. |
| `src/integrations/sockets/types.ts` | Frontend Sockets | Declare `request:new`, `request:updated`, `companions:updated` event signatures. |
| `src/hooks/useRequests.ts` | Frontend Hook | Listen to `request:new` and `request:updated` over Socket.IO to trigger reactive refetch. |
| `src/hooks/useAcceptedCompanions.ts` | Frontend Hook | Listen to `companions:updated` over Socket.IO to refresh accepted companion roster dynamically. |

### 5.3 Deleted / Relocated Files
| Original Path | Target Action | Rationale |
| :--- | :--- | :--- |
| `src/integrations/supabase/client.ts` | **DELETE** | Legacy Supabase client is 100% superseded by `src/lib/api/` and `src/integrations/sockets/`. |
| `src/integrations/supabase/types.ts` | **DELETE** | Legacy Supabase Database types replaced by typed API contracts in `src/lib/api/types.ts`. |
| `supabase/` | **RELOCATE** to `deploy/archive/supabase-legacy/` | Retains full historical audit trail while purging Supabase from the active source tree. |

---

## 6. Detailed Technical Specifications

### 6.1 Scheduled Expired-Request Background Job (`request-cleanup.job.ts`)
```typescript
export class RequestCleanupJob {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly requestService: RequestService,
    private readonly intervalMs: number = 60 * 60 * 1000 // 1 hour
  ) {}

  start(): void {
    if (this.timer) return;
    logger.info('[RequestCleanupJob] Initializing background request cleanup worker...');
    this.timer = setInterval(() => this.execute(), this.intervalMs);
    // Unref timer so it does not hold the Node.js event loop open during shutdown
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[RequestCleanupJob] Request cleanup worker stopped.');
    }
  }

  async execute(): Promise<number> {
    if (this.isRunning) {
      logger.warn('[RequestCleanupJob] Previous run still active, skipping cycle.');
      return 0;
    }
    this.isRunning = true;
    try {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const cutoffDate = twoDaysAgo.toISOString().split('T')[0];

      const count = await this.requestService.cleanupExpiredRequests('system-cron', cutoffDate);
      if (count > 0) {
        logger.info(`[RequestCleanupJob] Cleaned up ${count} expired requests past cutoff ${cutoffDate}.`);
      }
      return count;
    } catch (error) {
      logger.error('[RequestCleanupJob] Execution error during request cleanup:', error);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }
}
```

### 6.2 Realtime Request & Companion Event Dispatching
1. **Event Payloads**:
   * `request:new`: Dispatched to `user:<toUserId>` when an incoming request is created.
   * `request:updated`: Dispatched to `user:<fromUserId>` and `user:<toUserId>` when a request status changes (`accepted`, `rejected`, `cancelled`).
   * `companions:updated`: Dispatched to both participants when a request transitions to `accepted`.
2. **Zero-Overhead Subscriptions**: Client components subscribe to these events via their existing authenticated Socket.IO connection (`src/integrations/sockets/socket.ts`), triggering immediate local cache invalidation.

---

## 7. Verification & Testing Strategy

### 7.1 Automated CI/CD & Build Validation
1. **Dependency Decommissioning Verification**:
   * `npm run build` (Vite) compiles cleanly with zero errors.
   * `npm run lint` (ESLint) reports 0 errors and 0 warnings.
   * `git grep "@supabase"` confirms zero active code references outside `deploy/archive/`.
2. **Backend Test Suite**:
   * Run full backend test suite: `npm test` in `backend/` (must pass 100% of 74+ test files, 640+ tests).
   * Backend typecheck, lint, format check, and Docker build must pass cleanly.
3. **Security Audit**:
   * Production runtime audit: `npm audit --omit=dev --omit=optional --audit-level=high` reports **0 vulnerabilities**.

### 7.2 Canary Invariant Verification (`authz-probe.ts`)
Run the canary probe suite against the running API:
```bash
API_URL="http://localhost:3000" npx tsx monitoring/authz-probe.ts
```
Expected output:
* `✓ PASSED [INV-1: Health Endpoint]`
* `✓ PASSED [INV-2: Unauthenticated Endpoint Gate]`
* `✓ PASSED [INV-3: Stranger Profile Existence Masking]`
* `✓ PASSED [INV-4: Conversation & Message Isolation]`
* `ALL INVARIANTS SATISFIED (4/4 probes passed)`

### 7.3 Canonical 12-Flow E2E Suite (`e2e/m13-all-flows.spec.ts`)
Execute the full Playwright suite:
```bash
npx playwright test e2e/m13-all-flows.spec.ts
```
Verifies:
* Flow 1: Registration & confirmation
* Flow 2: Profile setup & avatar upload
* Flow 3: Journey creation & train autocomplete
* Flow 4: Companion matching & filter parity
* Flow 5: Companion request send, accept & reject
* Flow 6: Atomic conversation creation
* Flow 7: Realtime messaging & sender echo
* Flow 8: Read receipts & delivered badges
* Flow 9: Attachments upload & download
* Flow 10: Soft delete conversation
* Flow 11: Mutual blocking enforcement
* Flow 12: User safety reporting

---

## 8. Rollback Considerations

1. **Git Reversion**:
   * If removing `@supabase/supabase-js` causes unforeseen regressions, git revert restores the legacy files instantly.
2. **Dual-Path Capability**:
   * The client adapter design in `src/lib/api/` isolates network calls; if a fallback is needed, the API URL or client endpoint can be redirected via environment configuration without modifying frontend component source code.
3. **Database Independence**:
   * Database data resides in PostgreSQL; removing client-side Supabase references has zero impact on persisted user records, journeys, or messages.

---

## 9. Milestone 15 Exit Checklist & Acceptance Criteria

- [ ] `@supabase/supabase-js` completely removed from root `package.json` and lockfile.
- [ ] `src/integrations/supabase/client.ts` and `src/integrations/supabase/types.ts` removed.
- [ ] Legacy Supabase environment variables purged from `.env` and `.env.example`.
- [ ] `supabase/` migrations safely archived to `deploy/archive/supabase-legacy/`.
- [ ] Automated background request cleanup worker implemented and verified.
- [ ] Realtime request and companion status events (`companions:updated`, `request:updated`) implemented and verified.
- [ ] Frontend build (`npm run build`), lint, and format check pass 100% clean.
- [ ] Backend test suite (all 633+ existing + new job tests) passes 100% green.
- [ ] `monitoring/authz-probe.ts` passes all invariant checks.
- [ ] Canonical E2E suite passes all flows.
- [ ] Production runtime `npm audit` reports 0 high/critical vulnerabilities.
- [ ] **Zero Open Questions Remaining** — Fully aligned with governing roadmap.

---

## 10. Open Architectural Decisions & Recommendations

| Decision Area | Options Evaluated | Governing Recommendation | Rationale |
| :--- | :--- | :--- | :--- |
| **Job Scheduling Mechanism** | A. In-process interval runner<br>B. Standalone CLI for external cron<br>C. Database `pg_cron` | **Hybrid A + B** | Allows seamless zero-dependency operation in local/test/single-container environments, while providing an executable CLI command for AWS EventBridge / ECS scheduled tasks in production. |
| **Supabase Migrations Retention** | A. Delete permanently<br>B. Archive to `deploy/archive/supabase-legacy/`<br>C. Leave in place with README | **Option B (Archive)** | Eliminates ambiguity over the active database schema (Prisma is authoritative) while preserving complete historical audit records. |
| **Reactive Request Updates** | A. Manual polling only<br>B. Socket.IO user room broadcast | **Option B (Socket.IO Broadcast)** | Eliminates the documented `requests-changes` realtime gap (Spec §13.1) with zero added polling overhead. |
