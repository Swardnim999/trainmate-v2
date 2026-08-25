# TrainMate v2 — Production Rollback Playbook

**Document:** `deploy/runbooks/rollback.md`
**Milestone:** Phase 14 (`phase-14-cutover`)
**Objective:** Rapid, safe reversion to Supabase in the event of an unrecoverable production failure.

---

## 1. Rollback Triggers (P0 Severity Thresholds)

A rollback must be initiated immediately if any of the following conditions persist for > 5 minutes during the cutover window:

1. **High Error Rate:** HTTP 5xx error rate exceeds 2.0% across all API endpoints.
2. **Realtime Failure:** Socket.IO WebSocket handshake failure rate exceeds 5.0%.
3. **Authentication Failure:** User login / refresh failure rate exceeds 1.0% for valid credentials.
4. **Security Invariant Violation:** Canary probe (`monitoring/authz-probe.ts`) reports a privacy or authorization violation.
5. **Data Corruption:** Detected schema violation, foreign key failure, or irrecoverable transaction abort.

---

## 2. Step-by-Step Rollback Execution

### Step 1: Re-enable Supabase Writes (T = 0)
Restore write privileges on the Supabase database immediately:
```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
```

### Step 2: Instant Frontend Rollback in Vercel (T + 2 min)
1. Navigate to Vercel Dashboard -> TrainMate -> Deployments.
2. Promote the pre-cutover production deployment (which uses the direct Supabase client) to Current Production.
3. Alternatively, remove or empty `VITE_API_URL` environment variable and redeploy.

### Step 3: Revert DNS Routing (T + 5 min)
If `api.trainmate.in` was used for client traffic, update DNS records to point away from the AWS ALB or into a maintenance holding page.

### Step 4: Delta Write Reconciliation (T + 15 min)
If new users, messages, or requests were created in the new PostgreSQL database during the active cutover window, export and backfill them into Supabase:
```sql
-- Extract delta records created during the cutover window
SELECT * FROM users WHERE created_at >= '<CUTOVER_START_TIMESTAMP>';
SELECT * FROM journeys WHERE created_at >= '<CUTOVER_START_TIMESTAMP>';
SELECT * FROM requests WHERE created_at >= '<CUTOVER_START_TIMESTAMP>';
SELECT * FROM messages WHERE created_at >= '<CUTOVER_START_TIMESTAMP>';
```
Run reconciliation script to insert delta records into Supabase `auth.users` and `public.*`.

---

## 3. Post-Rollback Actions

1. **Verify Supabase Traffic:**
   - Confirm clients are successfully connecting to Supabase and executing the 12 core flows.
2. **Collect Diagnostics:**
   - Export ECS container logs, AWS ALB access logs, CloudWatch metrics, and PostgreSQL error logs for root cause analysis (RCA).
3. **Status Communication:**
   - Update status page and user communication channels.
4. **Schedule Retrospective:**
   - Review failure triggers and remediate underlying defects before scheduling the next cutover window.
