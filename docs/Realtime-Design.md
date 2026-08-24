# Milestone 12 — REALTIME / SOCKET.IO Design Specification

---

## 1. Executive Summary

Milestone 12 defines the real-time communication tier for TrainMate v2. In Milestones 10 and 11, the core data models, repositories, serializers, business validations, and REST APIs for conversations, messages, and read receipts were implemented and verified. 

Milestone 12 introduces a dedicated, secure **Socket.IO server** that bridges transactional database updates to connected clients. It replaces historical Supabase Realtime channels (`messages-<cid>`, `last-read-<cid>-<uid>`, `conversations-updates-<uid>`, `presence-<cid>`) with authenticated Socket.IO rooms, deterministic event emitters, presence tracking, and debounced typing broadcasts while strictly preserving existing business rules, authorization invariants, email privacy, and consistency guarantees.

---

## 2. Authoritative Sources Inspected & Reconciled

The design reconciles requirements from all project specifications, design documents, and baseline code:

1. **`docs/Backend-Specification.md`**:
   - §8.1–8.5: Historical Supabase Realtime v2 inventory (`postgres_changes`, `presence`, `broadcast`), channel topic contracts, payload shapes, RLS replication, and target Socket.IO mapping.
   - §6.5–6.6: Participant authorization, blocked-user message prevention, existence masking.
   - §9.6: Message content rules, attachment size and MIME validation.
   - §10.6–10.7: REST message endpoints, read-receipt upsert semantics.
2. **`docs/Backend-Architecture.md`**:
   - §2.1: System topology and socket server placement.
   - §8.4–8.5: Realtime event mirroring and security definition.
3. **`docs/Implementation-Roadmap.md`**:
   - Phase 12 (lines 1640–1760): Socket.IO server, JWT handshake, room mappings (`conv:<cid>`, `user:<uid>`), event emission contracts, abuse controls, testing strategy, and parity matrix.
4. **`docs/Messages-Design.md` & `docs/Conversations-Design.md`**:
   - M10/M11 contracts: Conversation room participants, atomic send + preview bump transactions, `last_read` compound unique model, dual-cased serialization, `attachment_size` BigInt conversion, and strict email privacy.
5. **Frontend Baseline (`src/hooks/useChat.tsx`, `src/hooks/usePresence.ts`, `src/pages/Chat.tsx`, `src/pages/Chats.tsx`)**:
   - Exact client-side event listeners, payload expectations, auto-scroll triggers, read-receipt update triggers, unread badge recalculation flows, and presence state maps.

---

## 3. Existing Architecture Relevant to M12

```
┌────────────────────────────────────────────────────────────────────────┐
│                          HTTP / REST Tier                              │
│                                                                        │
│   POST /conversations/:id/messages ────┐                               │
│   PUT  /conversations/:id/last-read ───┼───► MessageService            │
│   POST /conversations ─────────────────┼───► ConversationService       │
│   DELETE /conversations/:id/for-me ────┘                               │
│                                           │ (DB Transaction)           │
│                                           ▼                            │
│                                  PostgreSQL Database                   │
└───────────────────────────────────────────┬────────────────────────────┘
                                            │ (Post-Commit Event Hook)
                                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Socket.IO Realtime Tier                         │
│                                                                        │
│   Socket.IO Server (attached to HTTP Server / Port 3000)               │
│   ├── JWT Handshake Auth (socketAuth middleware)                       │
│   ├── Room Manager (conv:<cid>, user:<uid>)                            │
│   ├── RealtimeBroadcaster (message:new, last-read:update, etc.)        │
│   └── Presence & Typing Coordinator                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Separation of Concerns & Architectural Invariants
1. **Single Point of Mutation (No Dual Send Paths):** 
   - All message creations and read-receipt updates **must** remain on HTTP REST (`POST /conversations/:id/messages`, `PUT /conversations/:id/last-read`).
   - Socket.IO handlers **never** independently execute database writes for messages. Realtime events are purely the broadcast mirror of successful, committed database operations.
2. **Post-Commit Emission:**
   - Realtime events (`message:new`, `last-read:update`, `conversation:updated`) are emitted **only after** the Prisma database transaction successfully commits. If a transaction fails or rolls back, zero events are emitted.
3. **Server-Side Identity Forcing:**
   - Sockets derive identity exclusively from the verified JWT payload (`socket.user.id`). Client-supplied user IDs in socket events are ignored and rejected.

---

## 4. Socket.IO Server Architecture

### 4.1 Server Initialization & Attachment
The Socket.IO server is initialized on top of the existing Node.js HTTP server created in `backend/src/index.ts`.

```typescript
// backend/src/sockets/index.ts
import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { createSocketAuthMiddleware } from './middleware/socket-auth.js';
import { registerRoomHandlers } from './handlers/rooms.handler.js';
import { registerTypingHandlers } from './handlers/typing.handler.js';
import { registerPresenceHandlers } from './handlers/presence.handler.js';
import { RealtimeBroadcaster } from './broadcaster.js';
import type { JwtService } from '../utils/jwt.js';
import type { ConversationRepository } from '../repositories/conversations.repo.js';

