# OKORO — Audit-signing key rotation runbook

> Cadence: **quarterly** (calendar quarters; Q1=Mar, Q2=Jun, Q3=Sep, Q4=Dec, week 1).
> Scope: the OKORO Ed25519 audit-signing key — the keypair whose public
> half is published at [`/.well-known/audit-signing-key`](../../apps/api/src/modules/wellknown/) and whose private half signs every entry on the audit chain (`apps/api/src/common/crypto/audit-chain.util.ts`).
> Driver script: [`rotate-okoro-keys.sh`](./rotate-okoro-keys.sh).
> Generator: [`../../scripts/generate-okoro-keys.ts`](../../scripts/generate-okoro-keys.ts).
> Threats this addresses: T8 + T9 in [`../../docs/THREAT_MODEL.md`](../../docs/THREAT_MODEL.md), and "key compromise" in [`../../docs/DR_RUNBOOK.md`](../../docs/DR_RUNBOOK.md).

---

## Who can execute this ceremony

`<operator decision pending>` — leave this row to the operator. Recommended
shape: at least two named principals in the operating company, with
two-person concurrence for the `--execute` step. The exact list belongs in
the company's information security policy, not this file.

## Pre-flight checklist

Tick every box before starting. **If any box is blank, stop.**

- [ ] T-7d: status-page maintenance window posted; subscribers to `/.well-known/audit-signing-key` notified that a new `kid` is coming.
- [ ] T-1d: latest backup verified green ([`../backup/verify-backup.sh`](../backup/verify-backup.sh) ran today, exit 0).
- [ ] T-1d: latest restore drill green within the last 7 days ([`../backup/restore-drill.sh --execute`](../backup/restore-drill.sh)).
- [ ] T-0: Railway access confirmed (`railway whoami` shows operator).
- [ ] T-0: pgBackRest cipher pass rotation prepared (step 8 below).
- [ ] T-0: working tree clean on `main` (`git status` empty); ceremony performed from a freshly-checked-out repo on a hardened workstation.
- [ ] T-0: incident-response runbook open in a second tab (in case rollback needed).

---

## Step 1 — Pre-rotation announcement (T - 7 days)

Post to status page: "OKORO audit-signing key will rotate on YYYY-MM-DD.
Verifiers caching by `kid` will see a new entry in
`/.well-known/audit-signing-key` and should refresh their JWKS. Old entries
remain valid for 90 days post-cutover."

Email auditors and SOC2 evidence consumers known to pin keys.

## Step 2 — Generate the new keypair (T - 1 day, on a hardened workstation)

```bash
DATE="$(date -u +%Y%m%d)"
pnpm --filter @okoro/scripts run keys -- \
  --out "./.local/keys/rotation-${DATE}" \
  --format both
```

Outputs:

- `./.local/keys/rotation-<DATE>/okoro-signing.env` (mode 0600 — contains the **next** private key).
- `./.local/keys/rotation-<DATE>/okoro-signing.jwk.json` (mode 0644 — public key + `kid`).

Record the new `kid` (from the JSON line stdout of the script) in the
ceremony log. The `kid` is also embedded in the JWK file.

> The generator never uses `Math.random` — it goes straight to
> `crypto.getRandomValues` via `@noble/ed25519` (see
> [`scripts/generate-okoro-keys.ts`](../../scripts/generate-okoro-keys.ts)).

## Step 3 — Stage the rotation (dual-publish)

The API needs to run with **both** keys alive at the same time. Currently
the wellknown service publishes ONE key
(`apps/api/src/modules/wellknown/wellknown.service.ts`); for this step to
work cleanly the wellknown service needs a small change to publish a
JWKS array of `[next, current]`.

> **TODO operator + foundation**: extend `wellknown.service.ts` to read
> `OKORO_SIGNING_PUBLIC_KEY_NEXT` (optional) and emit two JWK entries on
> `/.well-known/jwks.json` when both are present. Until that lands, the
> dual-publish window is **not** automatic; auditors who refresh during
> the ~10 min window between step 4 and key promotion may see only the
> old or only the new key. Plan to ship the wellknown patch **before**
> the first rotation.

Set the staged variables on Railway (the driver script prints these for
operator confirmation; it does not run them):

```
railway variables set OKORO_SIGNING_PUBLIC_KEY_NEXT="<new-pub-b64url>" --service api
railway variables set OKORO_SIGNING_KID_NEXT="<new-kid>"               --service api
```

Restart the API. Confirm `/.well-known/jwks.json` returns both keys.

## Step 4 — Cut over

Promote the new key to primary. Old key continues to serve historical
verification (it is now the "previous" key).

```
# new becomes current
railway variables set OKORO_SIGNING_PRIVATE_KEY="<new-priv-b64url>"     --service api
railway variables set OKORO_SIGNING_PUBLIC_KEY="<new-pub-b64url>"       --service api
railway variables set OKORO_SIGNING_KID="<new-kid>"                     --service api

# old preserved for verification
railway variables set OKORO_SIGNING_KEY_PREVIOUS_PUBLIC_KEY="<old-pub-b64url>" --service api
railway variables set OKORO_SIGNING_KEY_PREVIOUS_KID="<old-kid>"               --service api

# clean up the staging variables
railway variables delete OKORO_SIGNING_PUBLIC_KEY_NEXT --service api
railway variables delete OKORO_SIGNING_KID_NEXT       --service api

# record the rotation moment for /.well-known/jwks.json metadata
railway variables set OKORO_SIGNING_KEY_ROTATED_AT="$(date -u +%FT%TZ)" --service api
```

