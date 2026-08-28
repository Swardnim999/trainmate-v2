# TrainMate v2 — Free-Tier Production Deployment Runbook

> **Target Architecture:**
> - **Frontend:** Vercel Free (Hobby Tier)
> - **Backend:** Render Free Web Service (Node.js 20)
> - **Database:** Supabase Free PostgreSQL (15/16)
> - **Realtime:** In-process Socket.IO on Render
> - **Storage:** Application Data URL Storage (Zero external storage dependency for MVP)
> - **Total Cost:** **$0.00 / month**

> [!IMPORTANT]
> **Configuration Preparation vs. Live Deployment**
> This runbook documents the step-by-step operational procedure for manual deployment.
> Creating this file **does NOT perform any live deployment** or modify any cloud resources.
> Follow these steps when you are ready to execute the manual deployment.

> [!NOTE]
> **Architectural Clarity: Supabase Role**
> Supabase is utilized **strictly as managed PostgreSQL database infrastructure**.
> It is **NOT** an application dependency.
> - NO `@supabase/supabase-js` SDK is used in the frontend or backend.
> - NO Supabase GoTrue authentication is used (all JWT auth is signed by our Node.js backend).
> - NO Supabase Realtime is used (all WebSockets are handled by our backend's Socket.IO server).
> The application backend remains 100% our own Express, Prisma, and Socket.IO server.

---

## Pre-Deployment Checklist

Before deploying, ensure you have free accounts on:
1. **GitHub** (repository hosting): https://github.com
2. **Supabase** (PostgreSQL hosting): https://supabase.com
3. **Render** (Node.js web service hosting): https://render.com
4. **Vercel** (Static frontend hosting): https://vercel.com
5. *(Optional)* **Resend** (Transactional email): https://resend.com

---

## Phase 1: Supabase PostgreSQL Database Setup

1. **Create Supabase Project**:
   - Log in to https://supabase.com and click **New Project**.
   - Name: `trainmate-v2-prod` (or similar).
   - Database Password: Generate a strong password and save it securely in your password manager.
   - Region: Select a region closest to your users / Render service (e.g., `Singapore - ap-southeast-1`).
   - Pricing Plan: **Free** ($0/month).
   - Click **Create new project** and wait ~1–2 minutes for initialization.

2. **Obtain Connection Strings**:
   - Navigate to **Project Settings** -> **Database**.
   - Under **Connection string**, select **URI**.
   - **Direct Connection (Port 5432)**:
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require
     ```
   - **Session Pooler (Port 5432, recommended for IPv4 compatibility)**:
     ```
     postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=5
     ```
   - Save this connection string (with your real password inserted) for the migration step and Render environment configuration.

---

## Phase 2: Run & Verify Prisma Migrations

Execute the 7 TrainMate v2 migrations from your secure local development machine against the Supabase PostgreSQL database:

1. In your local terminal, navigate to the `backend/` directory:
   ```bash
   cd backend
   ```

2. Temporarily set your `DATABASE_URL` environment variable to your Supabase PostgreSQL connection string:
   - **PowerShell (Windows)**:
     ```powershell
     $env:DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require"
     ```
   - **Bash (Linux/macOS)**:
     ```bash
     export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres?sslmode=require"
     ```

3. Deploy all 7 Prisma migrations:
   ```bash
   npx prisma migrate deploy
   ```
   *Expected output:*
   ```
   7 migrations found in prisma/migrations
   Applying migration `20260806182234_add_auth_tables`
   Applying migration `20260824120000_add_moderation_tables`
   Applying migration `20260825120000_add_profiles_table`
   Applying migration `20260826120000_add_journeys_and_trains_tables`
   Applying migration `20260828120000_add_requests_table`
   Applying migration `20260830120000_add_conversations_table`
   Applying migration `20260901120000_add_messages_and_last_read_tables`
   All migrations have been successfully applied.
   ```

4. Verify database tables in Supabase Table Editor:
   - In Supabase dashboard, click **Table Editor**.
   - Verify that the following 12 tables exist: `users`, `refresh_tokens`, `email_verifications`, `blocked_users`, `user_reports`, `profiles`, `journeys`, `trains`, `unverified_trains`, `requests`, `conversations`, `messages`, and `last_read`.

---

## Phase 3: Deploy Backend on Render Free Web Service

You can deploy using either the declarative `render.yaml` Blueprint or the Render Dashboard UI.

### Option A: Render Dashboard UI (Standard Manual Setup)
1. Go to https://dashboard.render.com and click **New +** -> **Web Service**.
2. Connect your GitHub repository (`trainmate-v2`).
3. Configure the service settings:
   - **Name:** `trainmate-api`
   - **Region:** `Singapore` (match Supabase region)
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm ci && npm run prisma:generate && npm run build`
   - **Start Command:** `node dist/index.js`
   - **Instance Type:** `Free` ($0/month)
4. Under **Advanced**, configure:
   - **Health Check Path:** `/health`
   - **Auto-Deploy:** `Yes`
5. Configure Environment Variables (under **Environment** tab):
   | Key | Value / Guidance |
   | :--- | :--- |
   | `NODE_ENV` | `production` |
   | `HOST` | `0.0.0.0` |
   | `TRUST_PROXY_HOPS` | `1` |
   | `LOG_LEVEL` | `info` |
   | `JWT_SECRET` | Generate via: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `DATABASE_URL` | Your Supabase connection string (append `&connection_limit=5`) |
   | `CORS_ORIGIN` | Placeholder: `http://localhost:5173` (update in Phase 5 with your Vercel URL) |
   | `API_PUBLIC_ORIGIN` | Placeholder: `http://localhost:3000` (update once Render assigns your URL) |
   | `AUTH_ALLOWED_REDIRECT_ORIGINS` | Placeholder: `http://localhost:5173` (update in Phase 5) |
   | `EMAIL_PROVIDER` | `console` (or `resend` if using Resend API key) |
   | `EMAIL_FROM` | `TrainMate <noreply@trainmate.in>` |
6. Click **Create Web Service**.

### Option B: Render Blueprint (1-Click Setup)
1. In Render Dashboard, click **New +** -> **Blueprint**.
2. Connect your GitHub repository (`trainmate-v2`).
3. Render detects [`render.yaml`](file:///c:/Users/sward/trainmate-v2/render.yaml) automatically.
4. Input the requested secrets (`DATABASE_URL`, `CORS_ORIGIN`, `API_PUBLIC_ORIGIN`).
5. Click **Apply**.

### Verify Backend Deployment
1. Wait for the build and deployment logs to display:
   ```
   INFO: trainmate-api listening
   host: "0.0.0.0"
   port: 10000
   ```
2. Note your assigned public URL: `https://<your-service-name>.onrender.com`.
3. Update `API_PUBLIC_ORIGIN` in Render Environment Variables to your assigned URL:
   `API_PUBLIC_ORIGIN=https://<your-service-name>.onrender.com`.
4. Test the health endpoint in your browser or terminal:
   ```bash
   curl -s https://<your-service-name>.onrender.com/health
   ```
   *Expected response:*
   ```json
   {"status":"ok","version":"0.1.0","environment":"production","timestamp":"..."}
   ```

---

## Phase 4: Deploy Frontend on Vercel Free

1. Go to https://vercel.com/dashboard and click **Add New...** -> **Project**.
2. Import your GitHub repository (`trainmate-v2`).
3. Configure the Project:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `./` (Repository root)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
4. Expand **Environment Variables** and add:
   | Key | Value |
   | :--- | :--- |
   | `VITE_API_URL` | `https://<your-render-app>.onrender.com` |
   | `VITE_SOCKET_URL` | `https://<your-render-app>.onrender.com` |
5. Click **Deploy**.
6. Wait ~45 seconds for the build to finish.
7. Note your assigned live Vercel domain: `https://<your-project>.vercel.app`.

---

## Phase 5: Link CORS & Security Origins

Now that both services are deployed and have live HTTPS domains:

1. Open your **Render Dashboard** -> **trainmate-api** -> **Environment**.
2. Update the following environment variables with your real Vercel URL:
   ```ini
   CORS_ORIGIN=https://<your-project>.vercel.app
   AUTH_ALLOWED_REDIRECT_ORIGINS=https://<your-project>.vercel.app
   ```
   *(If you have a custom domain e.g. `https://trainmate.in`, separate by commas: `https://<your-project>.vercel.app,https://trainmate.in`)*.
3. Save changes. Render will automatically redeploy the service with the updated CORS policy (~15 seconds).

---

## Phase 6: Post-Deployment Smoke Verification (12-Flow Checklist)

Open your live Vercel URL in your browser and verify the canonical flows:

- [ ] **1. Registration & Verification**: Register a test account (`testuser@example.com`). If `EMAIL_PROVIDER=console`, check the Render logs to copy the confirmation link and activate the user.
- [ ] **2. Login & Session**: Sign in with the registered credentials; verify JWT session is stored in localStorage.
- [ ] **3. Journey Creation**: Add a journey on the dashboard with train number autocomplete (e.g. `12951 - Mumbai Rajdhani`).
- [ ] **4. Companion Discovery**: Search for matching companions on the same train and travel date.
- [ ] **5. Send Request**: Send a companion request to another user.
- [ ] **6. Notifications**: Verify the bell badge counter increments for the recipient.
- [ ] **7. Request Acceptance**: Accept the incoming companion request.
- [ ] **8. Realtime Chat**: Enter the newly opened conversation room. Send a message and verify instant delivery.
- [ ] **9. Read Receipts & Unread**: Verify messages are marked as read upon view.
- [ ] **10. Presence & Typing**: Open the chat in two separate browser windows (or incognito) and verify typing indicator and online presence.
- [ ] **11. Profile Update & Avatar**: Edit display name and upload a profile photo (base64 Data URL).
- [ ] **12. Moderation**: Test blocking a companion and verify mutual journey/profile masking.

---

## Phase 7: Operational Notes & Free-Tier Behavior

### Render Free Cold Starts
- **Behavior:** Render Free Web Services sleep after **15 minutes of inactivity**.
- **User Impact:** The first visitor after idle will experience a **~30–50 second delay** while Render provisions the container and boots Node.js.
- **Handling:** Subsequent requests are instantaneous (<100ms).
- **Pro-tip for Demos / Interviews:** Wake up your service 2 minutes before a demo by visiting `https://<your-render-app>.onrender.com/health`.

### Database Connection Limits
- Supabase Free tier allows a limited number of direct client connections (~15–20).
- The `&connection_limit=5` parameter in `DATABASE_URL` ensures Prisma's connection pool remains well within this ceiling.

### Data Retention & Zero Cost
- Vercel Free: $0/month.
- Render Free Web Service: $0/month.
- Supabase Free PostgreSQL: $0/month (500 MB limit, ample for tens of thousands of journeys and messages).
- **Total Operational Cost:** **$0.00 / month**.
