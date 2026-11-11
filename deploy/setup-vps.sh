#!/usr/bin/env bash
#
# FRINS one-shot server setup for an Ubuntu/Debian or AlmaLinux/Rocky VPS
# that already runs nginx with other sites on it.
#
#   sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
#
# Where the code ends up does NOT depend on where you cloned it. The clone
# folder (usually ~/frins) is only a bootstrap; the app is installed to APP_DIR.
#
# Options (all optional except DOMAIN):
#   DOMAIN=frins.in            domain to serve          (required)
#   EMAIL=you@frins.in         for Let's Encrypt        (omit to skip certificates)
#   APP_DIR=/var/www/frins  where the app lives      (default)
#   APP_USER=frins             service account          (default)
#   PORT=3100                  app port on 127.0.0.1    (default)
#   REPO=https://github.com/jagthapsaurabh/frins.git
#   BRANCH=main
#   SKIP_TLS=1                 do not request a certificate
#   DRY_RUN=1                  print every change, touch nothing
#
# Safe to re-run. It only manages its own folder, its own systemd unit and its
# own nginx server block. It never edits another site's config.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
APP_DIR="${APP_DIR:-/var/www/frins}"
APP_USER="${APP_USER:-frins}"
PORT="${PORT:-3100}"
REPO="${REPO:-https://github.com/jagthapsaurabh/frins.git}"
BRANCH="${BRANCH:-main}"
SKIP_TLS="${SKIP_TLS:-0}"
DRY_RUN="${DRY_RUN:-0}"

bold() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mxx  %s\033[0m\n\n' "$1" >&2; exit 1; }

# Run a command, or just print it in dry-run mode.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '    \033[36m[dry-run]\033[0m %s %s -> %s %s\n' "$1" "$2" "$3" "${4:-}"
  else
    "$@"
  fi
}

run_sh() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '    \033[36m[dry-run]\033[0m %s\n' "$*"
  else
    bash -c "$*"
  fi
}

# Run a command as the app user.
as_app() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '    \033[36m[dry-run]\033[0m (as %s) %s\n' "$APP_USER" "$*"
  else
    sudo -u "$APP_USER" "$@"
  fi
}

as_app_sh() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '    \033[36m[dry-run]\033[0m (as %s) %s\n' "$APP_USER" "$*"
  else
    sudo -u "$APP_USER" bash -c "$*"
  fi
}

# Copy a tree, excluding build output and runtime data.
# Uses rsync when present, otherwise falls back to tar, which is everywhere.
copy_tree() {
  local src="$1" dst="$2" delete_flag="${3:-}"
  if [ -z "$(command -v rsync 2>/dev/null)" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get install -y -qq rsync >/dev/null 2>&1 || true
    elif command -v dnf >/dev/null 2>&1; then
      dnf install -y -q rsync >/dev/null 2>&1 || true
    fi
  fi
  if command -v rsync >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    rsync -a $delete_flag \
      --exclude node_modules --exclude data --exclude public_build --exclude .env \
      "$src/" "$dst/"
  else
    info "rsync unavailable, copying with tar"
    tar -C "$src" -cf - \
      --exclude=./node_modules --exclude=./data --exclude=./public_build --exclude=./.env . \
      | tar -C "$dst" -xf -
  fi
}

# --------------------------------------------------------------- preflight
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -f "$SRC_DIR/package.json" ] || die "Could not find package.json next to deploy/. Run this from inside the repository."
[ -f "$SRC_DIR/server/index.ts" ] || die "$SRC_DIR does not look like the FRINS repo."

