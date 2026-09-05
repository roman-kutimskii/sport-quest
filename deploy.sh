#!/usr/bin/env bash
# Deploy the prebuilt images to the VPS. Usage: [IMAGE_TAG=<tag>] ./deploy.sh [user@host]
# The target host comes from the argument or $DEPLOY_HOST (CI passes it from a repo secret).
# Images are built and pushed to GHCR by .github/workflows/deploy.yml; this only
# syncs the compose/Caddy config, pulls, and restarts.
set -euo pipefail
HOST="${1:-${DEPLOY_HOST:-}}"
if [ -z "$HOST" ]; then
  echo "no target host: pass one (./deploy.sh user@host) or set DEPLOY_HOST" >&2
  exit 1
fi
TAG="${IMAGE_TAG:-latest}"
DIR=/opt/sport-quest
SSH="${RSYNC_RSH:-ssh}"

rsync -az -e "$SSH" --include=compose.prod.yml --include=Caddyfile --include=deploy.sh \
  --exclude='*' ./ "$HOST:$DIR/"

# IMAGE_TAG is also written into .env.prod so a manual `docker compose up -d` on the server
# keeps using the deployed images instead of whatever `latest` was pulled last.
$SSH "$HOST" "cd $DIR && export IMAGE_TAG=$TAG \
  && sed -i '/^IMAGE_TAG=/d' .env.prod && echo IMAGE_TAG=$TAG >> .env.prod \
  && docker compose -f compose.prod.yml --profile tools --env-file .env.prod pull --quiet \
  && docker compose -f compose.prod.yml --env-file .env.prod up -d --remove-orphans \
  && docker compose -f compose.prod.yml --env-file .env.prod run --rm tools npx prisma migrate deploy \
  && docker image prune -f >/dev/null \
  && docker builder prune -f --filter until=168h >/dev/null \
  && docker compose -f compose.prod.yml --env-file .env.prod ps"
