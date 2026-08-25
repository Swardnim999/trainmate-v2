# TrainMate v2 — Production Cutover Runbook

**Document:** `deploy/runbooks/cutover.md`
**Milestone:** Phase 14 (`phase-14-cutover`)
**Target Environment:** AWS (`ap-south-1`)
**Objective:** Zero-downtime migration from Supabase to self-hosted Node.js / PostgreSQL / S3 backend.

---

## 1. Pre-Cutover Requirements (T - 24 Hours)

- [ ] **Staging Rehearsal:**
  - Execute full data migration on staging database using `migration/export-supabase.sh` and `migration/import-postgres.ts`.
  - Execute canonical 12-flow Playwright E2E test suite against staging: `npx playwright test`.
- [ ] **Infrastructure Readiness:**
  - Amazon RDS PostgreSQL 17 Multi-AZ provisioned with PgBouncer connection pool.
  - Amazon ElastiCache Redis 7 cluster active.
  - S3 buckets `trainmate-prod-avatars` and `trainmate-prod-chat-attachments` created with Block Public Access.
  - Amazon ECS Fargate cluster ready with minimum 2 tasks across `ap-south-1a` and `ap-south-1b`.
  - AWS ALB with ACM certificate for `api.trainmate.in` responding on `/health`.
- [ ] **DNS TTL Reduction:**
  - Lower TTL on `api.trainmate.in` and `app.trainmate.in` to 60 seconds.
- [ ] **Human Sign-off:** Lead Architect and DevOps Engineer review and approve maintenance window.

---

## 2. Maintenance & Write Drain (T - 30 Minutes)

1. **Activate Maintenance Notice:**
   - Display a brief maintenance notification on the frontend banner ("TrainMate is undergoing scheduled infrastructure upgrades").
2. **Freeze Supabase Writes:**
   - Revoke write privileges on Supabase database to prevent split-brain writes:
     ```sql
     REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
     ```
3. **Execute Final Incremental Export:**
   ```bash
   export SUPABASE_DB_URL="postgresql://postgres.<project_ref>:<pass>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
   bash migration/export-supabase.sh
   ```
4. **Restore into Target PostgreSQL:**
   ```bash
   export DATABASE_URL="postgresql://trainmate_user:<pass>@rds-primary.internal:5432/trainmate?sslmode=require"
   npx tsx migration/import-postgres.ts migration/supabase-data-export.sql
   ```
5. **Normalize Storage URLs:**
   ```bash
   npx tsx migration/normalize-storage-urls.ts
   ```
6. **Sync S3 Storage Objects:**
   ```bash
   export SUPABASE_URL="https://dfkbtusmnrhzaonouhsk.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
   npx tsx migration/copy-storage-to-s3.ts
   ```
7. **Verify Target Data Integrity:**
   ```bash
   npx tsx migration/verify-data.ts
   # Must return 100% PASSED with 0 errors
   ```

---

## 3. Production Deployment & DNS Switch (T = 0)

1. **Apply Database Migrations:**
   ```bash
   DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
   ```
2. **Deploy ECS Fargate Service:**
   - Trigger ECS service rolling update to start tasks with `NODE_ENV=production`.
   - Verify all tasks pass ALB `/health` checks.
3. **Update Frontend Environment in Vercel:**
   - Set `VITE_API_URL="https://api.trainmate.in"`.
   - Redeploy production build in Vercel.
4. **Switch DNS Routing:**
   - Point `api.trainmate.in` CNAME to the AWS ALB DNS name.

---

## 4. Post-Cutover 12-Flow Smoke Verification (T + 15 Minutes)

Run the canonical 12-flow verification either via automated Playwright E2E or manual check:

| # | Flow Description | Verification Method | Status |
| :---: | :--- | :--- | :---: |
| 1 | New User Registration & Confirmation | Sign up new user, receive email via Resend, confirm account | [ ] |
| 2 | User Login & Profile Hydration | Log in, check profile details & avatar | [ ] |
| 3 | Plan Train Journey | Create journey for train 12951, travel date 2026-09-01 | [ ] |
| 4 | Companion Discovery | Find companions on matching train & date | [ ] |
| 5 | Send Travel Companion Request | Dispatch request from User A to User B | [ ] |
| 6 | Receive Request & Badge Notification | User B verifies incoming request list & notification badge | [ ] |
| 7 | Accept Request & Auto-Provision Chat | User B accepts; conversation room created | [ ] |
| 8 | Send Message & Attachment | User A sends text message & photo attachment | [ ] |
| 9 | Realtime Message Sync & Read Receipts | User B receives message live via Socket.IO; read receipt synced | [ ] |
| 10 | Realtime Presence & Typing Indicator | Active presence and typing broadcast | [ ] |
| 11 | Profile Update | Update college, bio, avatar | [ ] |
| 12 | Safety & Moderation | Block user and submit abuse report | [ ] |

---

## 5. Continuous Monitoring & Sign-Off

1. **Activate Canary Monitor:**
   - Start 5-minute automated `monitoring/authz-probe.ts` job.
2. **Monitor Error Rates:**
   - HTTP 5xx error rate must remain < 0.1%.
   - WebSocket connection success rate must remain > 99.5%.
3. **Remove Maintenance Notice:**
   - Disable maintenance notice on frontend.
4. **Cutover Complete:** Final sign-off logged in deployment records.
