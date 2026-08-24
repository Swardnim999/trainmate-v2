# TrainMate v2 — Milestone 8: Journeys & Train Directory Design Document

**Status:** Draft Architecture Design  
**Date:** 2026-08-24  
**Module:** Journeys Management, Train Directory, Unverified Train Logging, and Companion Discovery (`journeys`, `trains`, `unverified_trains`, `canViewJourney()`, `usersShareJourney()`)  
**Governing Documents:**
- `docs/Backend-Specification.md` (§3.2, §6.2, §9.2, §9.3, §10.3, §10.9, §11.4, §11.10)
- `docs/Backend-Architecture.md` (§2.1, §3.1, §6.3)
- `docs/Implementation-Roadmap.md` (Part I map §6.2, Part II Phase 7 & Phase 8)
- `docs/Design-Review-Report.md` (Finding F4-journeys, F7-rls, email leak analysis)
- `docs/Profiles-Design.md` (M7 Identity anchor and serializer contract)
- `docs/Moderation-Design.md` (M6 Symmetric blocking contract)
- Historical Supabase Migrations (`20251212061640`, `20251214131649`, `20251217182641`, `20251219073900`, `20251223123652`, `20260106151017`, `20260418104404`, `20260716175301`, `20260725073436`)
- Frontend Consumers (`src/pages/Dashboard.tsx`, `src/pages/Matched.tsx`, `src/lib/validations.ts`, `src/integrations/supabase/types.ts`)

---

## 1. Executive Summary & Scope

Milestone 8 (Journeys) implements the travel plan management, train directory lookup, unverified train logging, and companion discovery subsystem for TrainMate v2. 

Journeys represent a user's planned rail trip (identified by Indian Railways `train_number` + `travel_date`). They serve as the foundational matching criteria for the companion social graph: mutual companion matching, companion request dispatch (M9), conversation creation (M10), and contextual profile visibility (`canViewProfile` in M7).

### 1.1 In-Scope Deliverables
1. **Database Schema & Migrations:**
   - `Journey` Prisma model mapped to `public.journeys`.
   - `Train` Prisma model mapped to `public.trains` (seeded with standard Indian Railways trains).
   - `UnverifiedTrain` Prisma model mapped to `public.unverified_trains`.
   - Database migration `add_journeys_and_trains_tables` with CHECK constraints, foreign keys (`ON DELETE CASCADE` for user journeys), triggers, and compound indexes.
2. **Repository Layer:**
   - `JourneyRepository` (`src/repositories/journeys.repo.ts`): CRUD for journeys, user journey listing, companion matching query, and shared journey verification.
   - `TrainRepository` (`src/repositories/trains.repo.ts`): Directory search with ILIKE prefix/substring filtering.
   - `UnverifiedTrainRepository` (`src/repositories/unverified-trains.repo.ts`): Logging unverified train numbers.
3. **Authorization & Visibility Engine:**
   - `AccessService.canViewJourney(userId: string, trainNumber: string, travelDate: string | Date)` implementation.
   - `AccessService.usersShareJourney(userA: string, userB: string, trainNumber: string, travelDate: string | Date)` implementation.
   - `AccessService.hasSharedJourney(userA: string, userB: string)` concrete database implementation replacing the M7 test seam.
   - Symmetric blocking filter (`AccessService.isBlocked`) integrated into companion matching queries.
4. **Service Layer:**
   - `JourneyService` (`src/services/journey.service.ts`): Creation with atomic unverified train logging, deletion with ownership verification, user journey listing, and companion discovery.
   - `TrainService` (`src/services/train.service.ts`): Train autocomplete directory search and unverified train logging.
5. **Serialization Layer:**
   - `JourneySerializer` (`src/serializers/journey.serializer.ts`): Guarantees that no private account email or unapproved fields are ever emitted in own-journey or companion-match responses.
6. **HTTP Boundary & Validation:**
   - Zod validation schemas (`src/validation/journey.schemas.ts`, `src/validation/train.schemas.ts`).
   - `JourneyController` and `TrainController`.
   - Express routers mounting:
     - `GET /journeys/me`
     - `POST /journeys`
     - `DELETE /journeys/:id`
     - `GET /journeys/:trainNumber/:travelDate/companions`
     - `GET /trains` (with `?q=`)
     - `POST /trains/unverified`
