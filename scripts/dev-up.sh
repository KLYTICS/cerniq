#!/usr/bin/env bash
# dev-up.sh — bring up local Postgres + Redis for OKORO development.
#
# Idempotent: detects already-running services and skips bring-up. Waits for
# both containers to report healthy before returning. Exits non-zero with a
# clear diagnostic on any broken state.
#
# Invoked by: `make up` (top-level Makefile).
# Standalone usage:
#   ./scripts/dev-up.sh
#
# Requires: docker (with either `docker compose` v2 or `docker-compose` v1).

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve repo root + compose command
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "dev-up: docker-compose.yml not found at $COMPOSE_FILE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "dev-up: docker not found on PATH." >&2
  echo "        install Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi

# Prefer Compose v2 (`docker compose`); fall back to legacy v1 (`docker-compose`).
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "dev-up: neither 'docker compose' (v2) nor 'docker-compose' (v1) is available." >&2
  echo "        upgrade Docker or install docker-compose." >&2
  exit 1
fi

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Idempotency check: are postgres + redis already running?
# ---------------------------------------------------------------------------

container_running() {
  local name="$1"
  # `docker inspect` returns 1 if container does not exist.
  local state
  state="$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || echo "missing")"
  [[ "$state" == "true" ]]
}

if container_running okoro-postgres && container_running okoro-redis; then
  echo "dev-up: postgres + redis already running, skipping bring-up."
else
  echo "dev-up: starting postgres + redis via ${COMPOSE[*]}..."
  "${COMPOSE[@]}" -f "$COMPOSE_FILE" up -d postgres redis
fi

# ---------------------------------------------------------------------------
# Healthcheck loop (max 30s)
# ---------------------------------------------------------------------------

wait_for() {
  local label="$1"; shift
  local timeout=30
  local elapsed=0
  while (( elapsed < timeout )); do
    if "$@" >/dev/null 2>&1; then
      echo "dev-up: $label ready (${elapsed}s)."
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "dev-up: $label did not become healthy within ${timeout}s." >&2
  echo "        diagnose with: ${COMPOSE[*]} logs $label" >&2
  return 1
}

wait_for postgres "${COMPOSE[@]}" -f "$COMPOSE_FILE" exec -T postgres pg_isready -U okoro -d okoro
wait_for redis    "${COMPOSE[@]}" -f "$COMPOSE_FILE" exec -T redis    redis-cli ping

echo "dev-up: stack healthy. Postgres on :5432, Redis on :6379."
