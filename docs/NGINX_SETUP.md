# nginx setup for frins.in

You cloned directly into `/var/www` and the `@` DNS record is already added. This is the nginx part:
the exact files, where they go, and how to confirm each step.

No Docker anywhere. The app is a Node process on `127.0.0.1:3100`; nginx proxies to it.

---

## 0. The layout you are aiming for

```
/var/www/frins.in/                  app folder, owned by user frins
  ├── .env                          NODE_ENV=production, PORT=3100
  ├── data/frins.db                 SQLite file
  ├── public_build/                 built site
  ├── deploy/nginx-frins.in.conf    the file you copy into nginx
  └── server/ src/ package.json

/etc/nginx/sites-available/frins.in     copy of the file above
/etc/nginx/sites-enabled/frins.in ->    symlink to it

frins.service                           systemd unit, runs npm start as frins
127.0.0.1:3100                          Node, not reachable from outside
```

Two rules that save trouble:

- **Do not** create a second site for the API. One domain serves both.
- **Do not** edit other server blocks. One file per domain.

---

## 1. Clone into /var/www

`/var/www` is root-owned, so clone as root and let the installer fix ownership.

```bash
cd /var/www
git clone https://github.com/jagthapsaurabh/frins.git frins.in
cd /var/www/frins.in
```

The folder name is your choice: `frins.in`, `frins`, anything without spaces. Whatever you pick is the
app folder from then on.

```bash
ls
# deploy  docs  index.html  package.json  server  src  tests  ...
```

---

## 2. Run the installer in place

```bash
cd /var/www/frins.in
sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
```

Because you are running it from the app folder itself, it installs **in place**: no copying, no
second checkout. It will:

1. install Node 20, build tools, sqlite3, nginx, certbot (skips what exists)
2. check port 3100 is free
3. create the `frins` system user
4. `chown -R frins:frins /var/www/frins.in`
5. write `.env` once (`NODE_ENV=production`, `PORT=3100`)
6. run `npm ci` and `npm run build` as `frins`
7. install and start `frins.service`, wait for `/api/health`
8. write the nginx server block, `nginx -t`, reload
9. request the certificate for names that resolve here
10. print the paths and the admin command

Preview it first if you want:

```bash
sudo DRY_RUN=1 DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
```

If you prefer to do the nginx part yourself, skip to section 3 and run the installer with
`SKIP_TLS=1`, or just do everything by hand as below.

---

## 3. The nginx files

There are two files in `deploy/`:

| File | Required? | What it does |
| --- | --- | --- |
| `nginx-frins.in.conf` | **yes** | The site: proxies `frins.in` and `www.frins.in` to port 3100, caches assets, sets security headers, enables gzip |
| `nginx-www-redirect.conf` | optional | Sends `www.frins.in` to `https://frins.in`. Add it after the certificate if you want one canonical address |

### Find out which layout your nginx uses

```bash
nginx -T 2>/dev/null | grep -E 'include .*(sites-enabled|conf\.d)' | head
```

- Prints `sites-enabled` → Debian/Ubuntu layout, use sections 3a
- Prints `conf.d` → AlmaLinux/Rocky layout, use section 3b
- Prints both → use `sites-enabled`

### 3a. Debian / Ubuntu

```bash
sudo cp /var/www/frins.in/deploy/nginx-frins.in.conf /etc/nginx/sites-available/frins.in
sudo ln -sf /etc/nginx/sites-available/frins.in /etc/nginx/sites-enabled/frins.in
sudo nginx -t
sudo systemctl reload nginx
```

### 3b. AlmaLinux / Rocky

```bash
sudo cp /var/www/frins.in/deploy/nginx-frins.in.conf /etc/nginx/conf.d/frins.in.conf
sudo nginx -t
sudo systemctl reload nginx
```

### What the file contains, line by line

| Directive | Why |
| --- | --- |
| `server_name frins.in www.frins.in;` | Claims both names. Other sites keep their own names |
| `client_max_body_size 2m;` | The app accepts 1 MB JSON uploads; without this nginx returns 413 first |
| `add_header X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy` | Basic response hardening, harmless here |
| `location /assets/ { expires 1y; }` | Vite filenames are content-hashed, so cache forever. `expires` is used rather than `add_header` so the headers above still apply |
| `proxy_pass http://127.0.0.1:3100;` | The whole site, API and pages, goes to one Node process |
| `proxy_set_header Host / X-Real-IP / X-Forwarded-For / X-Forwarded-Proto` | The app has `trust proxy` on, so rate limiting sees the real visitor IP and generated URLs use https |
| `proxy_read_timeout 120s` | A live AI run can take a while; nginx defaults to 60s |
| `gzip on` | Smaller JS and CSS over the wire |
| separate access and error logs | `frins.in` has its own logs, easier to read next to other sites |

### If `nginx -t` complains

| Message | Fix |
| --- | --- |
| `duplicate default server` | Another block already has `default_server`. This file does not use it, so the conflict is elsewhere. Check the line number nginx prints |
| `conflicting server name "frins.in"` | An older config still claims the name. `sudo grep -rn "frins.in" /etc/nginx/` and remove that one |
| `unknown directive "http2"` | nginx older than 1.25.2. Put `http2` on the `listen` line instead: `listen 443 ssl http2;` |
| `Permission denied` writing logs | SELinux on AlmaLinux, see section 7 |

---

## 4. Test over HTTP before touching certificates

```bash
curl -I http://frins.in
curl -s http://127.0.0.1:3100/api/health
```

Expected: `200` from the site, and a JSON health payload from Node. If you get `502`, Node is not
running:

```bash
systemctl status frins
journalctl -u frins -n 50 --no-pager
```

Do not continue to certificates until HTTP works.

---

## 5. HTTPS

