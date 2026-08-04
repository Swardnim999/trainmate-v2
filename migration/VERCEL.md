# Deploy to Vercel

This app is a standard Vite + React SPA. No Lovable runtime is needed in production.

## 1. Import the repo

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Vercel: **Add New → Project → Import** your repo.
3. **Framework preset**: `Vite` (auto-detected).
4. **Build command**: `vite build` (default).
5. **Output directory**: `dist` (default).
6. **Install command**: `npm install` (or `bun install` if you prefer; Vercel supports both).

## 2. Environment variables

In **Project Settings → Environment Variables**, add the following for **Production** and **Preview**:

| Name                            | Value                                                  |
| ------------------------------- | ------------------------------------------------------ |
| `VITE_SUPABASE_URL`             | `https://<your-new-ref>.supabase.co`                   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your new project's **anon** key                        |
| `VITE_SUPABASE_PROJECT_ID`      | `<your-new-ref>`                                       |

> The anon key is safe to expose in client code. Never put the **service role key** in Vercel env vars for this app — it's only used by the one-off migration scripts.

## 3. SPA routing

`vercel.json` is already in the repo. If you ever lose it, add:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

## 4. Custom domain (optional)

**Project Settings → Domains → Add**. Vercel handles TLS automatically.

## 5. Supabase Auth configuration

In your new Supabase dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://<your-vercel-domain>`
- **Redirect URLs** (add all of these):
  - `https://<your-vercel-domain>/**`
  - `https://<your-vercel-domain>` (without trailing slash)
  - `https://<project>-*.vercel.app/**` (preview deployments)
  - `http://localhost:5173/**` (local dev)

## 6. Google OAuth (if used)

In **Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client**:

- **Authorized JavaScript origins**: `https://<your-vercel-domain>`
- **Authorized redirect URIs**: `https://<your-new-ref>.supabase.co/auth/v1/callback`

Then in Supabase → **Authentication → Providers → Google**: paste the client ID and secret, save.

## 7. Cutover checklist

- [ ] All migrations applied to new Supabase project (`supabase db push`).
- [ ] `dump.sh` + `restore.sh` ran; row counts match.
- [ ] `copy-avatars.ts` ran; storage browser shows files in new bucket.
- [ ] `resign-avatars.ts` ran; pick a random profile and confirm avatar loads from new domain.
- [ ] Vercel deploy succeeds.
- [ ] Sign up a new test user on the live URL → confirm `profiles` row is created (the `handle_new_user` trigger).
- [ ] Log in as a migrated user (existing email + password).
- [ ] Send a chat message → second tab receives it in real time.
- [ ] Upload a new avatar → new signed URL appears, image loads.

## 8. Things you don't need anymore

- Lovable Cloud connection — leave it; it's harmless and lets you keep editing in Lovable. The deployed Vercel app is decoupled.
- Lovable AI Gateway key — not used in code.

## 9. Rollback

The Lovable Cloud project keeps running. To roll back, just revert the three `VITE_*` env vars in Vercel to the original Lovable Cloud values and redeploy. The codebase is identical.
