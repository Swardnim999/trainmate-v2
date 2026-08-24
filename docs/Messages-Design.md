# Milestone 11 — MESSAGES Design Specification

---

## 1. Governing Requirements & Executive Summary

### 1.1 Purpose & Role in TrainMate v2
Messages represent the private communication data plane in TrainMate v2. Once two travel companions have established a conversation room (Milestone 10 — Conversations) following an accepted companion request (Milestone 9 — Requests), they can exchange text messages and file attachments in real-time.

Milestone 11 defines the complete persistence layer, business rules, atomic send transactions, read receipts (`last_read`), unread count calculations, attachment metadata validation, and REST API surface for messages. Milestone 12 (Realtime / Socket.IO) will mirror these transactional writes to live client rooms.

### 1.2 Governing Documents
- **`docs/Backend-Specification.md`**: Schema definitions (§3.2), RLS authorization rules (§6.5, §6.6), business rules (§9.6), REST API endpoints (§10.6, §10.7), frontend call sites (§11.5), BigInt JSON pitfall (§3.2, §10.6).
- **`docs/Backend-Architecture.md`**: Message aggregate architecture (§2.1), blocking enforcement in chat (§8.4), database triggers (§9.1), performance indexes (§10).
- **`docs/Implementation-Roadmap.md`**: Phase 11 deliverable specification (lines 1525–1640), atomic send transaction contract, phantom error resolution, attachment MIME allowlist.
- **`docs/Design-Review-Report.md`**: Findings S2 (empty string text legal for attachment-only sends), F8 (attachments unaffected by avatar cache buster), Rm2 (phantom error atomic transaction fix), F10 (BigInt serialization).
- **`docs/Conversations-Design.md`**: M10 conversation aggregate, immutability trigger, and participant authorization.

---

## 2. Historical Supabase Migration Findings

Inspection of the historical Supabase migrations identified the exact schema and policy lineage for messages and read receipts:

| Migration | Key DDL / Logic Changes | Governing Invariants Discovered |
|---|---|---|
| `20251212061640` | Initial `messages` table: `id`, `conversation_id`, `sender_id`, `sender_name`, `text`, `created_at`. Initial `last_read` table: `id`, `user_id`, `conversation_id`, `timestamp`. Initial `is_conversation_participant` helper. | Foreign keys CASCADE on conversation or user deletion. Messages ordered by `created_at ASC`. |
| `20260618111613` | Added attachment columns to `messages`: `attachment_url text`, `attachment_type text`, `attachment_name text`, `attachment_size bigint`. Added storage RLS for `chat-attachments`. | File attachment metadata support. |
| `20260618111636` | Set `last_read` table to `REPLICA IDENTITY FULL`. | Realtime update payload requirements. |
| `20260630113712` | Added `is_blocked_in_conversation(conversation_id, sender_id)` RLS check to message INSERT policy. | Blocked users cannot send messages into conversations. |
| `20260716175301` & `20260717044824` | Anon access revoked, authenticated table privileges maintained. | Explicit service-layer policy replication. |

---

## 3. Frontend Contract Findings

Inspection of `src/pages/Chat.tsx`, `src/pages/Chats.tsx`, `src/hooks/useChat.tsx`, and `src/lib/chatFormat.ts` established the following frontend integration contracts:

1. **`useChat.tsx` — Message Fetching (`fetchMessages`):**
   - Dispatches query: `SELECT * FROM messages WHERE conversation_id = :id ORDER BY created_at ASC`.
   - Consumes properties: `id`, `sender_id`, `sender_name`, `text`, `created_at`, `attachment_url`, `attachment_type`, `attachment_name`, `attachment_size`.
2. **`useChat.tsx` — Message Sending (`sendMessage`):**
   - Validates text: 1..2000 chars for text messages; if attachment is present, text may be empty (`''`).
   - Fetches caller's display name from `profiles.name` (`sender_name`).
   - Inserts row into `messages`.
   - Bumps `conversations.last_message` (`text` or preview `📷 Photo` / `📎 filename`) and `conversations.last_message_time = now()`.
   - **Historical Phantom Error (Rm2):** In Supabase, the message insert succeeded but the subsequent conversation update could fail or re-throw, causing a failure toast even though the message was saved. M11 wraps both operations in a single atomic database transaction.
