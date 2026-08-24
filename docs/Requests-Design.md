# TrainMate v2 — Milestone 9: Requests Lifecycle Design Document

**Status:** Approved Architecture Design  
**Date:** 2026-08-24  
**Module:** Travel Companion Requests Subsystem (`requests`, `RequestRepository`, `RequestService`, `RequestController`, `requests.routes`)  
**Governing Documents:**
- `docs/Backend-Specification.md` (§3.2, §4, §6.3, §6.12, §9.4, §10.4, §11.4, §11.7, §11.10, §11.12)
- `docs/Backend-Architecture.md` (§2.1, §3.1, §5.2, §8.2)
- `docs/Implementation-Roadmap.md` (Part I map §6.3, Part II Phase 9 lines 1306–1405)
- `docs/Design-Review-Report.md` (Findings F2-fc, F3-fc, F4-rls, S6/F10-rls, C2 email analysis)
- `docs/Moderation-Design.md` (M6 Symmetric blocking contract via `AccessService.isBlocked`)
- `docs/Profiles-Design.md` (M7 Contextual profile visibility & strict email privacy)
- `docs/Journeys-Design.md` (M8 Journey matching & `AccessService.usersShareJourney`)
- Historical Supabase Migrations (`20251212061640`, `20251217182641`, `20251226092210`, `20260106151017`, `20260703100726`, `20260716175301`, `20260725073436`)
- Frontend Consumers (`src/hooks/useRequests.ts`, `src/hooks/useAcceptedCompanions.ts`, `src/pages/Requests.tsx`, `src/pages/Matched.tsx`, `src/pages/Dashboard.tsx`, `src/lib/validations.ts`)

---

## 1. Executive Summary & Scope

Milestone 9 (Requests Lifecycle) implements the companion request state machine for TrainMate v2. 

Companion requests bridge passenger discovery (Milestone 8) and mutual private messaging (Milestone 10). When a passenger discovers potential companions on the exact same train and travel date, they dispatch a travel companion request. Once the recipient accepts the request, mutual communication is unlocked: contextual profile visibility is granted (M7), a conversation room can be initiated (M10), and real-time chat begins (M11/M12).

### 1.1 In-Scope Deliverables
1. **Database Schema & Migrations:**
   - `Request` Prisma model mapped to `public.requests`.
   - Database migration `20260828120000_add_requests_table` with CHECK constraints, foreign keys (`ON DELETE CASCADE` to `users`), updated-at trigger, and compound indexes.
2. **Repository Layer:**
   - `RequestRepository` (`src/repositories/requests.repo.ts`): Type-safe Prisma queries for request creation, retrieval by ID, sent/received queries with symmetric block exclusion, status updates, atomic cancellation, and atomic expired request deletion.
3. **Authorization & Visibility Engine Integration:**
   - Integration with `AccessService.usersShareJourney(senderId, receiverId, trainNumber, travelDate)` to enforce the RLS rule that companion requests can only be sent between users who share a journey on that train+date.
   - Integration with `AccessService.isBlocked(userA, userB)` and `AccessService.getSymmetricBlockedUserIds(userId)` to hide and reject requests between blocked users.
   - Integration with `AccessService.hasAcceptedRequest(userA, userB)` to fulfill contextual profile visibility (M7) and future conversation creation (M10).
4. **Service Layer:**
   - `RequestService` (`src/services/request.service.ts`): Encapsulates the entire request lifecycle (send with journey verification, accept, reject, cancel, expired-cleanup, accepted companions list, and incoming pending count badge).
5. **Serialization Layer:**
   - `RequestSerializer` (`src/serializers/request.serializer.ts`): Strict privacy transformation. Guarantees that neither sender nor recipient email is ever exposed in request payloads. Supports both camelCase and snake_case properties for full backward compatibility with frontend hooks.
6. **HTTP Boundary & Validation:**
   - Zod validation schemas (`src/validation/request.schemas.ts`).
   - `RequestController` (`src/controllers/request.controller.ts`).
   - Express router (`src/routes/requests.routes.ts`) mounting:
     - `GET /requests/me` (optional `?type=sent|received|all`, default `all`)
     - `POST /requests`
     - `PATCH /requests/:id` (accept / reject)
     - `DELETE /requests/:id` (cancel pending request)
     - `POST /requests/cleanup-expired` (atomic sender-side pruning)
     - `GET /requests/me/accepted` (accepted companion pairs)
     - `GET /requests/incoming/pending-count` (dashboard bell badge count)
7. **Test Suites:**
   - Comprehensive unit test suites for repositories, serializers, services, validation schemas, controllers, and routes.
   - Database-backed integration tests (`test/integration/request.lifecycle.test.ts`) validating complete state transitions, atomic cancellation, single-query expired pruning, symmetric block filtering, and cascade behavior.

### 1.2 Explicit Non-Scope (Future Milestones)
- **Conversations & Messaging (M10, M11):** Creating conversation rooms, message persistence, read receipts, and attachment presigning.
- **Realtime / WebSockets (M12):** Live broadcast of request notifications over Socket.IO (replaces the historical inert `requests-changes` channel).
- **Frontend Client Migration (M13):** Rewriting React frontend hooks to call the Express API client.

