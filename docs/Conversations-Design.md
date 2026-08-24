# Milestone 10 — CONVERSATIONS Design Specification

---

## 1. Governing Requirements & Executive Summary

### 1.1 Purpose & Role in TrainMate v2
Conversations serve as the private messaging aggregate and communication room in TrainMate v2. They connect passengers who have established a verified, mutual companion connection (Milestone 9 — Requests).

Once a companion request is accepted, either passenger can initiate a 1-to-1 conversation room. The conversation model persists conversation metadata, train and travel date context, participant identifiers, denormalized participant display names, last message preview metadata, and per-user soft-delete states (`deleted_for`).

### 1.2 Governing Documents
- **`docs/Backend-Specification.md`**: Schema definitions (§3.2), RLS rules (§6.4), business rules (§9.5), REST endpoints (§10.5), frontend call sites (§11.5, §11.11, §11.12).
- **`docs/Backend-Architecture.md`**: Conversation creation guard (§8.3), soft-delete mechanics (§8.5), tamper triggers (§9.1), indexes (§10).
- **`docs/Implementation-Roadmap.md`**: Phase 10 specification (lines 1413–1510), dependency tree, acceptance criteria.
- **`docs/Design-Review-Report.md`**: Findings F4 (participant names display-name only; strict email omission), F5 (`deleted_for` append-only permanence), F9 (server-side RLS replication), C3 (contextual profile visibility integration).
- **`docs/Requests-Design.md`**: Accepted companion request state machine and `AccessService.hasAcceptedRequest` contract.

---

## 2. Historical Supabase Migration Findings

Inspection of the historical Supabase migrations revealed the exact evolution of the conversations domain:

| Migration | Key DDL / Logic Changes | Governing Invariants Discovered |
|---|---|---|
| `20251212061640` | Initial `conversations` table: `id`, `participants uuid[]`, `participant_names jsonb`, `train_number text`, `travel_date date`, `last_message text`, `last_message_time timestamptz`, `created_at timestamptz`. Initial participant-based RLS. | 1-to-1 rooms with array-based participant tracking. |
| `20251215070131` | Added `deleted_for uuid[] DEFAULT '{}'`. Updated RLS SELECT to exclude `deleted_for` users (`NOT (auth.uid() = ANY(COALESCE(deleted_for, '{}')))`). | Per-user soft-delete mechanism. |
| `20251226092940` & `20251227090748` | Updated conversation UPDATE policy with `WITH CHECK (auth.uid() = ANY(participants))` to allow participants to modify conversation metadata. | Participant-only updates. |
| `20251227092113` | Added `soft_delete_conversation(conv_id, user_id_to_add)` `SECURITY DEFINER` function with duplicate guard. | Atomic append to `deleted_for` array. |
| `20260703100726` | Added `can_create_conversation(parts, train, tdate)` `SECURITY DEFINER` function requiring: 2 participants, caller included, distinct users, not blocked, and **an accepted request in `requests` table**. Added `prevent_conversation_tamper_trg` trigger blocking mutation of `participants`, `participant_names`, `train_number`, `travel_date`, `created_at`, `id`, and restricting `deleted_for` to `soft_delete_conversation()` via session config flag `app.allow_deleted_for_update`. | Hard database-level tamper prevention and strict companion request authorization gating. |
| `20260716175301` & `20260725073436` | Table privilege grants. | Service-layer security replication. |

---

## 3. Frontend Contract Findings

Inspection of `src/pages/Chats.tsx`, `src/pages/Matched.tsx`, `src/pages/Requests.tsx`, `src/hooks/useChat.tsx`, and `src/hooks/useAcceptedCompanions.ts` established the following frontend interactions:

1. **`useChat.tsx` — Conversation Listing (`fetchConversations`):**
   - Queries `conversations` where `participants.contains([user.id])`, ordered by `last_message_time DESC`.
   - Relies completely on backend filtering for `deleted_for` exclusion (Finding F9).
   - Consumes properties: `id`, `participants`, `participant_names`, `last_message`, `last_message_time`, `train_number`, `travel_date`.
