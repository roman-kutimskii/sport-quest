#!/usr/bin/env bash
# Sync the repo to the VPS and rebuild. Usage: ./deploy.sh [user@host]
set -euo pipefail
HOST="${1:-root@82.146.60.122}"
DIR=/opt/sport-quest
rsync -az --delete --exclude-from=.dockerignore --exclude=.env.prod ./ "$HOST:$DIR/"
ssh "$HOST" "cd $DIR && docker compose -f compose.prod.yml --env-file .env.prod up -d --build --remove-orphans \
  && docker compose -f compose.prod.yml --env-file .env.prod run --rm --build tools npx prisma migrate deploy \
  && docker image prune -f >/dev/null && docker compose -f compose.prod.yml --env-file .env.prod ps"
