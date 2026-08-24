# TrainMate v2 — Milestone 7: Profiles Design Document

**Status:** Approved Architecture Design  
**Date:** 2026-08-24  
**Module:** User Profiles, Identity Lifecycle, and Contextual Visibility (`profiles`, `canViewProfile()`, `profiles_safe` Parity)  
**Governing Documents:**
- `docs/Backend-Specification.md` (§3.2, §3.3, §6.1, §6.12#1, §7.1–§7.3, §9.1, §10.2, §11.3, §13.6)
- `docs/Backend-Architecture.md` (§2.1, §3.1, §3.2, §6.2)
- `docs/Implementation-Roadmap.md` (Part I map §6.1, Part II Phase 6)
- `docs/Design-Review-Report.md` (Finding St1/Rm4, F3-auth, F7-rls, email leak analysis)
- `docs/Moderation-Design.md` (M6 symmetric blocking contract)
- Historical Supabase Migrations (`20251212061640`, `20251217182641`, `20251227101646`, `20260106151017`, `20260119144831`, `20260703100726`, `20260716175301`, `20260725073436`)
- Frontend Consumers (`src/hooks/useProfile.ts`, `src/components/ProfileModal.tsx`, `src/pages/Requests.tsx`, `src/pages/Chats.tsx`, `src/hooks/useChat.tsx`)

---

## Executive Summary

Milestone 7 (Profiles) establishes the identity and profile subsystem for TrainMate v2. It ports the `profiles` table from historical Supabase to the self-hosted Express/Prisma architecture, introduces profile auto-bootstrap on user creation, implements the core contextual visibility authorization engine (`canViewProfile`), enforces the **strict email-privacy invariant** (preventing the historical Supabase email-leak vulnerability), and provides authenticated REST endpoints for reading and updating profiles and avatars.

Profiles is the identity surface referenced by all downstream subsystems: Journeys (M8), Matching (M8), Requests (M9), Conversations (M10), Messages (M11), and Realtime (M12).

---

## 1. M7 Scope and Explicit Non-Scope

### 1.1 In-Scope Deliverables
1. **Database Layer:**
   - `Profile` Prisma model mapped to `public.profiles`.
   - Foreign key relation to `User` with `onDelete: Cascade`.
   - Database migration `add_profiles_table` with constraints, triggers, and indexes.
   - `update_profiles_updated_at` trigger for automatic timestamp tracking.
   - Auto-bootstrap trigger/mechanism on user registration.
2. **Repository Layer:**
   - `ProfileRepository` (`src/repositories/profiles.repo.ts`) providing thin, typed CRUD operations.
3. **Authorization & Visibility Engine:**
   - `AccessService.canViewProfile(requesterId: string, targetProfileId: string): Promise<boolean>` implementing the 4-arm contextual visibility rule gated by symmetric `isBlocked()`.
4. **Service Layer:**
   - `ProfileService` (`src/services/profile.service.ts`) managing profile fetching, updates, name lookups, and avatar storage integration.
5. **Serialization Layer:**
   - `ProfileSerializer` (`src/serializers/profile.serializer.ts`) strictly preventing email leakage to non-owners.
6. **HTTP Boundary & Validation:**
   - Zod validation schemas (`src/validation/profile.schemas.ts`).
   - `ProfileController` (`src/controllers/profile.controller.ts`).
   - Express router (`src/routes/profile.routes.ts`) mounting:
     - `GET /profiles/me`
     - `PATCH /profiles/me`
     - `GET /profiles/:userId`
     - `GET /profiles/:userId/name`
7. **Test Suites:**
   - Unit tests covering `ProfileRepository`, `ProfileSerializer`, `AccessService.canViewProfile`, `ProfileService`, and route boundaries.
   - Database-backed integration tests covering the complete profile lifecycle, contextual visibility arms, own-profile mutations, email privacy invariants, cascade deletions, and blocking visibility cutoffs.

### 1.2 Explicit Non-Scope (Future Milestones)
- **Journeys CRUD & Matching (M8):** Creating and searching journey companion matches (`/journeys/*`).
- **Companion Requests (M9):** Sending, accepting, and rejecting requests (`/requests/*`).
- **Conversations (M10):** Creating and soft-deleting conversation threads (`/conversations/*`).
- **Messages & Attachments (M11):** Sending messages and chat attachments (`/messages/*`).
- **Realtime / Socket.IO (M12):** WebSocket subscriptions and presence channels.
- **Frontend Migration / API Client Adapter (M13):** Rewriting React client queries from Supabase SDK to Express REST API.

---

## 2. Existing Supabase Schema vs. Target Schema

### 2.1 Historical Supabase Schema Analysis
In historical Supabase migrations:
- **`20251212061640`:** Initial `public.profiles` created with columns `(id, email, name, college, gender, created_at, updated_at)` and trigger `on_auth_user_created` inserting `(id, email)` on signup.
- **`20251227101646`:** Added `bio text`, `hobbies text`, `avatar_url text`.
- **`20260106151017`:** Added character length constraints (`name <= 100`, `bio <= 500`, `hobbies <= 200`, `college <= 200`).
- **`20260119144831`:** Created view `public.profiles_safe` (`CASE WHEN auth.uid() = id THEN email ELSE NULL END AS email`).
- **`20260703100726`:** Executed `REVOKE SELECT (email) ON public.profiles FROM authenticated, anon`.
- **`20260725073436` (Legacy Security Vulnerability):** Executed blanket `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`. In PostgreSQL, table-level grants override column-level revokes. Consequently, in live Supabase, any user passing `can_view_profile` can read `profiles.email` directly because the frontend queries `profiles` rather than `profiles_safe`.

### 2.2 Target Prisma Schema
In the target Express/Prisma backend:
1. `Profile` is a dedicated model with a 1:1 relation to `User` (`id` matches `User.id` as primary and foreign key).
2. The legacy email leak is **completely eliminated** at both the service and serializer layer.
3. Gender values are normalized while maintaining backwards compatibility with historical data.

```prisma
/// User profile information and public identity (Spec §3.2, §6.1; Roadmap Phase 6).
/// 1:1 relationship with User model, primary key is userId.
/// Foreign key onDelete: Cascade ensures profile is purged when User is deleted.
model Profile {
  id        String   @id @db.Uuid
  name      String?
  bio       String?
  hobbies   String?
  college   String?
  gender    String?
  avatarUrl String?  @map("avatar_url")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)

  user User @relation(fields: [id], references: [id], onDelete: Cascade)

  @@map("profiles")
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

  @@map("users")
}
```

---

## 3. Profile Fields and Semantics

| Field | Database Column | Postgres Type | Nullable | Max Length / Validation | Description / Notes |
|---|---|---|---|---|---|
| `id` | `id` | `UUID` | No | PK, FK → `users.id` | User UUID, immutable identity anchor |
| `name` | `name` | `TEXT` | Yes | $\le 100$ chars, trimmed | Display name shown across matches, requests, and chats |
| `bio` | `bio` | `TEXT` | Yes | $\le 500$ chars, trimmed | User biography / travel style description |
| `hobbies` | `hobbies` | `TEXT` | Yes | $\le 200$ chars, trimmed | Comma-separated hobbies or interests |
| `college` | `college` | `TEXT` | Yes | $\le 200$ chars, trimmed | College / institution affiliation |
| `gender` | `gender` | `TEXT` | Yes | Enum validation | `male`, `female`, `other`, `prefer_not_to_say` (normalized from `prefer-not-to-say`) |
| `avatarUrl` | `avatar_url` | `TEXT` | Yes | $\le 2000$ chars | S3 storage key or signed URL for avatar rendering |
| `createdAt` | `created_at` | `TIMESTAMPTZ(3)` | No | `DEFAULT CURRENT_TIMESTAMP` | Profile creation timestamp |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ(3)` | No | `DEFAULT CURRENT_TIMESTAMP` | Auto-updated on every modification |

---

## 4. Email Privacy Invariant & Serialization Contract

### 4.1 Invariant Definition (Spec §6.12#1)
> **CRITICAL SECURITY INVARIANT:** Another user's email address MUST NEVER be exposed in any API response or serialization payload under any circumstances.

### 4.2 Own Profile vs. Another User's Profile
1. **Own Profile (`GET /profiles/me`):**
   - Returns the authenticated user's profile combined with their account email (from `User.email`):
   ```json
   {
     "id": "00000000-0000-4000-8000-000000000001",
     "email": "user@example.com",
     "name": "Alex Smith",
     "bio": "Frequent train traveler",
     "hobbies": "Reading, Music",
     "college": "IIT Delhi",
     "gender": "male",
     "avatar_url": "https://storage.trainmate.local/avatars/00000000-0000-4000-8000-000000000001/avatar.jpg?token=..."
   }
   ```
2. **Another User's Profile (`GET /profiles/:userId`):**
   - Returns the public profile fields ONLY if authorized by `canViewProfile`.
   - **`email` key is strictly omitted** (not just `null` — absent from the JSON object):
   ```json
   {
     "id": "00000000-0000-4000-8000-000000000002",
     "name": "Sam Taylor",
     "bio": "Tech enthusiast",
     "hobbies": "Chess, Coding",
     "college": "BITS Pilani",
     "gender": "female",
     "avatar_url": "https://storage.trainmate.local/avatars/00000000-0000-4000-8000-000000000002/avatar.jpg?token=..."
   }
   ```
3. **Display Name Lookup (`GET /profiles/:userId/name`):**
   - Used by frontend (`Requests.tsx`, `Chats.tsx`) prior to conversation initialization.
   - Returns:
   ```json
   {
     "name": "Sam Taylor"
   }
   ```
   - If user exists but name is null, returns `{"name": null}`. If user is not visible or non-existent, returns `{"name": null}` or 404.

---

## 5. Contextual Profile Visibility & `canViewProfile`

### 5.1 Canonical Visibility Formula
In Supabase SQL, contextual visibility was defined in `public.can_view_profile(profile_id)` (migration `20251217182641`). In the target backend, this is canonically implemented in `AccessService`:

$$\text{canViewProfile}(R, T) \iff (R = T) \lor \Big(\neg\text{isBlocked}(R, T) \land \big(\text{hasSharedJourney}(R, T) \lor \text{hasAcceptedRequest}(R, T) \lor \text{hasSharedConversation}(R, T)\big)\Big)$$

Where:
- $R$ is the requester user ID (`req.user.id`).
- $T$ is the target user ID (`:userId`).
- $\text{isBlocked}(R, T)$ is the symmetric block check from M6 (`AccessService.isBlocked`).

### 5.2 The Four Visibility Arms
1. **Self-Ownership Arm ($R = T$):**
   - A user can always view their own profile.
2. **Shared Journey Arm ($\text{hasSharedJourney}(R, T)$):**
   - Returns `true` if there exists at least one journey for $R$ and one journey for $T$ with identical `train_number` AND identical `travel_date`.
   - Evaluated via indexed query on `journeys(train_number, travel_date)`.
3. **Accepted Companion Request Arm ($\text{hasAcceptedRequest}(R, T)$):**
   - Returns `true` if there exists a record in `requests` where `status = 'accepted'` and `(from_user_id = R AND to_user_id = T)` OR `(from_user_id = T AND to_user_id = R)`.
4. **Shared Conversation Arm ($\text{hasSharedConversation}(R, T)$):**
   - Returns `true` if there exists a record in `conversations` where both $R$ and $T$ are contained in the `participants` UUID array.

### 5.3 Gating and Non-Existence Handling
- **Block Override:** If either user has blocked the other, all three contextual arms are completely invalidated, and `canViewProfile` returns `false`.
- **404 Masking:** When `canViewProfile` returns `false`, `GET /profiles/:userId` responds with `404 USER_NOT_FOUND` / `Profile not found` rather than 403, preventing attackers from probing whether an arbitrary user ID exists in the system.

---

## 6. Avatar Storage Architecture & URL Handling

### 6.1 S3 Storage Conventions
- **Bucket:** `avatars` (private bucket in MinIO / S3 / Cloud Storage).
- **Object Key Scheme:** `<user_id>/avatar.<ext>` (e.g. `00000000-0000-4000-8000-000000000001/avatar.jpg`).
- **Path Isolation:** A user may only upload, overwrite, or delete objects within their own `<user_id>/` folder prefix.

### 6.2 Signed URL Generation vs. Stored URLs
- **Upload Flow:**
  1. Frontend uploads image to S3 storage bucket under `${userId}/avatar.${ext}`.
  2. S3 client generates a long-lived (or short-lived) signed URL.
  3. Frontend sends `PATCH /profiles/me` with `{ avatar_url: "..." }`.
- **Cache-Buster Compatibility (Design-Review-Report Finding St1/Rm4):**
  - Frontend hook `useProfile.ts:49-53` implements:
    ```typescript
    const getAvatarUrl = (url) => {
      if (!url) return undefined;
      const baseUrl = url.split('?')[0];
      return `${baseUrl}?t=${avatarVersion}`;
    };
    ```
  - Storing the public/proxy URL or full signed URL directly in `profiles.avatar_url` ensures existing frontend avatar rendering in `ProfileModal`, `ProfileMenu`, and chat avatars remains completely functional.

---

## 7. Profile Auto-Creation & Lifecycle Hooks

### 7.1 Signup Profile Bootstrapping
When a new user registers:
1. In `AuthService.register()`, after `User` creation:
   - Call `bootstrapProfile(user.id, user.email)` (the test-seam hook established in M3 `auth.service.ts:149`).
2. `bootstrapProfile` inserts a blank `Profile` row:
   ```typescript
   await prisma.profile.create({
     data: {
       id: userId,
       name: null,
       bio: null,
       hobbies: null,
       college: null,
       gender: null,
       avatarUrl: null,
     },
   });
   ```
3. In PostgreSQL database migrations, a database trigger `on_auth_user_created` (analogous to legacy Supabase trigger `handle_new_user`) will also be defined as defense-in-depth for any direct database user creation.
4. **Idempotency:** `ProfileRepository.findOrCreate(userId)` handles any potential race conditions where a profile record is requested before the trigger/bootstrap finishes.

---

## 8. REST API Contracts

### 8.1 `GET /profiles/me`
- **Authentication:** Required (Bearer JWT).
- **Description:** Retrieves the authenticated user's full profile including their account email.
- **Status Codes:**
  - `200 OK`: Profile retrieved successfully.
  - `401 AUTH_REQUIRED`: Missing or invalid JWT.
- **Response Payload:**
  ```json
  {
    "id": "00000000-0000-4000-8000-000000000001",
    "email": "user@example.com",
    "name": "Alex Smith",
    "bio": "Frequent train traveler",
    "hobbies": "Reading, Music",
    "college": "IIT Delhi",
    "gender": "prefer_not_to_say",
    "avatar_url": "https://...",
    "created_at": "2026-08-24T12:00:00.000Z",
    "updated_at": "2026-08-24T12:30:00.000Z"
  }
  ```

### 8.2 `PATCH /profiles/me`
- **Authentication:** Required (Bearer JWT).
- **Description:** Updates fields on the authenticated user's own profile.
- **Request Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "name": "Alex Smith",
    "bio": "Frequent train traveler",
    "hobbies": "Reading, Music",
    "college": "IIT Delhi",
    "gender": "male",
    "avatar_url": "https://..."
  }
  ```
- **Validation Rules:**
  - `name`: optional string, trimmed, 1..100 characters (or nullable).
  - `bio`: optional string, trimmed, max 500 characters, or null.
  - `hobbies`: optional string, trimmed, max 200 characters, or null.
  - `college`: optional string, trimmed, max 200 characters, or null.
  - `gender`: optional string enum `['male', 'female', 'other', 'prefer_not_to_say', 'prefer-not-to-say']` (normalized to `prefer_not_to_say`), or null.
  - `avatar_url`: optional string, max 2000 characters, or null.
  - Extra/unknown fields are stripped; `id`, `email`, `created_at`, `updated_at` cannot be mass-assigned.
- **Status Codes:**
  - `200 OK`: Profile updated successfully (returns updated profile).
  - `400 VALIDATION_ERROR`: Malformed input.
  - `401 AUTH_REQUIRED`: Missing/invalid JWT.

### 8.3 `GET /profiles/:userId`
- **Authentication:** Required (Bearer JWT).
- **Description:** Retrieves contextual public profile for another user.
- **Authorization:** Requires `AccessService.canViewProfile(req.user.id, userId) === true`.
- **Status Codes:**
  - `200 OK`: Authorized profile returned (**email strictly omitted**).
  - `400 VALIDATION_ERROR`: Invalid UUID format in `:userId`.
  - `401 AUTH_REQUIRED`: Missing/invalid JWT.
  - `404 USER_NOT_FOUND`: Target user does not exist, or caller is not authorized to view the profile (including blocked pairs).
- **Response Payload:**
  ```json
  {
    "id": "00000000-0000-4000-8000-000000000002",
    "name": "Sam Taylor",
    "bio": "Tech enthusiast",
    "hobbies": "Chess, Coding",
    "college": "BITS Pilani",
    "gender": "female",
    "avatar_url": "https://...",
    "created_at": "2026-08-24T12:00:00.000Z",
    "updated_at": "2026-08-24T12:30:00.000Z"
  }
  ```

### 8.4 `GET /profiles/:userId/name`
- **Authentication:** Required (Bearer JWT).
- **Description:** Returns the display name of a target user (matches PostgREST `.select('name').eq('id', uid).maybeSingle()`).
- **Authorization:** If not authorized or blocked, returns `{"name": null}` or 404.
- **Status Codes:**
  - `200 OK`: `{ "name": "Sam Taylor" }` or `{ "name": null }`.
  - `400 VALIDATION_ERROR`: Invalid UUID format.
  - `401 AUTH_REQUIRED`: Missing/invalid JWT.

---

## 9. Architectural Boundaries & Component Design

```
[ HTTP Request: GET /profiles/:userId ]
                 │
                 ▼
     [ authenticate middleware ] ──(401 if unauthenticated)
                 │
                 ▼
     [ validateParams middleware ] ──(400 if invalid UUID)
                 │
                 ▼
     [ ProfileController.getProfile ]
                 │
                 ▼
     [ ProfileService.getProfileById ]
        ├── 1. Check AccessService.canViewProfile(callerId, targetId)
        │        ├── isBlocked(callerId, targetId) ──(false if blocked)
        │        ├── check shared journeys in DB
        │        ├── check accepted requests in DB
        │        └── check conversation participants in DB
        │
        ├── 2. ProfileRepository.findById(targetId)
        │
        └── 3. ProfileSerializer.toPublicProfile(profile) ──(Strips email completely)
                 │
                 ▼
     [ 200 OK JSON Response / 404 Error ]
```

### 9.1 `ProfileRepository` (`src/repositories/profiles.repo.ts`)
Thin CRUD operations against `prisma.profile`:
- `findById(id: string): Promise<Profile | null>`
- `create(data: CreateProfileData): Promise<Profile>`
- `update(id: string, data: UpdateProfileData): Promise<Profile>`
- `findOrCreate(id: string): Promise<Profile>`

### 9.2 `AccessService` Extensions (`src/services/access.service.ts`)
Extend `AccessService` with contextual relationship checkers:
- `canViewProfile(requesterId: string, targetProfileId: string): Promise<boolean>`
- `hasSharedJourney(userA: string, userB: string): Promise<boolean>`
- `hasAcceptedRequest(userA: string, userB: string): Promise<boolean>`
- `hasSharedConversation(userA: string, userB: string): Promise<boolean>`

### 9.3 `ProfileSerializer` (`src/serializers/profile.serializer.ts`)
Explicit, hardened data mappers:
- `toOwnProfile(profile: Profile, userEmail: string): OwnProfileResponse` (Includes email)
- `toPublicProfile(profile: Profile): PublicProfileResponse` (Omits email)

---

## 10. Security & Adversarial Analysis

| Threat / Attack Vector | Mitigating Design Control | Verification Mechanism |
|---|---|---|
| **Cross-User Email Leakage** | `toPublicProfile` explicitly constructs output object without `email` property. No spread operator used on raw DB models. | Dedicated test asserting `Object.keys(response.body)` does NOT contain `"email"`. |
| **Profile Ownership Spoofing** | `PATCH /profiles/me` forces user ID from verified JWT `req.user.id`. `:userId` in URL parameters cannot be passed to update. | Automated route tests attempting to supply foreign user IDs in body/headers. |
| **Bypassing Symmetric Block** | `canViewProfile` evaluates `AccessService.isBlocked(requester, target)` before evaluating any contextual relationship arms. | Test asserting that even if users share a train journey, blocking either direction immediately returns 404 on `GET /profiles/:userId`. |
| **Profile Enumeration / Probing** | Non-contextual users, strangers, and blocked users receive identical `404 USER_NOT_FOUND` responses. | Response status uniformity tests. |
| **Mass-Assignment Vulnerabilities** | Zod input schemas reject or strip unexpected properties. System-generated fields (`id`, `created_at`, `updated_at`) are excluded from update schemas. | Schema unit tests submitting payload containing `{ id: "other", email: "hacked@a.com" }`. |
| **Avatar Path Traversal / Forgery** | Object keys must conform to `<user_id>/avatar.<ext>`. Presigned upload URLs are only generated for the authenticated user's prefix. | Unit/integration storage path validation tests. |

---

## 11. Database Migration & Integrity Plan

### 11.1 Migration DDL (`20260825120000_add_profiles_table/migration.sql`)
```sql
-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "bio" TEXT,
    "hobbies" TEXT,
    "college" TEXT,
    "gender" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" 
    FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Profile field length constraints matching historical schema
ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_name_length" 
    CHECK ("name" IS NULL OR char_length("name") <= 100);

ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_bio_length" 
    CHECK ("bio" IS NULL OR char_length("bio") <= 500);

ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_hobbies_length" 
    CHECK ("hobbies" IS NULL OR char_length("hobbies") <= 200);

ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_college_length" 
    CHECK ("college" IS NULL OR char_length("college") <= 200);

-- Trigger for updated_at
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON "profiles"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

---

## 12. Testing Strategy

### 12.1 Unit Test Suite
- `test/repositories/profiles.repo.test.ts`: CRUD operations, findOrCreate idempotency, cascade delete.
- `test/serializers/profile.serializer.test.ts`: Verify `toOwnProfile` contains email, `toPublicProfile` does NOT contain email key under any circumstance.
- `test/services/access.service.test.ts`: Extended truth table for `canViewProfile`:
  - Self-view: `true`
  - Blocked (A blocks B): `false`
  - Blocked (B blocks A): `false`
  - Shared journey (no block): `true`
  - Accepted request (no block): `true`
  - Shared conversation (no block): `true`
  - Stranger (no relationship): `false`
- `test/services/profile.service.test.ts`: Update validation, gender normalization, display name lookup.
- `test/routes/profile.routes.test.ts`: Route boundary authentication, parameter validation, HTTP status codes.

### 12.2 Integration Test Suite (`test/integration/profile.lifecycle.test.ts`)
- Database-backed test against PostgreSQL:
  1. Register & confirm User 1 and User 2.
  2. Verify profile auto-created for both users upon registration.
  3. User 1 updates profile via `PATCH /profiles/me` (`name`, `bio`, `college`, `gender`, `hobbies`).
  4. User 1 fetches own profile via `GET /profiles/me` -> verify email is present and matching.
  5. User 2 fetches User 1 profile via `GET /profiles/:user1Id` -> returns 404 (stranger).
  6. Create matching journey for User 1 and User 2 -> User 2 fetches User 1 profile -> returns 200 with public profile (**assert `email` property is undefined**).
  7. User 1 blocks User 2 -> User 2 fetches User 1 profile -> returns 404.
  8. User 2 fetches User 1 profile -> returns 404.
  9. User 1 unblocks User 2 -> User 2 fetches User 1 profile -> returns 200 again.
  10. Delete User 1 via `prisma.user.delete` -> verify User 1's profile row is cascade-deleted.

---

## 13. Open Questions & Design Decisions

### 13.1 Resolved Design Decisions
1. **Decision D-P1 (Email Storage vs. User Join):**
   - *Resolution:* Profile model in Prisma does not store a duplicate `email` column; the single source of truth for email is `User.email`. `GET /profiles/me` joins `User.email` when constructing the own-profile response.
2. **Decision D-P2 (Gender Normalization):**
   - *Resolution:* Frontend sends `prefer_not_to_say` in profile updates and `prefer-not-to-say` in journey filters. The backend validator accepts both and normalizes storage to canonical `prefer_not_to_say`.
3. **Decision D-P3 (Stranger Profile Status Code):**
   - *Resolution:* When `canViewProfile` evaluates to `false`, the endpoint returns `404 USER_NOT_FOUND` / `Profile not found` (rather than 403 Forbidden) to prevent user enumeration.

### 13.2 Open Questions for Implementation Review
- *None.* The historical schema, frontend consumers, and backend specification provide complete, unambiguous behavioral definitions for Milestone 7.

---

## 14. Implementation Files Summary (For Future Execution)

When the implementation phase is authorized, the following files will be created or modified:

1. `backend/prisma/schema.prisma` — Add `Profile` model, relation on `User`.
2. `backend/prisma/migrations/20260825120000_add_profiles_table/migration.sql` — Profiles DDL, constraints, trigger.
3. `backend/src/repositories/profiles.repo.ts` — Profile data access repository.
4. `backend/src/serializers/profile.serializer.ts` — Profile serialization mappers.
5. `backend/src/services/access.service.ts` — Implement `canViewProfile()` and contextual query arms.
6. `backend/src/services/profile.service.ts` — Profile business logic service.
7. `backend/src/validation/profile.schemas.ts` — Profile Zod schemas.
8. `backend/src/controllers/profile.controller.ts` — Profile HTTP controller.
9. `backend/src/routes/profile.routes.ts` — Profile Express router.
10. `backend/src/app.ts` — Mount profile router and inject test seam.
11. `backend/test/setup.integration.ts` — Add `profiles` to table truncation and test service builders.
12. Unit and integration test suites in `backend/test/`.
