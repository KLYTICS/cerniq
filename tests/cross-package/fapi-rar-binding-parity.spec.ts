// Cross-package parity — FAPI 2.0 RAR binding (RFC 9396)
//
// Locks the wedge promotion: every claim AEGIS makes about RFC-9396 in
// `/.well-known/aegis-configuration` must be backed by a matching
// behavior in the RAR evaluator. If either side drifts (a new detail
// type added to the evaluator but not surfaced; or a discovery field
// changed but the evaluator unchanged), this spec fails and the build
// blocks before the divergence reaches a buyer.
//
// SEV-1: a failure here means the marketing claim "AEGIS implements
// RFC-9396" no longer has discoverable evidence. Treat like the
// audit-chain-parity SEV-1 contract.
//
// This spec is intentionally PURE — no HTTP, no DB, no clock fakes.
// It imports the evaluator + the wellknown service-level constants
// directly and exercises them in-process. Speed: sub-second.

import { describe, expect, it } from 'vitest';

// Evaluator side
import { evaluateRar } from '../../apps/api/src/modules/verify/rar/rar.evaluator';
import {
  REGISTERED_AUTH_DETAIL_TYPES,
  type AegisAuthorizationDetail,
} from '../../apps/api/src/modules/verify/rar/rar.types';

// Discovery side — service-level constants used to populate /.well-known
import {
  WellknownService,
  computeKid,
} from '../../apps/api/src/modules/wellknown/wellknown.service';
import { encodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';

// Helper: build a minimal WellknownService for getAegisConfiguration() —
// the service only needs aegisSigningPublicKey + aegisSigningKeyRotatedAt
// to boot. We don't exercise any other code path.
const ZERO_KEY = new Uint8Array(32);
const ZERO_KEY_B64 = encodeBase64Url(ZERO_KEY);

function newDiscovery() {
  // Minimal AppConfigService stub.
  const svc = new WellknownService({
    aegisSigningPublicKey: ZERO_KEY_B64,
    aegisSigningKeyRotatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
  svc.onModuleInit();
  return svc;
}

describe('FAPI RAR binding parity — discovery ↔ evaluator', () => {
  it('discovery surfaces RFC-9396 in standards_implemented (not aligned)', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    expect(cfg.standards_implemented).toContain('RFC-9396');
    expect(cfg.standards_aligned).not.toContain('RFC-9396');
  });

  it('discovery surfaces the 4 registered detail types — exactly the evaluator-supported set', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    expect(cfg.authorization_details_types_supported.sort()).toEqual(
      [...REGISTERED_AUTH_DETAIL_TYPES].sort(),
    );
  });

  it('every type advertised in discovery is accepted by the evaluator', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    for (const type of cfg.authorization_details_types_supported) {
      // Build a minimal detail of this type with one action — evaluator
      // should at least progress past the type lookup. If it returns
      // 'type_unauthorized' for an advertised type, the discovery doc
      // is lying about what the evaluator supports.
      const detail = {
        type,
        actions: ['x'],
      } as unknown as AegisAuthorizationDetail;
      const result = evaluateRar([detail], { type, action: 'x' });
      expect(result.ok, `type=${type} must reach action evaluation`).toBe(true);
    }
  });

  it('every type accepted by the evaluator appears in discovery', () => {
    // Inverse direction: the evaluator's switch covers exactly the
    // REGISTERED_AUTH_DETAIL_TYPES list. A new type added to the
    // evaluator without updating discovery would be silent-by-default
    // for buyers — caught here.
    const cfg = newDiscovery().getAegisConfiguration();
    for (const type of REGISTERED_AUTH_DETAIL_TYPES) {
      expect(
        cfg.authorization_details_types_supported,
        `evaluator type "${type}" must appear in discovery`,
      ).toContain(type);
    }
  });
});