3. **`useChat.tsx` — Read Receipts (`markAsRead` & `fetchLastRead`):**
   - Calls `last_read` upsert on conversation open and on receiving messages from the other user.
   - Queries `last_read` for `otherUserId` to determine if sent messages have been read (`sentAt <= otherReadAt`).
4. **`useChat.tsx` — Unread Counts (`fetchUnreadCounts`):**
   - For each conversation, queries count of messages where `conversation_id = :id`, `sender_id != me`, and `created_at > lastReadTimestamp`.
5. **Editing and Deletion:**
   - The frontend contains **zero** UI or handlers for editing single messages or deleting single messages. Messages are strictly append-only and immutable.

---

## 4. Current Backend & M10 Dependency Analysis

1. **Milestone 6 (Moderation):** `AccessService.isBlocked(userA, userB)` prevents blocked participants from sending messages.
2. **Milestone 7 (Profiles):** `sender_name` is denormalized from `Profile.name`.
3. **Milestone 10 (Conversations):**
   - Messages link to `Conversation.id` via foreign key with `ON DELETE CASCADE`.
   - Participant verification ensures `req.user.id` is in `Conversation.participants`.
   - Sending a message atomically updates `Conversation.lastMessage` and `Conversation.lastMessageTime`.

---

## 5. Message Database Schema Design (Prisma & DDL)

### 5.1 Prisma Schema Models
```prisma
/// Message entity for 1-to-1 conversation rooms (Spec §3.2, §6.5, §9.6; Roadmap Phase 11).
/// Supports text messages and file attachments (images, pdf, docs, txt).
model Message {
  id             String    @id @default(uuid()) @db.Uuid
  conversationId String    @map("conversation_id") @db.Uuid
  senderId       String    @map("sender_id") @db.Uuid
  senderName     String?   @map("sender_name")
  text           String    @default("")
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  attachmentUrl  String?   @map("attachment_url")
  attachmentType String?   @map("attachment_type")
  attachmentName String?   @map("attachment_name")
  attachmentSize BigInt?   @map("attachment_size") @db.BigInt

  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender         User         @relation(fields: [senderId], references: [id], onDelete: Cascade)

  @@index([conversationId])
  @@index([conversationId, createdAt])
  @@index([senderId])
  @@map("messages")
}

/// Read receipt tracking per user per conversation (Spec §3.2, §6.6, §9.6; Roadmap Phase 11).
model LastRead {
  id             String       @id @default(uuid()) @db.Uuid
  userId         String       @map("user_id") @db.Uuid
  conversationId String       @map("conversation_id") @db.Uuid
  timestamp      DateTime     @default(now()) @map("timestamp") @db.Timestamptz(3)

  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([userId, conversationId])
  @@index([conversationId])
  @@map("last_read")
}
```

### 5.2 SQL Migration (`20260901120000_add_messages_and_last_read_tables/migration.sql`)
```sql
-- Create messages table
CREATE TABLE IF NOT EXISTS "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_name" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachment_url" TEXT,
    "attachment_type" TEXT,
    "attachment_name" TEXT,
    "attachment_size" BIGINT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "check_messages_content" CHECK (char_length("text") > 0 OR "attachment_url" IS NOT NULL),
    CONSTRAINT "check_messages_text_length" CHECK (char_length("text") <= 2000)
);

-- Performance Indexes on messages
CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_messages_conversation_created_at" ON "messages" ("conversation_id", "created_at" ASC);
CREATE INDEX IF NOT EXISTS "idx_messages_sender" ON "messages" ("sender_id");

-- Create last_read table
CREATE TABLE IF NOT EXISTS "last_read" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "last_read_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "last_read_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "last_read_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "last_read_user_id_conversation_id_key" UNIQUE ("user_id", "conversation_id")
);

-- Performance Indexes on last_read
CREATE INDEX IF NOT EXISTS "idx_last_read_conversation" ON "last_read" ("conversation_id");
```

