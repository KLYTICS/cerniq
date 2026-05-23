# ADR-0005 — Audit chain canonicalization (RFC 8785-lite)

**Status**: accepted
**Date**: 2026-05-01

## Context

The audit log is the load-bearing compliance artifact for CERNIQ:
SOC2, FINRA, and (for CERNIQ-pipeline customers) COSSEC all require
tamper-evident records of every authorization decision.

Tamper-evidence requires that each event carry a signature **over a
deterministic byte representation** of its payload. JSON is non-
deterministic by default (key order, whitespace, number formatting),
so two correct implementations that serialize "the same" event can
produce different signatures.

RFC 8785 (JSON Canonicalization Scheme) is the standards-track answer.
It is also a non-trivial implementation surface (number serialization,
Unicode normalization, escape rules).

## Decision

We use a **deterministic stable-stringify** that:

1. Sorts object keys recursively (lexicographic, codepoint-aware).
2. Uses `JSON.stringify` for value serialization — relying on V8's
   number-to-string for the numeric portion.
3. Has no whitespace.
4. Does not handle exotic types (NaN, Infinity, BigInt) because the
   audit payload schema forbids them at the validation layer (Zod
   `.finite()` / `.int()`).

We call this **RFC 8785-lite**. It is sufficient because:

- We control both signer (CERNIQ API and worker) and verifier (the
  third-party JS verifier we'll publish, plus internal tooling).
- We've audited the input shape; no edge case fields can leak into
  the canonical form.

Chain construction (per event):

```
prev_hash  = sha256( prev_event.signature_bytes  ||  prev_event.id_utf8 )    (32B)
canonical  = stable_stringify(payload)
sign_input = prev_hash || canonical
signature  = ed25519.sign(cerniq_audit_private_key, sign_input)
```

For the genesis event: `prev_hash = sha256("CERNIQ-AUDIT-GENESIS-v1")`.

## Consequences

### Positive

- Implementation fits in ~30 LOC of pure TypeScript
  (`apps/api/src/common/crypto/audit-chain.util.ts`).
- Verifier libraries can be written in any language without pulling
  an RFC 8785 dependency.
- Signatures are reproducible — replaying the chain is deterministic.

### Negative

- We are not RFC 8785-compliant. If a third-party tool expects strict
  RFC 8785 conformance, our signatures won't match. Mitigation:
  publish our verifier alongside the public-key endpoint so external
  parties don't have to roll their own.
- Number serialization defers to V8's behavior. If we ever need to
  port the verifier to a non-JS runtime (Go, Python), we have to
  carefully replicate JS number formatting (always finite, no
  trailing `.0`, scientific notation thresholds).
- Unicode normalization is implicit (V8 normalizes to NFC). If
  payloads ever contain non-NFC strings, signatures may surprise.

### Neutral

- Migration to strict RFC 8785 is mechanical: drop in a vetted
  library and rotate the audit signing key (existing chain remains
  verifiable with the old public key under JWKS rotation, see
  ADR-0006 planned).

## Alternatives considered

### Alt A: Strict RFC 8785 via a vetted library

Best correctness story. Deferred because (a) no JS library is widely
adopted as the standard, (b) we'd take on a transitive dependency
that's hard to audit. Reconsider when SOC2 Type II audit asks.

### Alt B: CBOR / msgpack for the canonical form

Smaller signatures, deterministic by construction. Rejected because
JSON is what every customer can introspect; CBOR adds opacity.

### Alt C: Don't canonicalize — sign the raw HTTP request body

Naïve and brittle: any whitespace or header change breaks
verification. Rejected immediately.

## How to reverse this decision

Migrating canonicalization is a breaking change for chain verifiers.
Strategy: cut a new audit signing key (old chain remains verifiable
under the old key per JWKS rotation), start the new chain with a new
genesis sentinel (`"CERNIQ-AUDIT-GENESIS-v2"`), and offer customers a
verifier that handles both eras.

## References

- RFC 8785: https://datatracker.ietf.org/doc/html/rfc8785
- `apps/api/src/common/crypto/audit-chain.util.ts`
- `docs/ARCHITECTURE.md` § "The audit chain"
- `docs/SECURITY.md` § "Audit chain integrity"