if [ "$DRY_RUN" != "1" ]; then
  [ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo DOMAIN=frins.in bash deploy/setup-vps.sh"
fi
[ -n "$DOMAIN" ] || die "Set the domain: sudo DOMAIN=frins.in bash deploy/setup-vps.sh"

# APP_DIR may equal the clone folder: that is a direct clone into /var/www.
# Anything else nested inside each other is a mistake.
IN_PLACE=0
if [ "$APP_DIR" = "$SRC_DIR" ]; then
  IN_PLACE=1
elif [ "${APP_DIR#"$SRC_DIR"/}" != "$APP_DIR" ]; then
  die "APP_DIR ($APP_DIR) is inside the clone ($SRC_DIR). Run the script from the app folder itself, or pick a separate APP_DIR."
elif [ "${SRC_DIR#"$APP_DIR"/}" != "$SRC_DIR" ]; then
  die "The clone ($SRC_DIR) is inside APP_DIR ($APP_DIR). Move the clone out of the app folder first."
fi

bold "FRINS setup"
info "Domain      : ${DOMAIN}"
info "App folder  : ${APP_DIR}"
info "App user    : ${APP_USER}"
info "Port        : ${PORT} (bound to localhost, proxied by nginx)"
info "Repository  : ${REPO} (${BRANCH})"
info "Source      : ${SRC_DIR}$([ "$IN_PLACE" = "1" ] && echo ' (installing in place)')"
info "Mode        : $([ "$DRY_RUN" = "1" ] && echo 'DRY RUN, nothing will change' || echo 'LIVE')"

# --------------------------------------------------------------- packages
bold "System packages"
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] would install: nodejs >= 20, git, build-essential/gcc-c++, python3, sqlite3, nginx$([ "$SKIP_TLS" != "1" ] && echo ', certbot')"
else
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl git build-essential python3 sqlite3 nginx >/dev/null
    if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
      apt-get install -y -qq nodejs >/dev/null
    fi
    if [ "$SKIP_TLS" != "1" ]; then
      apt-get install -y -qq certbot python3-certbot-nginx >/dev/null || warn "certbot install failed, continuing without it"
    fi
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q ca-certificates curl git gcc-c++ make python3 sqlite nginx >/dev/null
    if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
      dnf module reset nodejs -y >/dev/null 2>&1 || true
      dnf module enable nodejs:20 -y >/dev/null 2>&1 || true
      dnf install -y -q nodejs >/dev/null
    fi
    if [ "$SKIP_TLS" != "1" ]; then
      dnf install -y -q epel-release >/dev/null 2>&1 || true
      dnf install -y -q certbot python3-certbot-nginx >/dev/null 2>&1 || warn "certbot install failed, continuing without it"
    fi
  else
    die "Neither apt-get nor dnf found. Install Node 20, nginx, sqlite3 and git by hand."
  fi
  NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  [ "$NODE_MAJOR" -ge 20 ] || die "Node 20 or newer is required, found $(node -v)."
  info "node $(node -v), npm $(npm -v)"
fi

# --------------------------------------------------------------- port
if [ "$DRY_RUN" != "1" ]; then
  if ss -lnt 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"; then
    die "Port ${PORT} is already in use. Re-run with a free port, for example: sudo PORT=3200 DOMAIN=${DOMAIN} bash deploy/setup-vps.sh"
  fi
fi

# --------------------------------------------------------------- app user
bold "Service account"
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] would create user ${APP_USER} with home ${APP_DIR} if missing"
elif id "$APP_USER" >/dev/null 2>&1; then
  info "user ${APP_USER} already exists"
else
  useradd --system --create-home --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
  info "created user ${APP_USER}"
fi

# --------------------------------------------------------------- place code
bold "Placing the code in ${APP_DIR}"

place_code() {
  # 0. Cloned straight into APP_DIR: nothing to copy, just fix ownership.
  if [ "$IN_PLACE" = "1" ]; then
    info "installing in place, the clone is the app folder"
    run_sh "chown -R '${APP_USER}:${APP_USER}' '$APP_DIR'"
    return
  fi

  # 1. Existing checkout at the target: fast-forward it.
  if [ -d "$APP_DIR/.git" ]; then
    info "existing git checkout, updating from origin/${BRANCH}"
    run_sh "git -C '$APP_DIR' fetch --prune origin"
    run_sh "git -C '$APP_DIR' reset --hard 'origin/${BRANCH}'"
    run_sh "chown -R '${APP_USER}:${APP_USER}' '$APP_DIR'"
    return
  fi

  # 2. Target has the app but no git (rsync'd up): copy the source over it.
  if [ -f "$APP_DIR/package.json" ]; then
    info "app files already present without git, copying source over them"
    run copy_tree "$SRC_DIR" "$APP_DIR" --delete
    run_sh "chown -R '${APP_USER}:${APP_USER}' '$APP_DIR'"
    return
  fi

  # 3. Target missing or empty.
  if [ -d "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
    die "${APP_DIR} exists and is not empty, and it is not a FRINS checkout.
    Move its contents away, or run again with a different APP_DIR:
      sudo APP_DIR=/var/www/frins-2 DOMAIN=${DOMAIN} bash deploy/setup-vps.sh"
  fi

  # Prefer copying the clone you already have: no second download, and it
  # keeps the git history so deploy.sh can pull later.
  if [ -d "$SRC_DIR/.git" ]; then
    info "copying the clone from ${SRC_DIR}"
    run_sh "mkdir -p '$APP_DIR'"
    run copy_tree "$SRC_DIR" "$APP_DIR"
  else
    info "cloning ${REPO} into ${APP_DIR}"
    run_sh "mkdir -p '$APP_DIR' && rmdir '$APP_DIR' 2>/dev/null || true"
    run_sh "git clone --branch '${BRANCH}' '${REPO}' '$APP_DIR'"
  fi
  run_sh "chown -R '${APP_USER}:${APP_USER}' '$APP_DIR'"
}

place_code
run_sh "mkdir -p '$APP_DIR/data'"
run_sh "chown -R '${APP_USER}:${APP_USER}' '$APP_DIR/data'"

# --------------------------------------------------------------- env file
bold "Environment file"
ENV_FILE="$APP_DIR/.env"
env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }

if [ -f "$ENV_FILE" ]; then
  info "keeping existing $ENV_FILE"
  EXISTING_PORT="$(env_value PORT || true)"
  if [ -n "$EXISTING_PORT" ] && [ "$EXISTING_PORT" != "$PORT" ]; then
    warn "The .env sets PORT=${EXISTING_PORT} but this run uses PORT=${PORT}."
    warn "Align them, then: sudo systemctl restart frins && sudo nginx -t && sudo systemctl reload nginx"
    PORT="$EXISTING_PORT"
  fi
else
  info "writing $ENV_FILE"
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] NODE_ENV=production, PORT=${PORT}"
  else
    cat > "$ENV_FILE" <<ENVEOF
NODE_ENV=production
PORT=${PORT}
# Optional: switch the AI pipeline to a live OpenAI-compatible model
# AI_PROVIDER=real
# AI_API_KEY=
# AI_MODEL=gpt-4o-mini
# Optional: service key for the training JSONL endpoints
# GUIDE_REVIEW_API_KEY=
ENVEOF
    chmod 600 "$ENV_FILE"
    chown "$APP_USER:$APP_USER" "$ENV_FILE"
  fi
fi

# --------------------------------------------------------------- build
bold "Dependencies and build"
as_app_sh "cd '$APP_DIR' && npm ci --no-audit --no-fund"
as_app_sh "cd '$APP_DIR' && npm run build"

# --------------------------------------------------------------- systemd
bold "systemd unit"
UNIT=/etc/systemd/system/frins.service
if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] would write ${UNIT} (User=${APP_USER}, WorkingDirectory=${APP_DIR}, PORT=${PORT})"
else
  # Escape sed metacharacters in the paths before substituting.
  APP_DIR_SED="$(printf '%s' "$APP_DIR" | sed -e 's/[&|\\]/\\&/g')"
  sed -e "s|/var/www/frins|${APP_DIR_SED}|g" \
      -e "s|Environment=PORT=3100|Environment=PORT=${PORT}|" \
      -e "s|^User=frins|User=${APP_USER}|" \
      -e "s|^Group=frins|Group=${APP_USER}|" \
      "$SRC_DIR/deploy/frins.service" > "$UNIT"
  systemctl daemon-reload
  systemctl enable frins >/dev/null 2>&1 || true
  systemctl restart frins
  info "frins.service installed and started"

  ok=0
  for _ in $(seq 1 25); do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" = "1" ]; then
    info "health check passed on 127.0.0.1:${PORT}"
  else
    journalctl -u frins -n 40 --no-pager || true
    die "The app did not become healthy. See the log above."
  fi
fi

# --------------------------------------------------------------- nginx
bold "nginx server block"
NGINX_SRC="$SRC_DIR/deploy/nginx-frins.in.conf"

render_nginx() {
  local domain_sed
  domain_sed="$(printf '%s' "$DOMAIN" | sed -e 's/[&|\\]/\\&/g')"
  sed -e "s|frins\.in|${domain_sed}|g" -e "s|127\.0\.0\.1:3100|127.0.0.1:${PORT}|g" "$NGINX_SRC"
}