---

## 6. Authorization & Security Model

### 6.1 Sending Messages (`POST /conversations/:id/messages`)
- **Participant Rule:** `req.user.id` MUST be one of the `participants` in the conversation.
- **Existence Masking:** If conversation does not exist or caller is not a participant, return `404 NOT_FOUND`.
- **Symmetric Block Rule:** If `AccessService.isBlocked(participantA, participantB)` is true, return `400 USER_BLOCKED` / `403 BLOCKED_IN_CONVERSATION`.
- **Identity Forcing:** `senderId` is strictly bound to `req.user.id`. Any client-supplied sender ID is rejected/ignored.
- **Content Validation:**
  - If no attachment: `text` must be trimmed, 1..2000 chars.
  - If attachment present: `text` may be empty or up to 2000 chars.
  - Attachment constraints: max size 10MB (10485760 bytes), MIME type in allowlist (`image/*`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `text/plain`). HTML (`text/html`), SVG (`image/svg+xml`), and executables are strictly rejected.

### 6.2 Reading Messages (`GET /conversations/:id/messages`)
- **Participant Rule:** Caller MUST be a participant in `conversation.participants`.
- **Existence Masking:** Returns `404 NOT_FOUND` if conversation does not exist or caller is not a participant.
- **Soft-Delete Exemption:** A participant who soft-deleted their conversation can still read message history when navigating directly to `/chat/:id` (Spec §9.5, Finding F5).

### 6.3 Read Receipts (`PUT` & `GET /conversations/:id/last-read/:userId`)
- **Upsert:** `PUT /conversations/:id/last-read` upserts a row for `user_id = req.user.id` and `conversation_id = conversationId`. Caller must be a participant.
- **Query:** `GET /conversations/:id/last-read/:userId` allows querying the other user's read receipt timestamp within the shared conversation.

---

## 7. Message Lifecycle & State Machine

```
[ Conversation Exists & Active (M10) ]
                 │
                 ▼
     [ POST /conversations/:id/messages ]
                 │
        ┌────────┴────────┐
        ▼                 ▼
   (Text Only)    (With Attachment)
   - 1..2000 chars - ≤10 MB, allowed MIME
        │                 │
        └────────┬────────┘
                 │
                 ▼
  ┌───────────────────────────────────────────────────────────┐
  │              Atomic Database Transaction                  │
  │  1. INSERT into messages (created_at = now())             │
  │  2. UPDATE conversations                                 │
  │     SET last_message = preview, last_message_time = now() │
  └───────────────────────────────────────────────────────────┘
                 │
                 ▼
  ┌───────────────────────────────────────────────────────────┐
  │                 Message History Active                    │
  │  - GET /conversations/:id/messages (created_at ASC)       │
  │  - Unread count incremented for recipient                 │
  │  - PUT /conversations/:id/last-read updates read receipt  │
  └───────────────────────────────────────────────────────────┘
```

---

## 8. REST API Specification

### 8.1 Endpoints Overview

| Method | Path | Auth | Middleware / Validation | Description |
|---|---|---|---|---|
| `GET` | `/conversations/:id/messages` | Required | `validateParams(conversationIdParamSchema)` | Retrieves message history for conversation (ordered by `created_at ASC`) |
| `POST` | `/conversations/:id/messages` | Required | `validateParams(conversationIdParamSchema)`, `validateBody(sendMessageSchema)` | Sends text/attachment message atomically and bumps conversation preview |
| `GET` | `/conversations/:id/messages/unread-count` | Required | `validateParams(conversationIdParamSchema)` | Returns count of unread messages for caller |
| `GET` | `/conversations/:id/last-read/:userId` | Required | `validateParams(lastReadParamSchema)` | Retrieves last read timestamp for user in conversation |
| `PUT` | `/conversations/:id/last-read` | Required | `validateParams(conversationIdParamSchema)` | Upserts caller's read receipt timestamp |