7. **Test Suites:**
   - Unit test suites for all repositories, serializers, services, schemas, controllers, and routes.
   - Database-backed integration tests covering journey creation, deletion, atomic unverified train logging, companion discovery, and symmetric block exclusion.

### 1.2 Explicit Non-Scope (Future Milestones)
- **Companion Requests (M9):** Sending, accepting, rejecting, or canceling requests (`/requests/*`).
- **Conversations & Messaging (M10, M11):** Chat rooms, read receipts, attachments.
- **Realtime / WebSockets (M12):** Live broadcast of companion journey changes.
- **Frontend Client Migration (M13):** Updating React hooks from Supabase SDK to REST API client.

---

## 2. Governing Requirements & Historical Analysis

### 2.1 Historical Schema & Migrations Review
1. **`20251212061640`:** Initial `public.journeys` table created with columns `(id, user_id, user_email, user_name, train_number, travel_date, coach, boarding_station, destination_station, college, gender, created_at)`.
2. **`20251214131649`:** Introduced `can_view_journey(train_number, travel_date)` helper function and replaced permissive RLS policy with contextual policy (`auth.uid() = user_id OR can_view_journey(train_number, travel_date)`).
3. **`20251219073900`:** Added `public.trains` directory table, `public.unverified_trains` table, added `train_name` column to `journeys`, and seeded ~230 popular Indian Railway trains.
4. **`20251223123652`:** Added `entered_value` and `normalized_value` columns to `unverified_trains`.
5. **`20260106151017`:** Added character length constraints (`user_name <= 100`, `train_number <= 20`, `coach <= 50`, `boarding_station <= 200`, `destination_station <= 200`, `college <= 200`) and integrated `is_blocked()` into journey SELECT policy.
6. **`20260418104404` (Critical Email Leak Fix):** Dropped column `user_email` from `journeys` table because any user who shared a train+date could read other travelers' emails via the `can_view_journey` SELECT policy.

### 2.2 Frontend Contract Analysis
- **`src/pages/Dashboard.tsx`:**
  - Loads caller's journeys: `.from('journeys').select('*').eq('user_id', user.id).order('travel_date', { ascending: true })`.
  - Categorizes journeys client-side:
    - `past`: `travel_date < today`
    - `today`: `travel_date === today`
    - `upcoming`: `travel_date > today`
  - Deletes journey: `.from('journeys').delete().eq('id', journeyId)`.
  - Form submit: Validates with `journeySchema` (`src/lib/validations.ts`), logs unverified train if `!isTrainVerified`, and inserts journey row.
  - Companion search: Queries `.from('journeys').select('*').eq('train_number', journey.train_number).eq('travel_date', journey.travel_date).neq('user_id', user.id)`.
- **`src/pages/Matched.tsx`:**
  - Renders companions list for a specific journey.
  - Filters by coach, college, gender client-side.

---

## 3. Database Schema & Prisma Models

```prisma
/// User journey / travel plan (Spec §3.2, §6.2, §9.2; Roadmap Phase 7 & 8).
/// Matches are computed on exact (train_number, travel_date).
/// Foreign key onDelete: Cascade purges journeys when the user is deleted.
model Journey {
  id                 String   @id @default(uuid()) @db.Uuid
  userId             String   @map("user_id") @db.Uuid
  userName           String?  @map("user_name")
  trainNumber        String   @map("train_number")
  trainName          String?  @map("train_name")
  travelDate         DateTime @map("travel_date") @db.Date
  coach              String?
  boardingStation    String?  @map("boarding_station")
  destinationStation String?  @map("destination_station")
  college            String?
  gender             String?
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([trainNumber, travelDate])
  @@map("journeys")
}

/// Verified Indian Railways train reference directory (Spec §3.2, §9.3; Roadmap Phase 7).
model Train {
  trainNumber String   @id @map("train_number")
  trainName   String   @map("train_name")
  active      Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  @@map("trains")
}

/// Logging table for manually-entered trains not found in the verified directory (Spec §3.2, §9.3).
model UnverifiedTrain {
  id              String   @id @default(uuid()) @db.Uuid
  trainNumber     String   @map("train_number")
  trainName       String?  @map("train_name")
  submittedBy     String?  @map("submitted_by") @db.Uuid
  enteredValue    String?  @map("entered_value")
  normalizedValue String?  @map("normalized_value")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  submitter User? @relation(fields: [submittedBy], references: [id], onDelete: SetNull)

  @@index([submittedBy])
  @@map("unverified_trains")
}
```

