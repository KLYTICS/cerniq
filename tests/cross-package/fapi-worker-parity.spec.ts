// Cross-package parity — Cloudflare Worker ↔ origin (round 11)
//
// Two distinct concerns locked in one file:
//
// (1) CLOSED-ENUM SOURCE-OF-TRUTH LOCK — packages/types is the wire-
//     contract source of truth (packages/CLAUDE.md). Round 10 added
//     ALL_DENIAL_CONTEXT_KINDS to apps/api/src/modules/verify/algorithm/verify.ports.ts;
//     round 11 mirrors it to packages/types as DENIAL_CONTEXT_KINDS.
//     These two arrays MUST stay bit-for-bit identical — either side
//     drifting would mean buyer-facing SDK types disagree with the
//     algorithm enforcement. This spec catches the drift before merge.
//
// (2) WORKER ↔ ORIGIN OUTPUT PARITY — the CF Worker at workers/cf-verify
//     is a fast-path port of /v1/verify (Phase 3 gated). Its response
//     shape MUST match the origin's, including the round-10 denialContext
//     field. A divergent edge response would mean buyers hitting
//     verify.aegis.klytics.io get a different schema than buyers hitting
//     api.aegis.klytics.io — the wedge claim of "verify is portable"
//     would silently mean "edge is structurally inferior."
//
// SEV-1: failure here means either the wire-contract source of truth is
// stale OR edge/origin response shapes have diverged. Both are wedge bugs.
// Promotion / demotion of denialContext kinds requires updating both
// sides AND this spec in the same change (CLAUDE.md invariant 6).
//
// PURE: no HTTP, no DB, no real CF runtime. Imports edge-verify directly
// and exercises it under the vitest harness — same pattern as
// fapi-jar-algorithm-binding-parity.spec.ts.

import { describe, expect, it, vi } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Source-of-truth side
import {
  DENIAL_CONTEXT_KINDS as TYPES_KINDS,
  VerifyResponseSchema,
  type DenialContext,
} from '@aegis/types';

// Algorithm side (mirror that must equal types side)
import { ALL_DENIAL_CONTEXT_KINDS as PORTS_KINDS } from '../../apps/api/src/modules/verify/algorithm/verify.ports';

// Worker side — the very file rounds 7-10 left without parity coverage
import { edgeVerify } from '../../workers/cf-verify/src/edge-verify';
import type { CachedAgent, CachedPolicy, KvCache } from '../../workers/cf-verify/src/kv-cache';

// Ed25519 SHA-512 hook (Worker token.ts uses WebCrypto; Node fallback for tests)
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── Concern 1: closed-enum source-of-truth lock ──────────────────────────

describe('FAPI Worker parity — DENIAL_CONTEXT_KINDS source-of-truth lock', () => {
  it('packages/types DENIAL_CONTEXT_KINDS equals apps/api ALL_DENIAL_CONTEXT_KINDS bit-for-bit', () => {
    // Source of truth is packages/types per packages/CLAUDE.md.
    // apps/api is the mirror. Drift in either direction fails.
    expect([...PORTS_KINDS].sort()).toEqual([...TYPES_KINDS].sort());
    expect(PORTS_KINDS.length).toBe(TYPES_KINDS.length);
  });

  it('every kind in the closed set is snake_case ASCII (naming convention)', () => {
    const valid = /^[a-z][a-z0-9_]*[a-z0-9]$/;
    for (const kind of TYPES_KINDS) {
      expect(valid.test(kind), `kind "${kind}" must be snake_case ASCII`).toBe(true);
    }
  });

  it('VerifyResponseSchema accepts denialContext { kind } as a valid optional field', () => {
    // Parses a synthetic response with denialContext set. Catches schema
    // drift if denialContext gets removed or its shape changes.
    const sample = {
      valid: false,
      agentId: null,
      principalId: 'p_test',
      trustScore: 0,
      trustBand: null,
      scopesGranted: [],
      denialReason: 'INVALID_SIGNATURE',
      verifiedAt: '2026-05-16T12:00:00.000Z',
      ttl: 0,
      denialContext: { kind: 'jar_aud_mismatch' },
    };
    const parsed = VerifyResponseSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const ctx: DenialContext | null | undefined = parsed.data.denialContext;
      expect(ctx).toEqual({ kind: 'jar_aud_mismatch' });
    }
  });

  it('VerifyResponseSchema rejects denialContext with unknown kind', () => {
    const sample = {
      valid: false,
      agentId: null,
      principalId: 'p_test',
      trustScore: 0,
      trustBand: null,
      scopesGranted: [],
      denialReason: 'INVALID_SIGNATURE',
      verifiedAt: '2026-05-16T12:00:00.000Z',
      ttl: 0,
      denialContext: { kind: 'NOT_A_REAL_KIND' },
    };
    const parsed = VerifyResponseSchema.safeParse(sample);
    expect(parsed.success).toBe(false);
  });
});

