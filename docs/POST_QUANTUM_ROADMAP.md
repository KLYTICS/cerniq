# AEGIS — Post-quantum cryptographic migration roadmap

> AEGIS's identity layer is built on Ed25519. Ed25519 is **classically
> secure** but vulnerable to a sufficiently large quantum computer
> (Shor's algorithm breaks it in polynomial time on a Cryptographically
> Relevant Quantum Computer / CRQC). Estimates of CRQC arrival range from
> 2030 to 2040+, with NSA's CNSA 2.0 timeline targeting **2035** for
> hybrid PQC adoption in NSS systems. We plan accordingly.

---

## 1. The threat model

- **"Harvest now, decrypt later"** — adversary records AEGIS-signed
  tokens / audit chains today, intends to forge or impersonate when CRQC
  is available. Mitigation: AEGIS tokens are short-lived (60s TTL) so
  *replay* is bounded; *forgery* of past tokens is meaningless once
  expired. Audit chains are different — those need to remain
  cryptographically verifiable for **7 years** (per OPERATOR_DECISIONS
  OD-004).
- **CRQC arrival before our migration** — Ed25519 audit signatures
  written today become forgeable. A bad actor with CRQC could rewrite
  history.

## 2. Selected PQC algorithms

NIST finalized the following post-quantum signature standards (FIPS 204
& 205, August 2024):

| Algorithm | NIST name | Use case in AEGIS |
|---|---|---|
| **ML-DSA-65** (CRYSTALS-Dilithium 3) | FIPS 204 | Audit chain signatures (replaces Ed25519 in `AuditChainUtil`) |
| **ML-DSA-44** (Dilithium 2) | FIPS 204 | Policy token issuance (replaces Ed25519 JWT) |
| **SLH-DSA-128s** (SPHINCS+ small) | FIPS 205 | Long-term archival signature (audit-chain-of-chains for >7y retention) |

We **do not** plan to use ML-KEM (FIPS 203) — that's a KEM, not a
signature, and AEGIS doesn't do key-exchange in the hot path.

## 3. Migration phases

### Phase α — Hybrid signatures (2027 H2)

