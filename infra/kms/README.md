# AEGIS — KMS / key management (operator-facing)

> AEGIS holds **only public keys for agents** (`CLAUDE.md` invariant #1).
> The keys this directory governs are **AEGIS's own service signing keys**:
> the Ed25519 keypair used to sign audit-chain events and to back the
> JWKS published at `/.well-known/audit-signing-key`.

## What lives here

- [`README.md`](./README.md) — this file.
- [`rotation-runbook.md`](./rotation-runbook.md) — the quarterly rotation ceremony.
- [`rotate-aegis-keys.sh`](./rotate-aegis-keys.sh) — the driver script (dry-run by default).

The actual keypair generator is [`../../scripts/generate-aegis-keys.ts`](../../scripts/generate-aegis-keys.ts).
This directory does **not** re-implement key generation — the rotation
runbook drives the existing script.

## Where keys live

| Environment | Storage                                                                     | How to access                                                                          |
|-------------|-----------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| Production  | Railway secrets (encrypted at rest, scoped per service).                    | `railway variables` — only the operator and the deploy pipeline have access.            |
| Staging     | Railway secrets in the staging project.                                     | Same as prod, separate project.                                                         |
| Dev         | `./.local/keys/aegis-signing.env` — produced by `pnpm --filter @aegis/scripts run keys`. | Mode 0600. Listed in `.gitignore`. NEVER copied into a prod env.                        |

The disk path `./.local/keys/` is the **only** place a private key may
appear on a developer machine. Production keys must never land on disk
outside of Railway's encrypted store.

The public key is also published at
`GET /.well-known/audit-signing-key` (Ed25519 JWK with stable `kid`,
served with a 1-day cache) — see
[`../../apps/api/src/modules/wellknown/`](../../apps/api/src/modules/wellknown/).

## How to rotate

Quarterly. Full ceremony in [`rotation-runbook.md`](./rotation-runbook.md).
Driver: [`rotate-aegis-keys.sh`](./rotate-aegis-keys.sh) — dry-run unless
`--execute` is passed; never pushes secrets without operator confirmation.

The cipher passphrase that protects pgBackRest backups
([`../backup/pgbackrest.conf`](../backup/pgbackrest.conf) → `repo1-cipher-pass`)
should rotate on the **same cadence**. Operator does that as part of the
ceremony — the runbook calls it out as step 8.

## Cross-references

- `CLAUDE.md` — invariant #1 (private keys never enter AEGIS) and #3 (audit chain).
- `docs/SECURITY.md` § 4 — key handling rules.
- `docs/THREAT_MODEL.md` row T8 (insider read of audit logs) and T9 (SDK supply-chain).
- `docs/DR_RUNBOOK.md` — "key compromise" disaster playbook.