You said the `@` record is added. Check both names:

```bash
dig +short frins.in
dig +short www.frins.in
```

`frins.in` should print your VPS IP. If `www` prints nothing, you have two choices:

**Option A, add `www` too (recommended).** In Hostinger DNS Zone Editor add `A www → VPS IP`. Then:

```bash
sudo certbot --nginx -d frins.in -d www.frins.in --redirect
```

**Option B, serve the bare domain only.** One domain is enough:

```bash
sudo certbot --nginx -d frins.in --redirect
```

Then `www.frins.in` will not work. Fine if nobody types `www`.

Certbot edits `/etc/nginx/sites-available/frins.in` in place: it adds the 443 block, copies the
`proxy_pass` lines into it, and adds the HTTP to HTTPS redirect. Your proxy settings survive.

Confirm renewal:

```bash
sudo certbot renew --dry-run
```

---

## 6. Verify the finished site

```bash
# 1. TLS and the redirect from HTTP
curl -I http://frins.in | head -3          # 301 to https
curl -I https://frins.in | head -3         # 200

# 2. Public pages
for p in / /why-frins /how-it-works /tracks /discovery; do
  printf "%-16s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done

# 3. Sign-in pages
for p in /login /admin/login /guide/login /ai-pipeline/login; do
  printf "%-16s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done

# 4. Dashboards closed to guests, at the API level
for p in /api/learner/dashboard /api/admin/overview /api/guide/workspace; do
  printf "%-26s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://frins.in$p)"
done
# all three must print 401

# 5. Security headers present
curl -sI https://frins.in | grep -iE 'x-content-type|x-frame|referrer|permissions|strict-transport'

# 6. Asset caching
curl -sI https://frins.in/assets/$(curl -s https://frins.in | grep -o 'index-[^"]*\.js' | head -1) | grep -i cache-control

# 7. Logs are clean
sudo tail -n 20 /var/log/nginx/frins.in.error.log
journalctl -u frins -n 20 --no-pager
```

Then in a browser: open the site, submit the Book a Call form with **Other**, finish Discovery, sign
in as a learner, and confirm `/admin` redirects you to `/admin/login`.

### Optional: www to bare domain

If both names work and you want one canonical address, follow the instructions at the top of
`deploy/nginx-www-redirect.conf`. Summary: remove `www.frins.in` from the 443 `server_name`, add the
redirect file, `nginx -t`, reload.

---

## 7. nginx.conf notes

You usually do not need to touch `/etc/nginx/nginx.conf`. Two exceptions on a shared VPS:

**Long domain names.** If `nginx -t` says `could not build server_names_hash`, raise the bucket:

```nginx
# in the http { } block
server_names_hash_bucket_size 64;
```

**SELinux on AlmaLinux.** A proxy to a local port is blocked by default. Symptom is `502` with
nothing in the app log:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

**Real client IPs behind another proxy or CDN.** If you later put Cloudflare in front, add the real IP
module so rate limiting still sees visitors:

```nginx
# http { } block
set_real_ip_from 173.245.48.0/20;
# ... Cloudflare ranges
real_ip_header CF-Connecting-IP;
```

Not needed today. Leave it out until there is a CDN.

---

## 8. Running apps on ports without exposing them

Port 3100 is bound to `0.0.0.0` by the app, which means it is reachable from outside if your firewall
allows it. Close it:

```bash
# Ubuntu
sudo ufw status
# only 22, 80, 443 should be allowed. 3100 must not appear.

# AlmaLinux
sudo firewall-cmd --list-ports
sudo firewall-cmd --permanent --remove-port=3100/tcp   # only if it is listed
sudo firewall-cmd --reload
```

Verify from your laptop that 3100 is closed:

```bash
curl -m 5 http://<vps-ip>:3100/api/health     # should time out
```

Everything reaches the app through nginx on 443.

---

## 9. Everyday commands

```bash
# after editing nginx config
sudo nginx -t && sudo systemctl reload nginx

# after changing .env
sudo systemctl restart frins

# after pushing new code
sudo /var/www/frins.in/deploy/deploy.sh

# deploy.sh and backup.sh find the app folder from their own location,
# so they work wherever you cloned. Override with APP_DIR=/path if needed.

# logs
sudo tail -f /var/log/nginx/frins.in.error.log
journalctl -u frins -f
```

**Always `nginx -t` before reloading.** A syntax error in another site's file takes down every site
on the box, not just this one.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `502 Bad Gateway` | Node down, wrong port, or SELinux | `systemctl status frins`, `journalctl -u frins -n 50`, check `PORT` in `.env` matches the `proxy_pass` port, then `setsebool -P httpd_can_network_connect 1` |
| `504 Gateway Timeout` | Long AI call | `proxy_read_timeout 120s` is already set |
| `403 Forbidden` | Wrong folder permissions or another block matched | `curl -I http://127.0.0.1:3100` works? Then it is nginx routing. Check `server_name` |
| `413 Request Entity Too Large` | Upload over the nginx limit | `client_max_body_size 2m` is set; raise it if you allow bigger files |
| Refresh on `/admin` gives 404 | Something other than this app answered | nginx must proxy `/` wholesale, as in the shipped file |
| Site works but every login fails | Frontend and API on different origins, or cookies dropped | Keep one domain. Check the browser console for CORS or 401 |
| Certbot: `Could not verify` | DNS not pointing here, or port 80 closed | `dig +short frins.in`, `ufw allow 'Nginx Full'` |
| `conflicting server name` | Two files claim `frins.in` | `sudo grep -rln "frins.in" /etc/nginx/sites-enabled /etc/nginx/conf.d` |
| Old Hostinger page appears | DNS still on the shared host | Wait for TTL, check `dig +short frins.in` |
