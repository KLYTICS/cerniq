# ADR-0006 — AuditEvent redactability for GDPR Article 17

**Status**: accepted
**Date**: 2026-05-02
**Audit ref**: A-019 in `docs/ARCHITECTURE_AUDIT.md`

## Context

GDPR Article 17 ("right to erasure") obliges us to remove personal data
on request, even when that data lives in records we are otherwise
required to retain (e.g. SOC2 audit logs with their 7-year horizon —
see `OPERATOR_DECISIONS.md` OD-004).

The audit chain is signed (CLAUDE.md invariant #3). If we delete a row
to satisfy erasure, the chain breaks at the next verifier walk and the
log becomes useless for SOC2. If we re-sign without the row, the chain
becomes mutable — a worse violation.

The fields in `AuditEvent` that may carry personal data:

| Field             | PII risk        | Example                      |
| ----------------- | --------------- | ---------------------------- |
| `agentId`         | low (opaque FK) | `agt_clxxx...`               |
| `principalId`     | low (opaque FK) | `pn_clxxx...`                |
| `action`          | medium          | `email.send` / `data.export` |
| `decision`        | none (enum)     | `APPROVED`                   |
| `denialReason`    | none (enum)     | `SCOPE_NOT_GRANTED`          |
| `relyingParty`    | high            | `bank-acme.com`              |
| `requestedAmount` | low–medium      | `1234.56`                    |
| `currency`        | none            | `USD`                        |
| `policyId`        | low (opaque FK) | `pol_clxxx...`               |
| `policySnapshot`  | medium–high     | could embed allowed-domains  |
| `trustScore`      | none            | `720`                        |
| `trustBand`       | none (enum)     | `VERIFIED`                   |
| `timestamp`       | none            | ISO datetime                 |

Cascaded delete handles the easy case: when a Principal exercises
account deletion, all their agents + audit rows go via the existing
`Cascade` FK and other tenants' chains are untouched. The hard case is
when an *individual data subject* (the human behind a B2B transaction —
e.g. the natural person whose name appears in `relyingParty` for a
sole-proprietor merchant) requests erasure: their data must come out
without breaking the chain that other parties rely on.

## Decision

Sign over **canonical hashes of high-PII fields**, not the raw values.
Persist raw values and hashes in separate columns. Erasure nulls the
raw column and stamps `redactedAt`; the hash column and signature stay
intact, so the chain still verifies.

### Signed payload (`AuditChainPayload v2`)

```ts
interface AuditChainPayload {
  // unchanged — opaque or non-PII
  agentId:           string;
  claimedAgentId:    string | null;
  principalId:       string;
  decision:          'APPROVED' | 'DENIED' | 'FLAGGED';
  denialReason:      string | null;       // enum, not free-text
  policyId:          string | null;
  trustScoreAtEvent: number;
  trustBandAtEvent:  'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  currency:          string | null;
  timestamp:         string;
  // hashed — base64url(sha256(value)) when value present, null otherwise
  actionHash:          string | null;
  relyingPartyHash:    string | null;
  requestedAmountHash: string | null;
  policySnapshotHash:  string | null;
  // schema version — verifiers must check this
  v:                 2;
}
```

### Database (additive migration; `agentId` now nullable per CRIT-5 fix)

```prisma
model AuditEvent {
  // ... existing columns ...
  // raw values — nullable; redactable
  action          String?
  relyingParty    String?
  requestedAmount Decimal? @db.Decimal(14, 2)
  policySnapshot  Json?
  // committed-to hashes — NEVER null after first write
  actionHash          String  @db.Text  // base64url(sha256)
  relyingPartyHash    String? @db.Text  // null only if value was null at write time
  requestedAmountHash String? @db.Text  // ...
  policySnapshotHash  String? @db.Text  // ...
  // redaction trail
  redactedAt     DateTime?
  redactionReason String?
}
```

### Hash construction

`hash(value)` =
- For strings: `base64url(sha256(utf8(value)))`
- For numbers (requestedAmount): `base64url(sha256(utf8(value.toFixed(2))))` —
  using the Decimal-to-string convention `audit-chain.util.ts` already enforces.
- For JSON (policySnapshot): `base64url(sha256(canonicalize(value)))` —
  reusing the existing canonicalize helper for stability.
- For null: the field is null in the signed payload (NOT the hash of "null").
  This preserves the distinction between "field was absent" and "field was
  present and contained the empty string."

### Verification

Third-party verifiers receive both raw + hash columns in the export
endpoint. For each row:

1. Recompute `expectedHash = hash(rawValue)` for each redactable field.
2. If the row is unredacted: `expectedHash` must equal the persisted hash.
3. If the row is redacted (`redactedAt != null` for that field): the raw
   column is null and the verifier accepts the persisted hash directly.
4. The signature is verified over the canonical (`v=2`) payload that uses
   the persisted hashes.

The chain integrity is preserved across redactions: redaction only nulls
raw columns; hashes are immutable.

### Redaction API

`AuditService.redact(eventId, principalId, fields[], reason)`:

- Tenant-scoped — requires the audit row's `principalId` to match the
  caller's principal (or be a superadmin operation). No cross-principal
  redactions.
- Operates per-field — redact only the specific PII field requested,
  leaving the rest queryable. (e.g. erasing `relyingParty` doesn't have
  to erase `action`).
- Stamps `redactedAt` and `redactionReason`. The redaction itself is
  **logged as a new audit event** (one with `decision: 'FLAGGED'` and
  `action: 'audit.redact'`) so the metadata of the redaction is itself
  in the chain.
- Idempotent — redacting an already-null field is a no-op.

## Consequences

### Pros

- GDPR Art. 17 compliance without chain breakage.
- Hash commitments are independent of redaction state — third-party
  verifiers can prove integrity without trusting OKORO.
- Migration is additive: existing v1 rows can be lazily upgraded by
  computing hashes from existing raw columns; no chain re-signing.
- Storage cost: ~140 bytes per row for the four extra hash columns.

### Cons

- Chain payload schema version bump (v1 → v2). Verifiers must branch.
- Verifier complexity: ~10 lines to handle the redaction case.
- Adversaries with a known-plaintext space (e.g. limited action enum)
  can dictionary-attack the hash to reveal the redacted value. We
  accept this for `action` (it's an enum-ish field anyway) but note
  it as a residual risk for `relyingParty` (low-cardinality domain
  list) and `requestedAmount` (numeric range). Mitigation in v3 if
  needed: salted HMAC instead of plain SHA-256, with a per-tenant key
  rotated on Art. 17 redaction event. Out of scope for v2.

### Migration

Single migration: add the hash columns + `redactedAt`/`redactionReason`,
backfill hashes from existing raw values, then make the raw columns
nullable. Operator runs once after deploying v2.

## Out of scope (future work)

- ADR-0007: Per-tenant HMAC keys for hash construction (closes the
  dictionary-attack residual).
- Cross-principal correlation engine support — `policySnapshot` hashes
  are stable, so cross-tenant correlation by exact policy still works,
  but content-derived correlation does not. This is intentional.

## References

- GDPR Article 17 — Right to erasure ("right to be forgotten")
- ADR-0005 — Audit chain canonicalization (this depends on its
  canonicalize helper for the JSON case).
- CLAUDE.md invariants #3 (append-only) and #4 (no silent failures).
- `docs/SECURITY.md` § "Audit chain integrity".