---

## 2. Governing Requirements & Historical Analysis

### 2.1 Historical Schema & Migrations Analysis
1. **`20251212061640` (Initial Schema):**
   - Created table `public.requests` with `(id, from_user_id, from_email, from_name, to_user_id, to_email, to_name, train_number, travel_date, boarding_station, destination_station, status, created_at, updated_at)`.
   - `status` constraint: `CHECK (status IN ('pending', 'accepted', 'rejected'))` with default `'pending'`.
   - Foreign keys: `from_user_id` and `to_user_id` reference `auth.users(id) ON DELETE CASCADE`.
   - Initial RLS policies:
     - SELECT: `auth.uid() = from_user_id OR auth.uid() = to_user_id`
     - INSERT: `auth.uid() = from_user_id`
     - UPDATE: `auth.uid() = to_user_id`
2. **`20251217182641` (Contextual Profile Access):**
   - Added index `idx_requests_status_users ON public.requests(status, from_user_id, to_user_id)`.
   - Updated `can_view_profile` to grant profile visibility if an accepted companion request exists between the pair (`status = 'accepted'`).
3. **`20251226092210` (Sender Cancellation Policy):**
   - Added RLS DELETE policy `"Users can delete their pending outgoing requests"`:
     `auth.uid() = from_user_id AND status = 'pending'`.
4. **`20260106151017` (Symmetric Moderation Enforcement):**
   - Updated INSERT policy: `auth.uid() = from_user_id AND NOT public.is_blocked(from_user_id, to_user_id)`.
   - Updated SELECT policy: `(auth.uid() = from_user_id OR auth.uid() = to_user_id) AND NOT public.is_blocked(from_user_id, to_user_id)`.
5. **`20260703100726` (Journey Verification Gate & Conversation Gating):**
   - Added `public.users_share_journey(a, b, train, tdate)` helper function.
   - Hardened INSERT policy: Required `auth.uid() = from_user_id AND from_user_id <> to_user_id AND NOT public.is_blocked(from_user_id, to_user_id) AND public.users_share_journey(from_user_id, to_user_id, train_number, travel_date)`.
   - Hardened `can_create_conversation` to require an accepted request matching the pair and optionally train/date.

### 2.2 Frontend Call-Site Analysis
The frontend interacts with requests across 4 key locations:
1. **`src/hooks/useRequests.ts`:**
   - `fetchRequests`: Queries `requests.select('*').or('from_user_id.eq.ME,to_user_id.eq.ME').order('created_at', { ascending: false })`.
   - `getRequestStatus(otherUserId, trainNumber?, travelDate?)`: Derives UI state (`'none' | 'outgoing_pending' | 'incoming_pending' | 'accepted' | 'rejected'`) by bidirectional matching on user pair and optional journey train+date.
   - `acceptRequest(id)`: Calls `requests.update({ status: 'accepted' }).eq('id', id)`.
   - `rejectRequest(id)`: Calls `requests.update({ status: 'rejected' }).eq('id', id)`.
   - `cancelRequest(id)`: Calls `requests.delete().eq('id', id)` (hard delete).
   - `cleanupExpiredRequests()`: Calculates `cutoff = today - 2 days`, selects expired pending requests, and deletes them.
2. **`src/hooks/useAcceptedCompanions.ts`:**
   - Fetches accepted requests sent (`from_user_id = ME, status = 'accepted'`) and received (`to_user_id = ME, status = 'accepted'`), merging them into a unique list of accepted companions.
3. **`src/pages/Matched.tsx`:**
   - Dispatches `POST /requests` when clicking "Send Request". Payload contains exactly 9 fields: `from_user_id, from_name, to_user_id, to_name, train_number, travel_date, boarding_station, destination_station, status='pending'`.
4. **`src/pages/Dashboard.tsx`:**
   - Fetches pending incoming requests head count (`to_user_id = ME, status = 'pending'`) to display the unread request badge over the bell icon.

---

## 3. Database Schema & Prisma Model

### 3.1 Prisma Schema Definition
Add the `Request` model and relation fields to `backend/prisma/schema.prisma`:

```prisma
/// Companion connection request and lifecycle state machine (Spec §3.2, §6.3, §9.4; Roadmap Phase 9).
/// Enforces status transition from pending to accepted or rejected.
/// Foreign keys link to users table with ON DELETE CASCADE.
model Request {
  id                 String   @id @default(uuid()) @db.Uuid
  fromUserId         String   @map("from_user_id") @db.Uuid
  fromEmail          String?  @map("from_email")
  fromName           String?  @map("from_name")
  toUserId           String   @map("to_user_id") @db.Uuid
  toEmail            String?  @map("to_email")
  toName             String?  @map("to_name")
  trainNumber        String?  @map("train_number")
  travelDate         DateTime? @map("travel_date") @db.Date
  boardingStation    String?  @map("boarding_station")
  destinationStation String?  @map("destination_station")
  status             String   @default("pending")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  fromUser User @relation("RequestsSent", fields: [fromUserId], references: [id], onDelete: Cascade)
  toUser   User @relation("RequestsReceived", fields: [toUserId], references: [id], onDelete: Cascade)

  @@index([fromUserId])
  @@index([toUserId])
  @@index([status])
  @@index([status, fromUserId, toUserId])
  @@index([toUserId, status])
  @@map("requests")
}
```

