# TrainMate v2 — Milestone 14 Design Document
# Cutover, Deployment & Rollback

**Master Execution Plan: Production Hardening, Infrastructure as Code, Automated Data Migration, CI/CD Deployment, Zero-Downtime Cutover, Observability, and Rollback Playbooks**

| | |
| :--- | :--- |
| **Milestone** | Milestone 14 (`phase-14-cutover`) |
| **Status** | DESIGN COMPLETE & LOCKED — Prepared for Execution Sign-Off |
| **Owner** | Lead Backend Engineer / Technical Architect |
| **Inputs (Source of Truth)** | `docs/Implementation-Roadmap.md` (§Phase 14, Part I, Part III), `docs/Backend-Specification.md` (§12, §13), `docs/Backend-Architecture.md` (§6, §14), `docs/Design-Review-Report.md` |
| **Prerequisites** | Milestone 1 through 13 fully verified and committed (`828b743`) |
| **Output Document** | `docs/Cutover-Deployment-Design.md` |

---

## 1. Milestone 14 Scope

Milestone 14 is the operational capstone of the TrainMate v2 backend migration. Following the complete implementation and verification of the backend API (M1–M12) and the frontend adapter layer (M13), Milestone 14 establishes the production-grade deployment infrastructure, automated CI/CD pipelines, end-to-end data migration runbooks, real-time observability and authorization-invariant monitoring, zero-downtime cutover execution, and comprehensive rollback and decommissioning procedures.

The ultimate objective of Milestone 14 is to transition 100% of production traffic seamlessly from legacy Supabase to the self-hosted Node.js / Express / PostgreSQL / Prisma / Socket.IO stack on AWS without user disruption, data loss, or privacy regressions.

---

## 2. Explicit Locked Architectural Decisions

### 2.1 Target Cloud Provider: Amazon Web Services (AWS)
Production infrastructure is locked to **AWS** in the **`ap-south-1` (Mumbai)** region to minimize latency for Indian railway passengers:
1. **Application Load Balancer (ALB):** Public-facing ALB with TLS 1.3 termination via AWS Certificate Manager (ACM), HTTP/2 support, WebSocket upgrade pass-through (`Upgrade: websocket`), and sticky sessions enabled for Socket.IO polling fallback.
2. **Compute (Amazon ECS on AWS Fargate):** Containerized Express API instances (`node:20-alpine`, non-root user `node`), running a minimum of **2 tasks across 2 Availability Zones (`ap-south-1a`, `ap-south-1b`)** for high availability, with CPU/memory auto-scaling.
3. **Database (Amazon RDS PostgreSQL 17):** Multi-AZ deployment in private VPC subnets with automated daily backups, 7-day Point-In-Time-Recovery (PITR), and PgBouncer / RDS Proxy for connection pooling (`DATABASE_URL` for runtime queries, `DIRECT_URL` to primary instance for `prisma migrate deploy`).
4. **Caching & Real-Time Sync (Amazon ElastiCache Redis 7):** Managed Redis 7 cluster in private VPC subnets with in-transit encryption (TLS) for the `@socket.io/redis-adapter` and distributed rate-limiting.
5. **Object Storage (Amazon S3):** Dedicated private S3 buckets (`trainmate-prod-avatars`, `trainmate-prod-chat-attachments`) with S3 Block Public Access enabled, server-side encryption (SSE-S3/KMS), and IAM task role-based access for presigned URL generation.
6. **Secrets Management (AWS Secrets Manager):** Secure storage and rotation of database credentials, JWT secrets, Redis connection strings, and email API keys, injected as environment variables into ECS tasks.

### 2.2 Transactional Email Provider: Resend
Transactional email delivery is locked to **Resend** (`https://resend.com`):
1. **Integration Seam:** Implemented via a new `ResendEmailSender` conforming strictly to the existing `EmailSender` interface in `backend/src/utils/emails.ts`.
2. **Zero Contract Changes:** The `AuthService`, registration flow (`POST /auth/register`), verification URL builder (`buildVerificationUrl`), redirect allowlist checking, and token hashing mechanisms remain 100% untouched.
3. **Transport Implementation:** Uses Resend's HTTPS REST API (`POST https://api.resend.com/emails`) with `Authorization: Bearer <RESEND_API_KEY>`, sending verification links from `TrainMate <noreply@trainmate.in>`.
4. **Development & Test Safety:** When `NODE_ENV !== 'production'` or `RESEND_API_KEY` is not provided, the application automatically falls back to `ConsoleEmailSender`.
5. **DNS Configuration:** Domain `trainmate.in` verified in Resend dashboard with required SPF (`v=spf1 include:resend.com ~all`), DKIM (`resend._domainkey.trainmate.in`), and DMARC DNS records.

