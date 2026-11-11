# Push to GitHub and deploy to frins.in

Two parts: the code is now in `github.com/jagthapsaurabh/frins`, and here is how to run it on the VPS.

---

## Part 1: the code is pushed

`main` on `github.com/jagthapsaurabh/frins` is at `a8ecc48` and CI is green. Turn 19 is in:
one sidebar in the admin console, real section routes, no "public website" item.

**The live site has not picked this up yet.** `https://frins.in` is still serving the older bundle
(`index-uwC8vDTV.js`). Run Part 2, step 6 on the VPS to deploy:

```bash
cd /var/www/frins
sudo ./deploy/deploy.sh
```

That pulls, runs the tests, builds and restarts the service, then checks `/api/health`.

### For future pushes from this workspace

### Route A: push from this workspace with a token

1. Create a token: GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories → frins**
   - Permissions: **Contents: Read and write**
2. Run:

```bash
cd /home/user
GITHUB_TOKEN=ghp_yourtoken bash deploy/push-to-github.sh
```

Then deploy on the VPS (Part 2, step 6) so frins.in picks up the new build.

The script pushes `main` using the token in the remote URL for that one command, then sets `origin`
back to the clean HTTPS URL. The token is never written to `.git/config`.

### Route B: push from your own machine

Download `frins-repo.bundle` from this workspace, then:

```bash
git clone frins-repo.bundle frins
cd frins
git remote add origin https://github.com/jagthapsaurabh/frins.git
git push -u origin main
```

### Route C: plain git, if you already have credentials set up

```bash
cd /home/user
git remote set-url origin https://github.com/jagthapsaurabh/frins.git
git push -u origin main --force
```

`--force` is only needed if the remote `main` already has commits you do not want. It currently holds
a single `README.md`, so a force push replaces it.

**What gets pushed:** the source tree, about 2.4 MB. Source, docs, deploy scripts and the uploaded
requirement PDF. `node_modules`, `data/`, `public_build/`, `.env` and the local previews are ignored,
so no database and no secrets go up.

---

## Part 2: deploy on the VPS

### 0. Facts this assumes

The backend does **not** need a subdomain. One Node process serves the site and the API, and the
frontend calls `/api/...` relatively, so `https://frins.in` covers everything.

| Item | Value |
| --- | --- |
| Domain | `frins.in` and `www.frins.in` |
| App folder | `/var/www/frins` |
| App user | `frins` (unprivileged) |
| App port | `3100`, localhost only |
| Reverse proxy | your existing nginx |
| Database | `/var/www/frins/data/frins.db` |

Change `PORT` if 3100 is taken: `sudo ss -lntp | grep 3100`.

### 1. DNS

Hostinger hPanel → **Domains → frins.in → DNS Zone Editor**:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | VPS IPv4 |
| A | `www` | VPS IPv4 |

Leave MX, SPF, DKIM and DMARC alone so email keeps working. Verify from your laptop:

```bash
dig +short frins.in
dig +short www.frins.in
```

Both must print the VPS IP before you run certbot.

### 2. One command on the server

```bash
ssh root@<vps-ip>

# get the code onto the box (public read is enough)
git clone https://github.com/jagthapsaurabh/frins.git      # creates /root/frins
cd /root/frins

sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
```

The clone folder is only a bootstrap. The script installs the app to `/var/www/frins`, so the
clone stays as it is and can be deleted later. See [`DEPLOY_CHANGES.md`](DEPLOY_CHANGES.md) for the
folder layout and every settable option.

The script:

1. installs Node 20, build tools, sqlite3, nginx and certbot if missing
2. creates the `frins` user with home `/var/www/frins`
3. clones the app into `/var/www/frins` (or updates it if already there)
4. writes `.env` with `NODE_ENV=production` and `PORT=3100`
5. runs `npm ci` and `npm run build`
6. installs and starts `frins.service`
7. writes its own nginx server block, runs `nginx -t`, reloads
8. requests the certificate for `frins.in` and `www.frins.in`
9. waits for `/api/health` and prints next steps

