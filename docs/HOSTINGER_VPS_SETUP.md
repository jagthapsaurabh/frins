# Hosting FRINS on frins.in with Hostinger

You have two products: **Hostinger Business web hosting** (shared LAMP) and a **VPS that already runs
nginx**, with other sites living in `/var/www/...`. This is the setup for putting FRINS on the VPS
without disturbing anything already there.

---

## 1. Which one to use: the VPS

Use the **VPS**. The Business plan cannot run FRINS, for four separate reasons:

| Requirement | Business hosting | VPS |
| --- | --- | --- |
| Long-running Node process on a port | Not allowed on shared hosting | Yes |
| `better-sqlite3` native module | Needs a compiler and a matching Node ABI | Yes, with build tools |
| Persistent writable SQLite file | No reliable writable path | Yes, `data/frins.db` |
| Processes that survive between requests | No, shared hosting is request/response | Yes, systemd |

The Business plan still earns its keep: keep it for **email** (mailboxes on `@frins.in`) and any PHP
site you already run there. Nothing in this guide touches those.

**Important:** the app must live at the **root of a domain or subdomain**, not a subfolder.
`https://frins.in` works. `https://frins.in/app` does not, because the React router and the bundled
asset paths are absolute. A subdomain such as `staging.frins.in` is fine.

**The backend does not need its own subdomain.** One Node process serves the website and the API on
the same port, and the frontend calls `/api/...` with relative paths, so `https://frins.in` covers
everything. Do not create `api.frins.in`.

---

## 2. What you need before you start

- The VPS public IPv4 address, SSH access with sudo.
- The VPS OS: check with `cat /etc/os-release`. Hostinger ships Ubuntu 22.04/24.04 or AlmaLinux 8/9.
  Commands below are Ubuntu first, with notes for AlmaLinux.
- Your code reachable from the VPS: a git repo, or `rsync`/`scp` from your machine.
- A free TCP port for the app. This guide uses **3100**. Check it first:

```bash
sudo ss -lntp | grep -E ':(3100|3000|3001|4000|5000|8000)\b' || echo "3100 is free"
```

- About 1.5 GB of free disk (Node modules plus the build, and room for the database to grow).

---

## 3. DNS at Hostinger

In hPanel: **Domains → frins.in → DNS / Nameservers → DNS Zone Editor**.

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | your VPS IPv4 | 300 |
| A | `www` | your VPS IPv4 | 300 |

Rules:

- If `www` already exists as a CNAME pointing at the Business hosting, **delete it** and create the
  A record above, or leave the CNAME and point it at `frins.in`.
- **Do not touch MX, SPF, DKIM, or DMARC.** Email keeps working from the Business plan.
- Do not change the nameservers.
- TTL 300 for the first switch, then raise it to 3600 once everything is confirmed.

**Safer path (recommended for a live domain):** create `staging.frins.in` as an A record to the VPS
first, run this whole guide against that name, confirm it works, then move `@` and `www`.
To do that, use `staging.frins.in` in the nginx `server_name` and in the certbot command, then
repeat both for the real domain.

Verify propagation before continuing:

```bash
dig +short frins.in        # dnf install bind-utils / apt install dnsutils if dig is missing
dig +short www.frins.in
```

Both should print the VPS IP.

---

## 4. Prepare the VPS

### Ubuntu / Debian

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 sqlite3 curl