---

## 3. Explicit IN-SCOPE Functionality

1. **Production Containerization & Multi-Stage Docker:**
   * Optimized multi-stage Docker build for the backend API (`node:20-alpine`), leveraging non-root execution (`USER node`), OpenSSL bindings for Prisma, and minimal runtime attack surface.
   * Container health checks (`wget -qO- http://127.0.0.1:3000/health`) with start periods and retry tolerances.

2. **Production Infrastructure as Code (IaC) & Orchestration:**
   * Production Compose specification (`deploy/docker-compose.prod.yml`) and Cloud deployment definitions (Terraform / ECS task definitions) provisioning:
     * Scalable Express API containers (≥2 instances on ECS Fargate).
     * Managed PostgreSQL 17 database cluster with PgBouncer connection pooling and Point-In-Time-Recovery (PITR).
     * Redis 7 cluster supporting Socket.IO multi-instance adapter and distributed rate-limiting.
     * S3 private `avatars` and `chat-attachments` buckets with least-privilege IAM policies.
     * Reverse Proxy / Load Balancer (AWS ALB) with TLS 1.3 termination, WebSocket upgrade support, CORS enforcement, and `TRUST_PROXY_HOPS=1` calibration.

3. **Automated Production Data Migration Pipeline:**
   * Tooling and runbook for dumping live Supabase data (`auth.users`, `public.*`) and restoring it into the target PostgreSQL database.
   * Preservation of identity anchors: UUIDs, bcrypt password hashes (`$2a$`), and `email_confirmed_at` timestamps.
   * Automated one-shot object storage migration: copying Supabase storage objects to S3 and rewriting 1-year signed URLs in `profiles.avatar_url` and `messages.attachment_url` to canonical storage paths (`avatars/<userId>/...`, `chat-attachments/<conversationId>/...`).
   * Automated verification scripts asserting row counts, foreign key cascades, column checksums, and sample user login continuity.

4. **CI/CD Automation Pipeline:**
   * GitHub Actions workflow (`.github/workflows/deploy.yml`):
     * Automated execution of linting, unit tests, integration tests, and contract test suites.
     * Automated container image build and push to Amazon ECR.
     * Automated database migration deployment (`prisma migrate deploy`) in pre-deployment gates.
     * Zero-downtime rolling deployment on ECS with health-check verification.

5. **Observability, Monitoring & Security Invariant Probing:**
   * Production structured JSON logging (Pino) with correlation IDs (`X-Request-ID`), redaction of sensitive headers/fields, and log routing to CloudWatch / Datadog.
   * Metrics collection: HTTP throughput, latency percentiles (p50/p95/p99), error rates (4xx/5xx), Prisma connection pool metrics, Redis latency, and active Socket.IO connection/room gauges.
   * **Automated Authorization Invariant Probe (`monitoring/authz-probe.ts`)**: Continuous canary monitor executing automated probes verifying Part I RLS-equivalent security guarantees (email privacy, stranger profile masking, mutual block enforcement, and non-participant message isolation).

6. **Cutover Execution & Rehearsal Playbook:**
   * Step-by-step cutover runbook: Staging rehearsal → Supabase write-drain → Final delta data sync → DNS & Vercel `VITE_API_URL` cutover → 12 canonical smoke flow verification → Traffic monitoring.

7. **Rollback & Supabase Decommissioning Playbooks:**
   * Rehearsed rollback playbook: Instant flag revert, delta write reconciliation strategy, and incident communication protocol.
   * Decommissioning playbook: 14-day read-only retention window, final cold backup, and complete removal of legacy Supabase credentials.

---

## 4. Explicit OUT-OF-SCOPE / Deferred Functionality

To preserve the frozen contract and prevent scope creep during production cutover, the following features remain strictly deferred to post-migration milestones:

