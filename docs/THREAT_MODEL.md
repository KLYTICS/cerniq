# OKORO — Threat Model

> Source: 03_OKORO_TECHNICAL_SPEC.md §5. This file tracks live mitigation
> status — keep it in sync with the master spec on every security change.

## Trust boundaries

```
agent host  ──┐
              │  HTTPS + signed JWT
              ▼
        OKORO API (Railway / CF edge)
              │
              ├── PostgreSQL (managed, encrypted at rest)
              ├── Redis (managed, in-memory)
              └── BullMQ (queue)
```

- **OKORO never holds private keys.** Only Ed25519 *public* keys are persisted. This is an architectural decision, not a policy — the registration endpoint has no field for a private key.
- **API keys are bcrypt-hashed (cost 12).** Plaintext is shown exactly once at issuance.
- **Audit records are Ed25519 signed by OKORO** (single curve, single library — see `docs/decisions/0002-ed25519-only-crypto.md`). Public key is published at `/.well-known/jwks.json`; third parties verify integrity without calling us. (Earlier drafts of this doc cited RSA-4096; that choice was retired in v2 of the threat model — see `docs/THREAT_MODEL_v2.md` § 4.2 for the rationale.)

## Threat catalog

| # | Threat | Likelihood | Impact | Mitigation | Status |
| - | - | - | - | - | - |
| T1 | Token theft + replay | High | Variable | 60 s `exp`, unique `jti`, edge cache invalidates on revoke | scaffolded |
| T2 | Agent private-key compromise | Medium | High | `DELETE /agents/:id` propagates to edge in <5 s; we only ever held the public key | ready (revoke wired) |
| T3 | BATE poisoning (fake fraud reports) | Medium | High | Reports weighted by `RelyingParty.reportWeight`; unverified sources capped | scoring honours weight; verification UX TODO |
| T4 | DDoS on `/verify` | High | High | `@nestjs/throttler` per-key (1000 rpm); CF WAF in Phase 3 | scaffolded |
| T5 | Policy tampering on the wire | Low | High | Policies looked up server-side by ID; client-presented scopes are advisory | covered (server-authoritative) |
| T6 | Prompt injection forcing the agent to sign bad requests | High | Medium | Server-side scope + spend caps reject regardless of what the agent signs | covered architecturally |
| T7 | Principal spoofing (fake org sign-up) | Medium | Medium | Email verification + optional KYC; KYC gates BATE bonuses | flag wired, KYC TODO |
| T8 | Insider read of audit logs | Low | High | Audit signed by separate Ed25519 key; audit-of-audit access logging in Phase 2 | partial |
| T9 | SDK supply-chain compromise | Low | Critical | `@noble/ed25519` (audited), Sigstore signing on publish, pinned deps | publish flow TODO |
| T10 | Cache poisoning on Redis | Low | High | Cache key is content-deterministic; cache is invalidated on every status change | covered |

## Cryptographic choices

| Use | Algorithm | Why |
| - | - | - |
| Agent signing | Ed25519 (libsodium / `@noble/ed25519`) | 64-byte sigs, ~50 µs sign, PQ-vulnerable but standard | 
| Policy capability tokens | EdDSA (OKORO service key) | Same primitive end-to-end; no asymmetric mismatch |
| Audit record signing | Ed25519 (separate keypair from agent/policy signing) | Same primitive everywhere; constant-time verify; 64-byte sigs keep audit-export size manageable; PQ migration plan in `docs/POST_QUANTUM_ROADMAP.md` |
| API keys | bcrypt cost 12 | Standard for human-secret hashing; not used in hot path |
| Webhook signing | HMAC-SHA-256 | Standard pattern; per-subscription secret rotated on demand |

## Post-quantum posture (Phase 4–5)

Ed25519 is **not** PQ-safe. Migration plan:
- `AgentIdentity.signingAlgorithm` field (default `ed25519` today)
- Dual-sign during cutover: agents sign with both Ed25519 and CRYSTALS-Dilithium
- Verify endpoint accepts either, prefers PQ-safe when present
- 18-month re-registration window for all live agents

## Compliance touchpoints

| Standard | Where OKORO satisfies | Phase |
| - | - | - |
| NIST AI Agent Identity (Feb 2026 concept paper) | Identity, scoped policy, append-only audit | 0–1 |
| SOC2 Type I | Access controls, encryption, audit, change mgmt | 1 (target month 12) |
| SOC2 Type II | Above + 6 months of operational evidence | 2 |
| FINRA | 3-year retention, principal KYC, human-in-the-loop scope flag | 2–3 |
| COSSEC (PR cooperativas) | Spanish-language reports, CERNIQ bridge | 2–3 |
| EU AI Act, Articles 13 + 17 | Audit transparency + management system attestations | 1–2 |

## Acceptance gates before any production launch

- [ ] All tests green on CI (unit + e2e)
- [ ] No `any` in verify hot path
- [ ] `AUDIT_SIGNING_KEY_B64` set in production secrets (not ephemeral)
- [ ] `JWT_ED25519_PRIVATE_KEY_B64` rotated and persisted
- [ ] Rate limit thresholds tuned per environment
- [ ] Penetration test completed (GHOST SWARM methodology)
- [ ] Bug bounty program live (`security@okorolabs.io`)
- [ ] Cyber-insurance binder issued (Embroker / Coalition)
- [ ] Incident-response runbook published
- [ ] Status page live at `status.okorolabs.io`
