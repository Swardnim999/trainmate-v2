# TrainMate v2 — Production Data Migration Runbook

**Document:** `deploy/runbooks/data-migration.md`
**Milestone:** Phase 14 (`phase-14-cutover`)
**Objective:** End-to-end instructions for extracting live Supabase data, importing into PostgreSQL, normalizing storage URLs, copying objects to S3, and asserting data integrity.

---

## 1. Prerequisites & Environment Setup

Ensure the following tools are available on the migration runner machine:
* `bash`, `psql`, `pg_dump` (PostgreSQL 17 compatible)
* `Node.js 20 LTS`, `npm`, `npx`
* Network access to both the source Supabase pooler and target AWS RDS PostgreSQL instance.

Configure environment variables:
```bash
export SUPABASE_DB_URL="postgresql://postgres.<project_ref>:<pass>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
export DATABASE_URL="postgresql://trainmate_user:<pass>@rds-primary.internal:5432/trainmate?sslmode=require"
export DIRECT_URL="$DATABASE_URL"
export SUPABASE_URL="https://<project_ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
export S3_REGION="ap-south-1"
export S3_BUCKET_AVATARS="trainmate-prod-avatars"
export S3_BUCKET_ATTACHMENTS="trainmate-prod-chat-attachments"
```

---

## 2. Step-by-Step Migration Execution

### Step 1: Export Data from Supabase
```bash
bash migration/export-supabase.sh
```
*Outputs: `migration/supabase-data-export.sql`*

### Step 2: Apply Prisma Schema Migrations to Target Database
Ensure target tables exist:
```bash
cd backend
npx prisma migrate deploy
cd ..
```

### Step 3: Import Data into PostgreSQL
```bash
npx tsx migration/import-postgres.ts migration/supabase-data-export.sql
```
*Maps `auth.users` to `users` with preserved UUIDs, bcrypt `$2a$` hashes, and `email_confirmed_at` timestamps.*

### Step 4: Normalize Legacy Storage URLs
Rewrites 1-year signed URLs in `profiles.avatar_url` and `messages.attachment_url` to canonical storage paths:
```bash
npx tsx migration/normalize-storage-urls.ts
```

### Step 5: Sync Storage Objects to Amazon S3
Streams avatar and chat-attachment blobs to private S3 buckets:
```bash
npx tsx migration/copy-storage-to-s3.ts
```

### Step 6: Verify Data Integrity
Executes comprehensive row-count, foreign-key, and URL normalization verification:
```bash
npx tsx migration/verify-data.ts
```
*Expected Output:* `Verification Result: PASSED (0 errors)`
