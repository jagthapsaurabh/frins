#!/usr/bin/env bash
#
# Install or replace the FRINS nginx server block, safely.
#
#   sudo bash deploy/install-nginx.sh                  # domain frins.in
#   sudo DOMAIN=frins.in PORT=3100 bash deploy/install-nginx.sh
#   sudo DRY_RUN=1 bash deploy/install-nginx.sh        # show, change nothing
#   sudo FORCE=1 bash deploy/install-nginx.sh          # move conflicting files aside
#
# Why this exists: if the site file is installed under two names
# (sites-available/frins.in and sites-available/frins.in.conf) nginx loads both,
# logs "conflicting server name" and silently ignores one of them. That makes it
# unclear which file certbot edited. This script keeps exactly one file.
#
# What it does:
#   1. Detects whether nginx uses sites-available/sites-enabled or conf.d
#   2. Refuses to continue if another enabled file claims the same server_name
#   3. Writes exactly ONE file, backs up the previous one
#   4. Runs nginx -t and rolls back if the test fails
#   5. Reloads nginx, never restarts it, so other sites keep serving

set -euo pipefail

DOMAIN="${DOMAIN:-frins.in}"
PORT="${PORT:-3100}"
APP_DIR="${APP_DIR:-/var/www/frins}"
ETC="${ETC_DIR:-/etc/nginx}"
FORCE="${FORCE:-0}"
BACKUP_DIR="${BACKUP_DIR:-/root}"   # where old files are parked
DRY_RUN="${DRY_RUN:-0}"

SRC_DIR="${SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TEMPLATE="$SRC_DIR/deploy/nginx-frins.in.conf"

bold() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '\033[33m!!  %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31mxx  %s\033[0m\n\n' "$1" >&2; exit 1; }

bold "FRINS nginx install"
info "Domain      : $DOMAIN"
info "Template    : $TEMPLATE"
info "App folder  : $APP_DIR"
info "Upstream    : 127.0.0.1:$PORT"
[ "$DRY_RUN" = "1" ] && info "Mode        : DRY RUN, nothing will change"

[ -f "$TEMPLATE" ] || die "Template not found: $TEMPLATE"
command -v nginx >/dev/null 2>&1 || die "nginx is not installed."
if [ "$DRY_RUN" != "1" ] && [ "$(id -u)" -ne 0 ]; then
  die "Run this with sudo."
fi

# ------------------------------------------------------------------ layout
bold "Layout"

HAS_SITES=0
if [ -d "$ETC/sites-enabled" ]; then HAS_SITES=1; fi
if nginx -T 2>/dev/null | grep -qE 'include[[:space:]]+.*sites-enabled'; then HAS_SITES=1; fi

if [ "$HAS_SITES" = "1" ]; then
  TARGET="$ETC/sites-available/${DOMAIN}.conf"
  LINK="$ETC/sites-enabled/${DOMAIN}.conf"
  SEARCH_DIRS=("$ETC/sites-enabled" "$ETC/conf.d")
  info "sites-available / sites-enabled"
else
  TARGET="$ETC/conf.d/${DOMAIN}.conf"
  LINK=""
  SEARCH_DIRS=("$ETC/conf.d")
  info "conf.d"
fi
info "Target      : $TARGET"

# ------------------------------------------------- catch duplicate names
bold "Checking for other files that claim $DOMAIN"

D_ESC="$(printf '%s' "$DOMAIN" | sed 's/\./\\./g')"   # dots escaped for regex
if [ -e "$TARGET" ]; then TARGET_REAL="$(readlink -f "$TARGET")"; else TARGET_REAL="$TARGET"; fi

# Walk the folders ourselves: "grep -r" does not follow the symlinks that live
# in sites-enabled, which is exactly where the duplicate shows up.
CONFLICTS=()
shopt -s nullglob
for dir in "${SEARCH_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*; do
    [ -f "$f" ] || continue                      # -f follows symlinks
    [ "$(readlink -f "$f" 2>/dev/null || echo "$f")" = "$TARGET_REAL" ] && continue
    if grep -vE "^[[:space:]]*#" "$f" 2>/dev/null \
         | grep -E "server_name" 2>/dev/null \
         | grep -qE "(^|[[:space:]])${D_ESC}([[:space:]]|;|$)"; then
      CONFLICTS+=("$f")
    fi
  done
done
shopt -u nullglob

# The same file can appear once via sites-enabled and once via sites-available.
UNIQUE_CONFLICTS=()
for f in "${CONFLICTS[@]+"${CONFLICTS[@]}"}"; do
  real="$(readlink -f "$f" 2>/dev/null || echo "$f")"
  dupe=0
  for u in "${UNIQUE_CONFLICTS[@]+"${UNIQUE_CONFLICTS[@]}"}"; do
    [ "$(readlink -f "$u" 2>/dev/null || echo "$u")" = "$real" ] && dupe=1 && break
  done
  [ "$dupe" = "0" ] && UNIQUE_CONFLICTS+=("$f")
