#!/usr/bin/env bash
#
# Nightly SQLite backup for FRINS.
# Cron:  15 2 * * * /var/www/frins.in/deploy/backup.sh >> /var/log/frins-backup.log 2>&1
#
# Uses the SQLite backup API, not cp, so a running WAL database is copied
# consistently.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/frins.in}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/frins}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F_%H%M)"
TARGET="$BACKUP_DIR/frins_${STAMP}.db"

sqlite3 "$APP_DIR/data/frins.db" ".backup '$TARGET'"

# Quick integrity check on the copy
sqlite3 "$TARGET" "PRAGMA quick_check;" | grep -qx ok && echo "$(date -Is) backup ok: $TARGET" \
  || { echo "$(date -Is) BACKUP INTEGRITY FAILED: $TARGET"; exit 1; }

find "$BACKUP_DIR" -name 'frins_*.db' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) retention applied, keeping ${KEEP_DAYS} days"
