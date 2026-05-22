# OKORO — Post-deploy smoke test

> Run this 12-step golden path after any deploy (dev, staging, or prod).
> Each step lists the command, expected output, what it proves, and what
> to do on failure. Stop at the first red and triage there — later steps
> assume earlier ones passed.

Set the base URL once:

```sh
export OKORO_BASE=http://localhost:4000   # or https://api.okorolabs.io
```

For dev, bring the stack up first: see `infra/dev/README.md`.

---

## 1. `/v1/health/ready` — the API is reachable

```sh
curl -sf "$OKORO_BASE/v1/health/ready"
```

**Expect:** HTTP 200 with `{"status":"ok"}` (plus optional sub-checks for DB/Redis).
**Proves:** Process is up, DB+Redis connections are healthy, `app.module` loaded.
**On failure:** Check pod/container logs (`docker compose logs api`). DB connection? Redis down? Bad env? See `docs/RUNBOOK.md` § "Boot failures".

---

## 2. `/v1/health/live` — liveness independent of dependencies

```sh
curl -sf "$OKORO_BASE/v1/health/live"
```

**Expect:** 200, `{"status":"ok"}`.
**Proves:** Event loop is responsive, the bare process is alive even if the DB is degraded.
**On failure:** Process is wedged. Roll the deployment. Capture a heap snapshot first if the wedge is reproducible.

---

## 3. `/metrics` — Prometheus exposition

```sh
curl -sf "$OKORO_BASE/metrics" | grep -E '^okoro_(verify|http|audit|webhook)_'
```

