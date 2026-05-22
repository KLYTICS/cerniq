# node-quickstart

A 60-line walkthrough of the OKORO agent lifecycle using `@okoro/sdk`:
register an agent, create a policy, sign a request token, verify it.

## Prerequisites

1. OKORO API running locally — see [`infra/dev/README.md`](../../infra/dev/README.md).
2. A management API key. The fastest path:

   ```sh
   pnpm --filter @okoro/scripts seed
   # copy the `apiKey` value from the JSON stdout
   ```

## Run

```sh
pnpm install
OKORO_API_BASE=http://localhost:4000 \
  OKORO_API_KEY=okoro_sk_... \
  pnpm tsx src/quickstart.ts
```

## Expected output

```
── 1. SDK client ──────────────────────────────────────────────
baseUrl: http://localhost:4000

── 2. Keypair (client-side only) ──────────────────────────────
publicKey:  <43-char base64url>
privateKey: <kept local — 43 chars>

── 3. Register agent ──────────────────────────────────────────
agentId:    cl…
trustBand:  VERIFIED (500)

── 4. Create policy ───────────────────────────────────────────
policyId:   cl…
expiresAt:  2026-06-01T00:00:00.000Z

── 5. Sign request token ──────────────────────────────────────
token:      eyJhbGciOiJFZERTQSIs…(truncated)

── 6. Verify ──────────────────────────────────────────────────
valid:        true
scopes:       commerce
trustBand:    VERIFIED (500)
denialReason: none
ttl:          30s
```

If `valid: false`, the script prints `denialReason` from the canonical
denial-precedence list — see `docs/SECURITY.md § Denial Precedence`.