Update `User` model in `backend/prisma/schema.prisma`:
```prisma
model User {
  id               String    @id @default(uuid()) @db.Uuid
  email            String    @unique
  passwordHash     String    @map("password_hash")
  emailConfirmedAt DateTime? @map("email_confirmed_at") @db.Timestamptz(3)
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt        DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  refreshTokens      RefreshToken[]
  emailVerifications EmailVerification[]
  blocksInitiated    BlockedUser[]       @relation("BlocksInitiated")
  blocksReceived     BlockedUser[]       @relation("BlocksReceived")
  reportsFiled       UserReport[]        @relation("ReportsFiled")
  reportsReceived    UserReport[]        @relation("ReportsReceived")
  profile            Profile?
  journeys           Journey[]
  unverifiedTrains   UnverifiedTrain[]

  @@map("users")
}
```

---

## 4. Field Semantics, Constraints & Canonical Representations

| Field | DB Column | Postgres Type | Nullable | Length / Validation | Notes / Canonical Representation |
|---|---|---|---|---|---|
| `id` | `id` | `UUID` | No | PK | Generated UUID |
| `userId` | `user_id` | `UUID` | No | FK → `users.id` | Authenticated owner ID |
| `userName` | `user_name` | `TEXT` | Yes | $\le 100$ chars | Denormalized display name from profile at insert |
| `trainNumber` | `train_number` | `TEXT` | No | $\le 20$ chars, `[A-Za-z0-9\s-]` | Trimmed uppercase / standard train number string |
| `trainName` | `train_name` | `TEXT` | Yes | String | Denormalized from `trains.train_name` or user input |
| `travelDate` | `travel_date` | `DATE` | No | ISO Date `YYYY-MM-DD` | Calendar date (no time component). Evaluated at UTC midnight |
| `coach` | `coach` | `TEXT` | Yes | $\le 50$ chars | Coach identifier (e.g. `B1`, `S4`, `M2`, `A1`) |
| `boardingStation` | `boarding_station` | `TEXT` | Yes | $\le 200$ chars | Boarding station name / code |
| `destinationStation` | `destination_station` | `TEXT` | Yes | $\le 200$ chars | Destination station name / code |
| `college` | `college` | `TEXT` | Yes | $\le 200$ chars | College / institution / organization |
| `gender` | `gender` | `TEXT` | Yes | String | `male`, `female`, `other`, `prefer-not-to-say` |
| `createdAt` | `created_at` | `TIMESTAMPTZ(3)` | No | `now()` | Timestamp of journey creation |

---

## 5. Authorization, Visibility & Privacy Invariants

### 5.1 Journey Ownership & Modification Rules
1. **Ownership Enforcement:**
   - A user can only view their own full journey list via `GET /journeys/me`.
   - A user can only delete their own journey via `DELETE /journeys/:id` (`where: { id, userId: req.user.id }`).
   - If a caller attempts to delete another user's journey or a non-existent journey, the backend returns `404 NOT_FOUND` (masking existence).
2. **Duplicate Journeys:**
   - Duplicate journeys (same user, same train number, same travel date) are **explicitly allowed** by historical design (§9.2). No unique constraint is placed on `(user_id, train_number, travel_date)`.

### 5.2 Companion Discovery Authorization (`canViewJourney` & Blocking)
1. **Exact-Match Matching Criteria:**
   - Matching is strictly computed on `train_number == target.train_number AND travel_date == target.travel_date`.
   - Coach, college, gender, and route are display-only and filterable client-side; they are **never** match constraints in the database.
2. **Symmetric Block Exclusion:**
   - Companion discovery queries (`GET /journeys/:trainNumber/:travelDate/companions`) must exclude all records belonging to users blocked by the caller or who have blocked the caller (`AccessService.isBlocked`).
3. **Strict Email Privacy:**
   - Journey rows returned to companion seekers **never contain email addresses**. The legacy `user_email` column was dropped, and the serializer strictly shapes the output to public companion properties only.

---

## 6. Train Directory & Atomic Unverified Logging