- Bump JWT alg to a hybrid value: `Ed25519+ML-DSA-65` per [draft-ietf-cose-hybrid-pq-jwt](https://datatracker.ietf.org/doc/draft-ietf-cose-hybrid-pq-jwt/).
- Verify path accepts: classical-only, hybrid, or PQC-only signatures.
- Audit-chain entries written from Phase α onward use hybrid; pre-α entries remain Ed25519-only and are migrated to a **hybrid attestation** (an ML-DSA-65 re-signature added by a one-shot batch job; original Ed25519 signature retained for chain integrity).

**Trigger**: NIST/IETF finalize hybrid JWT alg names AND a stable
JavaScript implementation of ML-DSA-65 ships (likely `@noble/post-quantum`
v2.x).

### Phase β — PQC-default (2029)

- New tokens / audit entries: ML-DSA-65 / ML-DSA-44 only.
- Existing classical-only audit entries: re-attested via SLH-DSA-128s
  batch job, results stored in `AuditAttestation` table.
- SDK ships with a `pqcOnly: true` config flag.
- Relying parties choose: classical-fallback or strict-PQC.

**Trigger**: CNSA 2.0 mandates PQC for NSS systems (target 2035, but
big-tech adoption likely 2027-2029).

### Phase γ — Classical sunset (2032+)

- Verify path stops accepting classical-only Ed25519.
- Old audit entries: only the SLH-DSA-128s attestation is verifier-of-record.
- AEGIS classical signing keys are revoked and JWKS publishes a final
  rotation.

**Trigger**: Either operator-initiated (compliance pressure) or NIST
publishes a formal sunset for Ed25519 in regulated contexts.

## 4. Implementation strategy

### Library choices

| Phase | Algorithm | Library | Status (2026 Q2) |
|---|---|---|---|
| α | ML-DSA-65 | `@noble/post-quantum` (Paul Miller) | available, audited |
| α | hybrid JWS | needs custom impl on top of `jose` v6 | TBD — track [draft-ietf-cose-hybrid-pq-jwt](https://datatracker.ietf.org/doc/draft-ietf-cose-hybrid-pq-jwt/) |
| β | SLH-DSA-128s | `@noble/post-quantum` | available |

### Token shape (Phase α)

```jsonc
{
  "alg": "EdDSA+ML-DSA-65",       // hybrid
  "typ": "JWT",
  "kid": "ed25519-2027-q3+pqc-2027-q3"
}
```

The `kid` references both keys; the public side is published under
`/.well-known/jwks.json` as TWO entries (one classical, one PQC). The
signature segment becomes a length-prefixed concatenation.

### `algoVersion` claim (already planned for Phase 1)

We will add `algoVersion: "v1"` to every AEGIS-issued token starting in
Phase 1 so Phase α can be cleanly distinguished without breaking
backward-compat parsers. Verifiers reject unknown `algoVersion` values.

## 5. Audit-chain re-attestation (the hard part)

The audit chain's prev-hash includes the *signature* of the previous
event. A purely-additive PQC migration is therefore impossible without a
mechanism to attest pre-α events.

### Solution: layered attestation

- Phase α adds an **AuditAttestation** record per chain segment (per
  agent, per quarter). Each AuditAttestation contains an
  ML-DSA-65 signature over `(merkle_root_of_chain_segment, segment_id, signed_at)`.
- Verifiers check: (a) the original Ed25519 chain is internally
  consistent, AND (b) the AuditAttestation is valid against the current
  AEGIS PQC public key.
- This means a CRQC-equipped adversary who wants to forge pre-α history
  must also forge a valid PQC AuditAttestation — a quadratic problem.

### Cost

- One ML-DSA-65 signature per agent per quarter = ~4× per year.
- Storage: ~3 KB per signature (Dilithium 3 sig size). Negligible.
- CPU: signing is ~1 ms per record, attestation is a batch job during
  off-peak hours.

## 6. Decision triggers (revisit dates)

This document is reviewed:
- Every February 1 (post-NIST winter releases)
- Every August 1 (post-Black Hat / DEFCON disclosures)
- On any of: NIST publishes Ed25519 deprecation guidance, a JS PQC
  library reaches v1.0, a major customer (cooperative, bank) requests
  PQC in their RFP

## 7. What NOT to do

- **Don't migrate everything at once.** Hybrid first; PQC-only after the
  ecosystem (verifiers, JWT libs, OS keychains) catches up.
- **Don't drop Ed25519 from the SDK.** Customer hosts may not have PQC
  libraries for years.
- **Don't try to write our own PQC.** Use `@noble/post-quantum` or wait
  for a vetted library.
- **Don't conflate transport security and signing.** TLS 1.3's PQC
  migration (kyber hybrid in TLS) is independent and ahead of ours;
  it's Cloudflare's concern, not ours.

## 8. References

- [NIST FIPS 204 — ML-DSA](https://csrc.nist.gov/pubs/fips/204/final)
- [NIST FIPS 205 — SLH-DSA](https://csrc.nist.gov/pubs/fips/205/final)
- [CNSA 2.0 — Commercial National Security Algorithm Suite](https://media.defense.gov/2022/Sep/07/2003071834/-1/-1/0/CSA_CNSA_2.0_ALGORITHMS_.PDF)
- [draft-ietf-cose-hybrid-pq-jwt](https://datatracker.ietf.org/doc/draft-ietf-cose-hybrid-pq-jwt/)
- [@noble/post-quantum](https://github.com/paulmillr/noble-post-quantum)
- AEGIS internal: `docs/SECURITY.md`, `docs/decisions/0002-non-custodial-key-policy.md`
