# Migrate from Lovable Cloud → your own Supabase + Vercel

Everything in this folder is a one-time tool. It does **not** ship with the app and nothing in `src/` depends on it.

## Order of operations

```text
1. Create new Supabase project       (dashboard)
2. Apply schema                      (supabase db push  OR  paste schema.sql)
3. Configure Auth                    (email, Google, leaked-password)
4. Dump data from Lovable Cloud      (dump.sh, inside Lovable sandbox)
5. Restore data into new project     (restore.sh, locally)
6. Copy avatar storage objects       (copy-avatars.ts)
7. Re-sign avatar URLs               (resign-avatars.ts)
8. Update .env locally + smoke test  (VITE_SUPABASE_URL / _PUBLISHABLE_KEY / _PROJECT_ID)
9. Deploy to Vercel                  (see VERCEL.md)
```

## Files

| File                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `schema.sql`          | All 17 migrations concatenated in chronological order.                  |
| `dump.sh`             | `pg_dump` data-only export of public schema + auth.users/identities.    |
| `restore.sh`          | `psql` restore into the new project, with row-count verification.       |
| `copy-avatars.ts`     | Copies every file in the `avatars` bucket to the new project's bucket.  |
| `resign-avatars.ts`   | Rewrites `profiles.avatar_url` with fresh signed URLs on the new project. |
| `VERCEL.md`           | Vercel deploy walkthrough, env vars, OAuth redirect config.             |

## Step 1 — Create the new Supabase project

Dashboard → New Project. Pick a region close to your users. Note the **project ref**, **anon key**, **service role key**, and the **database connection string** (Settings → Database → Connection string → URI, the pooler one).

## Step 2 — Apply schema

Easiest path:

```bash
# in the repo root
npx supabase link --project-ref <new-ref>
npx supabase db push
```

Alternative: open SQL Editor in the new project, paste `migration/schema.sql`, run.

## Step 3 — Configure Auth (new Supabase dashboard)

- **Authentication → Providers → Email**: enabled. Turn on **Confirm email** (or off, to match current Lovable Cloud config).
- **Authentication → Policies → Leaked Password Protection**: enable.
- **Authentication → Providers → Google**: paste client ID + secret (see `VERCEL.md` §6).
- **Authentication → URL Configuration**: set Site URL + Redirect URLs (see `VERCEL.md` §5).

## Step 4 — Dump

Run inside the Lovable sandbox (it has `PG*` env vars set for the source DB):

```bash
bash migration/dump.sh
# → /mnt/documents/lovable-dump.sql
```

Download `/mnt/documents/lovable-dump.sql` to your machine.

## Step 5 — Restore

Locally, with `psql` installed:

```bash
export NEW_DB_URL="postgres://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
export DUMP=./lovable-dump.sql
bash migration/restore.sh
```

The script prints row counts so you can verify nothing was lost.

## Step 6 — Copy avatar storage

```bash
export OLD_SUPABASE_URL="https://rswxmpeenaudubnnmwcd.supabase.co"
export OLD_SERVICE_ROLE_KEY="<lovable cloud service role key>"
export NEW_SUPABASE_URL="https://<new-ref>.supabase.co"
export NEW_SERVICE_ROLE_KEY="<new project service role key>"

bun run migration/copy-avatars.ts
```

> Lovable Cloud does not expose its `SUPABASE_SERVICE_ROLE_KEY` to the user. If you don't have it, contact Lovable support to request a one-time export, or skip avatar migration and have users re-upload.

## Step 7 — Re-sign avatar URLs

```bash
export NEW_SUPABASE_URL="https://<new-ref>.supabase.co"
export NEW_SERVICE_ROLE_KEY="<new project service role key>"

bun run migration/resign-avatars.ts
```

## Step 8 — Frontend smoke test

Edit `.env` locally:

```
VITE_SUPABASE_URL="https://<new-ref>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<new anon key>"
VITE_SUPABASE_PROJECT_ID="<new-ref>"
```

```bash
npm run dev
```

Test: signup, login, create journey, send a chat message in two tabs, upload a new avatar.

## Step 9 — Deploy

Follow `VERCEL.md`.

## Rollback

Revert the three `VITE_*` env vars in `.env` (and Vercel) back to the Lovable Cloud values. The Lovable Cloud project is untouched throughout this process.