2. **`useChat.tsx` / `Chats.tsx` — Conversation Creation (`createConversation`):**
   - Dispatches payload: `{ participants: [user.id, otherUserId], participant_names: { [userId]: name }, train_number, travel_date, last_message: '', last_message_time }`.
   - Before dispatching, fetches caller's display name from `profiles.name` so `participant_names` contains only display names (**never email**; Finding F4).
3. **`Chats.tsx` — Open Chat Navigation (`openChat`):**
   - Inspects locally loaded conversations; if one exists between the pair, reuses `conversation.id` without calling create.
   - If no conversation exists and users are not blocked, calls `createConversation` and navigates to `/chat/:id`.
4. **`useChat.tsx` — Soft Delete (`deleteChat`):**
   - Calls `soft_delete_conversation` RPC with `{ conv_id: conversationId, user_id_to_add: user.id }`.
   - On success, removes the conversation from local state.
   - **Permanence Invariant:** The conversation stays permanently hidden from the list; subsequent messages do NOT resurrect it in the conversation list (Finding F5). Direct navigation to `/chat/:id` remains accessible to participants for message reading.

---

## 4. Current Backend Dependency Analysis

1. **Milestone 6 (Moderation):** `AccessService.isBlocked(userA, userB)` is called before creating a conversation. Blocked pairs are strictly disallowed from creating new conversations.
2. **Milestone 7 (Profiles):** `AccessService.hasSharedConversation(userA, userB)` allows contextual profile visibility if a conversation contains both users. `participant_names` receives names from `Profile.name`.
3. **Milestone 8 (Journeys):** `train_number` and `travel_date` denormalized metadata reflect the journey context.
4. **Milestone 9 (Requests):** `canCreateConversation` checks `AccessService.hasAcceptedRequest(userA, userB)` against the `requests` table. A conversation cannot be created without an accepted request row between the participants.
5. **Downstream Milestone 11 (Messages):** Milestone 10 provides the parent `Conversation` entity that `Message` rows link to via foreign key `conversation_id`.

---

## 5. Database Schema Design (Prisma & DDL)

### 5.1 Prisma Schema Definition
```prisma
/// Conversation aggregate for 1-to-1 companion chat rooms (Spec §3.2, §6.4, §9.5; Roadmap Phase 10).
/// Immutable fields protected by service layer and database trigger.
model Conversation {
  id               String    @id @default(uuid()) @db.Uuid
  participants     String[]  @db.Uuid
  participantNames Json      @default("{}") @map("participant_names")
  trainNumber      String?   @map("train_number")
  travelDate       DateTime? @map("travel_date") @db.Date
  lastMessage      String?   @default("") @map("last_message")
  lastMessageTime  DateTime? @default(now()) @map("last_message_time") @db.Timestamptz(3)
  deletedFor       String[]  @default([]) @map("deleted_for") @db.Uuid
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  @@index([lastMessageTime(sort: Desc)])
  @@map("conversations")
}
```

### 5.2 SQL Migration (`20260830120000_add_conversations_table/migration.sql`)
```sql
-- Create conversations table
CREATE TABLE IF NOT EXISTS "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participants" UUID[] NOT NULL,
    "participant_names" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "train_number" TEXT,
    "travel_date" DATE,
    "last_message" TEXT DEFAULT '',
    "last_message_time" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_for" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_conversations_participants_length" CHECK (array_length("participants", 1) = 2),
    CONSTRAINT "check_conversations_participants_distinct" CHECK ("participants"[1] <> "participants"[2]),
    CONSTRAINT "check_conversations_train_number_length" CHECK ("train_number" IS NULL OR char_length("train_number") <= 20)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS "idx_conversations_participants" ON "conversations" USING GIN ("participants");
CREATE INDEX IF NOT EXISTS "idx_conversations_last_message_time" ON "conversations" ("last_message_time" DESC);

-- Tamper Prevention Function & Trigger
CREATE OR REPLACE FUNCTION prevent_conversation_tamper()
RETURNS trigger AS $$
BEGIN
  IF NEW.participants IS DISTINCT FROM OLD.participants
     OR NEW.participant_names IS DISTINCT FROM OLD.participant_names
     OR NEW.train_number IS DISTINCT FROM OLD.train_number
     OR NEW.travel_date IS DISTINCT FROM OLD.travel_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Modifying protected conversation fields is not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_conversation_tamper_trg ON "conversations";
CREATE TRIGGER prevent_conversation_tamper_trg
BEFORE UPDATE ON "conversations"
FOR EACH ROW EXECUTE FUNCTION prevent_conversation_tamper();
```

