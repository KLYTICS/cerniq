# `wellknown` module

## What

Two unauthenticated, cacheable HTTP endpoints that publish AEGIS's
audit-event-signing public key:

- `GET /.well-known/audit-signing-key` — plain JSON helper (`kid`,
  `publicKey`, `algorithm`, `curve`, `issuer`, `rotatedAt`, `purpose`,
  `verificationGuide`).
- `GET /.well-known/jwks.json` — RFC 8037 JWKS (Ed25519 in JOSE), suitable
  for any tool that consumes `application/jwk-set+json` (e.g. `jose`,
  `node-jose`, `python-jose`).

Both responses carry `Cache-Control: public, max-age=86400,
stale-while-revalidate=604800` and a strong `ETag` whose value is the `kid`.
A matching `If-None-Match` returns `304 Not Modified` with no body.

## Why

SOC2 auditors and relying parties verify each `AuditEvent` in the AEGIS
hash chain (CLAUDE.md invariant #3) by checking the Ed25519 signature
against AEGIS's public key. They need a stable, no-auth, edge-cacheable
URL — the same shape Auth0 and Stripe expose for their public signing
keys. This module is that surface.

The verify hot path (CLAUDE.md invariant #2) lives in `modules/verify` and
must stay framework-import-free; this module is **not** on that path, so
NestJS imports here are fine.

## Wiring requirement (read before merging)

`apps/api/src/main.ts` sets a global `v1` prefix:

```ts
app.setGlobalPrefix('v1', { exclude: ['/'] });
```

For these endpoints to be reachable at the canonical IETF path
(`/.well-known/...`) rather than `/v1/.well-known/...`, the controller
declares `version: VERSION_NEUTRAL` AND `main.ts` must extend the exclude
list:

```ts
app.setGlobalPrefix('v1', { exclude: ['/', '/.well-known/(.*)'] });
```

That single edit is owned by the wiring agent — this module does not
modify `main.ts`. Without the exclusion, the routes will still mount, but
under `/v1/.well-known/...`, which violates the IETF well-known URI
convention (RFC 8615) and breaks tooling that probes the canonical path.

## Configuration

| Env var                          | Required | Notes                                                                                              |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `AEGIS_SIGNING_PUBLIC_KEY`       | yes      | base64url-encoded raw 32-byte Ed25519 public key. Boot fails fast if missing or wrong length.     |
| `AEGIS_SIGNING_KEY_ROTATED_AT`   | no       | ISO-8601 timestamp the current key was activated. If absent: process-start is captured at module init and the service is flagged DEGRADED (logged warning). |

Generate a key with: `pnpm --filter @aegis/scripts run keys`.

## kid format

`kid = sha256(rawPublicKeyBytes)` → base64url → first 16 chars.

Why these choices:

- **sha256 over the raw key** — RFC 8037 § 2 leaves `kid` to the
  implementer; hashing the raw key (not the base64url string) is
  encoding-stable and matches RFC 7638's "JWK thumbprint" spirit while
  staying simple.
- **base64url** — URL-safe, no padding, fits in HTTP header validators.
- **16-char prefix** — collision-resistant for our population (one
  active key + at most one rotating-out at a time) and short enough
  to fit comfortably in `ETag`, log lines, and dashboards.

## Curl examples

```bash
# Plain JSON helper.
curl -sSf https://api.aegislabs.io/.well-known/audit-signing-key | jq

# JWKS (note the content type).
curl -sSf -H 'Accept: application/jwk-set+json' \
  https://api.aegislabs.io/.well-known/jwks.json | jq

# Cache-aware: capture the ETag and re-fetch.
ETAG=$(curl -sSfI https://api.aegislabs.io/.well-known/audit-signing-key | awk -F': ' '/^etag/i {print $2}' | tr -d '\r')
curl -sSf -o /dev/null -w '%{http_code}\n' \
  -H "If-None-Match: $ETAG" \
  https://api.aegislabs.io/.well-known/audit-signing-key
# -> 304
```

## Verifying an audit-event signature

A relying party verifies a single `AuditEvent` like this:

```ts
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// noble/ed25519 v2 needs sha512 wired explicitly.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// 1. Fetch the AEGIS audit-signing key.
const res = await fetch('https://api.aegislabs.io/.well-known/audit-signing-key');
const { publicKey, kid } = await res.json();

// 2. base64url-decode helpers.
const b64u = (s: string) => Uint8Array.from(Buffer.from(s, 'base64url'));

// 3. Reconstruct the canonical signing input. AEGIS signs
//    `prev_sig_b64url || canonical_json(event_without_signature)`
//    — see `apps/api/src/common/crypto/audit-chain.util.ts` for the
//    canonicalisation rule (sorted keys, no whitespace).
const signingInput = `${event.prevSig ?? ''}${canonicalJson(event)}`;

// 4. Verify.
const ok = await ed.verifyAsync(b64u(event.signature), new TextEncoder().encode(signingInput), b64u(publicKey));
if (!ok) throw new Error(`AEGIS audit signature invalid for kid=${kid}`);
```

For JWKS-native tooling (e.g. `jose`):

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://api.aegislabs.io/.well-known/jwks.json'));
// Use `jwks` wherever a key resolver is accepted. AEGIS audit signatures
// today are detached Ed25519 over canonicalised JSON, NOT compact JWS;
// the JWKS view exists for tools that want a uniform key-discovery path.
```

## Tests

- `wellknown.service.spec.ts` — kid determinism, RFC 8037 JWK shape,
  fail-closed on missing/invalid env, DEGRADED flag on missing
  `AEGIS_SIGNING_KEY_ROTATED_AT`.
- `wellknown.controller.spec.ts` — happy-path payload shapes, ETag
  matching kid, `If-None-Match` 304 (exact / wildcard / weak), shared
  kid across both endpoints.