Update the `User` model with the opposite relation fields:
```prisma
model User {
  // ... existing fields ...
  requestsSent     Request[] @relation("RequestsSent")
  requestsReceived Request[] @relation("RequestsReceived")
}
```

### 3.2 SQL Migration DDL (`20260828120000_add_requests_table/migration.sql`)

```sql
-- Create requests table
CREATE TABLE IF NOT EXISTS "requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_user_id" UUID NOT NULL,
    "from_email" TEXT,
    "from_name" TEXT,
    "to_user_id" UUID NOT NULL,
    "to_email" TEXT,
    "to_name" TEXT,
    "train_number" TEXT,
    "travel_date" DATE,
    "boarding_station" TEXT,
    "destination_station" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_requests_status" CHECK ("status" IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT "check_requests_from_name_length" CHECK ("from_name" IS NULL OR char_length("from_name") <= 100),
    CONSTRAINT "check_requests_to_name_length" CHECK ("to_name" IS NULL OR char_length("to_name") <= 100),
    CONSTRAINT "check_requests_train_number_length" CHECK ("train_number" IS NULL OR char_length("train_number") <= 20),
    CONSTRAINT "check_requests_boarding_station_length" CHECK ("boarding_station" IS NULL OR char_length("boarding_station") <= 200),
    CONSTRAINT "check_requests_destination_station_length" CHECK ("destination_station" IS NULL OR char_length("destination_station") <= 200),
    CONSTRAINT "check_requests_no_self_request" CHECK ("from_user_id" <> "to_user_id")
);

-- Foreign key constraints with CASCADE deletion
ALTER TABLE "requests"
    ADD CONSTRAINT "requests_from_user_id_fkey"
    FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "requests"
    ADD CONSTRAINT "requests_to_user_id_fkey"
    FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Performance indexes
CREATE INDEX IF NOT EXISTS "idx_requests_from_user" ON "requests"("from_user_id");
CREATE INDEX IF NOT EXISTS "idx_requests_to_user" ON "requests"("to_user_id");
CREATE INDEX IF NOT EXISTS "idx_requests_status" ON "requests"("status");
CREATE INDEX IF NOT EXISTS "idx_requests_status_users" ON "requests"("status", "from_user_id", "to_user_id");
CREATE INDEX IF NOT EXISTS "idx_requests_to_user_status" ON "requests"("to_user_id", "status");

-- Trigger for automatic updated_at timestamp management
CREATE OR REPLACE FUNCTION update_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_requests_updated_at ON "requests";
CREATE TRIGGER trg_update_requests_updated_at
BEFORE UPDATE ON "requests"
FOR EACH ROW
EXECUTE FUNCTION update_requests_updated_at();
```

---

## 4. Request Lifecycle & State Machine

### 4.1 State Machine Diagram

```
                 [ User A discovers User B on Journey ]
                                  │
                                  ▼ (POST /requests)
                           ┌─────────────┐
                           │   PENDING   │ ◄──────────────────────────────┐
                           └──────┬──────┘                                │
                                  │                                       │
            ┌─────────────────────┼─────────────────────┐                 │
            │                     │                     │                 │
            ▼ (Recipient Accept)  ▼ (Recipient Reject)  ▼ (Sender Cancel) │
     ┌─────────────┐       ┌─────────────┐       ┌─────────────┐          │
     │  ACCEPTED   │       │  REJECTED   │       │   DELETED   │          │
     └──────┬──────┘       └──────┬──────┘       │  (Canceled) │          │
            │                     │              └─────────────┘          │
            │                     │                                       │
            ▼                     └───────── [ Sender can re-request ] ───┘
[ Unlocks Chat (M10) & ]
[ Profile View (M7)    ]
```

### 4.2 State Transition Table

