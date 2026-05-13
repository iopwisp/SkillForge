#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/docker-compose.yml"}
BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/backups"}
FILE_PREFIX=${FILE_PREFIX:-skillforge}
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
BACKUP_FILE="${FILE_PREFIX}-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

cd "$ROOT_DIR"

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -lc \
  "export PGPASSWORD=\"\$POSTGRES_PASSWORD\"; pg_dump -h 127.0.0.1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists --format=custom --file \"/backups/$BACKUP_FILE\""

printf 'Backup written to %s\n' "$BACKUP_DIR/$BACKUP_FILE"
