# `did:cerniq` — DID Method Specification (draft v0.1)

> A W3C-conformant Decentralized Identifier method for CERNIQ-registered
> AI agents. Lets standards-compliant verifiers (W3C VC verifiers,
> GS1's traceability stack, Microsoft Entra Verified ID, etc.) consume
> CERNIQ identities natively, without bespoke client code.

**Spec status**: DRAFT — not yet submitted to the W3C DID Method
Registry. Targeted submission: Q3 2026 after one external pilot.
**Editor**: CERNIQ Labs / KLYTICS.
**Version**: 0.1 (2026-05-01).

---

## 1. Why a DID method at all

Two reasons:

1. **Standards distribution wedge.** Verifiers built around W3C DIDs
   (a growing set in 2026: government wallets, supply-chain
   traceability, healthcare credential systems) can consume `did:cerniq`
   identities by adding a single resolver entry, without learning the
   CERNIQ API.
2. **DID compatibility hedge.** If the W3C DID stack wins the standards
   war over OAuth-for-agents (uncertain), we're already there. If
   OAuth/DPoP wins, we still have our REST API. Doctrine: CERNIQ is
   neutral and protocol-agnostic.

**Non-goals**: replacing the CERNIQ REST API; obsoleting the CERNIQ SDK;
selling DIDs as an end product.

## 2. Method name

```
did:cerniq:<network>:<agent-id>
```

- `<network>` — `mainnet` (production), `sandbox` (sandbox env), or a
  region prefix in Phase 2.5 (`eu-mainnet`).
- `<agent-id>` — the CERNIQ agent identifier, e.g.
  `agt_01HZ9YZXM4QT3B7P8WKJD6R5V`.

### Example

```
did:cerniq:mainnet:agt_01HZ9YZXM4QT3B7P8WKJD6R5V
```

## 3. CRUD operations

### CREATE (registration)

Creating an CERNIQ agent via `POST /v1/agents/register` implicitly creates
the DID. There is no separate DID registration step.

### READ (resolve)

Resolution endpoint:

```
GET https://api.cerniq.io/.well-known/did/{did-encoded}
```

Or via the [universal resolver](https://dev.uniresolver.io/) once we
register the method (target Q3 2026):

```
https://dev.uniresolver.io/1.0/identifiers/did:cerniq:mainnet:agt_xyz
```

Returns a DID Document conforming to W3C DID Core v1.1:

```jsonc
{
  "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2020/v1"],
  "id": "did:cerniq:mainnet:agt_01HZ9YZXM4QT3B7P8WKJD6R5V",
  "controller": "did:cerniq:mainnet:principal:p_abc123",
  "verificationMethod": [
    {
      "id": "did:cerniq:mainnet:agt_01HZ9YZXM4QT3B7P8WKJD6R5V#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:cerniq:mainnet:agt_01HZ9YZXM4QT3B7P8WKJD6R5V",
      "publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSrYE6BnUQUpCPVZjy2",
    },
  ],
  "authentication": ["did:cerniq:mainnet:agt_01HZ9YZXM4QT3B7P8WKJD6R5V#key-1"],
  "assertionMethod": ["did:cerniq:mainnet:agt_01HZ9YZXM4QT3B7P8WKJD6R5V#key-1"],
  "service": [
    {
      "id": "did:cerniq:mainnet:agt_xyz#cerniq-status",
      "type": "CerniqAgentStatus",
      "serviceEndpoint": "https://api.cerniq.io/v1/agents/agt_xyz/status",
    },
    {
      "id": "did:cerniq:mainnet:agt_xyz#cerniq-verify",
      "type": "CerniqVerify",
      "serviceEndpoint": "https://api.cerniq.io/v1/verify",
    },
  ],
}
```

The DID Document is **not signed** by CERNIQ — the integrity comes from
TLS to a verifiable CERNIQ endpoint. Verifiers MAY additionally use the
status service endpoint to fetch the current trust band.

### UPDATE

DID Documents are derived from CERNIQ database state. Updates happen
implicitly when the underlying agent is updated:

- Status changes (`active` → `revoked`) reflect within ≤60s in the DID
  Document and immediately on the status service endpoint.
- Trust score changes are NOT reflected in the DID Document itself
  (avoid resolution churn) — fetch via the `CerniqAgentStatus` service.

### DEACTIVATE

Calling `DELETE /v1/agents/:id` (revoke) sets the DID Document to a
deactivated form:

```jsonc
{
  "id": "did:cerniq:mainnet:agt_xyz",
  "deactivated": true,
  "controller": "did:cerniq:mainnet:principal:p_abc123",
}
```

## 4. Authentication & assertion

A relying party verifying a presentation that includes a `did:cerniq`
identity SHOULD:

1. Resolve the DID Document.
2. Confirm the public key matches the one used to sign the presentation
   (Ed25519 raw verification — same operation as `cerniq.verify()` does
   internally).
3. Optionally call the `CerniqVerify` service endpoint to confirm
   trust-score, scope, spend limits, and revocation state — this is the
   CERNIQ value-add over a bare DID resolution.

A bare DID resolution gives identity but **not** behavioral attestation;
that's why the BATE service endpoint exists.

## 5. Security considerations

### Privacy

- DIDs leak the CERNIQ network (`mainnet` vs `sandbox`).
- The `controller` field reveals the principal-level DID.
- Verifiers should be aware that calling `CerniqVerify` with a DID is
  observable to CERNIQ — operators wanting unobservable verification
  should fall back to local key verification.

### DID rotation

- v0.1 does NOT support DID rotation (the agent ID is stable for the
  agent's life).
- Customers who need to rotate keypairs **register a new agent** and
  migrate their integration. The old DID is deactivated.
- Future v0.2 may support `verificationMethod` rotation while keeping
  the DID stable; designing this requires understanding how relying
  parties cache the DID Document.

### Replay protection

- DIDs do not carry replay protection — that's the JWT layer's job.
  Don't conflate DID resolution with token verification.

## 6. Conformance

This document targets W3C DID Core v1.1 (May 2025 Recommendation). When
the spec is submitted to the registry, conformance will be tested via
the [DID Test Suite](https://w3c.github.io/did-test-suite/).

## 7. Open questions (revisit before Q3 2026 submission)

1. **Should `did:cerniq` be cryptographic-self-asserting (like `did:key`)
   or web-anchored (like `did:web`)?** Currently web-anchored — implies
   CERNIQ uptime is part of the trust model. Counter-argument: making it
   self-asserting decouples CERNIQ uptime from DID validity, which
   matches our "neutral verifier" doctrine.

2. **Multi-key support.** A future agent might want classical Ed25519
   AND post-quantum ML-DSA-65 (per `POST_QUANTUM_ROADMAP.md` Phase α).
   The DID Document already supports multi-key arrays — wire this up
   when the migration starts.

3. **`did:cerniq:eu-mainnet`** vs `did:cerniq:mainnet` with a
   `service.region` field. Cleaner to put it in the network identifier
   (resolvable without parsing the document) but it complicates URI
   parsing.

## 8. References

- [W3C DID Core v1.1](https://www.w3.org/TR/did-1.1/)
- [W3C DID Method Registry](https://www.w3.org/TR/did-spec-registries/#did-methods)
- [Microsoft Entra Verified ID](https://learn.microsoft.com/en-us/entra/verified-id/)
- CERNIQ internal: `docs/spec/05_STANDARDS_ROADMAP.md`, `docs/SECURITY.md`