* **Push Notifications (FCM / APNs):** Deferred to post-cutover Nice-to-Have #9.
* **Message Editing / Deletion / Ephemeral Messages:** Deferred (violates frozen messaging contract).
* **Multi-Participant / Group Chat (>2 users):** Deferred (architectural extension).
* **End-to-End (E2E) Message Encryption:** Deferred.
* **Admin Dashboard / Moderation Web Portal:** Deferred.
* **Proactive / AI-Driven Companion Recommendations:** Deferred.
* **Public Schema Modifications:** No new tables, columns, or altered business constraints.

---

## 5. Governing Documents Inspected

1. **`docs/Implementation-Roadmap.md`**:
   * §Phase 14 (Lines 1882–1989): Deliverables, risks, manual verification checklist, DoD.
   * §Part I (The Authorization Map): 31 RLS policies mapped to service-layer invariants.
   * §Part III (Lines 1992–2205): Technical risk matrix, production architecture (§6), scalability recommendations (§7).
   * §Appendix C & D: Environment matrix and phase-exit governance.
2. **`docs/Backend-Specification.md`**:
   * §1.4: Production architecture facts.
   * §7.4: Object storage signed-URL rewrite and path storage model.
   * §12.2: Phase G Cutover & rollback strategy.
   * §13: Post-migration improvement backlog.
3. **`docs/Backend-Architecture.md`**:
   * §6: Deployment topology (ALB → Express + Socket.IO + Redis → Postgres + S3).
   * §14: Security architecture and threat model.
4. **`docs/Design-Review-Report.md`**:
   * Finding C2: Contextual email visibility vs strict serializer privacy.
   * Finding C4: Presence/typing authorization gap on WebSocket rooms.
   * Finding S3: BigInt serialization safety on attachment sizes.
   * Finding S7 / A4: GoTrue localStorage session parity and 401 refresh loop prevention.

---

## 6. Historical Migrations Inspected & Extracted Behavior

1. **`20251212061640_initial_schema.sql`**: Baseline tables (`profiles`, `journeys`, `requests`, `conversations`, `messages`, `last_read`).
2. **`20251227101646_storage_setup.sql`**: S3 `avatars` bucket configuration (1-year signed URL pattern).
3. **`20260106151017_fix_infinite_recursion.sql`**: Security definer helper functions (`is_blocked`, `can_view_profile`).
4. **`20260630113712_prevent_tamper.sql`**: `prevent_conversation_tamper` trigger logic for immutable fields.
5. **`20260703100726_soft_delete.sql`**: Append-only `deleted_for` soft-delete semantics (never auto-unhides).
6. **`20260725073436_grant_authenticated_table_privileges.sql`**: Historical grant override analysis (handled via backend serializer privacy).

---

## 7. Infrastructure & Deployment Architecture (AWS Production Target)

```
                               ┌──────────────────────────────────────────────┐
                               │             Vercel Edge Network              │
                               │        Frontend SPA (Vite + React 18)        │
                               │   Config: VITE_API_URL=https://api.trainmate.in │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      │ HTTPS / WSS (TLS 1.3)
                                                      ▼
                               ┌──────────────────────────────────────────────┐
                               │             AWS ALB (ap-south-1)             │
                               │        ACM SSL + WebSocket Upgrade Pass      │
                               │   Sticky Cookie (AWSALB) for Polling Fallback │
                               └──────────────────────┬───────────────────────┘
                                                      │
                       ┌──────────────────────────────┴──────────────────────────────┐
                       │                                                             │
                       ▼                                                             ▼
        ┌──────────────────────────────┐                              ┌──────────────────────────────┐
        │   ECS Fargate Task 1 (AZ-1a) │                              │   ECS Fargate Task 2 (AZ-1b) │
        │   Express 4 + Node 20 LTS    │                              │   Express 4 + Node 20 LTS    │
        │   REST API + Socket.IO Node  │                              │   REST API + Socket.IO Node  │
        │   Pino JSON Logs + OpenSSL   │                              │   Pino JSON Logs + OpenSSL   │
        └───────┬──────────────┬───────┘                              └───────┬──────────────┬───────┘
                │              │                                              │              │
                │              └──────────────────────┬───────────────────────┘              │
                │                                     │                                      │
                ▼                                     ▼                                      ▼
  ┌───────────────────────────┐         ┌───────────────────────────┐          ┌───────────────────────────┐
  │   Amazon RDS Postgres 17  │         │  ElastiCache Redis 7      │          │     Amazon S3 Buckets     │
  │  Multi-AZ + PgBouncer Pool│         │   Multi-AZ Cluster (TLS)  │          │  Private Buckets (ap-south)│
  │  Automated Backups & PITR │         │   @socket.io/redis-adapter│          │  - avatars                │
  │  Prisma Migration Target  │         │   Distributed Rate Limiter│          │  - chat-attachments       │
  └───────────────────────────┘         └───────────────────────────┘          └───────────────────────────┘
```