| Current State | Action / Endpoint | Caller Role | New State | Conditions & Invariants | Error Code on Failure |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **None** | `POST /requests` | Sender (`from_user_id`) | `pending` | `from !== to`, `!isBlocked`, `usersShareJourney == true`, no active pending request | `400 VALIDATION_ERROR`, `400 NO_MATCHING_JOURNEY`, `409 REQUEST_ALREADY_PENDING` |
| **Pending** | `PATCH /requests/:id` (`status='accepted'`) | Recipient (`to_user_id`) | `accepted` | Caller is `to_user_id`, `!isBlocked` | `403 FORBIDDEN` (or `404 USER_NOT_FOUND` on block), `400 INVALID_STATE_TRANSITION` |
| **Pending** | `PATCH /requests/:id` (`status='rejected'`) | Recipient (`to_user_id`) | `rejected` | Caller is `to_user_id` | `403 FORBIDDEN`, `400 INVALID_STATE_TRANSITION` |
| **Pending** | `DELETE /requests/:id` | Sender (`from_user_id`) | *Row Deleted* | Caller is `from_user_id`, `status === 'pending'` | `404 NOT_FOUND` (masks existence if not owner/non-pending) |
| **Pending** | `POST /requests/cleanup-expired` | Sender (`from_user_id`) | *Rows Deleted* | Caller is `from_user_id`, `travel_date < cutoff` | `200 OK` `{ count: n }` |
| **Accepted** | `PATCH /requests/:id` | Any | — | Transition not allowed (terminal state) | `400 INVALID_STATE_TRANSITION` |
| **Accepted** | `DELETE /requests/:id` | Any | — | Cancellation not allowed | `404 NOT_FOUND` |
| **Rejected** | `POST /requests` | Sender (`from_user_id`) | `pending` | Allowed: Re-requesting after rejection creates a fresh row | `201 CREATED` |
| **Rejected** | `PATCH /requests/:id` | Any | — | Transition not allowed (terminal state) | `400 INVALID_STATE_TRANSITION` |

---

## 5. Authorization & Visibility Engine (`AccessService`)

### 5.1 RLS-to-Service Mapping Matrix

| Supabase RLS Policy / Helper | Operations | Express Service Implementation | Verification Method |
| :--- | :--- | :--- | :--- |
| `Users can create requests` | `INSERT` | `RequestService.sendRequest`: enforces `req.user.id === fromUserId`, `fromUserId !== toUserId`, `!AccessService.isBlocked`, and `AccessService.usersShareJourney`. | Unit & Integration Test |
| `Users can view requests they sent or received` | `SELECT` | `RequestRepository.findUserRequests`: queries `where: { OR: [{ fromUserId: me }, { toUserId: me }] }` and filters out all pairs in `AccessService.getSymmetricBlockedUserIds(me)`. | Unit & Integration Test |
| `Users can update requests they received` | `UPDATE` | `RequestService.updateRequestStatus`: verifies `req.user.id === request.toUserId`, checks `status === 'pending'`, and ensures neither user is blocked. | Unit & Integration Test |
| `Users can delete their pending outgoing requests` | `DELETE` | `RequestService.cancelRequest`: executes atomic delete matching `id`, `fromUserId = me`, and `status = 'pending'`. Returns 404 if row does not match. | Unit & Integration Test |
| `can_view_profile` accepted request arm | `SELECT profiles` | `AccessService.hasAcceptedRequest(userA, userB)` queries the real `requests` table for `status = 'accepted'`. | M7/M9 Joint Integration Test |
| `can_create_conversation` accepted request gate | `INSERT conversations` | `RequestRepository.findAcceptedRequestBetween(userA, userB, trainNumber?, travelDate?)` provides the query seam for M10. | M9/M10 Seam Unit Test |

### 5.2 Symmetric Block Exclusion Semantics
- If User A blocks User B, or User B blocks User A:
  1. `POST /requests` between A and B is immediately rejected (`400 USER_BLOCKED` or `404 USER_NOT_FOUND`).
  2. `GET /requests/me` and `GET /requests/me/accepted` filter out all records between A and B in both directions.
  3. `GET /requests/incoming/pending-count` excludes requests from blocked users.
  4. Any attempt to accept a pending request after a block was placed fails with `404 NOT_FOUND` / `403 FORBIDDEN`.

### 5.3 Existence Probing Resistance
- If an unauthorized user attempts to `PATCH` or `DELETE` a request they do not own or are not the intended recipient of, the service throws `NotFoundError` (returning HTTP `404 NOT_FOUND`), masking whether the target `requestId` exists in the system.

---

## 6. Repository Layer Contracts (`RequestRepository`)

File: `backend/src/repositories/requests.repo.ts`