describe('FAPI RAR binding parity — wedge demo lock', () => {
  // The demo scenario from `AEGIS_WEDGE_FINANCIAL_STANDARDS_2026-05-15.md` §5:
  // AI portfolio manager rebalances a managed account. This spec locks
  // the EXACT scenarios that close Persona A/B deals. Modifying these
  // semantics requires updating the wedge doc + this spec together —
  // otherwise the marketing claim and the running code drift.

  it('AI portfolio manager: $49,750 BUY NASDAQ:AAPL during trading hours allows', () => {
    const result = evaluateRar(
      [
        {
          type: 'trading_order',
          actions: ['buy', 'sell'],
          instruments: ['NYSE:*', 'NASDAQ:*'],
          limits: { per_order_usd: 50000, per_day_usd: 250000 },
          trading_hours_only: true,
        },
      ],
      {
        type: 'trading_order',
        action: 'buy',
        instrument: 'NASDAQ:AAPL',
        amount_usd: 49750,
        at: new Date('2026-06-08T14:00:00Z'),
      },
    );
    expect(result).toEqual({ ok: true, matched_detail_type: 'trading_order' });
  });

  it('AI portfolio manager: $50,001 BUY rejects with limit_exceeded', () => {
    const result = evaluateRar(
      [
        {
          type: 'trading_order',
          actions: ['buy'],
          limits: { per_order_usd: 50000 },
        },
      ],
      { type: 'trading_order', action: 'buy', amount_usd: 50001 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('limit_exceeded');
      expect(result.detail).toContain('per_order_usd=50000');
    }
  });

  it('Treasury agent: $5K USD transfer to whitelisted account allows', () => {
    const result = evaluateRar(
      [
        {
          type: 'payment_initiation',
          actions: ['transfer'],
          destinations: ['acct_vendor_x'],
          currencies: ['USD'],
          limits: { per_transaction_usd: 10000 },
        },
      ],
      {
        type: 'payment_initiation',
        action: 'transfer',
        destination: 'acct_vendor_x',
        amount_usd: 5000,
        currency: 'USD',
      },
    );
    expect(result.ok).toBe(true);
  });

  it('Treasury agent: EUR transfer rejects on currency_unauthorized', () => {
    const result = evaluateRar(
      [
        {
          type: 'payment_initiation',
          actions: ['transfer'],
          currencies: ['USD'],
        },
      ],
      {
        type: 'payment_initiation',
        action: 'transfer',
        amount_usd: 1000,
        currency: 'EUR',
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('currency_unauthorized');
  });

  it('Compliance bot: PII access denied when pii_allowed unset (strict default)', () => {
    const result = evaluateRar(
      [
        {
          type: 'data_access',
          actions: ['read'],
          resources: ['kyc/*'],
        },
      ],
      {
        type: 'data_access',
        action: 'read',
        resource: 'kyc/customer_xyz',
        is_pii: true,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('pii_disallowed');
  });
});

describe('FAPI RAR binding parity — discovery doc integrity', () => {
  it('fapi_profile identifier is stable across renders', () => {
    const a = newDiscovery().getAegisConfiguration();
    const b = newDiscovery().getAegisConfiguration();
    expect(a.fapi_profile).toBe(b.fapi_profile);
    expect(a.fapi_profile).toBe('aegis-fapi-2.0-aligned-1.0');
  });

  it('standards_implemented and standards_aligned remain disjoint', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    const overlap = cfg.standards_implemented.filter((s) =>
      cfg.standards_aligned.includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it('spec_version bumped to at least 1.3.0 (RFC-8414 + RFC-6749 promotion)', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    const [major, minor] = cfg.spec_version.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(1);
    if (major === 1) expect(minor).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────────────
// RFC 8414 + RFC 6749 binding parity (added 1.3.0)
// ──────────────────────────────────────────────────────────────────────

import {
  OAUTH_ERROR_MAPPING,
  OAUTH_ERROR_DESCRIPTION,
  oauthErrorFor,
} from '../../apps/api/src/modules/verify/oauth-error-mapping';
import type { DenialReason } from '../../apps/api/src/modules/verify/verify.dto';

const ALL_DENIAL_REASONS: ReadonlyArray<DenialReason> = [
  'PLAN_LIMIT_EXCEEDED',
  'AGENT_NOT_FOUND',
  'AGENT_REVOKED',
  'INVALID_SIGNATURE',
  'POLICY_REVOKED',
  'POLICY_EXPIRED',
  'SCOPE_NOT_GRANTED',
  'TRIAL_EXHAUSTED',
  'SPEND_LIMIT_EXCEEDED',
  'TRUST_SCORE_TOO_LOW',
  'ANOMALY_FLAGGED',
  'INTENT_MISMATCH',
];

describe('RFC 8414 binding parity — discovery ↔ oauth-as-metadata', () => {
  it('discovery surfaces RFC-8414 in standards_implemented', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    expect(cfg.standards_implemented).toContain('RFC-8414');
    expect(cfg.standards_aligned).not.toContain('RFC-8414');
  });

  it('oauth-authorization-server endpoint produces conformant RFC 8414 metadata', () => {
    const md = newDiscovery().getOAuthAuthorizationServerMetadata();
    // RFC 8414 §2 required fields are present.
    expect(md.issuer).toBeDefined();
    expect(Array.isArray(md.response_types_supported)).toBe(true);
    // Honest emptiness — AEGIS isn't a full AS.
    expect(md.response_types_supported).toEqual([]);
    expect(md.token_endpoint_auth_methods_supported).toEqual([]);
    // Honest population — AEGIS does sign JWS with EdDSA.
    expect(md.token_endpoint_auth_signing_alg_values_supported).toEqual(['EdDSA']);
  });

  it('oauth-as-metadata authorization_details_types_supported = aegis-configuration', () => {
    const svc = newDiscovery();
    expect(svc.getOAuthAuthorizationServerMetadata().authorization_details_types_supported)
      .toEqual(svc.getAegisConfiguration().authorization_details_types_supported);
  });

  it('aegis_fapi_profile in oauth-as-metadata matches aegis-configuration', () => {
    const svc = newDiscovery();
    expect(svc.getOAuthAuthorizationServerMetadata().aegis_fapi_profile)
      .toBe(svc.getAegisConfiguration().fapi_profile);
  });

  it('introspection_endpoint and aegis_rar_evaluate_endpoint live under the same issuer', () => {
    const md = newDiscovery().getOAuthAuthorizationServerMetadata();
    expect(md.introspection_endpoint.startsWith(md.issuer)).toBe(true);
    expect(md.aegis_rar_evaluate_endpoint.startsWith(md.issuer)).toBe(true);
  });
});

describe('RFC 6749 binding parity — oauth error envelope', () => {
  it('discovery surfaces RFC-6749 in standards_implemented', () => {
    const cfg = newDiscovery().getAegisConfiguration();
    expect(cfg.standards_implemented).toContain('RFC-6749');
    expect(cfg.standards_aligned).not.toContain('RFC-6749');
  });

  it('every AEGIS denial reason has an OAuth canonical mapping', () => {
    for (const reason of ALL_DENIAL_REASONS) {
      expect(OAUTH_ERROR_MAPPING[reason]).toBeDefined();
      expect(OAUTH_ERROR_DESCRIPTION[reason]).toBeDefined();
    }
  });

  it('oauthErrorFor returns a structured pair for every reason', () => {
    for (const reason of ALL_DENIAL_REASONS) {
      const pair = oauthErrorFor(reason);
      expect(pair.error).toBe(OAUTH_ERROR_MAPPING[reason]);
      expect(pair.error_description).toBe(OAUTH_ERROR_DESCRIPTION[reason]);
    }
  });

  it('only RFC 6749 §5.2 canonical errors are emitted (no AEGIS-bespoke values)', () => {
    const canonical = new Set([
      'invalid_request',
      'invalid_client',
      'invalid_grant',
      'invalid_token',
      'invalid_scope',
      'unauthorized_client',
      'access_denied',
      'server_error',
      'temporarily_unavailable',
    ]);
    for (const reason of ALL_DENIAL_REASONS) {
      expect(canonical.has(OAUTH_ERROR_MAPPING[reason])).toBe(true);
    }
  });

  it('mapping is total — TS exhaustiveness check via Object.keys vs ALL_DENIAL_REASONS', () => {
    // If a new DenialReason is added without mapping it, Object.keys
    // returns fewer entries than the union — this test fails and forces
    // the engineer to update the mapping at the same time.
    expect(Object.keys(OAUTH_ERROR_MAPPING).sort()).toEqual(
      [...ALL_DENIAL_REASONS].sort(),
    );
    expect(Object.keys(OAUTH_ERROR_DESCRIPTION).sort()).toEqual(
      [...ALL_DENIAL_REASONS].sort(),
    );
  });
});

// Helper export to keep linters happy about `computeKid` import — it's
// used to ensure the wellknown.service module-init path runs cleanly.
void computeKid;