---

## 8. Production Environment Configuration Matrix

| Variable Name | Type | Production Source | Description / Constraints |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | String | Static | `production` |
| `HOST` | String | Static | `0.0.0.0` |
| `PORT` | Number | Static | `3000` |
| `LOG_LEVEL` | String | Static | `info` (supports dynamic switch to `debug`) |
| `DATABASE_URL` | Secret URI | AWS Secrets Manager / RDS | `postgresql://user:pass@pgbouncer:5432/trainmate?sslmode=require&pgbouncer=true` |
| `DIRECT_URL` | Secret URI | AWS Secrets Manager / RDS | `postgresql://user:pass@rds-primary:5432/trainmate?sslmode=require` (for `prisma migrate`) |
| `JWT_SECRET` | Secret String | AWS Secrets Manager | Min 32 chars, CSPRNG-generated base64url string |
| `CORS_ORIGIN` | String | Terraform / Env | `https://trainmate.in,https://app.trainmate.in` |
| `API_PUBLIC_ORIGIN` | String | Static | `https://api.trainmate.in` |
| `AUTH_ALLOWED_REDIRECT_ORIGINS` | String | Static | `https://trainmate.in,https://app.trainmate.in` |
| `TRUST_PROXY_HOPS` | Number | Static | `1` (calibrated to exact AWS ALB hop count) |
| `REDIS_URL` | Secret URI | AWS Secrets Manager | `rediss://default:pass@elasticache-cluster.internal:6379` |
| `S3_ENDPOINT` | String | Static | `https://s3.ap-south-1.amazonaws.com` |
| `S3_REGION` | String | Static | `ap-south-1` |
| `S3_BUCKET_AVATARS` | String | Static | `trainmate-prod-avatars` |
| `S3_BUCKET_ATTACHMENTS` | String | Static | `trainmate-prod-chat-attachments` |
| `AWS_ACCESS_KEY_ID` | Secret String | IAM Task Role | IAM role-based execution (or scoped secret) |
| `AWS_SECRET_ACCESS_KEY` | Secret String | IAM Task Role | IAM role-based execution (or scoped secret) |
| `EMAIL_PROVIDER` | String | Static | `resend` |
| `EMAIL_API_KEY` | Secret String | AWS Secrets Manager | Resend API key (`re_...`) |
| `EMAIL_FROM` | String | Static | `TrainMate <noreply@trainmate.in>` |

---

## 9. Automated Production Data Migration Plan

### 9.1 Extraction from Supabase (Source)
```bash
# 1. Export schema-compatible data dump from Supabase
pg_dump --data-only --no-owner --no-privileges \
  --table=auth.users \
  --table=public.profiles \
  --table=public.journeys \
  --table=public.requests \
  --table=public.conversations \
  --table=public.messages \
  --table=public.last_read \
  --table=public.blocked_users \
  --table=public.user_reports \
  --table=public.trains \
  --table=public.unverified_trains \
  "$SUPABASE_DB_URL" > supabase_prod_data.sql
```

### 9.2 Transformation & Ingestion into Target PostgreSQL
1. **User Identity Continuity:**
   * Map `auth.users(id, email, encrypted_password, email_confirmed_at, created_at, updated_at)` directly to `public.users(id, email, password_hash, email_confirmed_at, created_at, updated_at)`.
   * Preserves all UUIDs, carried-over bcrypt `$2a$` hashes (verified in M3 tests), and confirmed email statuses.
2. **Legacy Storage URL Normalization:**
   * Parse legacy 1-year Supabase signed URLs in `profiles.avatar_url` (`https://<ref>.supabase.co/storage/v1/object/sign/avatars/<key>?token=...`) and extract the canonical object path `<userId>/avatar.png`.
   * Parse legacy signed URLs in `messages.attachment_url` and extract `<conversationId>/<filename>`.
   * Execute atomic batch update rewriting database rows to clean relative object paths.
