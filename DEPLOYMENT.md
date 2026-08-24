# Deployment Guide — MongoDB Atlas + Render (backend) + Vercel (frontend)

Free-tier setup to test the platform with your batch before buying Hostinger.
Total cost: ₹0. Both hosts provide HTTPS, which the webcam/proctoring features **require**.

---

## Part 1 — MongoDB Atlas (database)

1. Go to <https://www.mongodb.com/cloud/atlas/register> and sign up with your email.
2. Create a deployment:
   - Choose **M0 FREE** (512 MB storage, shared RAM — enough for a 200-student batch).
   - Provider: any (AWS Mumbai `ap-south-1` is closest for RGUKT) · Name: `cse-placements`.
3. **Database Access** (left sidebar) → *Add New Database User*:
   - Method: **Password**
   - Username: `examapp` · Password: generate one and save it (no special chars avoids URL-escaping issues).
   - Role: **Read and write to any database**.
4. **Network Access** → *Add IP Address* → **Allow access from anywhere (0.0.0.0/0)**.
   - Required because Render free-tier instances don't have static outbound IPs.
5. Open the cluster → **Connect** → **Drivers** (Node.js) → copy the connection string. It looks like:

```
mongodb+srv://examapp:<password>@cse-placements.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

6. Put your database name in the string (`/cse-placements?retryWrites...`) — final form:

```
mongodb+srv://examapp:<password>@cse-placements.xxxxx.mongodb.net/cse-placements?retryWrites=true&w=majority
```

That value is your `MONGODB_URI`.

### M0 limits to know
| Limit | Value | Impact for you |
|---|---|---|
| Storage | 512 MB | Text answers are tiny; thousands of submissions fit |
| Connections | ~100 | Backend pools at 10 per instance — fine for one Render instance |
| Ops/sec | shared, throttled | Fine for exam bursts; see "Load notes" below |

---

## Part 2 — Backend on Render

1. Push this repo to GitHub (Render deploys from git).
2. <https://dashboard.render.com> → **New → Web Service** → connect the repo.
3. Settings:
   - **Name:** `cse-placements-api`
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`   ← not nodemon
   - **Instance Type:** Free
4. **Environment variables** (Advanced → Add Environment Variable). Copy values from your local `backend/.env`:

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `MONGODB_URI` | *(from Part 1 step 6)* | |
| `STUDENT_JWT_SECRET` | same long hex as local | Keeps student logins valid across deploys |
| `FIREBASE_PROJECT_ID` | from local .env | |
| `FIREBASE_CLIENT_EMAIL` | from local .env | |
| `FIREBASE_PRIVATE_KEY` | from local .env | Paste exactly as-is; the app converts `\n` itself |
| `CLOUDINARY_CLOUD_NAME` | from local .env | Question images upload here |
| `CLOUDINARY_API_KEY` | from local .env | |
| `CLOUDINARY_API_SECRET` | from local .env | |
| `FRONTEND_URL` | `https://<your-app>.vercel.app` | Fill after Part 3; comma-separate multiple origins |
| `TRUST_PROXY` | `1` | Makes rate-limiting see real client IPs behind Render's proxy |

   Do **not** set `REDIS_URL` — Redis was removed from the stack.

5. Click **Create Web Service**. First deploy takes ~3–5 min. Verify: open `https://<render-app>.onrender.com/health` → `{"status":"healthy"}`.

### Free-tier caveat: spin-down
Render Free sleeps after **15 min without traffic**; next request takes ~50 s (cold start). Mitigations:
- Acceptable while testing; or keep it warm with a free pinger (cron-job.org hitting `/health` every 10 min).
- During a real exam everyone is active, so it never sleeps mid-exam.

---

## Part 3 — Frontend on Vercel

1. <https://vercel.com> → sign in with GitHub → **Add New Project** → import the repo.
2. Settings:
   - **Root Directory:** `frontend`
   - Framework Preset: Vite (auto-detected)
   - Build Command: `npm run build` · Output: `dist` (defaults are correct)