if [ "$DRY_RUN" = "1" ]; then
  if nginx -T 2>/dev/null | grep -qE 'include .*sites-enabled'; then
    info "[dry-run] would write /etc/nginx/sites-available/${DOMAIN}.conf and link it into sites-enabled"
  else
    info "[dry-run] would write /etc/nginx/conf.d/${DOMAIN}.conf"
  fi
  info "[dry-run] would run nginx -t, then systemctl reload nginx"
else
  if nginx -T 2>/dev/null | grep -qE 'include .*sites-enabled'; then
    SITE="/etc/nginx/sites-available/${DOMAIN}.conf"
    render_nginx > "$SITE"
    ln -sf "$SITE" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  else
    SITE="/etc/nginx/conf.d/${DOMAIN}.conf"
    render_nginx > "$SITE"
  fi
  info "wrote $SITE"
  if ! nginx -t; then
    die "nginx config test failed. Nothing was reloaded, your other sites are untouched.
    Fix or remove $SITE, then run: sudo nginx -t && sudo systemctl reload nginx"
  fi
  systemctl reload nginx
  info "nginx reloaded, other sites unaffected"

  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
    setsebool -P httpd_can_network_connect 1 || warn "Could not set the SELinux boolean, expect 502s"
    info "SELinux: httpd_can_network_connect enabled"
  fi
fi

# --------------------------------------------------------------- TLS
bold "HTTPS"
PUBLIC_IP=""
if [ "$DRY_RUN" != "1" ]; then
  PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
fi

host_points_here() {
  local host="$1" ips
  ips="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)"
  [ -z "$ips" ] && { echo "  $host does not resolve yet"; return 1; }
  echo "  $host -> $(echo "$ips" | tr '\n' ' ')"
  [ -n "$PUBLIC_IP" ] && echo "$ips" | grep -qx "$PUBLIC_IP"
}

if [ "$SKIP_TLS" = "1" ]; then
  warn "SKIP_TLS=1, no certificate requested"
elif [ -z "$EMAIL" ]; then
  warn "No EMAIL set, no certificate requested. Run later:
    sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect"
else
  CERT_HOSTS=(-d "$DOMAIN")
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] would check DNS for ${DOMAIN} and www.${DOMAIN}, then run certbot --nginx"
  else
    host_points_here "$DOMAIN" || warn "${DOMAIN} does not point at this server yet. Fix DNS first, then re-run certbot."
    if host_points_here "www.${DOMAIN}"; then
      CERT_HOSTS+=(-d "www.${DOMAIN}")
    else
      warn "Skipping www.${DOMAIN} in the certificate because it does not point here yet.
    Add the www A record, then run: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect"
    fi
    if certbot --nginx "${CERT_HOSTS[@]}" --redirect --agree-tos -n -m "$EMAIL"; then
      info "certificate installed, HTTP redirects to HTTPS"
    else
      warn "certbot did not finish. Once DNS points here, run:
    sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect"
    fi
  fi
fi

# --------------------------------------------------------------- summary
bold "Done"
if [ "$DRY_RUN" = "1" ]; then
  printf '\n  Dry run finished. Nothing on this machine was changed.\n'
  printf '  Run the same command without DRY_RUN=1 to apply it.\n\n'
  exit 0
fi

APP_SIZE="$(du -sh "$APP_DIR" 2>/dev/null | cut -f1 || echo '?')"
cat <<SUMMARY

  Code          : ${APP_DIR} (${APP_SIZE})
  Service       : systemctl status frins
  Logs          : journalctl -u frins -f
  Health        : curl -s http://127.0.0.1:${PORT}/api/health
  Site          : curl -I https://${DOMAIN}
  Database      : ${APP_DIR}/data/frins.db

  The clone you ran this from (${SRC_DIR}) is only a bootstrap.
  You can delete it once the site is up.

  Next, create your own admin:

    cd ${APP_DIR} && sudo -u ${APP_USER} npm run create:admin -- \\
      --email you@${DOMAIN} --name "Your Name" --role ADMIN

  Then sign in at https://${DOMAIN}/admin/login
  and remove the demo account admin@frins.org / frins123:

    cd ${APP_DIR} && sudo -u ${APP_USER} npm run list:accounts

SUMMARY