node -v      # expect v20.x
npm -v
```

### AlmaLinux / Rocky / RHEL

```bash
sudo dnf module reset nodejs -y
sudo dnf module enable nodejs:20 -y
sudo dnf install -y nodejs gcc-c++ make python3 sqlite curl
node -v
```

### Swap, if the VPS has 1 GB RAM

`npm ci` plus a Vite build can momentarily exceed 1 GB. A small swap file removes that risk:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Firewall

Only 80 and 443 need to be open. Port 3100 stays internal.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

If the VPS has a **cloud firewall** in hPanel, open 80 and 443 there too.

---

## 5. Put the code on the server

Clone straight into the app folder and run the installer in place:

```bash
cd /var/www
git clone https://github.com/jagthapsaurabh/frins.git frins.in
cd /var/www/frins.in
sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
```

If you would rather keep a separate bootstrap clone somewhere else, that still works: pass
`APP_DIR=/var/www/frins.in` and the installer copies the code there. nginx details, including the
exact files to copy, are in [`NGINX_SETUP.md`](NGINX_SETUP.md).

It handles all four starting cases: no target folder, an existing git checkout, app files without
git, or an unrelated folder (which it refuses to overwrite). The bootstrap clone can be deleted
afterwards. Details: [`DEPLOY_CHANGES.md`](DEPLOY_CHANGES.md).

To do it by hand instead:

```bash
sudo useradd --system --create-home --home-dir /var/www/frins.in --shell /bin/bash frins
sudo -u frins git clone https://github.com/jagthapsaurabh/frins.git /var/www/frins.in
cd /var/www/frins.in
sudo -u frins mkdir -p data
sudo -u frins npm ci
sudo -u frins npm test          # 19 tests
sudo -u frins npm run build     # writes public_build/
```

If `better-sqlite3` fails with "Could not locate the bindings file", rebuild it on the server:

```bash
sudo -u frins npm rebuild better-sqlite3
```

---

## 6. Environment file

The app itself does **not** read `.env`. systemd injects it through `EnvironmentFile`, so a `.env`
file sitting there does nothing until the service is started with this unit.

```bash
sudo -u frins tee /var/www/frins.in/.env > /dev/null <<'EOF'
NODE_ENV=production
PORT=3100
# Optional, only if you switch the AI pipeline to a live provider
# AI_PROVIDER=real
# AI_API_KEY=
# AI_MODEL=gpt-4o-mini
# Optional, only needed if the UI is ever served from another domain
# CORS_ORIGIN=https://frins.in
EOF

sudo chmod 600 /var/www/frins.in/.env
sudo chown frins:frins /var/www/frins.in/.env
```

Format rules: `KEY=value`, no `export`, no quotes, one per line.

---

## 7. Run it as a service

```bash
sudo cp /var/www/frins.in/deploy/frins.service /etc/systemd/system/frins.service
sudo systemctl daemon-reload
sudo systemctl enable --now frins
sudo systemctl status frins --no-pager
```

The unit already matches this layout: `User=frins`, `WorkingDirectory=/var/www/frins.in`,
`EnvironmentFile=/var/www/frins.in/.env`, `PORT=3100`, `MemoryMax=900M`.

Watch the boot:

```bash
journalctl -u frins -n 50 --no-pager
curl -s http://127.0.0.1:3100/api/health
```

Expected: `{"status":"ok","product":"FRINS Market Learning",...}` with row counts. If you get
connection refused, read the journal before touching nginx.

Handy commands:

```bash
sudo systemctl restart frins
sudo systemctl stop frins
journalctl -u frins -f
```

---

## 8. nginx: one new server block

Your existing sites stay exactly where they are. First find out how this nginx loads sites:

```bash
nginx -T 2>/dev/null | grep -E 'include .*(sites-enabled|conf\.d)' | head
```

- If you see `sites-enabled`, use `sites-available` + symlink (Debian/Ubuntu).
- If you see `conf.d`, drop the file straight into `/etc/nginx/conf.d/`.

```bash
# Debian / Ubuntu layout
sudo cp /var/www/frins.in/deploy/nginx-frins.in.conf /etc/nginx/sites-available/frins.in
sudo ln -sf /etc/nginx/sites-available/frins.in /etc/nginx/sites-enabled/frins.in

# AlmaLinux layout instead:
# sudo cp /var/www/frins.in/deploy/nginx-frins.in.conf /etc/nginx/conf.d/frins.in.conf

sudo nginx -t          # must say "syntax is ok" and "test is successful"
sudo systemctl reload nginx
```

`reload` re-reads config without dropping connections to your other sites. Use `reload`, not
`restart`, whenever you only change config.

Test:

```bash
curl -I http://frins.in
# expect 301 from the HTTP block once certbot runs, or 200 before that
curl -s http://127.0.0.1:3100/api/health | head -c 120; echo
```

**AlmaLinux note.** SELinux blocks nginx from opening a socket to a local port by default. If you get
`502 Bad Gateway` with nothing in the app log:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

Also confirm your existing `default_server` block does not claim `frins.in` by name. It will not,
because nginx matches `server_name` first, but if a default block has `server_name _` and both listen
on 80, the named block wins for `frins.in`. Nothing to change.

---

## 9. HTTPS

```bash
# Ubuntu / Debian
sudo apt-get install -y certbot python3-certbot-nginx

