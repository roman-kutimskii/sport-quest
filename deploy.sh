#!/usr/bin/env bash
# Deploy the prebuilt images to the VPS. Usage: [IMAGE_TAG=<tag>] ./deploy.sh [user@host]
# Images are built and pushed to GHCR by .github/workflows/deploy.yml; this only
# syncs the compose/Caddy config, pulls, and restarts.
set -euo pipefail
HOST="${1:-root@82.146.60.122}"
TAG="${IMAGE_TAG:-latest}"
DIR=/opt/sport-quest
SSH="${RSYNC_RSH:-ssh}"

rsync -az -e "$SSH" --include=compose.prod.yml --include=Caddyfile --include=deploy.sh \
  --exclude='*' ./ "$HOST:$DIR/"

$SSH "$HOST" "cd $DIR && export IMAGE_TAG=$TAG \
  && docker compose -f compose.prod.yml --profile tools --env-file .env.prod pull --quiet \
  && docker compose -f compose.prod.yml --env-file .env.prod up -d --remove-orphans \
  && docker compose -f compose.prod.yml --env-file .env.prod run --rm tools npx prisma migrate deploy \
  && docker image prune -f >/dev/null \
  && docker builder prune -f --filter until=168h >/dev/null \
  && docker compose -f compose.prod.yml --env-file .env.prod ps"
