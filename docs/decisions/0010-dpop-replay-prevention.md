# ADR-0010 — DPoP (RFC 9449) layered on Ed25519 JWT for replay prevention

**Status**: accepted
**Date**: 2026-05-02
**Deciders**: sid=enterprise-backbone-arch (operator: erwin)
**Supersedes**: none

## Context

CERNIQ issues short-lived (60-second default) Ed25519 JWTs as agent
tokens. The 60s TTL bounds replay risk but does not eliminate it: a
network observer who captures a token within the window can replay it
against a different relying party until expiry.

Three mitigations exist in standards-land:

1. **Token binding** (RFC 8471) — TLS-layer; deprecated, never reached
   browser parity. Not viable.
2. **mTLS client certificates** (RFC 8705) — strong, but operationally
   heavy: every agent needs a managed cert, every relying party a TLS
   intercept. Not portable to MCP stdio transport (no TLS). Not viable
   as a default.
3. **DPoP — Demonstrating Proof of Possession at the Application Layer
   (RFC 9449, published Sept 2023)** — a per-request signed proof JWT
   that proves the caller holds a private key bound to the access token.
   Transport-agnostic. Works in browsers, server-to-server, and stdio.

DPoP is the right shape for CERNIQ: every relying party can verify a
DPoP proof without a TLS handshake, the proof binds method + URL +
access-token-hash + nonce, and `@noble/ed25519` already gives us the
crypto. The cost is ~150 µs per request (Ed25519 verify) and one extra
header.

## Decision

1. **CERNIQ adopts DPoP per RFC 9449 with a single curve constraint:
   the DPoP `cnf.jkt` thumbprint MUST be Ed25519 only.** No RSA, no P-256,
   no P-384 — consistent with ADR-0002 (Ed25519-only crypto).
2. **DPoP is OPTIONAL in v1.0, REQUIRED in v1.1.** A 6-month adoption
   window. Until v1.1, presence of `DPoP:` header is enforced; absence
   is allowed but bumps the BATE risk score by `+15` (signal:
   `agent.no_dpop`). After v1.1, absence is `INVALID_SIGNATURE`.
3. **Proof claims required.** Every DPoP proof JWT must carry:
   - `htm` — HTTP method (uppercase)
   - `htu` — request URL (full, with query string, normalized per RFC
     section 4.2 — strip fragment, lowercase scheme+host)
   - `iat` — issued-at (unix seconds, must be within ±30 s of server clock)
   - `jti` — unique nonce (ULID); replay-checked against Redis 90 s window
   - `ath` — base64url(sha256(access_token)); binds proof to one token
   - Header: `typ=dpop+jwt`, `alg=EdDSA`, `jwk={kty:OKP,crv:Ed25519,x:...}`
4. **`cnf` claim binding on access tokens.** When an agent presents a
   DPoP proof at policy creation, the JWT it gets back includes
   `cnf: { jkt: <thumbprint> }`. Subsequent verify calls require a DPoP
   proof whose JWK thumbprint matches `cnf.jkt`.
5. **Replay cache reuses ReplayCacheService** (peer is currently wiring
   in `cerniq:bug-fix-pass`). Key: `dpop:jti:<jti>`. TTL: 90 s (3× max
   clock skew).
6. **MCP transport without HTTP headers.** For stdio MCP transport,
   DPoP proof rides in `params._cerniq_dpop`. The bridge populates
   `htm = "MCP"`, `htu = "mcp://<server-name>/<method>"` synthetically.
   Documented in `packages/mcp-bridge/README.md`.

## Consequences

### Positive

- A captured access token is useless without the DPoP private key. Even
  inside the 60s TTL, the attacker can't replay against another RP.
- The DPoP private key never leaves the agent; CERNIQ never sees it.
  Consistent with ADR-0002 non-custodial principle.
- Browser-based agents can use the WebCrypto Ed25519 API (Chrome 113+,
  Safari 17+) — no extra dependency.
- Standards-aligned: any DPoP-aware client (most OAuth 2.1 SDKs by 2026)
  works with CERNIQ out of the box.

### Negative

- ~150 µs extra verification per request. Acceptable: edge p99 budget
  is 50 ms, this is 0.3% of budget.
- Six-month dual-mode complexity (optional → required transition).
  Mitigation: feature flag `CERNIQ_DPOP_REQUIRED`; flip in v1.1.
- DPoP proofs are NOT replay-proof on the agent side: a malicious local
  process on the agent's host can sign new proofs. We don't claim to
  protect against compromised agents. That's the BATE layer's job.

### Neutral

- New util: `apps/api/src/common/crypto/dpop.util.ts` + spec.
- New verify-algorithm step: between current step 4 (signature verify)
  and step 5 (scope check), add step 4.5 (DPoP proof verify).
  Coordination: peer holds verify path, will land via M-019.
- SDK adds `signWithDpop()` helper — wraps existing `signAgentToken`
  - adds proof generation per request.
- BATE signal `agent.no_dpop` (+15) and `agent.dpop_replay_attempt`
  (+50) added to docs/BATE_ALGORITHM.md (M-024).

## Alternatives considered

### Alt A: mTLS only

Rejected: not portable to stdio MCP, operational overhead untenable for
hobbyist agents (which we want as the long tail).

### Alt B: HMAC request signing (AWS SigV4-style)

Considered briefly. Symmetric key — relying party would need to know the
agent's secret, breaking the non-custodial invariant. Rejected.

### Alt C: Token binding via TLS extensions

Deprecated standard, no browser support. Not viable.

### Alt D: Stay with bearer tokens, rely on TTL

What we have today. Adequate for v0/v1 alpha, NOT acceptable for SOC2
Type II audit which expects defense-in-depth on token security.

## How to reverse this decision

Unlikely. DPoP is additive — to "remove" it we just don't enforce
`CERNIQ_DPOP_REQUIRED` and accept proofs as optional indefinitely. The
crypto utility and proof types stay; only the gate at verify-step 4.5
becomes a no-op. ~10-line change in `verify.algorithm.ts`. No data
migration; no customer comms.

## References

- RFC 9449 — DPoP: https://www.rfc-editor.org/rfc/rfc9449
- ADR-0002 — Ed25519-only crypto.
- ADR-0008 — MCP transport adaptation for headerless DPoP.
- WORK_BOARD M-019 — verify algorithm DPoP step.
- WORK_BOARD M-024 — BATE signal weights for DPoP signals.
- Threat model: `docs/THREAT_MODEL_v2.md` § "Token replay across RPs".