---

## 6. Authorization & Security Model

### 6.1 Security Invariants
1. **Authenticated Caller Identity:** `req.user.id` is the single source of truth. A caller cannot create a conversation on behalf of another user.
2. **Participant Membership Rule:** Exactly 2 distinct UUIDs. The caller MUST be one of the participants.
3. **Symmetric Blocking Gate:** If `AccessService.isBlocked(userA, userB)` is true, conversation creation is rejected with `400 USER_BLOCKED`.
4. **Accepted Companion Request Gate:** Conversation creation requires an accepted companion request (`status === 'accepted'`) between the two participants. If missing, rejected with `403 FORBIDDEN` / `NO_ACCEPTED_REQUEST`.
5. **Existence Masking:** Non-participants attempting to fetch (`GET /conversations/:id`) or soft-delete (`DELETE /conversations/:id/for-me`) receive `404 NOT_FOUND` to prevent existence probing.
6. **Immutable Fields Protection:**
   - Protected: `id`, `participants`, `participant_names`, `train_number`, `travel_date`, `created_at`.
   - Updatable (M10): `deleted_for` (via soft-delete endpoint).
   - Updatable (M11): `last_message`, `last_message_time` (via message dispatch internal bump).
7. **Strict Email Privacy Invariant:** `participant_names` contains only display names (`profiles.name`). Email addresses are NEVER stored in or returned from conversation endpoints.

---

## 7. Conversation Lifecycle State Machine

```
[ Request Accepted (M9) ]
           │
           ▼
 [ POST /conversations ] ──(canCreateConversation: 2 users, caller included, !blocked, accepted req)
           │
           ▼
 ┌───────────────────────────────────────────────────────────┐
 │               Active Conversation Room                   │
 │  - Listed in GET /conversations (caller ∉ deleted_for)    │
 │  - Message sending active (M11)                           │
 │  - Contextual profile visibility active (M7)             │
 └───────────────────────────────────────────────────────────┘
           │
           ├───► [ DELETE /conversations/:id/for-me ]
           │        │
           │        ▼
           │  ┌──────────────────────────────────────────────┐
           │  │      Soft-Deleted for Caller                 │
           │  │  - Hidden from caller's GET /conversations   │
           │  │  - Permanent: never auto-unhides             │
           │  │  - Direct /chat/:id remains readable         │
           │  └──────────────────────────────────────────────┘
           │
           └───► [ User Account Deleted (Cascade) ]
                    │
                    ▼
              (Hard CASCADE Deletion)
```

---

## 8. REST API Specification

### 8.1 Endpoints Overview

| Method | Path | Auth | Middleware / Validation | Description |
|---|---|---|---|---|
| `GET` | `/conversations` | Required | None | Lists active conversations for caller (excluding `deleted_for`) |
| `GET` | `/conversations/:id` | Required | `validateParams(conversationIdParamSchema)` | Retrieves conversation details for participant |
| `POST` | `/conversations` | Required | `validateBody(createConversationSchema)` | Creates or idempotently retrieves conversation for accepted companions |
| `DELETE` | `/conversations/:id/for-me` | Required | `validateParams(conversationIdParamSchema)` | Per-user soft-delete (appends caller to `deleted_for`) |