```typescript
export interface CreateRequestInput {
  fromUserId: string;
  fromEmail?: string | null;
  fromName?: string | null;
  toUserId: string;
  toEmail?: string | null;
  toName?: string | null;
  trainNumber?: string | null;
  travelDate?: Date | null;
  boardingStation?: string | null;
  destinationStation?: string | null;
  status?: string;
}

export interface FindUserRequestsOptions {
  userId: string;
  type?: 'sent' | 'received' | 'all';
  status?: string;
  excludedUserIds?: Set<string>;
}

export class RequestRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** Creates a new companion request record */
  async create(input: CreateRequestInput): Promise<Request>;

  /** Finds a single request by its primary key ID */
  async findById(id: string): Promise<Request | null>;

  /** Finds all requests for a user with type filtering and blocked ID exclusions */
  async findUserRequests(options: FindUserRequestsOptions): Promise<Request[]>;

  /** Finds all accepted requests involving a user (sent or received) excluding blocked IDs */
  async findAcceptedRequestsForUser(userId: string, excludedUserIds?: Set<string>): Promise<Request[]>;

  /** Finds an active pending request between two users for a specific train and travel date */
  async findActivePendingBetween(
    fromUserId: string,
    toUserId: string,
    trainNumber?: string | null,
    travelDate?: Date | null,
  ): Promise<Request | null>;

  /** Checks if an accepted request exists between two users (for M7 profile access & M10 conversations) */
  async findAcceptedRequestBetween(
    userA: string,
    userB: string,
    trainNumber?: string | null,
    travelDate?: Date | null,
  ): Promise<Request | null>;

  /** Counts incoming pending requests for badge count, excluding blocked senders */
  async countIncomingPending(toUserId: string, excludedUserIds?: Set<string>): Promise<number>;

  /** Updates request status atomically (e.g. pending -> accepted or rejected) */
  async updateStatus(id: string, status: 'accepted' | 'rejected'): Promise<Request>;

  /** Atomically cancels/deletes a pending request owned by fromUserId */
  async deletePendingByIdAndOwner(id: string, fromUserId: string): Promise<boolean>;

  /** Atomically deletes expired pending requests sent by a user prior to cutoff date */
  async deleteExpiredPending(fromUserId: string, cutoffDate: Date): Promise<number>;
}
```

---

## 7. Service Layer Contracts & Business Logic (`RequestService`)

File: `backend/src/services/request.service.ts`

```typescript
export interface RequestServiceDeps {
  requestsRepo?: RequestRepository;
  accessService?: AccessService;
  db?: PrismaClient;
}

export class RequestService {
  constructor(deps: Partial<RequestServiceDeps> = {}) {}

  /**
   * Dispatches a new companion request (POST /requests).
   * 
   * Validation & Business Rules:
   * 1. fromUserId must equal callerId.
   * 2. fromUserId !== toUserId (cannot request self).
   * 3. Must not be blocked (isBlocked(from, to) === false).
   * 4. Users must share a journey on trainNumber + travelDate (AccessService.usersShareJourney).
   * 5. Checks if an active pending request already exists between the pair (returns 409 CONFLICT).
   * 6. Creates request with status='pending'.
   */
  async sendRequest(callerId: string, input: CreateRequestDto): Promise<Request>;

  /**
   * Retrieves all requests for the caller (GET /requests/me).
   * Filters by type ('all' | 'sent' | 'received') and excludes all symmetrically blocked users.
   */
  async listUserRequests(callerId: string, type: 'all' | 'sent' | 'received' = 'all'): Promise<Request[]>;

  /**
   * Retrieves all accepted requests for the caller (GET /requests/me/accepted).
   * Excludes symmetrically blocked users.
   */
  async listAcceptedRequests(callerId: string): Promise<Request[]>;

  /**
   * Returns the count of incoming pending requests for the Dashboard bell badge (GET /requests/incoming/pending-count).
   */
  async getIncomingPendingCount(callerId: string): Promise<number>;

  /**
   * Updates request status to 'accepted' or 'rejected' (PATCH /requests/:id).
   * 
   * Business Rules:
   * 1. Caller must be the recipient (toUserId === callerId).
   * 2. Request must currently be in 'pending' status.
   * 3. Caller and sender must not be blocked.
   * 4. Updates status and updated_at timestamp.
   */
  async updateStatus(callerId: string, requestId: string, newStatus: 'accepted' | 'rejected'): Promise<Request>;

  /**
   * Cancels an outgoing pending request (DELETE /requests/:id).
   * 
   * Business Rules:
   * 1. Caller must be the sender (fromUserId === callerId).
   * 2. Request must currently be in 'pending' status.
   * 3. Hard deletes the record.
   * 4. Returns 404 if record not found or caller is not sender or status !== 'pending'.
   */
  async cancelRequest(callerId: string, requestId: string): Promise<void>;

  /**
   * Prunes expired pending requests sent by caller (POST /requests/cleanup-expired).
   * 
   * Business Rules:
   * 1. Single atomic DELETE query (eliminates TOCTOU select-then-delete race).
   * 2. Only deletes requests where fromUserId === callerId, status === 'pending', and travelDate < cutoffDate.
   * 3. Defaults cutoffDate to (today - 2 days) if not provided.
   */
  async cleanupExpiredRequests(callerId: string, cutoffDate?: string): Promise<number>;
}
```

---

## 8. Serialization & Strict Privacy Rules (`RequestSerializer`)

File: `backend/src/serializers/request.serializer.ts`

### 8.1 Email Privacy Invariant
- Under **no circumstances** may any companion request endpoint return another user's email address.
- Historical columns `from_email` and `to_email` are excluded from the output serializer.
- If the authenticated caller is the sender or receiver, their own email is not emitted through the request record (own email is managed solely via `/auth` and `/profiles/me`).

### 8.2 Response DTO Structure
To guarantee 100% compatibility with existing frontend React hooks (`useRequests.ts`, `useAcceptedCompanions.ts`, `Matched.tsx`), the serializer outputs an object containing both standard camelCase and backward-compatible snake_case properties:

```typescript
export interface SerializedRequest {
  id: string;
  fromUserId: string;
  from_user_id: string;
  fromName: string | null;
  from_name: string | null;
  toUserId: string;
  to_user_id: string;
  toName: string | null;
  to_name: string | null;
  trainNumber: string | null;
  train_number: string | null;
  travelDate: string | null;
  travel_date: string | null;
  boardingStation: string | null;
  boarding_station: string | null;
  destinationStation: string | null;
  destination_station: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
}
```

---

## 9. Validation Schemas (`src/validation/request.schemas.ts`)

```typescript
import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Zod schema for sending a companion request (POST /requests) */
export const createRequestSchema = z.object({
  toUserId: z.string().regex(UUID_REGEX, 'toUserId must be a valid UUID').optional(),
  to_user_id: z.string().regex(UUID_REGEX, 'to_user_id must be a valid UUID').optional(),
  fromName: z.string().trim().max(100).optional().nullable(),
  from_name: z.string().trim().max(100).optional().nullable(),
  toName: z.string().trim().max(100).optional().nullable(),
  to_name: z.string().trim().max(100).optional().nullable(),
  trainNumber: z.string().trim().max(20).optional().nullable(),
  train_number: z.string().trim().max(20).optional().nullable(),
  travelDate: z.string().min(1, 'Travel date is required'),
  travel_date: z.string().min(1, 'travel_date is required').optional(),
  boardingStation: z.string().trim().max(200).optional().nullable(),
  boarding_station: z.string().trim().max(200).optional().nullable(),
  destinationStation: z.string().trim().max(200).optional().nullable(),
  destination_station: z.string().trim().max(200).optional().nullable(),
  status: z.literal('pending').optional(),
}).transform((data) => {
  const targetToUserId = data.toUserId ?? data.to_user_id;
  if (!targetToUserId) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['toUserId'],
        message: 'Recipient toUserId is required',
      },
    ]);
  }

  const rawDate = data.travelDate ?? data.travel_date ?? '';
  const cleanDate = rawDate.split('T')[0] ?? '';
  if (!DATE_REGEX.test(cleanDate)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path: ['travelDate'],
        message: 'travelDate must be formatted as YYYY-MM-DD',
      },
    ]);
  }

  return {
    toUserId: targetToUserId,
    fromName: data.fromName ?? data.from_name ?? null,
    toName: data.toName ?? data.to_name ?? null,
    trainNumber: (data.trainNumber ?? data.train_number)?.trim() || null,
    travelDate: cleanDate,
    boardingStation: (data.boardingStation ?? data.boarding_station)?.trim() || null,
    destinationStation: (data.destinationStation ?? data.destination_station)?.trim() || null,
  };
});

/** Zod schema for updating request status (PATCH /requests/:id) */
export const updateRequestStatusSchema = z.object({
  status: z.enum(['accepted', 'rejected'], {
    errorMap: () => ({ message: "Status must be either 'accepted' or 'rejected'" }),
  }),
});

/** Zod schema for request parameters (:id) */
export const requestIdParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'Request ID must be a valid UUID'),
});

/** Zod schema for listing query parameters (GET /requests/me?type=) */
export const listRequestsQuerySchema = z.object({
  type: z.enum(['all', 'sent', 'received']).default('all').optional(),
});

/** Zod schema for expired cleanup (POST /requests/cleanup-expired) */
export const cleanupExpiredRequestsSchema = z.object({
  cutoffDate: z.string().regex(DATE_REGEX, 'cutoffDate must be YYYY-MM-DD').optional(),
  cutoff_date: z.string().regex(DATE_REGEX, 'cutoff_date must be YYYY-MM-DD').optional(),
}).transform((data) => ({
  cutoffDate: data.cutoffDate ?? data.cutoff_date,
}));
```

---

## 10. HTTP Boundary & Endpoint Contracts

All routes require authentication via `authenticate` middleware (`Authorization: Bearer <token>`).

### 10.1 `GET /requests/me`
- **Description:** Returns the authenticated user's requests, filtered by type and excluding blocked users.
- **Query Parameters:** `type` (`all` | `sent` | `received`, default: `all`).
- **Response `200 OK`:**
  ```json
  [
    {
      "id": "c1f7a40b-e448-4c8d-862d-9477b7f2b189",
      "fromUserId": "550e8400-e29b-41d4-a716-446655440000",
      "from_user_id": "550e8400-e29b-41d4-a716-446655440000",
      "fromName": "Aarav Sharma",
      "from_name": "Aarav Sharma",
      "toUserId": "660e8400-e29b-41d4-a716-446655440001",
      "to_user_id": "660e8400-e29b-41d4-a716-446655440001",
      "toName": "Priya Patel",
      "to_name": "Priya Patel",
      "trainNumber": "12951",
      "train_number": "12951",
      "travelDate": "2026-09-15",
      "travel_date": "2026-09-15",
      "boardingStation": "Mumbai Central",
      "boarding_station": "Mumbai Central",
      "destinationStation": "New Delhi",
      "destination_station": "New Delhi",
      "status": "pending",
      "createdAt": "2026-08-24T12:00:00.000Z",
      "created_at": "2026-08-24T12:00:00.000Z",
      "updatedAt": "2026-08-24T12:00:00.000Z",
      "updated_at": "2026-08-24T12:00:00.000Z"
    }
  ]
  ```

