# TrainMate v2 — Supabase Decommissioning Playbook

**Document:** `deploy/runbooks/decommission.md`
**Milestone:** Phase 14 (`phase-14-cutover`)
**Objective:** Time-boxed retention, final cold archival, and safe decommissioning of legacy Supabase project (`dfkbtusmnrhzaonouhsk`).

---

## 1. Post-Cutover Retention Window (Days 1–14)

1. **Read-Only Mode:**
   - Keep Supabase database in read-only mode for 14 calendar days following successful cutover.
2. **Monitoring:**
   - Verify that 0 client requests hit Supabase during this 14-day window.
   - Retain database backups in Supabase dashboard.
3. **No Premature Deletion:**
   - Do NOT delete the project or purge credentials during the 14-day window.

---

## 2. Final Cold Archival (Day 15)

1. **Export Final Cold Backup:**
   ```bash
   export SUPABASE_DB_URL="postgresql://postgres.<project_ref>:<pass>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
   pg_dump -Fc "$SUPABASE_DB_URL" > trainmate-supabase-final-cold-backup.dump
   ```
2. **Archive Storage Objects:**
   - Create a tarball of all exported avatars and attachments.
3. **Upload to Cold Storage:**
   - Upload the dump and storage archive to an encrypted S3 Glacier / Standard-IA bucket:
     ```bash
     aws s3 cp trainmate-supabase-final-cold-backup.dump s3://trainmate-legacy-supabase-archive/
     ```

---

## 3. Project Decommissioning & Credential Purge (Day 16)

1. **Delete Supabase Project:**
   - Open Supabase Dashboard -> Project `dfkbtusmnrhzaonouhsk` -> Project Settings -> General -> Delete Project.
   - Confirm deletion.
2. **Purge Environment Variables:**
   - Remove `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID`, and `SUPABASE_SERVICE_ROLE_KEY` from:
     - Vercel Environment Variables (Production, Preview, Development)
     - GitHub Actions Repository Secrets
     - Local developer `.env` files
3. **Audit Repository:**
   - Run audit to ensure no remaining references to Supabase credentials exist in configuration.
4. **Final Sign-Off:**
   - Log completion of Supabase decommissioning in project change log.