---

### 8.2 Endpoint Details & Contracts

#### 1. `GET /conversations/:id/messages`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 200 OK:**
```json
[
  {
    "id": "m1111111-1111-4111-8111-111111111111",
    "conversation_id": "c1111111-1111-4111-8111-111111111111",
    "conversationId": "c1111111-1111-4111-8111-111111111111",
    "sender_id": "00000000-0000-4000-8000-000000000001",
    "senderId": "00000000-0000-4000-8000-000000000001",
    "sender_name": "Alice",
    "senderName": "Alice",
    "text": "Hey, see you on train!",
    "attachment_url": null,
    "attachmentUrl": null,
    "attachment_type": null,
    "attachmentType": null,
    "attachment_name": null,
    "attachmentName": null,
    "attachment_size": null,
    "attachmentSize": null,
    "created_at": "2026-08-24T12:00:00.000Z",
    "createdAt": "2026-08-24T12:00:00.000Z"
  }
]
```

#### 2. `POST /conversations/:id/messages`
- **Headers:** `Authorization: Bearer <access_token>`
- **Request Body (supports camelCase & snake_case):**
```json
{
  "text": "Hello! I have boarded coach B3.",
  "attachment_url": "https://storage.example.com/chat-attachments/convId/ticket.pdf",
  "attachment_type": "application/pdf",
  "attachment_name": "ticket.pdf",
  "attachment_size": 1048576
}
```
- **Response 201 Created:** Returns serialized `SerializedMessage` object.
- **Error Codes:**
  - `400 VALIDATION_ERROR`: Empty text without attachment, text > 2000 chars, invalid attachment MIME or size > 10MB.
  - `400 USER_BLOCKED`: Participants are symmetrically blocked.
  - `404 NOT_FOUND`: Conversation not found or caller is not a participant.

#### 3. `GET /conversations/:id/messages/unread-count`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 200 OK:**
```json
{
  "count": 3
}
```

#### 4. `GET /conversations/:id/last-read/:userId`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 200 OK:**
```json
{
  "timestamp": "2026-08-24T12:05:00.000Z"
}
```

#### 5. `PUT /conversations/:id/last-read`
- **Headers:** `Authorization: Bearer <access_token>`
- **Response 200 OK:**
```json
{
  "timestamp": "2026-08-24T12:06:00.000Z"
}
```

---

## 9. Pagination Strategy

1. **Default Ordering:** Messages are ordered by `created_at ASC` to provide chronological chat streams.
2. **Deterministic Pagination (Future / Large Chat Histories):**
   - Query parameter `before`: ISO timestamp or Message UUID cursor for backward infinite scroll.
   - Query parameter `limit`: defaults to 50, maximum 100.
   - When fetching initial history, frontend queries `GET /conversations/:id/messages` returning the full thread (or initial 50 rows).

---

## 10. Validation Rules & Zod Schemas

```typescript
// backend/src/validation/message.schemas.ts
import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export const sendMessageSchema = z
  .object({
    text: z.string().optional().default(''),
    attachment_url: z.string().url().optional().nullable(),
    attachmentUrl: z.string().url().optional().nullable(),
    attachment_type: z.string().optional().nullable(),
    attachmentType: z.string().optional().nullable(),
    attachment_name: z.string().max(255).optional().nullable(),
    attachmentName: z.string().max(255).optional().nullable(),
    attachment_size: z.number().int().nonnegative().optional().nullable(),
    attachmentSize: z.number().int().nonnegative().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const trimmedText = data.text.trim();
    const url = data.attachment_url ?? data.attachmentUrl;
    const type = data.attachment_type ?? data.attachmentType;
    const size = data.attachment_size ?? data.attachmentSize;

    if (!url && trimmedText.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Message text cannot be empty when no attachment is provided',
      });
    }

    if (trimmedText.length > 2000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Message text must be at most 2000 characters',
      });
    }

    if (url) {
      if (type && !ALLOWED_MIME_TYPES.some((allowed) => type.startsWith('image/') || type === allowed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attachmentType'],
          message: 'Unsupported attachment type. Allowed: Images, PDF, Word, Plain Text',
        });
      }
      if (size && size > MAX_ATTACHMENT_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attachmentSize'],
          message: 'Attachment size exceeds maximum limit of 10 MB',
        });
      }
    }
  })
  .transform((data) => ({
    text: data.text.trim(),
    attachmentUrl: data.attachment_url ?? data.attachmentUrl ?? null,
    attachmentType: data.attachment_type ?? data.attachmentType ?? null,
    attachmentName: data.attachment_name ?? data.attachmentName ?? null,
    attachmentSize: data.attachment_size ?? data.attachmentSize ?? null,
  }));

export const lastReadParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'Conversation ID must be a valid UUID'),
  userId: z.string().regex(UUID_REGEX, 'User ID must be a valid UUID'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
```

