# `okoro-quickstart` — your first verify in 30 seconds

Single script. End to end. Real cryptography. Zero magic.

## What it proves

By the time the script exits, you've watched OKORO do exactly four
things in order:

1. **Generate a keypair on your machine.** The private key never
   leaves the script. You'll see the public key sent to OKORO.
2. **Register the agent.** OKORO responds with an `agentId` and an
   initial trust score.
3. **Create a scoped policy.** $500 commerce cap, allow-listed
   domain, signed JWT response.
4. **Sign and verify a token.** A per-request token signed locally;
   OKORO verifies it cryptographically against the registered public
   key and decides allow / deny.

If you see `✓ APPROVED`, your OKORO deployment works. If you see
`✗ DENIED`, the `denialReason` tells you which gate refused.

## Run

```sh
cd tools/quickstart
pnpm install

# Against a local OKORO (recommended for first run):
OKORO_API_BASE=http://localhost:4000 \
OKORO_API_KEY=okoro_sk_xxx \
pnpm start

# Against the hosted OKORO:
OKORO_API_BASE=https://api.okoroapp.com \
OKORO_API_KEY=okoro_sk_xxx \
pnpm start
```

## Output shape

```
[1/6] Generate Ed25519 keypair (client-side; private never sent)
     publicKey  Mc4LpHN...
     privateKey YmFkLW... (truncated; never persisted)

[2/6] Register the agent with OKORO — public key only
     agentId    ag_2nXh...
     trustScore 500

[3/6] Create a scoped policy ($500 per-tx commerce cap)
     policyId   po_2nXh...

[4/6] Sign a per-request agent token (client-side)
     token      eyJhbGciOi...

[5/6] Call /v1/verify with the token + action context

[6/6] Verdict

✓ APPROVED
  agentId       ag_2nXh...
  trustBand     VERIFIED
  trustScore    500
  scopesGranted commerce
```

stdout carries the full JSON verdict (for piping); stderr carries
the human-readable progress.

## Common failures

| Symptom                             | Likely cause                                             |
| ----------------------------------- | -------------------------------------------------------- |
| `OKORO_API_KEY env is required`     | Set the env var. See `docs/RUNBOOK.md` for issuance.     |
| `register failed: 401 Unauthorized` | Wrong key or wrong base URL. Verify `okoro_sk_` prefix.  |
| `verify denied AGENT_NOT_FOUND`     | Agent registration didn't land. Check API logs.          |
| `verify denied INVALID_SIGNATURE`   | The SDK and API are on incompatible versions. Bump both. |
| Connection refused                  | Local OKORO not running. `pnpm db:up && pnpm dev`.       |

## Next steps

After the green light, pick a vertical:

- **Card / commerce** → [`examples/fintech-payments/`](../../examples/fintech-payments/)
- **Stripe ACP** → [`examples/acp-bridge/`](../../examples/acp-bridge/)
- **Banking / treasury** → [`examples/banking-rails/`](../../examples/banking-rails/)
- **MCP tool calls** → [`examples/ai-platform-tool-call/`](../../examples/ai-platform-tool-call/)
- **SaaS provisioning** → [`examples/saas-seat-provisioning/`](../../examples/saas-seat-provisioning/)

Then read [`docs/PARTNER_ONBOARDING.md`](../../docs/PARTNER_ONBOARDING.md)
for the full integration arc.