### 6.1 Train Directory Autocomplete (`GET /trains?q=`)
- Autocomplete searches the `trains` reference table where `active = true`.
- Matches against either `train_number` (prefix / substring) OR `train_name` (case-insensitive substring `ILIKE %q%`).
- Returns up to 15 records sorted alphabetically / numerically.
- If query string `q` has length $< 2$, returns empty array `[]` (matching frontend debounce threshold).

### 6.2 Atomic Journey + Unverified Train Logging Transaction
In legacy Supabase, `Dashboard.tsx` performed a non-transactional two-step insert: writing to `unverified_trains`, then inserting into `journeys`. If the journey insert failed, an orphan unverified train row was left behind.

In TrainMate v2:
1. When `POST /journeys` receives a payload where `isTrainVerified === false` (or when the submitted train is not present in `trains`):
2. Both the `journeys` insertion and the `unverified_trains` logging are executed inside a **single Prisma database transaction** (`prisma.$transaction`):
   ```typescript
   await prisma.$transaction(async (tx) => {
     if (!isVerified && trainNumber) {
       await tx.unverifiedTrain.create({
         data: {
           trainNumber: normalizedTrainNumber,
           trainName: trainName ?? null,
           submittedBy: userId,
           enteredValue: rawInput,
           normalizedValue: rawInput.toLowerCase().trim(),
         },
       });
     }
     return tx.journey.create({ ... });
   });
   ```
3. If the journey insert fails validation or constraints, the unverified train log is automatically rolled back, preventing orphan rows.

---

## 7. REST API Contracts

### 7.1 `GET /journeys/me`
- **Authentication:** Required (Bearer JWT).
- **Description:** Retrieves all journeys created by the authenticated user, ordered by `travel_date ASC`.
- **Response Shape (200 OK):**
  ```json
  [
    {
      "id": "11111111-1111-4000-8000-111111111111",
      "user_id": "00000000-0000-4000-8000-000000000001",
      "user_name": "Alex Smith",
      "train_number": "12301",
      "train_name": "Howrah Rajdhani Express",
      "travel_date": "2026-09-15",
      "coach": "B1",
      "boarding_station": "New Delhi",
      "destination_station": "Howrah",
      "college": "IIT Delhi",
      "gender": "prefer-not-to-say",
      "created_at": "2026-08-24T12:00:00.000Z"
    }
  ]
  ```

### 7.2 `POST /journeys`
- **Authentication:** Required (Bearer JWT).
- **Description:** Creates a new journey for the authenticated user and optionally logs unverified train numbers atomically.
- **Request Body:**
  ```json
  {
    "train_number": "12301",
    "train_name": "Howrah Rajdhani Express",
    "travel_date": "2026-09-15",
    "coach": "B1",
    "boarding_station": "New Delhi",
    "destination_station": "Howrah",
    "college": "IIT Delhi",
    "gender": "prefer-not-to-say",
    "user_name": "Alex Smith",
    "is_train_verified": true
  }
  ```
- **Validation Rules:**
  - `train_number`: required string, trimmed, 1..20 chars, regex `^[A-Za-z0-9\s-]+$`.
  - `travel_date`: required ISO Date string `YYYY-MM-DD`. Must be valid date.
  - `user_name`: optional string, max 100 chars (defaults to caller profile name).
  - `coach`: optional string, max 50 chars.
  - `boarding_station`: optional string (or required 1..200 per frontend), trimmed.
  - `destination_station`: optional string (or required 1..200 per frontend), trimmed.
  - `college`: optional string, max 200 chars.
  - `gender`: optional enum `['male', 'female', 'other', 'prefer-not-to-say', 'prefer_not_to_say', '']`.
  - `is_train_verified`: optional boolean (default `false`).
- **Response Shape (201 Created):**
  ```json
  {
    "id": "11111111-1111-4000-8000-111111111111",
    "user_id": "00000000-0000-4000-8000-000000000001",
    "user_name": "Alex Smith",
    "train_number": "12301",
    "train_name": "Howrah Rajdhani Express",
    "travel_date": "2026-09-15",
    "coach": "B1",
    "boarding_station": "New Delhi",
    "destination_station": "Howrah",
    "college": "IIT Delhi",
    "gender": "prefer-not-to-say",
    "created_at": "2026-08-24T12:00:00.000Z"
  }
  ```