done

if [ "${#UNIQUE_CONFLICTS[@]}" -gt 0 ]; then
  warn "These files already declare server_name $DOMAIN:"
  for f in "${UNIQUE_CONFLICTS[@]}"; do
    info "  $f -> $(readlink -f "$f" 2>/dev/null || echo "$f")"
  done
  info ""
  info "nginx loads them all, logs 'conflicting server name' and ignores one."
  if [ "$FORCE" != "1" ]; then
    die "Stop here, pick ONE file to keep, then re-run.
    To disable one without deleting it:
      sudo rm -f /etc/nginx/sites-enabled/<name>     (for a symlink)
      sudo mv /etc/nginx/conf.d/<name> /root/<name>.disabled
    Or let this script move them aside: sudo FORCE=1 bash deploy/install-nginx.sh"
  fi
  warn "FORCE=1, moving them aside"
  for f in "${UNIQUE_CONFLICTS[@]}"; do
    if [ -L "$f" ]; then
      [ "$DRY_RUN" = "1" ] && info "[dry-run] would unlink $f" || { rm -f "$f"; info "unlinked $f"; }
    else
      dest="$BACKUP_DIR/$(basename "$f").disabled-$(date +%Y%m%d%H%M%S)"
      [ "$DRY_RUN" = "1" ] && info "[dry-run] would move $f to $dest" || { mv "$f" "$dest"; info "moved $f to $dest"; }
    fi
  done
else
  info "None. Good."
fi

# -------------------------------------------------------------- write it
bold "Writing the server block"

render() {
  local d p a
  d="$(printf '%s' "$DOMAIN" | sed -e 's/[&|\\]/\\&/g')"
  p="$(printf '%s' "$PORT" | sed -e 's/[&|\\]/\\&/g')"
  a="$(printf '%s' "$APP_DIR" | sed -e 's/[&|\\]/\\&/g')"
  sed -e "s|frins\.in|${d}|g" \
      -e "s|127\.0\.0\.1:3100|127.0.0.1:${p}|g" \
      -e "s|/var/www/frins|${a}|g" \
      "$TEMPLATE"
}

BACKUP=""
if [ -f "$TARGET" ]; then
  BACKUP="$BACKUP_DIR/$(basename "$TARGET").bak-$(date +%Y%m%d%H%M%S)"
  if [ "$DRY_RUN" = "1" ]; then
    info "[dry-run] would back up $TARGET to $BACKUP"
  else
    cp -a "$TARGET" "$BACKUP"
    info "Backed up the old file to $BACKUP"
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  info "[dry-run] would write $TARGET"
  [ -n "$LINK" ] && info "[dry-run] would link $LINK -> $TARGET"
  info "[dry-run] would run: nginx -t && systemctl reload nginx"
  bold "Done (dry run)"
  exit 0
fi

mkdir -p "$(dirname "$TARGET")"
render > "$TARGET"
info "Wrote $TARGET"

if [ -n "$LINK" ]; then
  ln -sfn "$TARGET" "$LINK"
  info "Linked $LINK"
fi

# ---------------------------------------------------------------- verify
bold "Testing and reloading"

if ! nginx -t; then
  if [ -n "$BACKUP" ] && [ -f "$BACKUP" ]; then
    cp -a "$BACKUP" "$TARGET"
    warn "Restored the previous file. nginx was NOT reloaded."
  else
    rm -f "$TARGET"
    [ -n "$LINK" ] && rm -f "$LINK"
    warn "Removed the new file. nginx was NOT reloaded."
  fi
  die "nginx -t failed. Your other sites were not touched."
fi

systemctl reload nginx
info "Reloaded. Existing connections were not dropped."

# ------------------------------------------------------------- next step
bold "Next"

if command -v certbot >/dev/null 2>&1; then
  if [ -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]; then
    info "A certificate already exists for $DOMAIN."
    info "Re-attach it to this single site file with:"
    info "  sudo certbot --nginx -d ${DOMAIN} --redirect --cert-name ${DOMAIN}"
  else
    info "Get a certificate with:"
    info "  sudo certbot --nginx -d ${DOMAIN} --redirect"
  fi
  info ""
  info "Only add -d www.${DOMAIN} once www.${DOMAIN} has an A record and resolves:"
  info "  dig +short www.${DOMAIN}"
fi
info ""
info "Check the result:"
info "  sudo nginx -T 2>/dev/null | grep -c 'server_name ${DOMAIN}'   # should be 1 or 2, never more"
info "  curl -sI http://${DOMAIN} | head -1"
