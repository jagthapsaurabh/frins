# FRINS: stack and deployment

This document answers two questions: what the app is built with, and how to put it on a server.

---

## 1. Tech stack

| Layer | Choice | Notes |
| --- | --- | --- |
| UI | **React 18** + **TypeScript 5** | Function components, hooks, no class components |
| Routing | **React Router 6** | Public site, `/login`, `/dashboard`, `/admin`, `/guide`, `/ai-pipeline` |
| Styling | **Plain CSS** (`src/styles/frins.css`, ~2.7k lines) | Design tokens as CSS variables, no Tailwind or UI kit |
| Icons | **lucide-react** | Tree-shaken SVG icons |
| Build tool | **Vite 5** | Builds to `public_build/`, about 403 kB JS and 42 kB CSS |
| API | **Express 4** on **Node 20** | `server/index.ts`, one process serves API and UI |
| Language | **TypeScript everywhere** | Server runs through **tsx** (no separate compile step) |
| Database | **SQLite** via **better-sqlite3 11** | File at `data/frins.db`, WAL mode, **no Prisma** |
| Auth | Opaque bearer tokens in `auth_sessions` | 24 hour expiry, role checked per route, `localStorage` on the client |
| AI | Deterministic three-agent pipeline, optional OpenAI-compatible LLM | `AI_PROVIDER=real` + `AI_API_KEY` to switch it on |
| Tests | **Vitest** | 19 tests: acceptance, access control, route guards |
| Package manager | **npm** | `package-lock.json` is committed |

**How it runs in production.** One Node process listens on `PORT` (default 3001). Express serves `/api/*` and the static files in `public_build/`, with a catch-all that returns `index.html` so client-side routes work on refresh. There is no separate web server, no build server, and no background worker.

**What that means for hosting.** SQLite is a real file. The host must give you a **persistent disk**. Any platform that wipes the filesystem on deploy (Render free tier, Vercel, Netlify Functions, Cloudflare Workers) will lose data on every deploy. Use a VPS, Docker with a volume, Fly with a volume, or a paid Render/Railway service with a disk attached.

**Minimum requirements:** Node 20+, 512 MB RAM, 1 vCPU, ~200 MB disk plus your data.

---

## 2. Environment variables

Only `PORT` and `NODE_ENV` matter for a basic deploy. Everything else is optional.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `3001` | Port the Node process listens on |
| `NODE_ENV` | yes | none | Set to `production`. Enables the built-asset path and disables development keys |
| `CORS_ORIGIN` | no | same origin | Comma separated list, only if the UI is served from a different domain |
| `AI_PROVIDER` | no | `mock` | `real` to call a live model, anything else stays deterministic |
| `AI_API_KEY` | no | empty | Key for the OpenAI-compatible endpoint |
| `AI_API_BASE_URL` | no | `https://api.openai.com/v1` | Any compatible base URL |
| `AI_MODEL` | no | `gpt-4o-mini` | Model name for the observational stage |
| `AI_TIMEOUT_MS` | no | implementation default | Upstream timeout before falling back to deterministic output |
| `GUIDE_REVIEW_API_KEY` | no | empty | Service key for `x-frins-guide-key` training endpoints. Empty in production means only signed-in staff can use them |

The database path is **not** configurable by env var. It is always `<working directory>/data/frins.db`, so the process must start from the project root.

---

## 3. Build and run commands

```bash
npm ci            # install exact versions from the lockfile
npm test          # 19 tests, optional but recommended before a deploy
npm run build     # writes public_build/
NODE_ENV=production npm start   # serves API + UI on :3001
```

`npm start` runs `tsx server/index.ts`. `tsx` is listed in `dependencies`, not `devDependencies`, so `npm ci --omit=dev` still produces a runnable app.

Health check for your platform:

```bash
curl -f http://localhost:3001/api/health
```

It returns `{"status":"ok", ...}` plus row counts. Point the platform's health check at `/api/health`.

---

## 4. Option A: Docker (recommended)

A `Dockerfile` and `.dockerignore` are in the repo root.

```bash
docker build -t frins:1.0 .
docker run -d --name frins \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -v frins_data:/app/data \
  --restart unless-stopped \
  frins:1.0
```

Or with `docker-compose.yml`:

```bash
docker compose up -d --build
docker compose logs -f app
```

The volume mount is the important line. It keeps `data/frins.db` outside the container so `docker compose down` or a new image does not erase users, leads, and courses.

Put TLS in front with a reverse proxy. Minimal Caddy setup, which gets certificates automatically:

```
learn.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

Nginx equivalent:

```nginx
server {
    listen 443 ssl http2;
    server_name learn.example.com;

    ssl_certificate     /etc/letsencrypt/live/learn.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/learn.example.com/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

`client_max_body_size 2m` matters because student uploads go through JSON with a 1 MB server limit.

---

## 5. Option B: VPS with systemd (the frins.in setup)

A ready-made walkthrough for an existing nginx VPS is in
[`docs/HOSTINGER_VPS_SETUP.md`](docs/HOSTINGER_VPS_SETUP.md). It covers DNS at Hostinger, hosting
next to existing sites in `/var/www`, TLS, backups, and rollback.

Short version, with the app at `/var/www/frins.in` and the Node process on port 3100:

```bash
# 1. Node 20, build tools for better-sqlite3, sqlite3 for backups
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 sqlite3

# 2. Service account and code
sudo useradd --system --create-home --home-dir /var/www/frins.in --shell /bin/bash frins
sudo -u frins git clone <your-repo> /var/www/frins.in
cd /var/www/frins.in

# 3. Install, test, build
sudo -u frins npm ci
sudo -u frins npm test
sudo -u frins npm run build

# 4. Service
sudo cp deploy/frins.service /etc/systemd/system/frins.service
sudo systemctl daemon-reload
sudo systemctl enable --now frins
sudo systemctl status frins
```

`deploy/frins.service` points at `/var/www/frins.in`, runs as the unprivileged `frins` user, reads
`/var/www/frins.in/.env` through `EnvironmentFile`, listens on 3100, and caps memory at 900 MB so it
cannot starve other sites on the same box.

nginx gets one new server block, `deploy/nginx-frins.in.conf`, proxying `frins.in` and
`www.frins.in` to `127.0.0.1:3100`. Add it, run `sudo nginx -t`, then `sudo systemctl reload nginx`.
Reloading does not disturb the other sites.

Then issue the certificate:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d frins.in -d www.frins.in --redirect
```

Redeploy with `deploy/deploy.sh`, back up with `deploy/backup.sh`. Both are documented in the
Hostinger walkthrough.

## 6. Option C: Render, Railway, or Fly.io

The app is a plain Node service, so it runs on any of these. The only thing that trips people up is the disk.

**Render**

- New → Web Service → connect the repo.
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Environment: `NODE_ENV=production`
- Add a **Persistent Disk** mounted at `/opt/render/project/src/data`, size 1 GB.
- Health check path: `/api/health`

**Railway**

- New Project → Deploy from repo. Railway detects Node.
- Build: `npm ci && npm run build`, Start: `npm start`.
- Add a **Volume** mounted at `/app/data`.
- Variables: `NODE_ENV=production`.

**Fly.io**

```bash
fly launch --no-deploy          # accept the Dockerfile it finds
fly volumes create frins_data --size 1
fly secrets set NODE_ENV=production
fly deploy
```

Make sure `fly.toml` mounts the volume at `/app/data` and that the internal port is 3001.

**Do not** deploy to Vercel, Netlify, or Cloudflare. They run stateless functions with a read-only or ephemeral filesystem, so SQLite will not survive.

---

## 7. Backups and restore

SQLite in WAL mode must be copied with the backup command, not `cp`, or you can capture a half-written state.

```bash
# Safe online backup, works while the app is running
sqlite3 data/frins.db ".backup 'backups/frins-$(date +%F).db'"

# Keep 14 days
find backups -name 'frins-*.db' -mtime +14 -delete
```

Cron entry:

```
15 2 * * * cd /srv/frins && sqlite3 data/frins.db ".backup 'backups/frins-$(date +\%F).db'" && find backups -name 'frins-*.db' -mtime +14 -delete
```

Restore:

```bash
sudo systemctl stop frins
cp backups/frins-2026-10-16.db data/frins.db
rm -f data/frins.db-wal data/frins.db-shm
sudo systemctl start frins
```

`sqlite3` is not installed by default on every image. `apt-get install -y sqlite3` on a VPS, or use a container that has it.

Uploaded student files are stored as base64 inside `learning_tasks.uploaded_file_data`, so the database backup is the whole backup. That is why the file grows and why the 1 MB request limit exists.

---

## 8. Before you take real users

These are real gaps in the current code, not hypotheticals. Fix them in this order.

1. **Change every seeded password.** The app seeds five demo accounts with the password `frins123`, and `admin@frins.org` is one of them. Sign in as admin, create your own admin, then delete or deactivate the demo accounts. The seed runs only when the `users` table is empty, so deleting them is permanent.
2. **Replace the fixed password salt.** `hashPassword()` in `server/db.ts` uses one hard-coded salt for every user, which makes rainbow tables effective. Switch to a per-user random salt (or `crypto.scryptSync` with a stored salt column) and rehash on next login.
3. **Set `GUIDE_REVIEW_API_KEY`** to a long random value if you use the JSONL training endpoints from a script. Without it, production only accepts staff bearer tokens, which is the safer default.
4. **Terminate TLS.** Sessions are bearer tokens; over plain HTTP they are readable on the wire.
5. **Keep one instance.** The rate limiter is an in-memory `Map`. Two instances behind a load balancer double the effective limit. Horizontal scaling also means moving off SQLite.
6. **Watch disk growth.** Every Discovery answer, upload, and audit event is a row. Check `du -h data/frins.db` monthly and back up before it gets large.
7. **Know where the seed data comes from.** If you clone from git, `data/` is ignored, so the first boot creates an empty database and seeds demo users, courses, and the question bank automatically. If you copy this folder as-is, `data/frins.db` already holds that seeded state plus the sample lead and session rows you created while testing. Run `npm run db:reset` for a clean seed before going live.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error: Could not locate the bindings file` | better-sqlite3 built for a different Node ABI | Rebuild inside the target image: `npm rebuild better-sqlite3` |
| `EADDRINUSE` | Another process on 3001 | `lsof -i :3001`, stop it, or set `PORT` |
| Page loads but every route 404s on refresh | Static catch-all not reached | Confirm `npm run build` ran and `public_build/index.html` exists |
| `Frontend bundle not found. Run npm run build.` | Started without a build | Run `npm run build`, restart |
| Data disappears after each deploy | Ephemeral filesystem | Attach a persistent disk or volume at `data/` |
| All users logged out and data reset | Started from a different working directory | `WorkingDirectory` must be the folder containing `data/` |
| 502 from nginx | App not listening or crashed | `journalctl -u frins -n 100` |
| Login works locally, fails in production | Frontend and API on different origins without CORS | Serve both from this process, or set `CORS_ORIGIN` |

Logs go to stdout. On Docker use `docker logs -f frins`; with systemd use `journalctl -u frins -f`.