### 7.3 `DELETE /journeys/:id`
- **Authentication:** Required (Bearer JWT).
- **Description:** Deletes a journey belonging to the authenticated user.
- **Status Codes:**
  - `204 No Content`: Successfully deleted.
  - `400 Bad Request`: Malformed UUID.
  - `401 Unauthorized`: Missing/invalid JWT.
  - `404 Not Found`: Journey does not exist or is not owned by the caller.

### 7.4 `GET /journeys/:trainNumber/:travelDate/companions`
- **Authentication:** Required (Bearer JWT).
- **Description:** Discovers other users travelling on the exact same train and date, excluding blocked users.
- **Parameters:**
  - `trainNumber`: string (train number)
  - `travelDate`: string (ISO date `YYYY-MM-DD`)
- **Response Shape (200 OK):**
  ```json
  [
    {
      "id": "22222222-2222-4000-8000-222222222222",
      "user_id": "00000000-0000-4000-8000-000000000002",
      "user_name": "Sam Taylor",
      "train_number": "12301",
      "train_name": "Howrah Rajdhani Express",
      "travel_date": "2026-09-15",
      "coach": "B2",
      "boarding_station": "New Delhi",
      "destination_station": "Kanpur",
      "college": "BITS Pilani",
      "gender": "female",
      "created_at": "2026-08-24T12:10:00.000Z"
    }
  ]
  ```

### 7.5 `GET /trains`
- **Authentication:** Required (Bearer JWT).
- **Query Parameters:** `q` (search string, optional).
- **Description:** Autocomplete search across verified Indian Railways trains (`active = true`).
- **Response Shape (200 OK):**
  ```json
  [
    {
      "train_number": "12301",
      "train_name": "Howrah Rajdhani Express"
    },
    {
      "train_number": "12302",
      "train_name": "New Delhi Rajdhani Express"
    }
  ]
  ```

### 7.6 `POST /trains/unverified`
- **Authentication:** Required (Bearer JWT).
- **Description:** Standalone endpoint for logging an unverified train entry (matches §10.9).
- **Request Body:**
  ```json
  {
    "train_number": "99999",
    "train_name": "Special Summer Express"
  }
  ```
- **Response Shape (201 Created):**
  ```json
  {
    "id": "33333333-3333-4000-8000-333333333333",
    "train_number": "99999",
    "train_name": "Special Summer Express",
    "submitted_by": "00000000-0000-4000-8000-000000000001",
    "created_at": "2026-08-24T12:20:00.000Z"
  }
  ```

---

## 8. Architectural Boundaries & Component Interaction

```
[ Client Request: POST /journeys ]
                │
                ▼
    [ authenticate middleware ] ──(401 if unauthenticated)
                │
                ▼
    [ validateBody(createJourneySchema) ] ──(400 if validation fails)
                │
                ▼
    [ JourneyController.createJourney ]
                │
                ▼
    [ JourneyService.createJourney ]
        ├── Fetch caller profile name if not provided
        ├── Look up train in TrainRepository (denormalize train_name)
        └── Execute Prisma Transaction:
             ├── tx.unverifiedTrain.create(...) [if unverified]
             └── tx.journey.create(...)
                │
                ▼
    [ JourneySerializer.toJourneyResponse ] ──(Ensures email never included)
                │
                ▼
    [ 201 Created JSON Response ]
```

### 8.1 `JourneyRepository` (`src/repositories/journeys.repo.ts`)
- `findByUserId(userId: string): Promise<Journey[]>`
- `findById(id: string): Promise<Journey | null>`
- `create(data: CreateJourneyData, tx?: Prisma.TransactionClient): Promise<Journey>`
- `deleteByIdAndUser(id: string, userId: string): Promise<boolean>`
- `findCompanions(userId: string, trainNumber: string, travelDate: Date, blockedUserIds: Set<string>): Promise<Journey[]>`
- `hasSharedJourney(userA: string, userB: string): Promise<boolean>`
- `usersShareSpecificJourney(userA: string, userB: string, trainNumber: string, travelDate: Date): Promise<boolean>`

### 8.2 `TrainRepository` (`src/repositories/trains.repo.ts`)
- `findByNumber(trainNumber: string): Promise<Train | null>`
- `search(query: string, limit?: number): Promise<Train[]>`
- `seedTrains(trains: Array<{ trainNumber: string; trainName: string }>): Promise<void>`

