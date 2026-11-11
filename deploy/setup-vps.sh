#!/usr/bin/env bash
#
# One-shot setup for FRINS on a fresh Ubuntu/Debian or AlmaLinux/Rocky VPS
# that already runs nginx with other sites.
#
#   sudo DOMAIN=frins.in EMAIL=you@frins.in bash deploy/setup-vps.sh
#
# Optional overrides:
#   APP_DIR=/var/www/frins.in  PORT=3100  APP_USER=frins
#   REPO=https://github.com/jagthapsaurabh/frins.git
#   SKIP_TLS=1        (do not run certbot)
#
# Safe to re-run: it updates code, rebuilds, rewrites its own config files and
# restarts only its own service. It never edits other nginx server blocks.

set -euo pipefail

DOMAIN="${DOMAIN:-frins.in}"
EMAIL="${EMAIL:-}"
APP_DIR="${APP_DIR:-/var/www/frins.in}"
PORT="${PORT:-3100}"
APP_USER="${APP_USER:-frins}"
REPO="${REPO:-https://github.com/jagthapsaurabh/frins.git}"
SKIP_TLS="${SKIP_TLS:-0}"

bold() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }
die()  { printf '\033[31mxx  %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
[ "$(id -u)" -eq 0 ] || die "Run this with sudo."
[ -n "$DOMAIN" ] || die "Set DOMAIN, for example: sudo DOMAIN=frins.in bash deploy/setup-vps.sh"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SRC_DIR/package.json" ] || die "Run this from inside the project (deploy/setup-vps.sh)."

if ss -lnt 2>/dev/null | grep -qE "[:.]${PORT}\b"; then
  die "Port ${PORT} is already in use. Re-run with PORT=<free port>."
fi

bold "FRINS setup"
cat <<INFO
  Domain      : ${DOMAIN}
  App folder  : ${APP_DIR}
  App user    : ${APP_USER}
  Port        : ${PORT} (localhost only, proxied by nginx)
  Repository  : ${REPO}
  Project src : ${SRC_DIR}
INFO

# ---------------------------------------------------------------- packages
bold "Installing system packages"

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git build-essential python3 sqlite3 nginx >/dev/null
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  if [ "$SKIP_TLS" != "1" ]; then
    apt-get install -y -qq certbot python3-certbot-nginx >/dev/null || warn "certbot install failed, continuing"
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
    dnf install -y -q certbot python3-certbot-nginx >/dev/null 2>&1 || warn "certbot install failed, continuing"
  fi
else
  die "Neither apt-get nor dnf found. Install Node 20, nginx and sqlite3 by hand."
fi

NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required, found $(node -v)."
echo "  node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- app user
bold "Preparing the app user and folder"

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_DIR" --shell /bin/bash "$APP_USER"
  echo "  created user $APP_USER"
else
  echo "  user $APP_USER already exists"
fi

mkdir -p "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  bold "Updating existing checkout"
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
elif [ -f "$APP_DIR/package.json" ]; then
  bold "Using code already present in $APP_DIR"
  rsync -a --exclude node_modules --exclude data --exclude public_build "$SRC_DIR/" "$APP_DIR/" 2>/dev/null || true
else
  bold "Cloning the repository"
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"

# ---------------------------------------------------------------- env file
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  bold "Writing $ENV_FILE"
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
else
  echo "  keeping existing $ENV_FILE"
fi

# ---------------------------------------------------------------- build
bold "Installing dependencies and building"
sudo -u "$APP_USER" npm --prefix "$APP_DIR" ci --no-audit --no-fund
sudo -u "$APP_USER" npm --prefix "$APP_DIR" run build

# ---------------------------------------------------------------- systemd
bold "Installing the systemd service"
UNIT=/etc/systemd/system/frins.service
sed -e "s|/var/www/frins.in|${APP_DIR}|g" \
    -e "s|Environment=PORT=3100|Environment=PORT=${PORT}|" \
    -e "s|^User=frins|User=${APP_USER}|" \
    -e "s|^Group=frins|Group=${APP_USER}|" \
    "$SRC_DIR/deploy/frins.service" > "$UNIT"

systemctl daemon-reload
systemctl enable frins >/dev/null 2>&1 || true
systemctl restart frins

bold "Waiting for the app"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "  app is healthy on 127.0.0.1:${PORT}"
    break
  fi
  sleep 2
done
curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 \
  || { journalctl -u frins -n 40 --no-pager; die "App did not start. See the log above."; }

# ---------------------------------------------------------------- nginx
bold "Installing the nginx site"
NGINX_CONF_SRC="$SRC_DIR/deploy/nginx-frins.in.conf"

if nginx -T 2>/dev/null | grep -qE 'include .*sites-enabled'; then
  NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}.conf"
  sed -e "s|frins\.in|${DOMAIN}|g" -e "s|127\.0\.0\.1:3100|127.0.0.1:${PORT}|g" "$NGINX_CONF_SRC" > "$NGINX_SITE"
  ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  echo "  $NGINX_SITE (sites-enabled layout)"
else
  NGINX_SITE="/etc/nginx/conf.d/${DOMAIN}.conf"
  sed -e "s|frins\.in|${DOMAIN}|g" -e "s|127\.0\.0\.1:3100|127.0.0.1:${PORT}|g" "$NGINX_CONF_SRC" > "$NGINX_SITE"
  echo "  $NGINX_SITE (conf.d layout)"
fi

nginx -t || die "nginx config test failed. Nothing was reloaded, other sites are untouched."
systemctl reload nginx
echo "  nginx reloaded"

if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  setsebool -P httpd_can_network_connect 1 || warn "Could not set SELinux boolean, expect 502s"
  echo "  SELinux: httpd_can_network_connect enabled"
fi

# ---------------------------------------------------------------- TLS
if [ "$SKIP_TLS" = "1" ]; then
  warn "Skipping TLS because SKIP_TLS=1"
elif [ -n "$EMAIL" ] && command -v certbot >/dev/null 2>&1; then
  bold "Requesting the certificate for ${DOMAIN}"
  certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" --redirect --agree-tos -n -m "$EMAIL" \
    || warn "certbot did not finish. DNS may not point here yet. Re-run: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
else
  warn "TLS skipped. Re-run with EMAIL=you@${DOMAIN} to get a certificate,"
  warn "or run: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect"
fi

# ---------------------------------------------------------------- summary
bold "Done"
cat <<SUMMARY

  App folder : ${APP_DIR}
  Service    : systemctl status frins
  Logs       : journalctl -u frins -f
  Health     : curl -s http://127.0.0.1:${PORT}/api/health
  Local test : curl -I http://${DOMAIN}

  Create your admin account now:

    cd ${APP_DIR} && sudo -u ${APP_USER} npm run create:admin -- \\
      --email you@${DOMAIN} --name "Your Name" --role ADMIN

  Then sign in at https://${DOMAIN}/admin/login

  Before real users, remove the demo accounts (admin@frins.org / frins123):

    cd ${APP_DIR} && sudo -u ${APP_USER} npm run list:accounts

SUMMARY
