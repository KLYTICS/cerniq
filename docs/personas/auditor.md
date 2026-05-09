---
title: AEGIS for auditors
audience: SOC2 / FINRA / COSSEC auditors evaluating AEGIS as a control or as evidence source
last-reviewed: 2026-05-02
---

# AEGIS for auditors — evidence shape, retention, isolation

AEGIS produces *cryptographically attested* evidence of every
agent-initiated decision. The chain is signed, hashed, append-only,
and exportable. This page is the operator's bible for what an external
auditor will ask for and where to find it.

## What AEGIS attests

For every agent-initiated action that passed through AEGIS:

- **Who** — the agent identity (public-key-rooted, signed by the
  registering principal).
- **What** — the action `kind` + payload hash (raw payload may be
  redacted; the *hash* is in the chain regardless).
- **When** — server-stamped timestamp, AEGIS-signed.
- **Whether** — verify outcome (`valid` or `denialReason`) and
  outcome reason ordered per the canonical denial precedence.
- **Linked** — the prior event's hash + AEGIS Ed25519 signature
  forming the chain. Tampering with a single row breaks every
  signature after it.

## Retention

`OD-004` (open) — the operator-decision table holds the binding answer.
The default that ships if silent is **7 years** (SOC2 Type II floor;
matches financial-services audit norms cited in
`docs/spec/04_COMMERCIAL_STRATEGY.md` Persona C). AEGIS does not
auto-prune below the configured horizon; storage growth is in
`docs/CAPACITY_PLAN.md` § Audit retention.

## Isolation

Every query is scoped by `principalId`. A SOC2 auditor for Customer X
sees only Customer X's chain — never Customer Y's. The mechanism is
two-layered:

1. **Application-layer guard** (CLAUDE.md invariant 5) — every
   service method takes `principalId` as the first argument.
2. **Storage-layer RLS** (peer migration 2026-05-02) — Postgres Row-
   Level Security enforces the same constraint at the database, so
   a logic bug at the application layer cannot leak across tenants.

## Export shape

NDJSON, one event per line, each line an AEGIS-signed JSON document
with the chain pointer to its predecessor. The export endpoint:

```
GET /v1/audit/export?from=ISO&to=ISO
Accept: application/x-ndjson
X-AEGIS-API-Key: aegis_sk_...
```

Streams the slice; the auditor pipes it to disk and replays the chain
locally to verify. Verification is one line of code with the
`@aegis/verifier-rp` package or the `aegis audit verify` plugin
binary (peer-owned).

The exported chain is *self-contained*: the AEGIS public key (`kid`)
is referenced inline; the auditor pulls it from
`/.well-known/audit-signing-key` (M-016, in flight) and replays the
chain offline.

## GDPR Art-17 erasure

The audit chain is hash-only over redactable fields. When GDPR Art-17
erasure is invoked:

- The redactable columns (PII payloads) are nulled.
- The `redactedAt` and `redactionReason` columns are set.
- The signed event remains chain-valid because the signature was
  computed over the *hash* of the redactable payload, not the payload
  itself (per `docs/ARCHITECTURE_AUDIT.md` finding A-019, addressed
  in M-006 redesign).

The auditor sees: "this row was redacted at <timestamp> for <reason>;
the original payload hash matches the chain." That's enough to attest
that AEGIS did not silently drop or rewrite the row.

## Compliance mappings

| Framework        | Section / clause                                         | AEGIS evidence                                  |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------ |
| SOC2 Type II     | CC7.1 system monitoring                                  | `aegis tail audit --follow` + alert rules         |
| SOC2 Type II     | CC7.4 incident comm                                      | OD-007 status page + incident.{open,history}.json |
| SOC2 Type II     | CC8.1 change management                                  | ADR series (`docs/decisions/`) + signed releases  |
| FINRA 4511       | books and records retention                              | OD-004 retention horizon (7yr default)            |
| FINRA 17a-4(f)   | electronic record retention (WORM)                       | append-only chain + tamper detection              |
| GDPR Art 17      | right to erasure                                         | redactable-by-design (A-019 addressed)            |
| GDPR Art 30      | record of processing activities                          | per-`principalId` audit slice                     |

## Reference

- `docs/COMPLIANCE.md` — full mapping table.
- `docs/SECURITY.md` — denial precedence + key handling.
- `docs/THREAT_MODEL_v2.md` — STRIDE table.
- `docs/RETENTION_POLICY.md` (sid=a9198691, 2026-05-02) — the
  shipping default for OD-004 plus customer-override pattern.
- `docs/ARCHITECTURE_AUDIT.md` — 22 findings + remediation map.