Restart the API. Confirm:

- New `AuditEvent` rows are signed with the new `kid` (spot-check via
  `psql -c 'SELECT "signatureKid" FROM "AuditEvent" ORDER BY "timestamp" DESC LIMIT 5;'`).
- `/.well-known/jwks.json` returns `[current=new, previous=old]`.
- Audit chain verification passes for at least 100 events on either side
  of the cutover (`pnpm --filter @okoro/api audit:verify-chain --since <T-1h>`
  once the CLI ships per `M-006-ext`).

## Step 5 — Backfill window (90 days)

Keep `OKORO_SIGNING_KEY_PREVIOUS_PUBLIC_KEY` set for **90 days**. SOC2
auditors verifying historical records resolve old `kid` values against
this published JWKS entry.

The 90-day choice matches the standard `kid` cache lifetime hint we
publish in `Cache-Control` (1 day max-age + `stale-while-revalidate`)
times a comfortable safety margin for once-a-quarter audit consumers.

## Step 6 — Cleanup (T + 90 days)

Remove the previous key from the JWKS:

```
railway variables delete OKORO_SIGNING_KEY_PREVIOUS_PUBLIC_KEY --service api
railway variables delete OKORO_SIGNING_KEY_PREVIOUS_KID        --service api
```

Restart the API. Confirm the JWKS returns only the current key. Shred
`./.local/keys/rotation-<DATE>/okoro-signing.env` from any operator
workstation that still has it (`shred -u` on linux,
`rm -P` on macOS, then empty trash). The Railway-stored secret is the
canonical source from this point on; no copy on disk.

## Step 7 — Audit-chain replay

Sample 1% of `AuditEvent` rows spanning the rotation cutover (1 hour
before through 1 hour after). Each sample must verify against the JWKS.
Acceptance: 100% pass. Any failure is treated as a P0 audit-integrity
incident — escalate to the disaster runbook ([`../../docs/DR_RUNBOOK.md`](../../docs/DR_RUNBOOK.md)
§ "Audit chain corruption").

## Step 8 — Rotate the pgBackRest cipher pass

Every key ceremony also rotates the backup-repo encryption passphrase
(see [`../backup/pgbackrest.conf`](../backup/pgbackrest.conf) →
`repo1-cipher-pass`). The mechanic:

1. Mint a new passphrase from a CSPRNG (`openssl rand -base64 48`).
2. Trigger one full backup with the new pass set as the new pgBackRest
   `repo1-cipher-pass` (existing backups continue to use the old one;
   pgBackRest tracks the cipher pass per-backup).
3. Once retention has aged out backups encrypted with the old pass,
   purge the old pass from the secret manager.

This step is timed with the 90-day backfill window so cipher-pass
retirement and key retirement happen together.

## Rollback

If anything in steps 4–7 reports an unexpected failure, **stop the
ceremony** and roll back:

```
# revert primary back to the old key
railway variables set OKORO_SIGNING_PRIVATE_KEY="<old-priv-b64url>" --service api
railway variables set OKORO_SIGNING_PUBLIC_KEY="<old-pub-b64url>"   --service api
railway variables set OKORO_SIGNING_KID="<old-kid>"                 --service api

# the new key, briefly active, becomes the previous (so historical
# events signed by it during the window remain verifiable)
railway variables set OKORO_SIGNING_KEY_PREVIOUS_PUBLIC_KEY="<new-pub-b64url>" --service api
railway variables set OKORO_SIGNING_KEY_PREVIOUS_KID="<new-kid>"               --service api
```

Then file an incident postmortem and an ADR in `docs/decisions/` if
anything architectural changed during recovery.

---

## Outputs / log

The driver script writes a structured log file at
`./.local/keys/kms-rotation-<DATE>.log` with a JSON line per ceremony
step. Retain this log for **3 years** alongside SOC2 evidence (control
CC8.1 — change management).

## Open TODOs flagged by this runbook

1. `wellknown.service.ts` does not yet emit a multi-key JWKS array.
   Spec: when `OKORO_SIGNING_PUBLIC_KEY_NEXT` (or
   `OKORO_SIGNING_KEY_PREVIOUS_PUBLIC_KEY`) is set, the JWKS response
   includes `keys: [current, next?, previous?]` — order does not matter
   to clients (they resolve by `kid`), but `current` should be index 0
   for legibility.
2. `audit:verify-chain` CLI is not yet wired (tracked as M-006-ext in
   [`../../docs/SESSION_HANDOFF.md`](../../docs/SESSION_HANDOFF.md)).
   Step 7 falls back to a placeholder count until that ships.
3. Two-person concurrence on `--execute` is not yet enforced by
   `rotate-okoro-keys.sh` — currently a single operator confirmation.
   Operator decision: keep the human-control as policy, or extend the
   script to require a second sign-off file.