---

## 11. Serialization & Privacy Rules

### 11.1 BigInt Handling & Dual Casing Serializer
```typescript
// backend/src/serializers/message.serializer.ts
import type { Message } from '@prisma/client';

export interface SerializedMessage {
  id: string;
  conversationId: string;
  conversation_id: string;
  senderId: string;
  sender_id: string;
  senderName: string | null;
  sender_name: string | null;
  text: string;
  attachmentUrl: string | null;
  attachment_url: string | null;
  attachmentType: string | null;
  attachment_type: string | null;
  attachmentName: string | null;
  attachment_name: string | null;
  attachmentSize: number | null;
  attachment_size: number | null;
  createdAt: string;
  created_at: string;
}

export class MessageSerializer {
  static toResponse(message: Message): SerializedMessage {
    const sizeNumber = message.attachmentSize !== null ? Number(message.attachmentSize) : null;

    return {
      id: message.id,
      conversationId: message.conversationId,
      conversation_id: message.conversationId,
      senderId: message.senderId,
      sender_id: message.senderId,
      senderName: message.senderName,
      sender_name: message.senderName,
      text: message.text,
      attachmentUrl: message.attachmentUrl,
      attachment_url: message.attachmentUrl,
      attachmentType: message.attachmentType,
      attachment_type: message.attachmentType,
      attachmentName: message.attachmentName,
      attachment_name: message.attachmentName,
      attachmentSize: sizeNumber,
      attachment_size: sizeNumber,
      createdAt: message.createdAt.toISOString(),
      created_at: message.createdAt.toISOString(),
    };
  }

  static toResponseList(messages: Message[]): SerializedMessage[] {
    return messages.map((m) => this.toResponse(m));
  }
}
```

---

## 12. Edit & Delete Semantics

- **No In-Place Editing:** Messages cannot be modified after insertion. `UPDATE` operations on `messages` are prohibited.
- **No Single Message Deletion:** Messages are immutable logs. Single message deletion is not supported.
- **Cascade Deletion:** Messages and `last_read` records are automatically deleted when the parent `Conversation` or `User` is deleted via PostgreSQL `ON DELETE CASCADE`.

---

## 13. Transaction & Concurrency Strategy

1. **Atomic Send & Preview Bump:**
   ```typescript
   await this.db.$transaction(async (tx) => {
     const message = await tx.message.create({
       data: {
         conversationId,
         senderId: callerId,
         senderName: displayName,
         text: input.text,
         attachmentUrl: input.attachmentUrl,
         attachmentType: input.attachmentType,
         attachmentName: input.attachmentName,
         attachmentSize: input.attachmentSize !== null ? BigInt(input.attachmentSize) : null,
       },
     });

     const preview = input.attachmentUrl
       ? input.attachmentType?.startsWith('image/')
         ? '📷 Photo'
         : `📎 ${input.attachmentName || 'Attachment'}`
       : input.text;

     await tx.conversation.update({
       where: { id: conversationId },
       data: {
         lastMessage: preview.substring(0, 255),
         lastMessageTime: message.createdAt,
       },
     });

     return message;
   });
   ```
