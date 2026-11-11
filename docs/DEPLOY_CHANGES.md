# Deploying FRINS: folders, what to change, and the domain question

Short answers first.

**Does the backend need a subdomain?** No. One domain is enough. `https://frins.in` serves both the
website and the API. Do not create `api.frins.in`.

**Where does the code live?** Wherever you tell it. The clone folder is only a bootstrap. The app is
installed to `/var/www/frins.in` and runs from there.

---

## 1. Why one domain is enough

The Node process serves both halves on the same port:

```
  Browser  ──HTTPS──▶  nginx (port 443)  ──▶  127.0.0.1:3100  (one Node process)
                                                 ├── /api/*      Express routes
                                                 └── /*          built React files
```

The React app calls `fetch('/api/...')` with a relative path, so the browser sends every request to
whatever domain the page came from. Same origin, no CORS, no second certificate.

Verified: there is no absolute API URL anywhere in `src/`. Every call is relative, for example
`/api/auth/login`, `/api/leads`, `/api/book-call`, `/api/discovery/questions`.

**What a subdomain would cost you.** If the API lived at `api.frins.in`, every `fetch('/api/...')`
would hit `frins.in/api/...` instead, which is the wrong host. You would need to add a configurable
API base URL, change every call site, enable CORS with credentials, and issue a second certificate.
There is no benefit for this app. Keep it on one domain.

**The one thing you do need:** the app must be at the **root of the domain or subdomain**, not a
subfolder. `https://frins.in` works, `https://frins.in/app` does not, because the router and the
asset paths are absolute. A subdomain such as `staging.frins.in` is fine if you want a test copy.

---

## 2. Folders: the clone is not the install

Cloning always creates a folder named after the repo:

```bash
git clone https://github.com/jagthapsaurabh/frins.git       # creates ./frins
git clone https://github.com/jagthapsaurabh/frins.git /opt/frins   # creates /opt/frins
```

That folder is a **bootstrap**. `deploy/setup-vps.sh` reads the code from wherever it sits and
installs it to `APP_DIR`, which defaults to `/var/www/frins.in`. Afterwards the layout is:

```
/var/www/frins.in/            <- the app, and the only folder that matters
├── .env                      NODE_ENV, PORT
├── data/
│   └── frins.db              the database, back this up
├── public_build/             built website
├── deploy/                   deploy.sh, backup.sh, nginx conf, systemd unit
├── server/  src/  package.json
└── node_modules/             installed on the server

/root/frins/                  <- the bootstrap clone, safe to delete
```

The installer handles all four starting situations, each tested:

| Situation | What it does |
| --- | --- |
| `/var/www/frins.in` missing | Copies your clone there (keeps `.git`, so `deploy.sh` can pull later). Never downloads twice. |
| `/var/www/frins.in` already a git checkout | Runs `git fetch` + `git reset --hard origin/main`. This is how re-running the script updates the app. |
| `/var/www/frins.in` has app files but no `.git` | Copies the source over them, excluding `node_modules`, `data`, `public_build`, `.env`. Your database is untouched. |
| `/var/www/frins.in` has unrelated files | **Stops** with a message. It will not overwrite someone else's site. |

Two guards protect against mistakes: it refuses to install *inside* the clone, and refuses to run if
the clone is inside the install folder.

**Files that are never copied or overwritten:** `data/` (your database), `public_build/` (rebuilt on
the server), `node_modules/` (installed on the server), `.env` (created once, then kept).

You can delete the bootstrap clone after setup:

```bash
rm -rf /root/frins
```

### If you want a different folder

```bash
sudo APP_DIR=/var/www/frins DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
```

Everything follows `APP_DIR`: the systemd unit, the working directory, the database path, and the
`deploy.sh` defaults. Keep it out of any path that contains spaces.

---

## 3. What you must change for frins.in

Run this on the server, adapting the three values:

```bash
sudo DOMAIN=frins.in EMAIL=you@frins.in APP_DIR=/var/www/frins.in \
     REPO=https://github.com/jagthapsaurabh/frins.git \
     bash deploy/setup-vps.sh
```

| Setting | Default | Change it when |
| --- | --- | --- |
| `DOMAIN` | none, required | Always. Used in the nginx `server_name` and the certificate |
| `EMAIL` | empty | Always, unless you add TLS by hand. Omit it and no certificate is requested |
| `APP_DIR` | `/var/www/frins.in` | You already have that path in use, or you prefer `/var/www/frins` |
| `APP_USER` | `frins` | Only if that user already exists for something else |
| `PORT` | `3100` | The port is taken. Check with `sudo ss -lntp \| grep 3100` |
| `REPO` / `BRANCH` | this GitHub repo / `main` | You fork the repo or deploy from a branch |
| `SKIP_TLS` | `0` | You terminate TLS at a different proxy, or you want to test on HTTP first |

Then these, which are not script flags:

| What | Where | Value |
| --- | --- | --- |
| DNS | Hostinger hPanel, DNS Zone Editor | `A @` and `A www` → VPS IP. Leave MX/SPF/DKIM alone |
| `.env` | `/var/www/frins.in/.env` | `NODE_ENV=production`, `PORT=` the same port you passed |
| AI provider | `.env` | `AI_PROVIDER=mock` by default. Set `real` plus `AI_API_KEY` to call a live model |
| Admin account | `npm run create:admin` | Your own email and name |
| Demo accounts | Admin console, Team tab | Remove `admin@frins.org` / `frins123` |
| Backups | crontab | `deploy/backup.sh` nightly |

**Nothing in the application code has to change.** There is no domain, URL, or hostname baked into
the source. The same build runs on `frins.in`, `staging.frins.in`, or `localhost`.

---

## 4. What the script does, in order

1. Installs Node 20, git, build tools, sqlite3, nginx, certbot (skips what is already there)
2. Refuses to continue if `PORT` is taken
3. Creates the `frins` system user if missing
4. Places the code in `APP_DIR` (one of the four cases above)
5. Writes `.env` once, then leaves it alone
6. Runs `npm ci` and `npm run build` as the app user
7. Installs `frins.service`, starts it, waits for `/api/health`
8. Writes its own nginx server block, runs `nginx -t`, reloads nginx
9. Checks whether `frins.in` and `www.frins.in` resolve to this machine, then requests a certificate
   for the names that do
10. Prints the paths, the health URL and the admin command

**What it will not touch:** other nginx server blocks, other systemd units, `/etc/nginx/nginx.conf`,
and any folder other than `APP_DIR`.

**Test it without changing anything:**

```bash
sudo DRY_RUN=1 DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
```

It prints every command it would run and exits.

---

## 5. Common deployment mistakes

| Mistake | Symptom | Fix |
| --- | --- | --- |
| Creating `api.frins.in` for the backend | Login fails with network errors, `/api` returns the website's HTML | Delete it. Use one domain |
| Pointing DNS at the VPS but running the app on the Business plan | 404 or the old site | The app runs on the VPS only |
| Installing to a path with the repo name and forgetting it | Two copies, edits in the wrong one | One `APP_DIR`, printed at the end of setup |
| Editing files in the bootstrap clone | Changes vanish on next deploy | Edit in `APP_DIR`, or push to GitHub and run `deploy.sh` |
| Copying `data/frins.db` from a laptop | Old seeded data, wrong paths | Let the server create its own database |
| Changing `PORT` in `.env` but not in nginx | 502 | Both must match. The script warns if `.env` disagrees |
| Running `npm ci` as root | Files owned by root, service cannot write `data/` | `sudo -u frins npm ci`, as the script does |
| Deploying with no backup | One bad migration away from data loss | `deploy/backup.sh` nightly, off-box copy weekly |