### 8.3 `UnverifiedTrainRepository` (`src/repositories/unverified-trains.repo.ts`)
- `create(data: CreateUnverifiedTrainData, tx?: Prisma.TransactionClient): Promise<UnverifiedTrain>`

---

## 9. Security, Threat & Adversarial Analysis

| Threat / Attack Vector | Mitigating Design Control | Verification Mechanism |
|---|---|---|
| **Identity Forgery (`user_id` spoofing)** | `user_id` is always overridden with `req.user.id` from verified JWT. | Route test sending `{ user_id: "other-user-uuid" }` asserting own user ID is stored. |
| **Deleting Other Users' Journeys** | `deleteByIdAndUser` strictly checks `WHERE id = :id AND user_id = :callerId`. Returns 404 on failure. | Test attempting to delete User B's journey using User A's token. |
| **Email Leakage in Companion Discovery** | `Journey` model has no email column; `JourneySerializer` explicitly constructs public match fields. | Dedicated test asserting `'email' in res.body[0] === false`. |
| **Bypassing Symmetric Block** | `findCompanions` fetches symmetric blocked user IDs via `AccessService.getSymmetricBlockedUserIds` and filters them out (`userId: { notIn: [...] }`). | Test verifying that if User A blocks User B, User B never appears in User A's companion matches. |
| **Orphan Unverified Train Rows** | Journey creation and unverified logging are wrapped in a single database transaction. | Failure-injection integration test asserting rollback on mid-insert error. |
| **Date Parsing / Timezone Confusion** | `travel_date` is stored as PostgreSQL native `DATE` (`@db.Date`), avoiding UTC/local day-boundary skew. | Integration tests comparing dates formatted across multiple timezones. |

---

## 10. Database Migration Plan

### 10.1 Migration DDL (`20260826120000_add_journeys_and_trains_tables/migration.sql`)
```sql
-- CreateTable: trains
CREATE TABLE "trains" (
    "train_number" TEXT NOT NULL,
    "train_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trains_pkey" PRIMARY KEY ("train_number")
);

-- CreateTable: journeys
CREATE TABLE "journeys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "user_name" TEXT,
    "train_number" TEXT NOT NULL,
    "train_name" TEXT,
    "travel_date" DATE NOT NULL,
    "coach" TEXT,
    "boarding_station" TEXT,
    "destination_station" TEXT,
    "college" TEXT,
    "gender" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable: unverified_trains
CREATE TABLE "unverified_trains" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "train_number" TEXT NOT NULL,
    "train_name" TEXT,
    "submitted_by" UUID,
    "entered_value" TEXT,
    "normalized_value" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unverified_trains_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: journeys -> users
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: unverified_trains -> users
ALTER TABLE "unverified_trains" ADD CONSTRAINT "unverified_trains_submitted_by_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add check constraints matching historical schema
ALTER TABLE "journeys" ADD CONSTRAINT "check_user_name_length"
    CHECK ("user_name" IS NULL OR char_length("user_name") <= 100);

ALTER TABLE "journeys" ADD CONSTRAINT "check_train_number_length"
    CHECK (char_length("train_number") <= 20);

ALTER TABLE "journeys" ADD CONSTRAINT "check_coach_length"
    CHECK ("coach" IS NULL OR char_length("coach") <= 50);

ALTER TABLE "journeys" ADD CONSTRAINT "check_boarding_station_length"
    CHECK ("boarding_station" IS NULL OR char_length("boarding_station") <= 200);

ALTER TABLE "journeys" ADD CONSTRAINT "check_destination_station_length"
    CHECK ("destination_station" IS NULL OR char_length("destination_station") <= 200);

ALTER TABLE "journeys" ADD CONSTRAINT "check_college_length"
    CHECK ("college" IS NULL OR char_length("college") <= 200);

-- Create Indexes
CREATE INDEX "journeys_user_id_idx" ON "journeys"("user_id");
CREATE INDEX "journeys_train_number_travel_date_idx" ON "journeys"("train_number", "travel_date");
CREATE INDEX "unverified_trains_submitted_by_idx" ON "unverified_trains"("submitted_by");
```

---