---

### 8.2 Endpoint Details & Contracts

#### 1. `GET /conversations`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 200 OK:**
```json
[
  {
    "id": "c1111111-1111-4111-8111-111111111111",
    "participants": [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002"
    ],
    "participant_names": {
      "00000000-0000-4000-8000-000000000001": "Alex",
      "00000000-0000-4000-8000-000000000002": "Sam"
    },
    "participantNames": {
      "00000000-0000-4000-8000-000000000001": "Alex",
      "00000000-0000-4000-8000-000000000002": "Sam"
    },
    "train_number": "12951",
    "trainNumber": "12951",
    "travel_date": "2026-09-15",
    "travelDate": "2026-09-15",
    "last_message": "Hey, see you on train!",
    "lastMessage": "Hey, see you on train!",
    "last_message_time": "2026-08-24T12:00:00.000Z",
    "lastMessageTime": "2026-08-24T12:00:00.000Z",
    "created_at": "2026-08-24T10:00:00.000Z",
    "createdAt": "2026-08-24T10:00:00.000Z"
  }
]
```

#### 2. `GET /conversations/:id`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 200 OK:** Single `SerializedConversation` object.
- **Response 404 NOT_FOUND:** Conversation does not exist or caller is not a participant.

#### 3. `POST /conversations`
- **Headers:** `Authorization: Bearer <access_token>`
- **Request Body (supports camelCase & snake_case):**
```json
{
  "participants": ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
  "participant_names": {
    "00000000-0000-4000-8000-000000000001": "Alex",
    "00000000-0000-4000-8000-000000000002": "Sam"
  },
  "train_number": "12951",
  "travel_date": "2026-09-15"
}
```
- **Response 201 Created / 200 OK:** Returns serialized conversation object.
- **Error Codes:**
  - `400 VALIDATION_ERROR`: Invalid participant array (not 2 distinct UUIDs) or caller not in participants.
  - `400 USER_BLOCKED`: Participants are symmetrically blocked.
  - `403 NO_ACCEPTED_REQUEST`: No accepted companion request exists between participants.

#### 4. `DELETE /conversations/:id/for-me`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 204 No Content:** Caller successfully soft-deleted from conversation list.
- **Response 404 NOT_FOUND:** Conversation does not exist or caller is not a participant.

---

## 9. Validation Rules & Zod Schemas

```typescript
// backend/src/validation/conversation.schemas.ts
import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const createConversationSchema = z
  .object({
    participants: z.array(z.string().regex(UUID_REGEX)).min(2).max(2).optional(),
    participantIds: z.array(z.string().regex(UUID_REGEX)).min(2).max(2).optional(),
    participant_names: z.record(z.string(), z.string().max(100)).optional(),
    participantNames: z.record(z.string(), z.string().max(100)).optional(),
    train_number: z.string().trim().max(20).optional().nullable(),
    trainNumber: z.string().trim().max(20).optional().nullable(),
    travel_date: z.string().optional().nullable(),
    travelDate: z.string().optional().nullable(),
    last_message: z.string().max(255).optional().nullable(),
    last_message_time: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const parts = data.participants ?? data.participantIds;
    if (!parts || parts.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'Conversation must have exactly 2 participants',
      });
      return;
    }
    if (parts[0] === parts[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'Participants must be distinct users',
      });
    }
    const rawDate = data.travel_date ?? data.travelDate;
    if (rawDate) {
      const cleanDate = rawDate.split('T')[0] ?? '';
      if (!DATE_REGEX.test(cleanDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['travelDate'],
          message: 'travelDate must be formatted as YYYY-MM-DD',
        });
      }
    }
  })
  .transform((data) => {
    const parts = (data.participants ?? data.participantIds)!;
    const names = data.participant_names ?? data.participantNames ?? {};
    const rawDate = data.travel_date ?? data.travelDate;
    const cleanDate = rawDate ? rawDate.split('T')[0] : null;

    return {
      participants: parts,
      participantNames: names,
      trainNumber: (data.train_number ?? data.trainNumber)?.trim() || null,
      travelDate: cleanDate,
    };
  });

export const conversationIdParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'Conversation ID must be a valid UUID'),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
```