2. **Concurrent Sends:** Simultaneous message sends by both participants are safely serialized by PostgreSQL row-level locks on the `conversations` row update, ensuring ordered `last_message_time` timestamps.
3. **Idempotent Last-Read Upsert:** `last_read` upsert utilizes PostgreSQL `INSERT ... ON CONFLICT (user_id, conversation_id) DO UPDATE SET timestamp = EXCLUDED.timestamp`.

---

## 14. Unit Test Plan

- **`MessageRepository` (Unit):** `createInTx`, `findByConversationId`, `countUnreadMessages`.
- **`LastReadRepository` (Unit):** `upsert`, `findByUserAndConversation`.
- **`MessageService` (Unit):**
  - Validation: non-participant rejection (404), blocked pair rejection (400), empty text without attachment rejection (400), text > 2000 chars rejection (400).
  - Atomic transaction: verification that preview bump failure rolls back message creation.
  - Read receipts: `markAsRead`, querying other user's `last_read`.
  - Unread count: calculation with and without existing `last_read` row.
- **`MessageSerializer` (Unit):** Dual casing, safe `BigInt` to `Number` conversion, null attachment handling.
- **`MessageSchemas` (Unit):** Zod parsing for valid text, valid attachments, invalid MIME types, oversized attachments.
- **`MessageController` & Routes (Unit):** HTTP status mapping (200, 201, 400, 404), parameter extraction.

---

## 15. Integration Test Plan (`backend/test/integration/message.lifecycle.test.ts`)

1. **Text Message Send & Persistence:** Send text message -> 201 Created -> verify `messages` row and `conversations.last_message` updated in DB.
2. **Attachment Message Send & BigInt Handling:** Send message with attachment -> verify `attachment_size` stored as BigInt and serialized cleanly as Number.
3. **Empty Text with Attachment Allowed:** Message with empty text and valid attachment succeeds.
4. **Non-Participant Rejection (Send & Read):** Non-participant receives 404 NOT_FOUND on message history and send attempts.
5. **Symmetric Block Rejection:** Blocked user cannot send message into conversation (`400 USER_BLOCKED`).
6. **Chronological Message Ordering:** Multiple messages are returned in exact `created_at ASC` order.
7. **Read Receipt Upsert & Query:** `PUT /conversations/:id/last-read` upserts timestamp; `GET /conversations/:id/last-read/:userId` returns timestamp.
8. **Unread Count Calculations:** Unread count accurately reflects messages sent after caller's `last_read.timestamp`.
9. **Atomic Transaction Rollback:** Simulated failure in conversation update rolls back message insertion.
10. **Conversation Soft-Delete Message Reading:** Caller who soft-deleted conversation can still fetch message history via direct conversation ID.
11. **Cascade Deletion:** Deleting conversation or user cascades to all related `messages` and `last_read` rows.
12. **Email Privacy Invariant:** Message and last-read response payloads strictly contain no email addresses.

---

## 16. Scope Boundary (Milestone 11 vs Milestone 12)

### Strictly IN Scope for M11:
- Prisma models `Message` and `LastRead`, SQL migration, check constraints, composite indexes.
- `MessageRepository`, `LastReadRepository`, `MessageService`, `MessageSerializer`, `MessageController`, routes mounted at `/conversations/:id/messages` and `/conversations/:id/last-read`.
- Atomic transaction for message creation and conversation preview update.
- Read receipt upserts and unread message calculations.
- Comprehensive unit tests and PostgreSQL integration tests.

### Strictly OUT of Scope for M11 (Deferred to M12 / Realtime):
- Socket.IO server setup, handshake authentication, rooms (`conv:<id>`, `user:<id>`).
- Emitting realtime events (`message:new`, `last-read:update`, `conversation:updated`).
- Realtime typing indicators and presence synchronization.

---

## 17. Deviations & Open Questions

- **Deviations from Governing Documents:** None.
- **Open Questions:** None. All data models, endpoints, atomic transaction semantics, and validation rules are fully specified.
