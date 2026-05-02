# `@aegis/scripts`

Operator-facing helpers. Run via pnpm so workspace deps resolve.

> **Workspace note:** `scripts/*` is not currently matched by
> `pnpm-workspace.yaml`. Add `scripts/*` to the `packages:` array there for
> `pnpm install` to pick this up. (Out of scope for this swarm — the operator
> owns `pnpm-workspace.yaml`.)

> **Gitignore note:** the repo root `.gitignore` does not currently exclude
> `.local/`. The scripts here (and `aegis-cli`) write private keys and the
> `.aegisrc.json` operator state to `./.local/keys/` and `./.aegisrc.json` —
> add `.local/` and `.aegisrc.json` to `.gitignore` before committing.

| Script                        | Run as                                       | Purpose                                                                    |
| ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `generate-aegis-keys.ts`      | `pnpm --filter @aegis/scripts keys`          | Mint the AEGIS internal Ed25519 audit-signing keypair (env + JWK forms).   |
| `seed-dev.ts`                 | `pnpm --filter @aegis/scripts seed`          | Idempotently seed a Principal, ApiKey, AgentIdentity, and ACTIVE policy.   |
| `verify-spec.ts`              | `pnpm --filter @aegis/scripts verify-spec`   | OpenAPI ↔ Zod ↔ Prisma parity check. CI gate on contract drift.            |
| `aegis-cli.ts`                | `pnpm --filter @aegis/scripts run aegis -- <subcmd>` | Operator CLI: register / agent / policy / verify / audit / trust / health. |
| `backtest-verify.ts`          | `pnpm --filter @aegis/scripts run backtest-verify`   | Replay AuditEvent rows through the current verify algorithm; drift gate.   |
| `health-check.mjs` (existing) | `node scripts/health-check.mjs`              | Post-deploy liveness probe. Owned outside this swarm.                      |

All TypeScript runs under `tsx` (no compile step). Tests run under `vitest`.

---

## `generate-aegis-keys.ts`

Mints a fresh Ed25519 keypair and writes:

- **`./.local/keys/aegis-signing.env`** (mode `0600`) — `AEGIS_SIGNING_PRIVATE_KEY`, `AEGIS_SIGNING_PUBLIC_KEY`, `AEGIS_SIGNING_KID` (base64url encoded).
- **`./.local/keys/aegis-signing.jwk.json`** — the public JWK consumed by the `/.well-known/audit-signing-key` endpoint. Shape: `{ kty: "OKP", crv: "Ed25519", kid, use: "sig", alg: "EdDSA", x }`.

The `kid` is the first 16 chars of the base64url-encoded SHA-256 of the public key. It is stable for a given public key — caches keyed by `kid` survive re-runs that produce the same key.

Flags:

| Flag              | Default          | Effect                                                  |
| ----------------- | ---------------- | ------------------------------------------------------- |
| `--out <dir>`     | `./.local/keys`  | Output directory.                                       |
| `--format <kind>` | `both`           | `env`, `jwk`, or `both`.                                |
| `--force`         | `false`          | Overwrite existing files. Otherwise refuses to clobber. |

stdout on success: a single JSON line with `kid`, `publicKey`, and the file paths written. Private key material never leaves the file.

**Production:** do not use this output directly. Generate keys inside your KMS (Railway secrets, AWS KMS, GCP KMS) and inject `AEGIS_SIGNING_*` at deploy time.

Exit codes: `0` on success, `1` on any error (refuse-to-overwrite, write failure, etc.).

---

## `seed-dev.ts`

Creates the minimum row set needed to hit the API end-to-end:

1. `Principal` — `email = dev@aegis.local`.
2. `ApiKey` — full-scope, plaintext shape `aegis_sk_<22ch>`. **Only minted on first run.** The plaintext can never be recovered after that — bcrypt-hashed at rest. Use `--reset` to rotate.
3. `AgentIdentity` — fresh Ed25519 keypair; public key stored in DB; private key written to `./.local/keys/dev-agent.private` (mode `0600`).
4. `AgentPolicy` — `ACTIVE`, label `dev-policy`, scope `commerce` with `maxPerTransaction = 100 USD`, expiry 30 days from creation.

Idempotency keys:

| Row              | Key                                          |
| ---------------- | -------------------------------------------- |
| `Principal`      | unique `email`                               |
| `ApiKey`         | `(principalId, label="dev-key", revokedAt=null)` |
| `AgentIdentity`  | `(principalId, label="dev-agent")`           |
| `AgentPolicy`    | `(agentId, label="dev-policy", status=ACTIVE, expiresAt > now)` |

Re-running emits the same `principalId` / `agentId` / `policyId` and prints `already seeded`. The `apiKey` field appears in stdout JSON **only on first run.**

Required env: `DATABASE_URL` (Prisma).

Flags:

| Flag      | Effect                                                                |
| --------- | --------------------------------------------------------------------- |
| `--reset` | Delete the seeded principal (cascade) and recreate. Refuses when `NODE_ENV=production`. |
| `--fast`  | Use bcrypt cost `4` instead of `12`. Test environments only.          |

Exit codes: `0` on success or already-seeded, `1` on any failure.

---

## `verify-spec.ts`

CI gate on contract drift across the three places we declare the API contract:

- `docs/spec/AEGIS_API_SPEC.yaml` (publicly committed)
- `packages/types/src/schemas.ts` (runtime Zod source of truth)
- `apps/api/prisma/schema.prisma` (persistence enums)

For every `$ref`'d request and response component in OpenAPI, locates a Zod schema named `<Name>Schema` and confirms its top-level keys cover the OpenAPI properties. For every Prisma `enum`, confirms the corresponding Zod enum has identical members (case-insensitive).

Output: a fixed-width table per row + per Prisma enum, with status `ok | drift | missing` and a `delta` string indicating which properties are missing or extra.

Flags:

| Flag       | Effect                                                  |
| ---------- | ------------------------------------------------------- |
| `--strict` | Fail when Zod has top-level keys not in the spec.       |
| `--json`   | Emit machine-readable JSON instead of the table.        |

Exit codes: `0` on full parity, `1` on any drift or missing schema. Wire into CI as a required check.

> Requires `@aegis/types` to have been built (`pnpm --filter @aegis/types build`) so the script can import its compiled `./schemas` entry.

---

## Tests

Each non-trivial unit is paired with `*.spec.ts` and runs under vitest:

```sh
pnpm --filter @aegis/scripts test
```

Coverage:

- `generate-aegis-keys.spec.ts` — base64url roundtrip, kid stability, JWK shape, file mode `0600`, idempotency refusal, `--force` overwrite.
- `verify-spec.spec.ts` — schema-name resolver, Zod object-key extraction (with optional/nullable unwrap), spec-vs-Zod diff (loose + strict), Prisma enum parser, enum-diff case-insensitivity.