## 11. Testing Strategy

### 11.1 Unit Tests
- `test/repositories/journeys.repo.test.ts`: CRUD, companion matching query, block exclusion, shared journey query.
- `test/repositories/trains.repo.test.ts`: Autocomplete search, limit enforcement, case-insensitivity.
- `test/repositories/unverified-trains.repo.test.ts`: Insert logging, nullable user support.
- `test/services/journey.service.test.ts`: Own journey retrieval, creation with denormalization, deletion ownership guard, companion discovery.
- `test/services/train.service.test.ts`: Query delegation, fallback to empty array on short queries.
- `test/validation/journey.schemas.test.ts`: Schema boundary testing (length limits, date format, regex).
- `test/controllers/journey.controller.test.ts` & `test/controllers/train.controller.test.ts`: HTTP request parameter mapping and response codes.
- `test/routes/journeys.routes.test.ts` & `test/routes/trains.routes.test.ts`: Authentication enforcement, input validation middleware, status code mapping.

### 11.2 Integration Tests (`test/integration/journey.lifecycle.test.ts`)
- Database-backed test against real PostgreSQL:
  1. User A creates verified journey -> verified train name denormalized, no unverified log created.
  2. User A creates unverified journey -> `unverified_trains` record created with `normalized_value` in same transaction.
  3. User A lists journeys -> returns journeys ordered by `travel_date ASC`.
  4. User B creates journey on same train and date.
  5. User A queries companions for that train+date -> returns User B's journey (assert email absent).
  6. User A blocks User B -> User A queries companions -> returns empty list (blocked user excluded).
  7. User A attempts to delete User B's journey -> returns 404.
  8. User A deletes own journey -> returns 204.
  9. User A deleted via `prisma.user.delete` -> cascade deletes User A's remaining journeys.

---

## 12. Decision Log & Open Questions

### 12.1 Decision Log
1. **Decision D-J1 (Atomic Transaction for Unverified Train Logging):**
   - *Rationale:* In Supabase, the frontend issued two independent network requests, risking orphan logs on failure. Storing both in a single database transaction guarantees atomic consistency.
2. **Decision D-J2 (Date Representation as Native Postgres `DATE`):**
   - *Rationale:* Indian train journeys are planned by calendar day. Using `@db.Date` prevents timezone offsets from shifting travel dates across UTC midnight boundaries.
3. **Decision D-J3 (Duplicate Journey Policy):**
   - *Rationale:* In accordance with §9.2, duplicate journeys by the same user on the same train+date are permitted (no unique constraint).
4. **Decision D-J4 (Server Matchable Window Policy):**
   - *Rationale:* Frontend enforces `travel_date >= today` for matching companions. The server endpoint allows querying any valid date for parity with historical PostgREST queries.

### 12.2 Open Questions
- *None.* The database schema, frontend consumers, and backend specification provide unambiguous contracts.

---

## 13. Implementation Target Files Summary (For Future Execution)

When the implementation phase is authorized, the following files will be created or modified:

1. `backend/prisma/schema.prisma` — Add `Journey`, `Train`, and `UnverifiedTrain` models, and relations on `User`.
2. `backend/prisma/migrations/20260826120000_add_journeys_and_trains_tables/migration.sql` — DDL migration.
3. `backend/src/repositories/journeys.repo.ts` — Data access layer for journeys.
4. `backend/src/repositories/trains.repo.ts` — Data access layer for trains.
5. `backend/src/repositories/unverified-trains.repo.ts` — Data access layer for unverified trains.
6. `backend/src/serializers/journey.serializer.ts` — Journey response serializer.
7. `backend/src/services/access.service.ts` — Replace raw SQL in `hasSharedJourney` with Prisma queries and implement `canViewJourney`.
8. `backend/src/services/journey.service.ts` — Journey management and matching service.
9. `backend/src/services/train.service.ts` — Train directory search service.
10. `backend/src/validation/journey.schemas.ts` & `train.schemas.ts` — Zod schemas.
11. `backend/src/controllers/journey.controller.ts` & `train.controller.ts` — Express controllers.
12. `backend/src/routes/journeys.routes.ts` & `trains.routes.ts` — Express routers.
13. `backend/src/app.ts` — App router mounting.
14. Unit and database-backed integration test suites in `backend/test/`.