// ── Concern 2: Worker ↔ origin output shape parity ──────────────────────

function b64u(b: Uint8Array): string {
  return Buffer.from(b).toString('base64url');
}

interface Keys {
  priv: Uint8Array;
  pubB64u: string;
}
async function makeKeys(): Promise<Keys> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pubB64u: b64u(pub) };
}

async function signToken(keys: Keys, claims: Record<string, unknown>): Promise<string> {
  const enc = new TextEncoder();
  const header = b64u(enc.encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));
  const payload = b64u(enc.encode(JSON.stringify(claims)));
  const sig = await ed.signAsync(enc.encode(`${header}.${payload}`), keys.priv);
  return `${header}.${payload}.${b64u(sig)}`;
}

function makeCache(
  opts: { agent?: CachedAgent | null; policy?: CachedPolicy | null; daySpend?: number } = {},
): KvCache {
  return {
    getAgent: vi.fn(async () => opts.agent ?? null),
    getPolicy: vi.fn(async () => opts.policy ?? null),
    getDaySpend: vi.fn(async () => opts.daySpend ?? 0),
  };
}

function activeAgent(keys: Keys, over: Partial<CachedAgent> = {}): CachedAgent {
  return {
    id: 'agt_worker',
    publicKey: keys.pubB64u,
    status: 'ACTIVE',
    principalId: 'p_worker',
    trustScore: 720,
    trustBand: 'VERIFIED',
    ...over,
  };
}

function activePolicy(over: Partial<CachedPolicy> = {}): CachedPolicy {
  return {
    id: 'pol_worker',
    status: 'ACTIVE',
    expiresAtMs: Date.now() + 86_400_000,
    scopes: [{ category: 'commerce' }],
    ...over,
  };
}