# AlmaLinux / Rocky
# sudo dnf install -y epel-release
# sudo dnf install -y certbot python3-certbot-nginx

sudo certbot --nginx -d frins.in -d www.frins.in --redirect --agree-tos -m you@frins.in
```

Certbot edits only the block whose `server_name` matches, adds the 443 listener and the HTTP to HTTPS
redirect, and installs a renewal timer.

```bash
sudo certbot renew --dry-run     # confirm auto-renewal works
sudo systemctl list-timers | grep certbot
```

Then tighten nginx once more and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 10. Verify the deploy

Run these in order. All ten should pass before you point real traffic at it.

```bash
# 1. Process is up
systemctl is-active frins

# 2. App answers locally
curl -fsS http://127.0.0.1:3100/api/health | head -c 200; echo

# 3. nginx answers over HTTP and redirects to HTTPS
curl -I http://frins.in | head -3

# 4. TLS
curl -I https://frins.in | head -3

# 5. Public pages
for p in / /why-frins /how-it-works /tracks /discovery; do
  printf "%-16s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done

# 6. Sign-in pages
for p in /login /admin/login /guide/login /ai-pipeline/login; do
  printf "%-16s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done

# 7. Dashboards blocked for guests at the API level
for p in /api/learner/dashboard /api/admin/overview /api/guide/workspace; do
  printf "%-26s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done
# expect 401 three times

# 8. Security headers and HSTS arrive (certbot adds these on 443)
curl -sI https://frins.in | grep -iE 'strict-transport|content-type|server:'

# 9. Deep link refresh works, this is the SPA catch-all
curl -s -o /dev/null -w '%{http_code}\n' https://frins.in/admin/login

# 10. Logs are clean
sudo tail -n 20 /var/log/nginx/frins.in.error.log
journalctl -u frins -n 20 --no-pager
```

Then do a real browser pass: open `https://frins.in`, submit the Book a Call form with the **Other**
option, run Discovery and check the result screen, sign in as a learner, and open `/admin/login`
in a private window.

---

## 11. Redeploy and roll back

Deploy a new version:

```bash
sudo /var/www/frins.in/deploy/deploy.sh
```

Run it with sudo. The script drops to the `frins` user for `git`, `npm` and the build, so files stay
owned correctly, and uses systemd for the restart.

It pulls, runs `npm ci`, runs the tests, builds, restarts, and waits for `/api/health`. If the health
check fails it prints the journal tail and exits non-zero.

Roll back:

```bash
cd /var/www/frins.in
sudo -u frins git log --oneline -5
sudo -u frins git reset --hard <previous-sha>
sudo -u frins npm ci && sudo -u frins npm run build
sudo systemctl restart frins
curl -fsS http://127.0.0.1:3100/api/health
```

Schema changes in this app are additive (`ALTER TABLE ... ADD COLUMN` wrapped in try/catch), so an
older build still runs against a database touched by a newer one. Still, **take a backup before every
deploy** (next section). It costs two seconds.

---

## 12. Backups

`sqlite3` ships with the packages installed above.

```bash
sudo mkdir -p /var/backups/frins
sudo chown frins:frins /var/backups/frins

# one backup now
sudo -u frins /var/www/frins.in/deploy/backup.sh

# nightly at 02:15
( sudo crontab -l 2>/dev/null; echo '15 2 * * * /var/www/frins.in/deploy/backup.sh >> /var/log/frins-backup.log 2>&1' ) | sudo crontab -
```

`backup.sh` uses `sqlite3 .backup`, checks integrity on the copy, and deletes anything older than
14 days.

**Copy backups off the VPS.** A backup on the same disk does not survive disk failure. Either pull
them nightly from your machine:

```bash
rsync -az root@<vps-ip>:/var/backups/frins/ ./frins-backups/
```