**Expect:** Several lines, including `okoro_verify_total{decision="approved"}`, `okoro_http_requests_total`, `okoro_audit_append_total`. (5 dashboard panels point at metrics that aren't emitted yet — see `infra/dev/README.md § Dashboard drift`.)
**Proves:** Metrics middleware is registered, Prom format is valid, namespace is `okoro_*`.
**On failure:** `metrics.service.ts` not wired into `app.module`. Or the route is gated behind the global API-key guard (it shouldn't be — verify `health/metrics.controller.ts` declares `@Public`).

---

## 4. `/.well-known/audit-signing-key` — published audit key

```sh
curl -sf "$OKORO_BASE/.well-known/audit-signing-key" | jq
```

**Expect:**
```json
{
  "kid": "<16 base64url chars>",
  "publicKey": "<base64url Ed25519 public key>",
  "algorithm": "EdDSA",
  "rotatedAt": "2026-..."
}
```
ETag header equals `kid`.
**Proves:** `OKORO_SIGNING_PUBLIC_KEY` env is wired, the wellknown module booted, the kid derivation matches `sha256(publicKey)[:16]` from `scripts/generate-okoro-keys.ts`.
**On failure:** Module init throws if env unset (no silent fallback). Run `pnpm --filter @okoro/scripts run keys` and inject the value.

---

## 5. `/.well-known/jwks.json` — JWKS form of the same key

```sh
curl -sf "$OKORO_BASE/.well-known/jwks.json" | jq '.keys[0]'
```

**Expect:** `{ "kty":"OKP", "crv":"Ed25519", "kid":"...", "use":"sig", "alg":"EdDSA", "x":"..." }`. Same `kid` as step 4.
**Proves:** RFC 8037 OKP shape, JWKS-cache friendly, Cache-Control headers present.
**On failure:** Same triage as step 4 plus a wrong-shape regression — see `wellknown.service.spec.ts`.

---

## 6. Register a principal — get an API key

```sh
pnpm --filter @okoro/scripts exec okoro register --email smoke@example.com
```

**Expect:** Stdout JSON with `principalId` (cuid) and `apiKey` (`okoro_sk_…22 chars…`). Saved to `./.okororc.json`.
**Proves:** `POST /v1/principals/register` reachable, bcrypt hash + DB write OK.
**Caveat:** `/v1/principals/register` is REQUIRES_ENDPOINT — the controller is not yet wired in `apps/api/src/modules/principals/`. Until it is, fall back to `pnpm --filter @okoro/scripts seed` and copy the `apiKey` from its stdout into `./.okororc.json` manually, or export `OKORO_API_KEY=okoro_sk_…`.
**On failure:** 404 means the endpoint isn't wired (expected today). 503 means DB down — see step 1.

---

## 7. Register an agent

```sh
pnpm --filter @okoro/scripts exec okoro agent register --runtime custom --label smoke
```

**Expect:** Stdout JSON with `agentId` (cuid), `publicKey` (43-char base64url), and `privateKeyPath` (./.local/keys/<agentId>.private, mode 0600).
**Proves:** Identity controller, AgentIdentity persistence, BATE cold-start (sets `trustScore=500`, `trustBand=VERIFIED`).
**On failure:** 401 means the API key from step 6 didn't take — confirm `OKORO_API_KEY` env or `.okororc.json`. 422 means the runtime enum is rejected; check the `AgentRuntime` enum in Prisma + Zod.

---

## 8. Create a policy

```sh
pnpm --filter @okoro/scripts exec okoro policy create \
  --agent <agentId> --scope commerce --max-per-tx 100 --expires-in 30d
```

**Expect:** Stdout JSON with `policyId` and `expiresAt` ~30d in the future. `signedToken` (Ed25519-signed JWT) present.
**Proves:** Policy controller, scope serialisation, audit-key signature flow.
**On failure:** 422 typically means a bad scope category (see Zod `PolicyScope.category` enum). 401 → see step 6 caveat.

---

## 9. Verify a request

```sh
pnpm --filter @okoro/scripts exec okoro verify \
  --agent <agentId> --policy <policyId> \
  --action commerce.purchase --amount 50 --domain example.com
```

**Expect:** Human output `✓ verify approved` with `trustBand: VERIFIED (500)`, `scopes: commerce`. Or, in `--json`, `{"valid":true,...,"denialReason":null}`.
**Proves:** End-to-end verify hot path: signature verify, policy fetch, scope match, spend check, BATE read, audit append, signal ingestion.
**On failure:** Read the `denialReason`. Honored precedence:
- `INVALID_SIGNATURE` → wrong private key in `./.local/keys/`. Re-register.
- `POLICY_EXPIRED` → step 8's `expiresAt` is in the past. Re-create.
- `SCOPE_NOT_GRANTED` → action prefix doesn't match `commerce`. Use `commerce.<sub>`.
- `SPEND_LIMIT_EXCEEDED` → amount too high.
- 5xx → check `okoro_verify_total{decision="error"}` and DB/Redis health.

---

## 10. Tail audit — confirm append

```sh
pnpm --filter @okoro/scripts exec okoro audit tail --agent <agentId> | head -1
```

**Expect:** One line, an APPROVED event with `action=commerce.purchase`, `requestedAmount=50`, `relyingParty=example.com`, valid `okoroSignature`.
**Proves:** AuditEvent row written, hash chain advanced (event has non-null `okoroSignature`).
**On failure:** Step 9 returned valid but no audit row → fire-and-forget audit silently swallowed. Check `okoro_audit_append_total{result="error"}` in `/metrics` AND the API log for `audit.service` errors. CLAUDE.md invariant #4 forbids silent failure here — file an incident.

---

## 11. Trust score readback

```sh
pnpm --filter @okoro/scripts exec okoro trust score <agentId>
```

**Expect:** `trustScore: 500-510` (cold-start anchor + maybe +1 from CLEAN_TRANSACTION signal in step 9), `trustBand: VERIFIED`.
**Proves:** BATE recompute path runs, signal-ingestion debounce works.
**Caveat:** `GET /v1/agents/:id/bate` is REQUIRES_ENDPOINT — not yet exposed. The CLI falls back to `/agents/:id/status` (which carries the same fields, no recent-signals list). Documented inline.
**On failure:** Trust score drifted below 500 means BATE recompute charged a penalty signal. Check `bate_signal` table for unexpected severity-HIGH+ rows.

---

## 12. Backtest the audit row

```sh
pnpm --filter @okoro/scripts run backtest-verify -- --limit 10 --threshold 1.0
```

**Expect:** `match rate: 100.00%` and exit 0.
**Proves:** The pure verify algorithm (`apps/api/src/modules/verify/algorithm/verify.algorithm.ts`) reproduces the historical decision the API just wrote. This is the integrity check that fails LOUD if someone refactors the algorithm without realising it now disagrees with prior decisions — a SOC2-grade contract.
**On failure:**
- `ALGORITHM_NOT_PORTABLE` → algorithm file moved or has a runtime import path that breaks under `tsx`. Fix the loader path before reporting any score.
- match rate < 100% → real drift. Read the `diffGroups` output. Common causes: spend-limit math change, scope-category prefix change, denial-precedence reorder.

---

## After the 12 steps pass

The deploy is healthy on the verify hot path. Run the full integration suite
(`pnpm --filter @okoro/e2e test`) for the long tail (revocation propagation,
TOCTOU spend race, replay protection, idempotency, etc.).

For ongoing health, keep an eye on:

- `/metrics` → `okoro_verify_total{decision="error"}` (alerts at >0.1% over 5m).
- `okoro_http_requests_total{status_class="5xx"}` (alerts at >1% over 5m).
- Grafana → OKORO folder → `okoro-verify` dashboard. (5 panels are drift-affected — see `infra/dev/README.md § Dashboard drift`.)

If anything in the dashboard ever shows fabricated zero-data because a metric
is missing from the API while the panel still renders "0", file it as a
silent-failure regression — `docs/audit_2026q2/silent_failures.md` enumerates
the existing ones.