export interface SocketsInitOptions {
  httpServer: HttpServer;
  jwtService: JwtService;
  conversationsRepo: ConversationRepository;
  corsOrigin: string | string[];
}

export function initSocketServer(options: SocketsInitOptions): {
  io: SocketIOServer;
  broadcaster: RealtimeBroadcaster;
} {
  const io = new SocketIOServer(options.httpServer, {
    cors: {
      origin: options.corsOrigin,
      credentials: true,
    },
    serveClient: false,
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1 MB payload limit for socket frames
  });

  // Attach Handshake Auth Middleware
  io.use(createSocketAuthMiddleware(options.jwtService));

  const broadcaster = new RealtimeBroadcaster(io);

  io.on('connection', (socket) => {
    // 1. Auto-join user room
    socket.join(`user:${socket.user.id}`);

    // 2. Register feature handlers
    registerRoomHandlers(socket, options.conversationsRepo);
    registerTypingHandlers(socket, io);
    registerPresenceHandlers(socket, io);

    socket.on('disconnect', (reason) => {
      // Disconnect cleanup handled by presence coordinator
    });
  });

  return { io, broadcaster };
}
```

---

## 5. Authentication Architecture

### 5.1 Handshake Authentication Protocol
Every client establishing a Socket.IO connection must present a valid, unexpired JWT access token.

```
Client                                                  Server (Socket.IO)
  │                                                            │
  │─── WS Handshake ──────────────────────────────────────────►│
  │    auth: { token: "<access_token>" }                       │
  │    OR headers: { authorization: "Bearer <token>" }         │
  │                                                            │
  │                                                    [ Verify JWT via JwtService ]
  │                                                    ├── Invalid/Expired ──► Rejection: 401 Unauthorized
  │                                                    └── Valid ────────────► Attach socket.user = { id, email }
  │                                                                            Auto-join room: `user:<socket.user.id>`
  │◄── Connection Accepted ────────────────────────────────────│