It only creates files it owns and only restarts its own service. Your other sites stay untouched.

Expected finish:

```
==> Done
  App folder : /var/www/frins
  Service    : systemctl status frins
  Logs       : journalctl -u frins -f
  Health     : curl -s http://127.0.0.1:3100/api/health
  Local test : curl -I http://frins.in
```

### 3. Create your admin

```bash
cd /var/www/frins
sudo -u frins npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN
```

It prints a generated password once:

```
  Account created.
    Name:   Your Name
    Email:  you@frins.in
    Role:   ADMIN

  Temporary password (shown once, copy it now):
    QBUbsa-ZzEPsF-j33buz
```

Sign in at `https://frins.in/admin/login`. Pass `--password '...'` instead if you want to choose it,
`--force` to reset an account later, and `npm run list:accounts` to see everyone.

### 4. Remove the demo accounts

The seed ships `admin@frins.org` with the password `frins123`. Delete or suspend it once your own
admin works. In the Admin console, **Team** tab, or directly:

```bash
cd /var/www/frins && sudo -u frins npm run list:accounts
```

### 5. Verify

```bash
systemctl is-active frins
curl -fsS http://127.0.0.1:3100/api/health
curl -I https://frins.in

for p in / /why-frins /how-it-works /tracks /discovery /login /admin/login; do
  printf "%-16s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done

# these three must all return 401 for a guest
for p in /api/learner/dashboard /api/admin/overview /api/guide/workspace; do
  printf "%-26s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done
```

Then open the site in a private window: submit Book a Call with **Other**, run Discovery, sign in as
a learner, and confirm `/admin` sends you to `/admin/login`.

### 6. Backups

```bash
sudo mkdir -p /var/backups/frins && sudo chown frins:frins /var/backups/frins
( sudo crontab -l 2>/dev/null; echo '15 2 * * * /var/www/frins/deploy/backup.sh >> /var/log/frins-backup.log 2>&1' ) | sudo crontab -
```

Pull a copy off the VPS weekly, or it is not really a backup.

---

## Day two

**Ship a change**

```bash
sudo /var/www/frins/deploy/deploy.sh
```

Pulls, `npm ci`, tests, builds, restarts, waits for the health check, prints the journal if it fails.

**Change a config**

```bash
sudo nano /var/www/frins/.env
sudo systemctl restart frins
sudo nginx -t && sudo systemctl reload nginx    # only if you touched the nginx file
```

**Roll back**

```bash
cd /var/www/frins && sudo -u frins git log --oneline -5
sudo -u frins git reset --hard <sha>
sudo -u frins npm ci && sudo -u frins npm run build
sudo systemctl restart frins
```

**Where things live**

| What | Command |
| --- | --- |
| Live logs | `journalctl -u frins -f` |
| nginx logs | `/var/log/nginx/frins.in.error.log` |
| Service state | `systemctl status frins` |
| Database | `/var/www/frins/data/frins.db` |
| Backups | `/var/backups/frins/` |

---

## If something breaks

| Symptom | Check |
| --- | --- |
| `502 Bad Gateway` | `systemctl status frins`, then `journalctl -u frins -n 50`. On AlmaLinux also `setsebool -P httpd_can_network_connect 1` |
| Old Hostinger page still shows | DNS has not moved. `dig +short frins.in` |
| Certbot fails | Port 80 closed, or DNS not pointing here yet. `sudo certbot --nginx -d frins.in -d www.frins.in` again once DNS is right |
| Everything logged out after a deploy | The service started from the wrong folder, so it opened a different database. `WorkingDirectory` must be `/var/www/frins` |
| Build killed on a small VPS | Add 2 GB swap, or build locally and rsync `public_build/` |

Full troubleshooting table: [`HOSTINGER_VPS_SETUP.md`](HOSTINGER_VPS_SETUP.md) section 14.