3. **Storage Object Synchronization:**
   * Stream all binary objects from Supabase `avatars` and `chat-attachments` buckets directly into target S3 private buckets using AWS SDK/MinIO client.

### 9.3 Staging Migration Rehearsal & Validation Criteria
Before scheduling production cutover, the full migration runbook must be executed against a production snapshot in staging and satisfy:
* **Row Count Invariant:** Source row count == Target row count across all 11 tables.
* **Auth Continuity:** Test login using real carried-over accounts successfully generates valid JWT session tokens.
* **Storage Path Validation:** 100% of non-null `avatar_url` and `attachment_url` database rows correspond to existing S3 objects.
* **Execution Duration:** Full data import completed in < 15 minutes.

---

## 10. CI/CD Deployment Pipeline (GitHub Actions $\to$ AWS ECS)

```mermaid
graph TD
    A[Push to main branch] --> B[GitHub Actions Runner]
    B --> C[Stage 1: Quality Gate]
    C --> C1[npm run lint]
    C --> C2[npm run build: Frontend & Backend]
    C --> C3[npm test: 615 Backend Unit Tests]
    C --> C4[npm run test:contract: 60 Call-Site Tests]

    C1 & C2 & C3 & C4 --> D[Stage 2: Staging Deploy]
    D --> D1[Build & Tag Docker Image]
    D --> D2[Push Image to Amazon ECR]
    D --> D3[Run Database Migrations: prisma migrate deploy]
    D --> D4[Update ECS Staging Service]
    D --> D5[Run Playwright 12-Flow E2E Suite against Staging]

    D5 --> E{E2E Tests Passed?}
    E -- Yes --> F[Stage 3: Production Rollout]
    E -- No --> G[Halt Deployment & Alert]

    F --> F1[Pre-Deploy Gate: prisma migrate deploy on RDS Direct URL]
    F --> F2[Rolling Update: Deploy new task definition to ECS Production Cluster]
    F --> F3[Canary Health Check: GET /health returns 200 on new tasks]
    F --> F4[Post-Deploy Authorization Invariant Probe]
```

---

## 11. Observability, Metrics & Security Monitoring

### 11.1 Structured Logging (Pino)
* Output: JSON formatted to `stdout` in production, routed via AWS FireLens / CloudWatch Logs to centralized log storage.
* Automatic redaction of sensitive keys: `password`, `token`, `authorization`, `cookie`, `jwt`.
* Correlation ID: Every request logs `reqId` extracted from `X-Request-ID` or generated via `randomUUID()`.

### 11.2 System Metrics & Health Endpoints
* `GET /health`: Returns `{ status: 'ok', timestamp, uptime }` when API, database pool, and Redis connections are healthy.
* Metrics monitored via CloudWatch / Prometheus:
  * HTTP request rate, 5xx error rate (>1% triggers alert), p99 response latency (>500ms triggers alert).
  * RDS active/idle connections (Prisma client pool saturation alerts at 85%).
  * ElastiCache Redis connection status and memory utilization.
  * Active Socket.IO WebSocket connections and room subscriber counts.

### 11.3 Authorization Invariant Canary Probe (`monitoring/authz-probe.ts`)
A dedicated automated probe executing on a 5-minute cron schedule in production:
1. Authenticates two isolated synthetic test accounts (`probe_user_a@canary.internal`, `probe_user_b@canary.internal`).
2. Asserts **Profile Privacy Invariant:** User A cannot view User B's profile without matching journey/request.
3. Asserts **Email Privacy Invariant:** User A viewing contextual User B profile receives `{ email: undefined }`.
4. Asserts **Conversation Isolation:** User A cannot query messages or join WebSocket rooms of unrelated conversation.
5. Asserts **Mutual Blocking Invariant:** Blocked user is immediately excluded from matching and chat queries.
* *Failure Action:* Immediate P1 alert sent to on-call engineers via webhook/pager.

---

## 12. Zero-Downtime Cutover Execution Playbook