describe('FAPI Worker parity — every Worker denial response carries denialContext', () => {
  it('approval: edgeVerify result.response carries denialContext=null + valid=true', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, {
      sub: 'agt_worker',
      pid: 'pol_worker',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_ok',
      act: 'commerce.purchase',
    });
    const cache = makeCache({ agent: activeAgent(keys), policy: activePolicy() });
    const result = await edgeVerify({ token, action: 'commerce.purchase' }, cache);
    expect(result.outcome).toBe('decided');
    if (result.outcome === 'decided' && result.response) {
      expect(result.response.valid).toBe(true);
      expect(result.response.denialContext).toBeNull();
      // Schema-validate the approval response — should pass round-trip.
      const parsed = VerifyResponseSchema.safeParse(result.response);
      expect(parsed.success).toBe(true);
    }
  });

  it('malformed token: denialContext.kind === token_malformed', async () => {
    const cache = makeCache();
    const result = await edgeVerify({ token: 'garbage' }, cache);
    expect(result.outcome).toBe('decided');
    if (result.outcome === 'decided' && result.response) {
      expect(result.response.denialReason).toBe('INVALID_SIGNATURE');
      expect(result.response.denialContext).toEqual({ kind: 'token_malformed' });
    }
  });

  it('agent revoked: denialContext.kind === agent_revoked', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, {
      sub: 'agt_worker',
      pid: 'pol_worker',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_rev',
    });
    const cache = makeCache({
      agent: activeAgent(keys, { status: 'REVOKED' }),
      policy: activePolicy(),
    });
    const result = await edgeVerify({ token }, cache);
    expect(result.outcome).toBe('decided');
    if (result.outcome === 'decided' && result.response) {
      expect(result.response.denialReason).toBe('AGENT_REVOKED');
      expect(result.response.denialContext).toEqual({ kind: 'agent_revoked' });
    }
  });

  it('policy revoked: denialContext.kind === policy_revoked', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, {
      sub: 'agt_worker',
      pid: 'pol_worker',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_pol_rev',
    });
    const cache = makeCache({
      agent: activeAgent(keys),
      policy: activePolicy({ status: 'REVOKED' }),
    });
    const result = await edgeVerify({ token }, cache);
    if (result.outcome === 'decided' && result.response) {
      expect(result.response.denialReason).toBe('POLICY_REVOKED');
      expect(result.response.denialContext).toEqual({ kind: 'policy_revoked' });
    }
  });

  it('scope category miss: denialContext.kind === scope_category_not_granted', async () => {
    const keys = await makeKeys();
    const token = await signToken(keys, {
      sub: 'agt_worker',
      pid: 'pol_worker',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_scope',
      act: 'trading.execute',
    });
    const cache = makeCache({ agent: activeAgent(keys), policy: activePolicy() });
    const result = await edgeVerify({ token, action: 'trading.execute' }, cache);
    if (result.outcome === 'decided' && result.response) {
      expect(result.response.denialReason).toBe('SCOPE_NOT_GRANTED');
      expect(result.response.denialContext).toEqual({ kind: 'scope_category_not_granted' });
    }
  });

  it('every decided edgeVerify response validates against VerifyResponseSchema', async () => {
    // Schema-round-trip lock: edge response shape MUST match @aegis/types
    // — if Worker emits a field the schema rejects, this fails.
    const keys = await makeKeys();
    const token = await signToken(keys, {
      sub: 'agt_worker',
      pid: 'pol_worker',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_schema',
    });

    const scenarios = [
      // malformed
      { req: { token: 'garbage' }, cache: makeCache() },
      // policy expired (cache hit, expiresAtMs in the past)
      {
        req: { token },
        cache: makeCache({
          agent: activeAgent(keys),
          policy: activePolicy({ expiresAtMs: Date.now() - 1000 }),
        }),
      },
      // approval
      {
        req: { token, action: 'commerce.purchase' },
        cache: makeCache({ agent: activeAgent(keys), policy: activePolicy() }),
      },
    ];

    for (const { req, cache } of scenarios) {
      const result = await edgeVerify(req, cache);
      if (result.outcome === 'decided' && result.response) {
        const parsed = VerifyResponseSchema.safeParse(result.response);
        expect(
          parsed.success,
          `edge response should match schema; errors: ${JSON.stringify(parsed.error?.format())}`,
        ).toBe(true);
      }
    }
  });
});

// ── Concern 3: RAR-in-JAR forwards to origin (Worker doesn't enforce) ──

describe('FAPI Worker parity — JAR-strict behaviors forward to origin', () => {
  it('RAR-in-JAR token forwards to origin (Worker has no RAR evaluator)', async () => {
    // Design decision documented in edge-verify.ts: Phase 3 may add the
    // RAR evaluator at the edge; until then, any signed JAR carrying
    // authorization_details MUST forward to origin. The alternative
    // (silently approving) would diverge from origin's Step 6.5
    // enforcement.
    const keys = await makeKeys();
    const token = await signToken(keys, {
      sub: 'agt_worker',
      pid: 'pol_worker',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'j_rar',
      act: 'commerce.purchase',
      authorization_details: [{ type: 'trading_order', actions: ['buy'] }],
    });
    const cache = makeCache({ agent: activeAgent(keys), policy: activePolicy() });
    const result = await edgeVerify({ token, action: 'commerce.purchase' }, cache);
    expect(result.outcome).toBe('forward');
  });
});
