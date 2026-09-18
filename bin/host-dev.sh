#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f docker/.env ]]; then
  cp docker/example.env docker/.env
fi

# shellcheck disable=SC1091
set -a
source docker/.env
set +a

export DB_HOSTNAME="${DB_HOSTNAME:-localhost}"
export DB_PORT="${DB_PORT:-5433}"
export DB_USERNAME="${DB_USERNAME:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-postgres}"
export DB_DATABASE_NAME="${DB_DATABASE_NAME:-immich}"
export REDIS_HOSTNAME="${REDIS_HOSTNAME:-localhost}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export IMMICH_MEDIA_LOCATION="${IMMICH_MEDIA_LOCATION:-$ROOT/docker/library/photos}"
export IMMICH_SERVER_URL="${IMMICH_SERVER_URL:-http://127.0.0.1:2283}"
export IMMICH_ENV="${IMMICH_ENV:-development}"
export IMMICH_BUILD_DATA="${IMMICH_BUILD_DATA:-$ROOT/.local/build}"

mkdir -p "$IMMICH_MEDIA_LOCATION" "$IMMICH_BUILD_DATA/geodata" "$IMMICH_BUILD_DATA/plugins"
ln -sfn "$ROOT/packages/plugin-core" "$IMMICH_BUILD_DATA/plugins/immich-plugin-core"

if [[ ! -s "$IMMICH_BUILD_DATA/geodata/geodata-date.txt" || ! -s "$IMMICH_BUILD_DATA/geodata/cities500.txt" ]]; then
  image="${IMMICH_GEODATA_IMAGE:-immich-server-dev:latest}"
  echo "Copying reverse-geocoding data from $image..."
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "Missing Docker image $image (needed for geodata). Pull or build it first." >&2
    exit 1
  fi
  cid="$(docker create "$image")"
  docker cp "$cid:/build/geodata/." "$IMMICH_BUILD_DATA/geodata/"
  docker rm "$cid" >/dev/null
  chmod -R u+w "$IMMICH_BUILD_DATA/geodata"
fi

echo "Starting Postgres and Redis..."
docker compose -f docker/docker-compose.deps.yml up -d

echo "Installing host dependencies (reuses your local pnpm store)..."
mise x -- pnpm --filter immich --filter immich-web --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core install --frozen-lockfile
mise x -- pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core build

cleanup() {
  echo "Stopping server and web..."
  trap - EXIT INT TERM
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Web:  http://localhost:3000"
echo "API:  http://localhost:2283"

(cd "$ROOT/server" && mise x -- pnpm start:dev) &
(cd "$ROOT/web" && mise x -- pnpm run dev) &
wait