### 10.2 `POST /requests`
- **Description:** Sends a new companion request.
- **Request Body (supports both camelCase and snake_case):**
  ```json
  {
    "to_user_id": "660e8400-e29b-41d4-a716-446655440001",
    "from_name": "Aarav Sharma",
    "to_name": "Priya Patel",
    "train_number": "12951",
    "travel_date": "2026-09-15",
    "boarding_station": "Mumbai Central",
    "destination_station": "New Delhi"
  }
  ```
- **Response `201 Created`:** Serialized request object.
- **Errors:**
  - `400 VALIDATION_ERROR`: Missing or invalid input.
  - `400 NO_MATCHING_JOURNEY`: Sender and recipient do not share a journey on the specified train and date.
  - `400 USER_BLOCKED` / `404 USER_NOT_FOUND`: Blocking relationship exists between sender and recipient.
  - `409 REQUEST_ALREADY_PENDING`: An active pending request already exists for this journey.

### 10.3 `PATCH /requests/:id`
- **Description:** Accepts or rejects an incoming companion request. Recipient only.
- **Request Body:**
  ```json
  {
    "status": "accepted"
  }
  ```
- **Response `200 OK`:** Serialized request object with updated status.
- **Errors:**
  - `400 INVALID_STATE_TRANSITION`: Request is not in `pending` status.
  - `404 NOT_FOUND`: Request does not exist, or caller is not the recipient (`to_user_id`).

### 10.4 `DELETE /requests/:id`
- **Description:** Cancels an outgoing pending companion request. Sender only.
- **Response `204 No Content`**
- **Errors:**
  - `404 NOT_FOUND`: Request does not exist, status is not `pending`, or caller is not the sender (`from_user_id`).

### 10.5 `POST /requests/cleanup-expired`
- **Description:** Prunes expired pending requests sent by the caller where `travel_date < cutoffDate`.
- **Request Body (Optional):**
  ```json
  {
    "cutoff_date": "2026-09-13"
  }
  ```
- **Response `200 OK`:**
  ```json
  {
    "count": 3
  }
  ```

### 10.6 `GET /requests/me/accepted`
- **Description:** Returns all accepted requests involving the caller (sent or received), excluding blocked pairs.
- **Response `200 OK`:** Array of serialized accepted request objects.

### 10.7 `GET /requests/incoming/pending-count`
- **Description:** Returns count of incoming pending requests for Dashboard bell badge.
- **Response `200 OK`:**
  ```json
  {
    "count": 2
  }
  ```

---

## 11. Transaction Boundaries, Atomicity & Race Condition Handling

1. **Atomic Request Status Transition:**
   - When a recipient calls `PATCH /requests/:id` to accept/reject, the update query includes `WHERE id = :id AND to_user_id = :callerId AND status = 'pending'`.
   - If the sender concurrently cancels the request, the update touches 0 rows and returns `404 NOT_FOUND` / `400 INVALID_STATE_TRANSITION` cleanly.
2. **Single-Query Expired Cleanup (TOCTOU Race Elimination):**
   - Historical frontend (`useRequests.ts:155-189`) performed a SELECT then a DELETE `.in('id', ids)`.
   - `RequestService.cleanupExpiredRequests` executes a single atomic query:
     `DELETE FROM requests WHERE from_user_id = :callerId AND status = 'pending' AND travel_date < :cutoffDate`.
   - No rows can be accepted or modified in the gap between reading and deleting.
3. **Stale `localStorage` Journey Data Race:**
   - In `Matched.tsx`, users click "Send Request" based on cached matches. If the sender deleted their journey in the interim, `sendRequest` validates against the live database via `AccessService.usersShareJourney`. If the journey row no longer exists, the API rejects the insert with `400 NO_MATCHING_JOURNEY` and clear error details.

---

## 12. Cascade & Foreign Key Semantics

1. **User Account Deletion:**
   - `from_user_id` and `to_user_id` have `ON DELETE CASCADE` constraints referencing `users(id)`.
   - Deleting a user account completely purges all requests sent or received by that user from the database.
2. **Journey Deletion Independence:**
   - Requests store denormalized `train_number` and `travel_date` as values, without a foreign key to `journeys(id)`.
   - This design deliberately preserves historical accepted request records and companion connections even if a user subsequently archives or deletes their specific journey plan.

---

## 13. Cross-Milestone Interactions & Seams

1. **Milestone 6 (Moderation):**
   - `RequestService` invokes `AccessService.isBlocked` and `AccessService.getSymmetricBlockedUserIds` to ensure blocked users cannot send, receive, or view requests.
