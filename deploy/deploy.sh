#!/usr/bin/env bash
#
# Redeploy FRINS on the VPS.
#
#   sudo /var/www/frins/deploy/deploy.sh
#
# Works whether you run it as root (it drops to the app user for npm steps)
# or as the frins user (it uses sudo only for the service restart).

set -euo pipefail

# Default to the repo this script lives in, so it works wherever you cloned.
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_USER="${APP_USER:-frins}"
SERVICE="${SERVICE:-frins}"
PORT="${PORT:-3100}"

cd "$APP_DIR"

# Run a command as the app user, whichever user invoked this script.
run_as_app() {
  if [ "$(id -u)" -eq 0 ]; then
    sudo -u "$APP_USER" "$@"
  else
    "$@"
  fi
}

restart_service() {
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart "$SERVICE"
  else
    sudo systemctl restart "$SERVICE"
  fi
}

if [ -d .git ]; then
  echo "==> Pulling latest code"
  run_as_app git pull --ff-only
else
  echo "==> No git checkout here, using the files already on disk"
fi

echo "==> Installing exact dependency versions"
run_as_app npm ci

echo "==> Running tests"
run_as_app npm test

echo "==> Building the frontend"
run_as_app npm run build

echo "==> Restarting $SERVICE"
restart_service

echo "==> Waiting for the health check"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1; then
    echo "==> Healthy. Deploy finished."
    curl -s "http://127.0.0.1:${PORT}/api/health"
    echo
    exit 0
  fi
  sleep 2
done

echo "!! Health check failed. Last 40 log lines:"
journalctl -u "$SERVICE" -n 40 --no-pager || true
exit 1