```

### 5.2 Handshake Middleware Specification
```typescript
// backend/src/sockets/middleware/socket-auth.ts
import type { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io/dist/namespace';
import type { JwtService } from '../../utils/jwt.js';

export interface AuthenticatedSocket extends Socket {
  user: {
    id: string;
    email: string;
  };
}

export function createSocketAuthMiddleware(jwtService: JwtService) {
  return async (socket: Socket, next: (err?: ExtendedError) => void) => {
    try {
      const authPayload = socket.handshake.auth as { token?: string };
      const authHeader = socket.handshake.headers.authorization;
      
      let rawToken: string | undefined = authPayload?.token;
      if (!rawToken && authHeader?.startsWith('Bearer ')) {
        rawToken = authHeader.slice(7).trim();
      }

      if (!rawToken) {
        const error = new Error('AUTHENTICATION_REQUIRED') as ExtendedError;
        error.data = { code: 'UNAUTHORIZED', message: 'No authentication token provided' };
        return next(error);
      }

      const payload = await jwtService.verify(rawToken);
      (socket as AuthenticatedSocket).user = {
        id: payload.sub,
        email: payload.email,
      };

      next();
    } catch {
      const error = new Error('TOKEN_INVALID_OR_EXPIRED') as ExtendedError;
      error.data = { code: 'UNAUTHORIZED', message: 'Authentication token is invalid or expired' };
      next(error);
    }
  };
}
```

---

## 6. Connection Lifecycle

| State | Transition Event | Server Action |
|---|---|---|
| **Connecting** | Client requests WebSocket connection | Evaluates `socketAuth` middleware against JWT token. |
| **Connected** | Handshake succeeds | Attaches `socket.user`, auto-joins `user:<socket.user.id>`, initializes connection metrics. |
| **Room Join** | Client emits `join:conversation` `{ conversationId }` | Checks `ConversationRepository.findById` to verify `socket.user.id` is a participant. If authorized: joins `conv:<cid>`, syncs presence. If unauthorized: emits `error:forbidden`. |
| **Active Chat** | Client types or receives messages | Receives `message:new`, `last-read:update`, `typing`, `presence:sync`. |
| **Room Leave** | Client emits `leave:conversation` `{ conversationId }` | Leaves `conv:<cid>`, removes from presence map, emits `presence:leave`. |
| **Disconnecting** | Network drop or tab closed | Cleans up user presence across all conversation rooms they were in, leaves `user:<uid>`. |
| **Reconnecting** | Socket.IO auto-reconnects with backoff | Re-runs handshake with latest access token. Client re-emits `join:conversation` for current view. |

---

## 7. Room Architecture

```
                                  Socket.IO Server
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     Conversation Rooms (`conv:<cid>`)               User Rooms (`user:<uid>`)
     - Purpose: 1-to-1 conversation streams          - Purpose: User-scoped notifications
     - Members: Verified participants only           - Members: Sockets of that user only
     - Events:                                       - Events:
       * `message:new` (includes sender echo)          * `conversation:updated`
       * `last-read:update`
       * `presence:sync` / `join` / `leave`
       * `typing`
```

### 7.1 Room Naming Conventions
- **Conversation Room:** `conv:<conversationId>` (e.g. `conv:c1111111-1111-4111-8111-111111111111`)
- **User Room:** `user:<userId>` (e.g. `user:00000000-0000-4000-8000-000000000001`)

### 7.2 Room Join Authorization & Existence Masking
Clients cannot arbitrarily join any room. When `join:conversation` is received:
1. `conversationId` is validated as a UUID.
2. The server queries `ConversationRepository.findById(conversationId)`.
3. If the conversation does not exist or `!conversation.participants.includes(socket.user.id)`:
   - The join is **rejected**.
   - Server returns an error response `{ error: 'Conversation not found', code: 'NOT_FOUND' }` (existence masking, resisting room probing).
   - Socket is **not** joined to the room.

---

## 8. Event Catalogue

### 8.1 Summary Table

| Event Name | Direction | Room / Scope | Payload Summary | Authorization Rule |
|---|---|---|---|---|
| `join:conversation` | Client → Server | Target `conv:<cid>` | `{ conversationId: string }` | Verified participant in conversation |
| `leave:conversation` | Client → Server | Target `conv:<cid>` | `{ conversationId: string }` | Active socket in room |
| `message:new` | Server → Client | `conv:<cid>` | `SerializedMessage` (echoed to sender & recipient) | Server-emitted post-HTTP POST commit |
| `last-read:update` | Server → Client | `conv:<cid>` | `{ userId, conversationId, timestamp }` | Server-emitted post-HTTP PUT commit |
| `conversation:updated` | Server → Client | `user:<uid>` | `SerializedConversation` | Server-emitted on conversation row change |
| `typing` | Client → Server | Target `conv:<cid>` | `{ conversationId: string }` | Verified participant in conversation |
| `typing` | Server → Client | `conv:<cid>` (excl. sender) | `{ conversationId: string, userId: string }` | Broadcast to peers in room |
| `presence:sync` | Server → Client | `conv:<cid>` | `{ conversationId: string, users: Record<string, { online: boolean }> }` | Active member of `conv:<cid>` |
| `presence:join` | Server → Client | `conv:<cid>` | `{ conversationId: string, userId: string }` | Broadcast to peers on room join |
| `presence:leave` | Server → Client | `conv:<cid>` | `{ conversationId: string, userId: string, lastSeen: string }` | Broadcast to peers on room leave/disconnect |

---

## 9. Event Payload Contracts & Serialization

All event payloads strictly conform to the existing frontend contracts (`src/hooks/useChat.tsx`, `src/hooks/usePresence.ts`) and enforce dual camelCase / snake_case properties, BigInt safety, and zero email exposure.

### 9.1 `message:new` Payload Contract
```json
{
  "id": "m1111111-1111-4111-8111-111111111111",
  "conversationId": "c1111111-1111-4111-8111-111111111111",
  "conversation_id": "c1111111-1111-4111-8111-111111111111",
  "senderId": "00000000-0000-4000-8000-000000000001",
  "sender_id": "00000000-0000-4000-8000-000000000001",
  "senderName": "Alex",
  "sender_name": "Alex",
  "text": "Hello on train!",
  "attachmentUrl": null,
  "attachment_url": null,
  "attachmentType": null,
  "attachment_type": null,
  "attachmentName": null,
  "attachment_name": null,
  "attachmentSize": null,
  "attachment_size": null,
  "createdAt": "2026-08-24T12:00:00.000Z",
  "created_at": "2026-08-24T12:00:00.000Z"
}
```

### 9.2 `last-read:update` Payload Contract
```json
{
  "userId": "00000000-0000-4000-8000-000000000001",
  "user_id": "00000000-0000-4000-8000-000000000001",
  "conversationId": "c1111111-1111-4111-8111-111111111111",
  "conversation_id": "c1111111-1111-4111-8111-111111111111",
  "timestamp": "2026-08-24T12:05:00.000Z"
}
```

### 9.3 `conversation:updated` Payload Contract
```json
{
  "id": "c1111111-1111-4111-8111-111111111111",
  "participants": [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002"
  ],
  "participantNames": {
    "00000000-0000-4000-8000-000000000001": "Alex",
    "00000000-0000-4000-8000-000000000002": "Bob"
  },
  "participant_names": {
    "00000000-0000-4000-8000-000000000001": "Alex",
    "00000000-0000-4000-8000-000000000002": "Bob"
  },
  "trainNumber": "12951",
  "train_number": "12951",
  "travelDate": "2026-09-15",
  "travel_date": "2026-09-15",
  "lastMessage": "Hello on train!",
  "last_message": "Hello on train!",
  "lastMessageTime": "2026-08-24T12:00:00.000Z",
  "last_message_time": "2026-08-24T12:00:00.000Z",
  "deletedFor": [],
  "deleted_for": [],
  "createdAt": "2026-08-24T10:00:00.000Z",
  "created_at": "2026-08-24T10:00:00.000Z"
}
```

### 9.4 `presence:sync`, `presence:join`, `presence:leave`, `typing` Contracts
- **`presence:sync`:**
  ```json
  {
    "conversationId": "c1111111-1111-4111-8111-111111111111",
    "users": {
      "00000000-0000-4000-8000-000000000001": { "online": true },
      "00000000-0000-4000-8000-000000000002": { "online": true }
    }
  }
  ```
- **`presence:join`:**
  ```json
  {
    "conversationId": "c1111111-1111-4111-8111-111111111111",
    "userId": "00000000-0000-4000-8000-000000000001"
  }
  ```
- **`presence:leave`:**
  ```json
  {
    "conversationId": "c1111111-1111-4111-8111-111111111111",
    "userId": "00000000-0000-4000-8000-000000000001",
    "lastSeen": "2026-08-24T12:10:00.000Z"
  }
  ```
- **`typing` (Server broadcast):**
  ```json
  {
    "conversationId": "c1111111-1111-4111-8111-111111111111",
    "userId": "00000000-0000-4000-8000-000000000001"
  }
  ```

---

## 10. Authorization & Security Model

1. **Room Join Authorization:**
   - Client emits `join:conversation` with `{ conversationId }`.
   - Server looks up `Conversation.participants` from database.
   - If user is NOT in participants, join is rejected and 404 NOT_FOUND is emitted.
2. **Blocked Users:**
   - Symmetric block is checked during message send (`POST /conversations/:id/messages`). Blocked users cannot produce messages; therefore, no `message:new` event is ever triggered for blocked pairs.
   - If User A blocks User B while connected, User A can leave the room or ignore incoming events.
3. **Emit-Time Isolation:**
   - `message:new` and `last-read:update` are broadcast strictly to `conv:<conversationId>`. Sockets not in that room never receive the event frame.
   - `conversation:updated` is emitted strictly to `user:<userId>` of the affected participants. No user ever receives conversation metadata for conversations they do not participate in.
4. **Email Privacy Invariant:**
   - Zero email addresses are present in any socket event payload.

---

## 11. REST ↔ Realtime Consistency

To eliminate race conditions, phantom events, and event emission on rolled-back transactions:

```
1. Client issues HTTP POST /conversations/:id/messages
2. MessageService executes Prisma atomic transaction:
   ├── INSERT into messages
   └── UPDATE conversations SET last_message = preview, last_message_time = now()
3. Transaction COMMITS successfully in PostgreSQL.
4. MessageService (or Controller) calls RealtimeBroadcaster:
   ├── broadcaster.broadcastNewMessage(conv.id, serializedMessage)
   │     └── io.to(`conv:${conv.id}`).emit('message:new', serializedMessage)
   └── broadcaster.broadcastConversationUpdate(conv.participants, serializedConv)
         ├── io.to(`user:${p1}`).emit('conversation:updated', serializedConv)
         └── io.to(`user:${p2}`).emit('conversation:updated', serializedConv)
5. HTTP 201 Created response returned to caller.
```

### 11.1 RealtimeBroadcaster Interface
```typescript
// backend/src/sockets/broadcaster.ts
import type { Server as SocketIOServer } from 'socket.io';
import type { SerializedMessage, SerializedLastRead } from '../serializers/message.serializer.js';
import type { SerializedConversation } from '../serializers/conversation.serializer.js';

export class RealtimeBroadcaster {
  constructor(private readonly io: SocketIOServer) {}

  /** Broadcasts new message to conversation room (including sender echo) */
  broadcastNewMessage(conversationId: string, message: SerializedMessage): void {
    this.io.to(`conv:${conversationId}`).emit('message:new', message);
  }

  /** Broadcasts read receipt update to conversation room */
  broadcastLastRead(
    conversationId: string,
    userId: string,
    lastRead: SerializedLastRead,
  ): void {
    this.io.to(`conv:${conversationId}`).emit('last-read:update', {
      userId,
      user_id: userId,
      conversationId,
      conversation_id: conversationId,
      timestamp: lastRead.timestamp,
    });
  }

  /** Broadcasts conversation list preview update to each participant's user room */
  broadcastConversationUpdated(
    participantIds: string[],
    conversation: SerializedConversation,
  ): void {
    for (const userId of participantIds) {
      this.io.to(`user:${userId}`).emit('conversation:updated', conversation);
    }
  }
}
```

---

## 12. Persistence & Delivery Semantics

1. **At-Most-Once WebSocket Delivery:**
   - Realtime events are transient broadcasts designed for live UI responsiveness.
   - The PostgreSQL database is the single, durable store of record.
2. **Deterministic State Recovery:**
   - Sockets do NOT maintain persistent event backlogs or sequence numbers.
   - When a client reconnects after being offline, or when a chat view is mounted, the client issues REST queries (`GET /conversations/:id/messages`, `GET /conversations`, `GET /conversations/:id/messages/unread-count`) to fetch the exact authoritative database state.

---

## 13. Reconnect Semantics & Edge Cases

| Scenario | Behavior |
|---|---|
| **Temporary Network Drop** | Socket.IO client automatically reconnects with exponential backoff (1s -> 5s). |
| **Token Expiry During Connection** | Connection remains active until disconnect. On reconnect attempt with expired token, handshake fails (`TOKEN_INVALID_OR_EXPIRED`). Client frontend refreshes access token via `/auth/refresh` and reconnects. |
| **Missed Events While Offline** | Upon reconnecting and re-entering the Chat page, the frontend's `fetchMessages` / `fetchConversations` REST calls reconcile state completely. |
| **Multiple Tabs by Same User** | Each tab establishes its own socket and joins `user:<userId>`. Both tabs receive `conversation:updated` events. In `conv:<cid>`, presence collapses multiple sockets for the same user into a single online indicator. |

---

## 14. Error Handling & Abuse Controls

### 14.1 Typing Flood Protection
In Supabase Realtime, the frontend broadcasted typing events on every keystroke without rate limits. In Socket.IO:
- The server rate-limits `typing` events per socket (maximum 1 event per 1000ms per socket).
- Rapid keystroke events within the rate-limit window are discarded without error.

### 14.2 Room Join Abuse Protection
- Maximum active conversation rooms per socket capped at 20 (normal chat UI only occupies 1 room at a time).
- Arbitrary room strings are sanitized and rejected if not matching UUID format.

---

## 15. Graceful Server Shutdown

During server shutdown (`SIGTERM` / `SIGINT`):
1. Stop accepting new WebSocket connections.
2. Emit a `server:draining` event to all connected sockets.
3. Disconnect all active sockets cleanly: `io.close()`.
4. Allow HTTP server connection draining within `SHUTDOWN_TIMEOUT_MS` (10s).

---

## 16. Testing Strategy

### 16.1 Unit Tests (`backend/test/sockets/*.test.ts`)
- **`socketAuth` Middleware:**
  - Accepts valid JWT and populates `socket.user`.
  - Rejects connection with missing token (`AUTHENTICATION_REQUIRED`).
  - Rejects connection with expired or forged JWT (`TOKEN_INVALID_OR_EXPIRED`).
- **`RealtimeBroadcaster`:**
  - Verifies `broadcastNewMessage` targets `conv:<cid>` with serialized payload.
  - Verifies `broadcastLastRead` targets `conv:<cid>`.
  - Verifies `broadcastConversationUpdated` targets each participant's `user:<uid>` room.
- **`RoomHandler`:**
  - Authorizes participant join.
  - Rejects non-participant join with 404 NOT_FOUND.

### 16.2 Integration Tests (`backend/test/integration/realtime.lifecycle.test.ts`)
Executed against live HTTP + Socket.IO server connected to Docker PostgreSQL:
1. **Authenticated Socket Connection:** Connects client using valid JWT -> connection accepted -> auto-joins `user:<userId>`.
2. **Handshake Rejection:** Attempt connection with bad token -> connection error received.
3. **Room Authorization on Join:** Participant joins `conv:<cid>` -> succeeds. Non-participant attempts join -> error emitted and not joined.
4. **End-to-End Send & Realtime Echo:** User A posts message via HTTP `POST /conversations/:id/messages` -> both User A and User B receive `message:new` on their connected sockets with identical payload.
5. **Read Receipt Broadcast:** User B calls HTTP `PUT /conversations/:id/last-read` -> User A receives `last-read:update` on socket.
6. **Conversation List Update Broadcast:** Sending message triggers `conversation:updated` in both participants' `user:<uid>` rooms.
7. **Presence Sync & Join/Leave:** User A joins room -> User B receives `presence:join`. User A disconnects -> User B receives `presence:leave`.
8. **Typing Indicator Broadcast:** User A emits `typing` -> User B receives `typing` event; User A does not receive own echo.
9. **Cross-Room Isolation:** Sockets in `conv:A` receive zero events when messages are sent in `conv:B`.
10. **Email Privacy Invariant:** Assert zero email addresses present in all emitted event frames.

---

## 17. Adversarial QA Review

### Auditor 1 — Scope Compliance
- **Verification:** Milestone 12 covers strictly the Socket.IO server, handshake authentication, rooms, broadcaster, presence, typing, and integration test suite.
- **Boundary:** Zero modifications to M11 message schema or business logic. Frontend React adapter and Redis cluster rollout are strictly reserved for Phase 13 & 14.

### Auditor 2 — Governing Document Compliance
- **Reconciliation:** All 5 Supabase channel topics mapped with 100% semantic parity:
  - `messages-<cid>` -> `conv:<cid>` (`message:new`)
  - `last-read-<cid>-<uid>` -> `conv:<cid>` (`last-read:update`)
  - `conversations-updates-<uid>` -> `user:<uid>` (`conversation:updated`)
  - `presence-<cid>` -> `conv:<cid>` (`presence:sync`, `presence:join`, `presence:leave`, `typing`)
  - `requests-changes` -> Handled by navigation refresh parity (§8.2/#5).

### Auditor 3 — Security & Robustness
- **Attacks Evaluated & Mitigated:**
  - *Forged Sender ID in socket:* Rejected — messages are only accepted on authenticated HTTP REST.
  - *Unauthorized Room Join:* Gated by database query checking `Conversation.participants`.
  - *Cross-Conversation Leakage:* Emits are scoped exclusively to `conv:<cid>`.
  - *Rolled-Back Transaction Emit:* Prevented — broadcaster is invoked strictly post-commit.
  - *Typing Denial of Service:* Rate-limited to 1 event/sec per socket.

---

## 18. Explicit M13+ / Out-of-Scope Boundaries

- **Phase 13 (Frontend Adapter):** Replacing `supabase.channel()` in `useChat.tsx` and `usePresence.ts` with `socket.io-client` hooks.
- **Phase 14 (Redis Adapter & Multi-Instance):** `@socket.io/redis-adapter` configuration for multi-container deployments. (Single-instance in-memory adapter is standard for Phase 12).

---

## 19. Open Questions & Unresolved Decisions

- **None.** All socket events, handshake formats, authorization rules, and consistency hooks are fully specified and aligned with governing documents.