2. **Milestone 7 (Profiles):**
   - `AccessService.canViewProfile` includes the accepted request arm (`hasAcceptedRequest`).
   - In M9, `AccessService.hasAcceptedRequest` queries the live `requests` table. Once a request is accepted, mutual public profile visibility is unlocked.
3. **Milestone 8 (Journeys):**
   - `RequestService.sendRequest` invokes `AccessService.usersShareJourney`, which checks that both sender and recipient have matching active journeys on that train number and date.
4. **Milestone 10 (Conversations):**
   - M10 conversation creation requires an accepted companion request between the participants (`canCreateConversation`).
   - `RequestRepository.findAcceptedRequestBetween` will serve as the exact query seam consumed by M10 `ConversationService`.

---

## 14. Testing Strategy

### 14.1 Unit Tests
- `RequestRepository` (`backend/test/repositories/requests.repo.test.ts`):
  - CRUD operations, type filtering (`sent`, `received`, `all`), blocked ID exclusion, duplicate detection, atomic deletion by owner.
- `RequestSerializer` (`backend/test/serializers/request.serializer.test.ts`):
  - Stripping emails, mapping both camelCase and snake_case properties, date formatting.
- `RequestService` (`backend/test/services/request.service.test.ts`):
  - Validating journey sharing before send, self-request rejection, block check rejection, recipient-only accept/reject, sender-only cancel, single-query expired pruning.
- `RequestValidation` (`backend/test/validation/request.schemas.test.ts`):
  - Validating request creation inputs, status enums, UUID parameters, and cutoff date formatting.
- `RequestController` & Routes (`backend/test/controllers/request.controller.test.ts`, `backend/test/routes/requests.routes.test.ts`):
  - HTTP status codes (200, 201, 204, 400, 401, 403, 404, 409), authentication headers, input payload transformation.

### 14.2 Database-Backed Integration Tests (`backend/test/integration/request.lifecycle.test.ts`)
1. **Complete Request Lifecycle:** User A sends request to User B -> B lists incoming pending -> B accepts -> status transitions to `accepted`.
2. **Rejection Lifecycle & Re-Requesting:** User A sends request to User B -> B rejects -> A sends fresh request -> B accepts.
3. **Sender Cancellation:** User A sends request -> A cancels (`DELETE /requests/:id`) -> row is deleted -> non-owner cannot cancel (404).
4. **Journey Gate Enforcement:** User A attempts to request User B without a matching journey on that train+date -> rejected with `400 NO_MATCHING_JOURNEY`.
5. **Symmetric Blocking:** User A blocks User B -> pending requests between them disappear from `GET /requests/me` -> new requests between them fail -> unblock restores visibility.
6. **Atomic Expired Cleanup:** User A has pending requests with past travel dates -> `POST /requests/cleanup-expired` deletes only past pending requests in a single atomic operation.
7. **Incoming Pending Badge Count:** Verifies `GET /requests/incoming/pending-count` matches exact pending count and excludes blocked users.
8. **Cascade Deletion:** Deleting a user account cascade-deletes all sent and received request rows.

---

## 15. Decision Log

1. **Why exclude `from_email` and `to_email` from responses?**  
   *Decision:* The serializer never returns email addresses.  
   *Rationale:* User email privacy is a primary architectural invariant (Spec §6.12, Findings C2/S6). Historical Supabase columns `from_email`/`to_email` are kept nullable in DB for schema parity but never populated or exposed.

2. **Why provide an atomic `POST /requests/cleanup-expired` endpoint?**  
   *Decision:* Provide a dedicated backend endpoint executing a single `DELETE WHERE` query.  
   *Rationale:* The frontend hook `useRequests.ts` previously executed a SELECT then DELETE, introducing a TOCTOU race condition (Finding F4). A single atomic query guarantees consistency.

3. **Why allow re-requesting after a rejection?**  
   *Decision:* Rejection marks that specific request row as `rejected`, but does not permanently ban the user from re-requesting (Spec §9.4).  
   *Rationale:* Travel plans and contexts evolve; permanent blocking is reserved for the Moderation subsystem (M6).

4. **Why denormalize train number and travel date on requests instead of referencing `journey_id`?**  
   *Decision:* Store `train_number` and `travel_date` directly on `requests`.  
   *Rationale:* Maintains parity with the Supabase schema and ensures companion connection history remains intact even if a passenger later deletes their journey plan after the trip.

---

## 16. Deviations from Governing Documents

*None.* The design strictly adheres to `docs/Backend-Specification.md`, `docs/Backend-Architecture.md`, and `docs/Implementation-Roadmap.md`.

---

## 17. Assumptions & Open Questions

- **Assumptions:**
  - Frontend client continues to calculate local cutoff dates (today - 2 days) when calling cleanup, while backend safely defaults to server local date if cutoff is omitted.
  - WebSocket broadcast of request events remains deferred to M12 (Realtime), preserving current behavior where companion lists refresh on hook mount/navigation.
- **Open Questions:** None. All contracts, table structures, and lifecycle transitions are fully resolved from existing migrations and frontend code.