---

## 10. Serialization & Privacy Rules

### 10.1 Dual Casing Serializer
```typescript
// backend/src/serializers/conversation.serializer.ts
import type { Conversation } from '@prisma/client';
import { formatTravelDate } from './journey.serializer.js';

export interface SerializedConversation {
  id: string;
  participants: string[];
  participantNames: Record<string, string>;
  participant_names: Record<string, string>;
  trainNumber: string | null;
  train_number: string | null;
  travelDate: string | null;
  travel_date: string | null;
  lastMessage: string | null;
  last_message: string | null;
  lastMessageTime: string | null;
  last_message_time: string | null;
  createdAt: string;
  created_at: string;
}

export class ConversationSerializer {
  static toResponse(conversation: Conversation): SerializedConversation {
    const formattedTravelDate = conversation.travelDate
      ? formatTravelDate(conversation.travelDate)
      : null;
    const names = (conversation.participantNames as Record<string, string>) || {};

    return {
      id: conversation.id,
      participants: conversation.participants,
      participantNames: names,
      participant_names: names,
      trainNumber: conversation.trainNumber,
      train_number: conversation.trainNumber,
      travelDate: formattedTravelDate,
      travel_date: formattedTravelDate,
      lastMessage: conversation.lastMessage,
      last_message: conversation.lastMessage,
      lastMessageTime: conversation.lastMessageTime ? conversation.lastMessageTime.toISOString() : null,
      last_message_time: conversation.lastMessageTime ? conversation.lastMessageTime.toISOString() : null,
      createdAt: conversation.createdAt.toISOString(),
      created_at: conversation.createdAt.toISOString(),
    };
  }

  static toResponseList(conversations: Conversation[]): SerializedConversation[] {
    return conversations.map((c) => this.toResponse(c));
  }
}
```

---

## 11. Service & Repository Architecture

### 11.1 `ConversationRepository`
- `findById(id: string): Promise<Conversation | null>`
- `findUserConversations(userId: string): Promise<Conversation[]>`:
  - Queries `where: { participants: { has: userId }, NOT: { deletedFor: { has: userId } } }`, ordered by `lastMessageTime: 'desc'`.
- `findExistingBetween(userA: string, userB: string, trainNumber?: string | null, travelDate?: Date | null): Promise<Conversation | null>`:
  - Queries `where: { participants: { hasEvery: [userA, userB] }, trainNumber, travelDate }`.
- `create(data: CreateConversationData): Promise<Conversation>`
- `softDeleteForUser(id: string, userId: string): Promise<boolean>`:
  - Executes atomic SQL update:
    ```sql
    UPDATE "conversations"
    SET "deleted_for" = array_append(COALESCE("deleted_for", ARRAY[]::uuid[]), ${userId}::uuid)
    WHERE "id" = ${id}::uuid
      AND ${userId}::uuid = ANY("participants")
      AND NOT (${userId}::uuid = ANY(COALESCE("deleted_for", ARRAY[]::uuid[])));
    ```
- `updateLastMessage(id: string, lastMessage: string, lastMessageTime: Date): Promise<void>` (Seam for M11).

### 11.2 `ConversationService`
- `listConversations(callerId: string): Promise<Conversation[]>`
- `getConversation(callerId: string, id: string): Promise<Conversation>`
- `createConversation(callerId: string, input: CreateConversationDto): Promise<Conversation>`:
  - Validates 2 distinct participants, caller included.
  - Checks `AccessService.isBlocked`.
  - Checks `AccessService.hasAcceptedRequest(userA, userB)`.
  - Checks if existing conversation exists (idempotent reuse).
  - Fetches profiles to ensure valid display names if missing.
  - Inserts conversation record.
