# CERNIQ chaos drills

Manual recipes for proving the API degrades gracefully when its
dependencies (Postgres, Redis) misbehave.

These are **not run in CI** — they require docker, toxiproxy, and the
operator to be at the keyboard observing logs and dashboards. Run them
before each major release and after any change to the Redis caching path
or the spend-counter implementation.

## Tooling

```bash
docker pull ghcr.io/shopify/toxiproxy:2.9.0
brew install toxiproxy   # CLI client (mac)
```

`docker-compose.yml` already brings up `postgres` and `redis`; for chaos
drills we put toxiproxy _in front of_ each, then aim the API at the
toxiproxy ports instead of the real ones.

## Drill 1 — Postgres latency

Goal: verify the verify hot-path returns within budget when Postgres is
slow (cache hit) and surfaces a clean 503 (not a silent zero) when it
times out (cache miss + db hang).

```bash
# 1. Start toxiproxy and route the API at it.
docker run -d --name toxiproxy \
  --network cerniq_default -p 8474:8474 \
  -p 25432:25432 ghcr.io/shopify/toxiproxy:2.9.0

toxiproxy-cli create -l 0.0.0.0:25432 -u postgres:5432 pg
DATABASE_URL=postgres://cerniq:cerniq@localhost:25432/cerniq pnpm dev

# 2. Inject 500 ms latency.
toxiproxy-cli toxic add -t latency -a latency=500 pg

# 3. Drive verify load (50 rps for 30 s).
k6 run --duration=30s tests/load/verify.js

# 4. Assert: cache-hit verifies stay under p99 200 ms; cache-miss verifies
#    return 503 with a JSON body, never 200 with valid:true and zeroed
#    spend counters.

toxiproxy-cli toxic remove pg --toxicName latency_downstream
```

## Drill 2 — Redis disconnect

Goal: verify the spend counter falls back to Postgres correctly and the
service emits a structured warning.

```bash
toxiproxy-cli create -l 0.0.0.0:26379 -u redis:6379 redis
REDIS_URL=redis://localhost:26379 pnpm dev

# Cut the connection mid-flight.
toxiproxy-cli toxic add -t timeout -a timeout=1 redis
```

Expected:

- `/health/ready` reports `redis: false` and overall `degraded`.
- Verify endpoint either:
  - Returns 503 with `error: "service_unavailable"`, **or**
  - Falls back to a slower Postgres-only path and clearly logs the
    fallback (no silent zeros, no fabricated trust scores — invariant 4
    in `CLAUDE.md`).

## Drill 3 — Partial failure (DB up, Redis cold)

Goal: confirm cold-start behavior. Restart Redis with no warm cache,
hit verify with a fresh agent + policy, watch for stampede.

```bash
docker compose restart redis
# Then drive 100 unique tokens through /v1/verify in a 1-second burst.
```

Expected:

- All 100 succeed (or fail cleanly with documented denial reasons).
- No 5xx responses.
- Cache fills idempotently — no duplicate audit rows for the same jti.

## Reporting

Each drill should produce:

- A k6 summary JSON (`k6 run --summary-export=…`).
- A copy of API stdout/stderr filtered to the warn+error lines.
- A short markdown writeup pasted into `docs/SESSION_HANDOFF.md` under
  the date the drill was run.