3. **Environment Variables** (copy from local `frontend/.env`):

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://<render-app>.onrender.com/api` |
| `VITE_FIREBASE_*` | all six Firebase keys, unchanged |

4. Deploy. Then go back to Render and set `FRONTEND_URL` to the Vercel URL (e.g. `https://cse-placements.vercel.app`) — CORS only allows that origin. Redeploy backend once.
5. `frontend/vercel.json` already contains the SPA rewrite so deep links like `/take-exam/:id` work on refresh.

---

## Part 4 — Optimizations already done in this codebase

**Backend**
- Grading is fully deterministic/offline — no AI API, no Redis/Bull queue (deps removed), zero external cost.
- `compression` middleware gzips every JSON response (~70–80 % smaller).
- Mongo pool capped at 10 (`MONGO_MAX_POOL_SIZE`) — safe for Atlas M0's ~100-connection cap even if you later run 2 instances.
- All hot queries are indexed: `{studentId, examId}` and `{examId, status}` on submissions, `{userId, isRead, createdAt}` on notifications, unique indexes on users, `examCode` on exams.
- Auto-save sends **only changed answers** (delta), max 100 per request, rate-limited separately from normal traffic.
- Proctoring events are **batched** (queue flushes at 5 events / 7.5 s; high-severity flushes instantly but still through one request when bursts collide).
- Request bodies capped at 1 MB; `TRUST_PROXY=1` so rate limits apply per-student, not per-proxy.
- Exam start shuffles questions/options server-side (seeded per submission) — no client trust involved.

**Frontend**
- Initial JS bundle 435 kB (135 kB gzip); heavy libs (face-api/tensorflow ≈1.4 MB, KaTeX, webgazer) load lazily only when actually used.
- Exam timer runs isolated — question list doesn't re-render every second.
- Auto-save every 30 s only when answers changed; proctoring events queued, not spammed.
- Draft workspace background poll skips while anyone is editing or unsaved changes exist (no typing lag).

---

## Part 5 — Load notes for 150–200 concurrent students

What to expect on free tiers:
- **Vercel free**: no problem — it's a static SPA behind their CDN; hundreds of concurrent users are routine.
- **Atlas M0**: the risk point is the **submit burst** (everyone submits near the end-time). Each submit does a few indexed writes + one stats `$set` — M0 handles this, but keep exams' end-times staggered by a minute or two across sections if you can.
- **Render free (512 MB RAM, 0.1 CPU)**: workable for testing; for a real exam round, the single biggest upgrade is Render **Starter ($7/mo)** — faster CPU and no spin-down. Second best: ping `/health` during the exam window to pre-warm.
- Camera/AI face detection runs **in each student's browser**, not on your server — server load is unaffected by proctoring.

Cheap wins if a session feels slow:
1. Ask students to use Chrome and close other tabs (face-api needs CPU on THEIR machine).
2. Keep question images ≤200 kB (they're served straight from Cloudinary CDN).
3. One Render instance comfortably serves ~200 students for text-based traffic; scale to 2 instances only if you see `/health` latency climb.

---

## Part 6 — Later Hostinger migration (when you buy)

You're moving backend (+ maybe DB) to a VPS. Checklist then:
- Run `node server.js` under **PM2** (`pm2 start server.js --name exam-api`, `pm2 startup`).
- Nginx reverse proxy `:80/:443 → :5000` with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and keep `TRUST_PROXY=1`.
- Use certbot for HTTPS (mandatory for camera).
- MongoDB: either keep Atlas free (recommended — automated backups, zero ops) or self-host with authentication enabled + bind to localhost only.
- Set `FRONTEND_URL` to your Hostinger domain; host frontend as static files from Nginx or keep Vercel.

## Quick smoke test after deploying

1. Open the Vercel URL → login as staff → dashboard loads, notifications fetch (Firebase + CORS working).
2. Login as roster student → join with exam code → calibration shows (camera permission prompt = HTTPS OK).
3. Submit an exam → status becomes *Needs Review* (text questions) or *Graded* (MCQ) → check it in Exam Submissions.