- `softDeleteForUser(callerId: string, id: string): Promise<void>`:
  - Checks participant membership (masks existence with 404).
  - Calls `softDeleteForUser`.

---

## 12. Transaction & Concurrency Strategy

1. **Idempotent Room Creation:** When concurrent requests attempt to open a chat room for the same pair, the service checks for existing conversations matching the pair and returns the existing entity.
2. **Atomic Array Appends:** `softDeleteForUser` runs an atomic `UPDATE ... SET deleted_for = array_append(...) WHERE NOT (userId = ANY(deleted_for))` preventing lost updates when both participants soft-delete simultaneously.
3. **Tamper Prevention:** The `prevent_conversation_tamper_trg` trigger runs at the PostgreSQL engine level, guaranteeing immutability across all API surfaces.

---

## 13. Integration Test Plan (`backend/test/integration/conversation.lifecycle.test.ts`)

1. **Conversation Creation with Accepted Request:** Create companion request -> accept request -> create conversation -> 201 Created and persists in PostgreSQL.
2. **Rejection Without Accepted Request:** Attempting to create a conversation without an accepted request fails with `403 NO_ACCEPTED_REQUEST`.
3. **Symmetric Blocking Rejection:** Symmetrically blocked pairs cannot create a conversation (`400 USER_BLOCKED`).
4. **Idempotent Reuse:** Calling create again for an existing pair returns the existing conversation.
5. **Participant-Only Listing:** Caller only sees conversations they participate in; non-participants are excluded.
6. **Soft-Delete Permanence:** `DELETE /conversations/:id/for-me` hides conversation from caller's list; other participant still sees it.
7. **Direct URL Message Access:** Direct fetch of a soft-deleted conversation by a participant still succeeds (satisfies `/chat/:id` direct URL invariant).
8. **Existence Masking:** Non-participants receive `404 NOT_FOUND` on get and soft-delete attempts.
9. **Tamper Trigger Verification:** Direct SQL UPDATE to `participants` or `train_number` is blocked by `prevent_conversation_tamper_trg`.
10. **Cascade Deletion:** Deleting a user account cascades cleanly.
11. **Strict Email Privacy:** Response JSON does not contain email addresses anywhere.

---

## 14. Unit Test Plan

- **`ConversationRepository` (Unit):** `findById`, `findUserConversations`, `findExistingBetween`, `create`, `softDeleteForUser`.
- **`ConversationService` (Unit):** `canCreateConversation` truth table (2 distinct users, caller included, blocked pairs, missing accepted request, matching train/date), `softDeleteForUser` error mapping.
- **`ConversationSerializer` (Unit):** Dual casing formatting, null date handling, display name extraction.
- **`ConversationSchemas` (Unit):** Zod validation for valid/invalid participants, self-conversation rejection, date formatting.
- **`ConversationController` (Unit):** HTTP status codes, parameter extraction, service delegation.
- **`ConversationRoutes` (Unit):** Authentication requirement (401), route mapping, error envelope handling.

---

## 15. Scope Boundary (Milestone 10 vs Milestone 11)

### Strictly IN Scope for M10:
- `conversations` database model, migration, indexes, and tamper trigger.
- Conversation creation, listing, get by ID, and per-user soft delete.
- Authorization gating via `AccessService.hasAcceptedRequest` and `AccessService.isBlocked`.
- `AccessService.hasSharedConversation` live DB query integration.
- Unit and database-backed lifecycle integration tests.

### Strictly OUT of Scope for M10 (Deferred to M11/M12):
- `messages` table and message dispatch / listing endpoints.
- `last_read` table and read receipt tracking.
- Unread count queries.
- Chat attachment storage presigning (`chat-attachments` bucket).
- Socket.IO realtime events (`message:new`, `conversation:updated`, `presence:sync`).
- Automatic `last_message` / `last_message_time` updates on message sends.

---

## 16. Deviations & Open Questions

- **Deviations from Governing Documents:** None.
- **Open Questions:** None. All requirements, constraints, and endpoints are fully resolved.
