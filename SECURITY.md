# Security Policy — CERNIQ

## Reporting a Vulnerability

**Do not file a public issue.**

Email `security@cerniqapp.com` (PGP key fingerprint TBD on first deploy)
with:

1. A description of the vulnerability and its impact
2. Steps to reproduce, or a proof-of-concept
3. Affected version / commit SHA
4. Your name and contact for credit (optional)

We acknowledge within **48 hours** and aim to remediate critical issues
within **7 days**. We do not currently pay bounties but happily credit
researchers in release notes (with consent).

## Scope

In-scope:

- CERNIQ API (`api.cerniqapp.com`, `sandbox.cerniqapp.com`)
- CERNIQ dashboard (`app.cerniqapp.com`)
- CERNIQ SDK packages (`@cerniq/sdk`, `cerniq-sdk` Python)
- Cloudflare verify worker (when deployed)

Out-of-scope:

- KLYTICS holdco public sites
- Sibling product domains (CERNIQ, FORGE, etc.) — report directly to
  the relevant project

## Cryptographic Trust Boundaries

- **CERNIQ never holds agent private keys.** Compromise of the CERNIQ
  database does not yield agent signing capability. Verifying a stolen
  database is not a path to forging signed agent tokens.
- **Audit records are CERNIQ-signed (RSA-4096).** The audit-record signing
  key is held by CERNIQ and rotated per a published schedule. Public key:
  `https://api.cerniqapp.com/.well-known/audit-signing-key`.
- **Token TTL is 60s.** Replay window is bounded; high-value actions
  use single-use `jti`.

## Threat Model

See `docs/SECURITY.md` for the full threat model and mitigations.