or push them to object storage with `rclone`. Weekly off-box is the minimum.

Restore:

```bash
sudo systemctl stop frins
sudo cp /var/backups/frins/frins_YYYY-MM-DD_HHMM.db /var/www/frins.in/data/frins.db
sudo rm -f /var/www/frins.in/data/frins.db-wal /var/www/frins.in/data/frins.db-shm
sudo chown frins:frins /var/www/frins.in/data/frins.db
sudo systemctl start frins
curl -fsS http://127.0.0.1:3100/api/health
```

---

## 13. Living beside your existing sites

The rules that keep this safe on a shared VPS:

1. **Own folder.** `/var/www/frins.in`, owned by the `frins` user, nothing shared with other apps.
2. **Own port.** 3100, bound by one process, never exposed publicly. nginx is the only door.
3. **Own systemd unit.** `frins.service`. Restarting it does not touch your other services.
4. **One nginx file per domain.** Never edit another site's server block. Never touch the
   `default_server`.
5. **`nginx -t` before every reload.** A typo takes down every site on the box, not just this one.
6. **Reload, don't restart.** `systemctl reload nginx` keeps other connections alive.
7. **Memory cap.** `MemoryMax=900M` in the unit. If the box is 1 GB total, lower it to 500M and
   expect slower builds; builds are the memory spike, not runtime.
8. **Separate Node version.** FRINS needs Node 20. If another site on the box uses an older Node
   from `apt`, both can coexist: NodeSource installs to `/usr/bin/node` globally, so check
   `node -v` after installing and confirm the other app still starts. If they conflict, run this app
   under `nvm` or Docker instead.

Check who is using what at any time:

```bash
sudo ss -lntp | grep node
systemctl list-units --type=service --state=running | grep -v systemd
free -h && df -h /
```

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `curl https://frins.in` shows your old Hostinger site | DNS still points at the shared host | Check `dig +short frins.in`, wait for TTL, then flush |
| `502 Bad Gateway` | Node not running, wrong port, or SELinux | `systemctl status frins`, `journalctl -u frins -n 50`, check port in `.env` and nginx, then `setsebool -P httpd_can_network_connect 1` |
| `504 Gateway Timeout` | A live AI call exceeded the proxy timeout | `proxy_read_timeout 120s` is already set; check `AI_TIMEOUT_MS` |
| `403 Forbidden` from nginx | File permissions, or a default block matched | Confirm `server_name frins.in` and the symlink exists |
| Page loads, refresh on `/admin` gives 404 | Something other than this app answered | nginx must proxy `/` wholesale, as in `nginx-frins.in.conf` |
| Login works, then everyone is logged out after deploy | App started from a different working directory, so it opened a different database | `WorkingDirectory` must be `/var/www/frins.in` |
| `EACCES` writing `data/frins.db` | Ownership | `sudo chown -R frins:frins /var/www/frins.in/data` |
| Build killed with `Killed` | Out of memory | Add swap, or build locally and rsync `public_build/` |
| `Could not locate the bindings file` | `better-sqlite3` built for another Node ABI | `sudo -u frins npm rebuild better-sqlite3` |
| Certbot fails on HTTP-01 | Port 80 closed or DNS not propagated | `dig +short frins.in`, `ufw allow 'Nginx Full'`, retry |
| Uploads fail above about 1 MB | Body size | Both limits matter: `client_max_body_size 2m` in nginx, `express.json({ limit: '1mb' })` in the app |

Logs:

```bash
journalctl -u frins -f
tail -f /var/log/nginx/frins.in.error.log
tail -f /var/log/nginx/frins.in.access.log
```

---

## 15. Before you announce it

- Sign in as `admin@frins.org` / `frins123`, then **create your own admin and remove the demo
  accounts**. The seed password is public knowledge.
- The password salt is currently fixed per install, not per user. See section 8 of
  [`DEPLOYMENT.md`](../DEPLOYMENT.md) before taking paying users.
- Confirm email on the Business plan still works after moving the A records. Send a test to and from
  `you@frins.in`.
- Set up the nightly backup and confirm one off-box copy exists.
- Add uptime monitoring against `https://frins.in/api/health` from a free service. The endpoint is
  public and cheap.
