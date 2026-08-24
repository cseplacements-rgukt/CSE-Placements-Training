# RGUKT Deployment — Hostinger Cloud VPS

Target: **200–250 concurrent students writing the same exam** on a self-managed
Hostinger VPS (Node behind Nginx). This doc is the runbook; the repo contains
`backend/ecosystem.config.cjs` and `deploy/nginx.conf`.

## 1. Topology decisions (made explicitly)

| Concern | Decision | Why |
|---|---|---|
| Node process | **PM2 fork mode, 1 instance** | Keeps in-memory per-user rate limits correct. Cluster mode silently multiplies every student's limit per worker — do NOT enable unless rate limiting moves to `rate-limit-redis` first. |
| MongoDB | **MongoDB Atlas (managed)** | Avoids CPU/RAM contention with exam traffic on the same box during a live exam window. Self-hosting Mongo on this VPS is not recommended. |
| Redis | **Self-hosted on the same VPS** (`apt install redis-server`, bind 127.0.0.1) | Redis here only backs the Bull grading queue + nothing on the request hot path; contention risk is negligible vs. paying for managed Redis (Upstash also supported via `rediss://`). |
| Frontend | **Served from this VPS by Nginx** (static `dist/`) | One origin, no CORS complexity; Vercel would also work but then update `FRONTEND_URL`. This doc assumes VPS hosting. |
| TLS | Let's Encrypt via certbot (`--nginx`) | Standard, auto-renewing. |

## 2. Provisioning checklist

```bash
# 1. Base packages (Ubuntu 22.04/24.04 LTS image)
sudo apt update && sudo apt install -y nginx git redis-server
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# 2. Redis: loopback only + start on boot
sudo systemctl enable --now redis-server
redis-cli ping   # PONG

# 3. Create dirs & users
sudo mkdir -p /var/www/modugo /var/log/modugo
sudo chown -R $USER:$USER /var/www/modugo /var/log/modugo
```

## 3. Environment variables

Backend `/var/www/modugo/backend/.env` (**never commit**):

```ini
NODE_ENV=production
PORT=5000
TRUST_PROXY=1                      # one Nginx hop on same box
MONGO_URI=mongodb+srv://...        # Atlas connection string
REDIS_URL=redis://127.0.0.1:6379   # Bull queue
FRONTEND_URL=https://exam.yourdomain.edu   # exact origin(s), comma-separated
FIREBASE_SERVICE_ACCOUNT_PATH=/etc/modugo/firebase-service-account.json
SLM_API_URL=...                    # Groq/SLM endpoint for AI grading
SLM_API_KEY=...
CLOUDINARY_URL=                    # optional; only used if question images use it
```

Notes:
- Firebase service-account JSON goes to `/etc/modugo/` (root-owned, mode 600).
- `.env` files and service-account keys must never be committed to git.
- `frontend/.env` at build time: `VITE_API_URL=https://exam.yourdomain.edu/api`
  (then `npm run build`; rebuild whenever this changes).

## 4. Deploy & run

```bash
git pull                                   # or rsync from CI
cd backend && npm ci --omit=dev
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup systemd -u $USER --hp $HOME    # run printed command once → boot persistence

cd ../frontend && npm ci && npm run build  # dist/ served by Nginx
```

Nginx: copy `deploy/nginx.conf` → `/etc/nginx/sites-available/modugo`, edit
`server_name`, symlink into `sites-enabled`, `nginx -t && systemctl reload nginx`,
then run certbot as shown in the file header.

Firewall:
```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
# Node(5000) and Mongo/Redis ports stay closed externally.
```

## 5. Exam-day operations

- `pm2 monit` — watch event-loop/memory during the exam window.
- `redis-cli` → `LLEN bull:grading:wait` — grading queue depth.
- Atlas dashboard — connection count should hover ≈ Node pool size, not 250×.
- Deployments during an exam window are forbidden; PM2 restart mid-exam can strand
  submissions in `processing_submission` (the app auto-recovers them after 10 min,
  but avoid it anyway).

## 6. Load validation before go-live

Run `deploy/loadtest/k6-exam.js` (see its README section) ramping
25 → 50 → 100 → 150 → 200 → 250 VUs through join → load exam → jittered autosave →
proctoring batches → final-submit burst. Acceptance bar: submit p95 < 1.5 s,
autosave p95 < 300 ms, zero 5xx, 429s only from deliberate abuse.

## 7. Follow-ups (documented, intentionally not done now)

- Move rate limiting to `rate-limit-redis` (reusing ioredis) **before** any
  cluster/multi-instance deployment.
- If exam size grows past ~500 students, consider pagination on
  `GET /api/submissions/exam/:id` (currently hard-capped at 2000 docs).