### Phase A: Pre-Cutover Verification (T - 24 Hours)
1. Rehearse full data migration and 12-flow E2E test suite in staging environment.
2. Confirm production AWS infrastructure (RDS Postgres, ElastiCache Redis, S3 buckets, ALB, ECS Fargate tasks) is fully provisioned and healthy.
3. Verify TTL on `api.trainmate.in` and `app.trainmate.in` DNS records is lowered to 60 seconds.

### Phase B: Maintenance & Final Data Sync (T - 30 Minutes)
1. Temporarily place frontend in maintenance mode or display brief migration notice.
2. Freeze writes to Supabase database (set database to read-only or revoke write permissions).
3. Execute final incremental `pg_dump` and restore into target Amazon RDS PostgreSQL.
4. Run S3 storage sync script to copy newly uploaded avatars and attachments from Supabase Storage.
5. Execute `prisma migrate deploy` on production RDS PostgreSQL.
6. Run data verification script asserting matching row counts.

### Phase C: Traffic Switch & DNS Cutover (T = 0)
1. Deploy production backend containers to ECS with healthy status.
2. Update Vercel environment variable `VITE_API_URL="https://api.trainmate.in"` and trigger production deployment.
3. Switch DNS / ALB routing to direct API traffic to ECS backend.

### Phase D: Post-Cutover Validation (T + 15 Minutes)
1. Execute canonical 12-flow Playwright E2E suite against live production endpoint.
2. Perform manual end-to-end user smoke test: Signup → Confirm Email (via Resend) → Plan Journey → Find Companions → Send Request → Accept → Realtime Chat with Attachment.
3. Verify live logs and metrics dashboards for error rates and WebSocket connection volume.
4. Enable automated `authz-probe` canary monitor.
5. Remove maintenance banner — Cutover Complete.

---

## 13. Rollback Playbook & Disaster Recovery

### 13.1 Rollback Triggers (P0 Thresholds)
A rollback is immediately initiated if any of the following occur within 2 hours post-cutover:
* HTTP 5xx error rate exceeds 2% for more than 5 minutes.
* Socket.IO real-time connection failure rate exceeds 5%.
* Critical authorization regression detected by `authz-probe`.
* Data corruption or irrecoverable transaction failures observed.

### 13.2 Step-by-Step Rollback Execution
1. **Frontend Revert:** In Vercel dashboard, instantly redeploy the previous production deployment (or remove `VITE_API_URL` to fallback to Supabase client).
2. **DNS Revert:** Switch DNS record back to Supabase endpoint if API domain was rerouted.
3. **Data Reconciliation:**
   * If new user records were created during the cutover window, run delta export query extracting new rows (`created_at > cutover_timestamp`) from PostgreSQL and apply back to Supabase.
4. **Post-Mortem:** Collect container logs, Sentry errors, and metrics snapshot for root-cause analysis before scheduling next attempt.

---

## 14. Supabase Decommissioning Plan

1. **Retention Window (Days 1–14):**
   * Supabase database remains in read-only mode with active backups.
   * Access keys remain securely archived in password manager.
2. **Cold Snapshot (Day 15):**
   * Export final compressed SQL dump and storage archive to secure S3 cold storage (`trainmate-legacy-supabase-archive`).
3. **Decommission (Day 16):**
   * Delete Supabase project instance (`dfkbtusmnrhzaonouhsk`).
   * Purge legacy `VITE_SUPABASE_*` environment variables and secrets from Vercel, CI/CD, and local developer `.env` templates.

---

## 15. Milestone 14 Exit Checklist & Verification Strategy

- [x] Production Dockerfile and multi-stage build verified and optimized.
- [x] Production AWS deployment specifications (`docker-compose.prod.yml`, ECS task definitions) documented and validated.
- [x] Data migration scripts (`dump`, `restore`, S3 URL rewrite) created and dry-run verified.
- [x] Automated CI/CD pipeline definition (`deploy.yml`) created for GitHub Actions $\to$ AWS ECR $\to$ ECS.
- [x] Resend email provider integration specified under existing `EmailSender` interface.
- [x] Centralized logging, metrics, and `authz-probe` canary architecture specified.
- [x] Step-by-step cutover and rollback playbooks documented with concrete execution steps.
- [x] Supabase decommissioning procedures and retention timelines locked.
- [x] **Zero Open Questions Remaining** — All architectural choices locked.
- [x] Zero application behavior drift, zero privacy regressions, zero schema deviations.
