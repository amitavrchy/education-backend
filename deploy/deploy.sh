#!/usr/bin/env bash
# Release script run on the VPS by .github/workflows/deploy.yml (as the deploy user).
#   Usage: deploy.sh <image-tag> <ghcr-user>   (GHCR token on stdin)
# Pulls the API + migration images, runs prisma migrate deploy, then restarts the stack.
set -euo pipefail

TAG=${1:?image tag required}
GHCR_USER=${2:?ghcr user required}
IMAGE=ghcr.io/amitavrchy/education-backend
ROOT=/opt/shikkhaai
cd "$ROOT"

exec 9>"$ROOT/.deploy.lock"
flock -w 600 9

compose() { docker compose --project-name shikkhaai --env-file "$ROOT/.env" --env-file "$ROOT/.deploy.env" -f "$ROOT/docker-compose.prod.yml" "$@"; }

read -r GHCR_TOKEN
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
docker pull -q "$IMAGE:$TAG"
docker pull -q "$IMAGE:migrate-$TAG"
docker logout ghcr.io >/dev/null 2>&1 || true

touch "$ROOT/.deploy.env"
cp "$ROOT/.deploy.env" "$ROOT/.deploy.env.previous"
printf 'API_IMAGE=%s\n' "$IMAGE:$TAG" > "$ROOT/.deploy.env.next"

echo "==> Starting database and cache"
API_IMAGE="$IMAGE:$TAG" compose up -d --wait --wait-timeout 120 postgres redis

echo "==> Running migrations"
docker run --rm --env-file "$ROOT/.env" --network shikkhaai_internal "$IMAGE:migrate-$TAG"

echo "==> Starting API $TAG"
mv "$ROOT/.deploy.env.next" "$ROOT/.deploy.env"
if ! compose up -d --wait --wait-timeout 180 --remove-orphans; then
  echo "!! New release failed its health check; rolling back" >&2
  compose logs --tail 80 api >&2 || true
  cp "$ROOT/.deploy.env.previous" "$ROOT/.deploy.env"
  if grep -q '^API_IMAGE=' "$ROOT/.deploy.env"; then compose up -d --wait --wait-timeout 180 || true; fi
  exit 1
fi

curl -fsS -m 10 http://127.0.0.1:${NGINX_PORT:-8080}/api/v1/health/ready >/dev/null && echo "==> Healthy"
docker image prune -af --filter "label=com.shikkhaai.image" --filter "until=168h" >/dev/null || true
compose ps
