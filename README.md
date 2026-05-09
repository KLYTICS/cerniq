# AEGIS — Agent Gateway & Identity Stack

> Neutral cryptographic identity, scoped authorization, behavioral attestation,
> and audit rails for AI agents. ACP-compatible. Platform-agnostic. Built on the
> NIST AI Agent Identity & Authorization concept paper themes.

[![CI](https://github.com/klytics/aegis/actions/workflows/ci.yml/badge.svg)](https://github.com/klytics/aegis/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Proprietary-blue.svg)](#license)
[![Node](https://img.shields.io/badge/node-20.11+-green.svg)](.nvmrc)

---

## What this is

AEGIS sits between AI agents and the services they interact with. Every
agent-initiated action passes through it for:

| Layer | Responsibility |
| --- | --- |
| **L1 — Identity** | Per-agent Ed25519 keypair tied to a verified human/org principal |
| **L2 — Policy** | Fine-grained, time-bounded, revocable scopes (spend, domain, action) |
| **L3 — BATE** | Behavioral Attestation Engine — 0-1000 trust score that compounds across sessions |
| **L4 — Audit** | Append-only, AEGIS-signed event log; SOC2/FINRA/COSSEC export |

The hot path — `POST /v1/verify` — has a budget of **<80 ms p99 globally**
once the Cloudflare Workers edge ships in Phase 3, and **<200 ms p99** in the
Phase 1 origin-only deployment.

> Read [`docs/SPEC.md`](docs/SPEC.md) for the full architecture.
> The internal master suite lives at the KLYTICS document store.

---

## Repository layout

```
aegis/
├── apps/
│   ├── api/                  NestJS 11 — core API (identity, policy, verify, audit, BATE)
│   └── dashboard/            Next.js 16 — developer dashboard (Phase 1 minimal)
├── packages/
│   ├── sdk-ts/               @aegis/sdk — TypeScript SDK (npm)
│   └── sdk-py/               aegis — Python SDK (PyPI, scaffold)
├── workers/
│   └── cf-verify/            Cloudflare Worker for the verify hot path (Phase 3)
├── docs/                     Architecture notes, threat model, runbooks
├── docker-compose.yml        Local Postgres 16 + Redis 7
└── railway.json              Production deploy descriptor
```

---

## 10-Minute Quickstart

> The Aha Moment for AEGIS is "my agent sent a request, and the relying party
> got back `{ valid: true, trustScore: 500 }`." Everything below is engineered
> so a developer hits that in under 10 minutes.

### 1. Boot the stack (~30 seconds)

```bash
git clone https://github.com/klytics/aegis.git && cd aegis
cp .env.example .env
pnpm install
pnpm db:up                  # Postgres + Redis via Docker
pnpm db:migrate             # Apply Prisma schema
pnpm dev                    # API on http://localhost:4000
```

The API serves an OpenAPI playground at <http://localhost:4000/docs>.

### 2. Register an agent

```ts
import { Aegis, generateKeypair } from '@aegis/sdk';

const { publicKey, privateKey } = await generateKeypair();
const aegis = new Aegis({ apiKey: process.env.AEGIS_API_KEY! });

const agent = await aegis.agents.register({
  publicKey,
  runtime: 'anthropic',
  model: 'claude-sonnet-4-5',
  label: 'Shopping agent for alice@example.com',
});
console.log(agent.agentId); // agt_01HZ9YZXM4QT3B7P8WKJD6R5V
```

### 3. Issue a scoped policy

```ts
const policy = await aegis.policies.create(agent.agentId, {
  label: 'Book flights under $500',
  scopes: [
    {
      category: 'commerce',
      spendLimit: { currency: 'USD', maxPerTransaction: 500, maxPerDay: 1000 },
      allowedDomains: ['delta.com', 'united.com'],
    },
  ],
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
});
```

### 4. Sign and verify

```ts
// Agent side — produce a signed token before each outbound action
const token = await aegis.sign(privateKey, policy.signedToken, {
  action: 'commerce.purchase',
  amount: 347,
  currency: 'USD',
  merchantDomain: 'delta.com',
});

// Relying party side — verify in <200 ms
const result = await aegis.verify(token, {
  action: 'commerce.purchase',
  amount: 347,
  merchantDomain: 'delta.com',
});

if (result.valid && result.trustScore >= 500) {
  // proceed
}
```

---

## Development

| Task | Command |
| --- | --- |
| Boot Postgres + Redis | `pnpm db:up` |
| Apply migrations | `pnpm db:migrate` |
| Run API in watch mode | `pnpm dev` |
| Run dashboard | `pnpm dev:dashboard` |
| Seed dev fixtures | `pnpm seed:dev` |
| Unit tests | `pnpm test` |
| E2E tests | `pnpm test:e2e` |
| Typecheck everything | `pnpm typecheck` |
| Lint everything | `pnpm lint` |
| **Everything green gate** | **`pnpm check`** |
| Spec parity | `pnpm check:openapi-zod && pnpm check:openapi-prisma` |
| Migration immutability | `pnpm check:migrations` |

`pnpm check` runs typecheck, lint, unit tests, spec-sync, and migration
immutability in one shot — the same gate CI enforces. Run it before every
push and your PR will land on the first try.

### Operator runbooks

- [`docs/OPERATOR_RUNBOOK.md`](docs/OPERATOR_RUNBOOK.md) — `git clone` to first paying customer.
- [`docs/PARALLEL_SESSIONS.md`](docs/PARALLEL_SESSIONS.md) — protocol for concurrent Claude / contractor sessions.
- [`docs/IMMUTABILITY.md`](docs/IMMUTABILITY.md) — invariants the system holds and how each is enforced.

---

## Public discovery surface

Every AEGIS deployment publishes a stable, unauthenticated discovery surface.
Relying parties auto-configure from a single fetch; security researchers,
auditors, and AI agents read the rest:

| URL | Purpose | Cache |
| --- | --- | --- |
| `/.well-known/aegis-configuration` | OIDC-style discovery JSON: every endpoint, JWKS, denial-reason enum, trust band ladder, supported runtimes, build identity | 1 day |
| `/.well-known/jwks.json` | RFC 8037 JWKS — Ed25519 key for verifying audit-chain signatures | 1 day, ETag |
| `/.well-known/audit-signing-key` | Plain-JSON helper view of the active audit signing key | 1 day, ETag |
| `/.well-known/security.txt` | RFC 9116 responsible-disclosure file (Contact + Expires + Policy) | 1 hour |
| `/.well-known/llms.txt` | AI-agent-readable site description (Markdown) — emerging convention | 1 day |
| `/docs` | Swagger UI for the OpenAPI spec | — |
| `/docs-json` | Raw OpenAPI 3 JSON | — |

A relying party integrating AEGIS only needs **one URL** to bootstrap:

```ts
const config = await fetch('https://api.aegislabs.io/.well-known/aegis-configuration').then(r => r.json());
const verifier = new AegisVerifier({ jwksUri: config.jwks_uri });
```

The discovery doc's shape is locked by `apps/api/src/modules/wellknown/dto/discovery.dto.ts`
(`spec_version`); evolution is additive. The denial-reason enum order is
locked by ADR-0004 and CI-enforced.

---

## Operational targets

| Surface | Target | Phase |
| --- | --- | --- |
| `/v1/verify` p99 | < 200 ms | 1 (origin) |
| `/v1/verify` p99 | < 80 ms global | 3 (CF Workers edge) |
| Agent revocation propagation | < 5 s to edge | 3 |
| Audit log write reliability | 100% (best-effort, fire-and-forget with DLQ) | 1 |
| BATE score recompute lag | < 60 s after signal ingestion | 2 |

---

## Security model (one-line summary per layer)

- **L1 — Identity**: AEGIS holds *only* public keys. Private keys are generated
  client-side and never transit the wire. Compromise window = `DELETE /v1/agents/:id`.
- **L2 — Policy**: Server-side enforcement is authoritative. Client-signed
  claims are advisory and re-validated on every verify call.
- **L3 — BATE**: Reports from relying parties are weighted by their verified
  status; unverified-source signals cap their score impact.
- **L4 — Audit**: Each `AuditEvent` is signed with an AEGIS-held Ed25519 key
  via the configured KMS adapter (AWS, GCP, Vault, or in-memory for dev).
  Public key published at `/.well-known/audit-signing-key` (and JWKS at
  `/.well-known/jwks.json`) for third-party verification without AEGIS
  involvement. One curve, one library — see CLAUDE.md invariant #2.

Full threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

---

## License

Proprietary — © KLYTICS / AEGIS Labs. All rights reserved.
The `@aegis/sdk` package is published under MIT (separate `LICENSE` in
`packages/sdk-ts/`). API source is closed.
