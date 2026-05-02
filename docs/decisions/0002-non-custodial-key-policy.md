# 0002 — Non-custodial key policy

- **Status**: Accepted (architectural invariant — non-revocable)
- **Date**: 2026-05-01
- **Decision drivers**: liability isolation, brand differentiation, regulatory simplicity

## Context

AEGIS verifies cryptographic identity for AI agents. The simplest path is
for AEGIS to manage agent private keys — generate them, store them
encrypted, sign on behalf of the agent at API time. This eliminates a
class of developer mistakes (lost private key = lost agent identity) and
yields better UX.

## Decision

**AEGIS never holds agent private keys.** The SDK generates keypairs
client-side, returns them to the developer, and stores them locally. The
AEGIS database stores public keys only.

## Consequences

### Pros
- **Liability isolation**: a database breach yields nothing of cryptographic value (public keys are not secrets). Compromise of AEGIS does not let an attacker forge agent tokens.
- **Brand differentiator**: "AEGIS is the verifier, not a custodian" maps directly to the regulatory positioning ("we are Switzerland for agent identity").
- **Insurance & compliance**: SOC2 scope is dramatically narrower without key custody. No HSM requirements. No KMS requirements (for agent keys; the AEGIS audit-signing key is still HSM-backed).
- **Developer trust**: agent builders retain control. They can rotate, export, archive on their own schedule.

### Cons
- **Worse UX on first run**: developers have to do `generateKeypair()` and store the result somewhere. We mitigate via SDK helpers and clear documentation.
- **Lost private key = lost agent**: the agent must be re-registered with a new keypair. We document this prominently and provide tooling to migrate policies + history to a new agent ID.
- **No "sign on behalf of" flows**: AEGIS cannot, even with a court order, sign tokens for an agent. This is a feature, not a bug, but customers may ask for it.

## Implementation

- The SDK exports `generateKeypair()` and `signAgentToken()`. Both run client-side.
- The API has no endpoint that accepts a private key. Schema validation rejects any field that looks like a private key.
- The dashboard shows "Generate keypair locally" with explicit copy: "AEGIS will never see your private key. If you lose it, regenerate."

## Non-goals

- We do not provide a "managed keys" tier. Even Enterprise customers get the same non-custodial model. Custodial offerings are a different product (with a different liability profile) and would require a separate legal entity.

## What this rules out

- BYOKMS-style flows where AEGIS calls a customer KMS to sign on demand. Possible future product, not part of v1.
- Hosted "ephemeral" keys where AEGIS holds a key for the duration of a session. Equivalent to custody — same liability profile.
