// FAPI buyer integration journey — end-to-end walk
//
// Emulates the real conditions a fintech buyer hits when integrating
// AEGIS. Every step exercises the actual code path the buyer would hit
// in production, asserts the wire shape against the RFC, and produces
// a formatted transcript suitable for sales / docs / demo.
//
// What this catches that unit tests miss:
//   - Discovery contract drift (issuer URL inconsistent across endpoints)
//   - Cross-RFC field consistency (RAR types in aegis-configuration vs
//     oauth-authorization-server vs the evaluator)
//   - RFC wire-shape regressions (missing required fields)
//   - RAR ↔ RFC-6749 envelope coherence (denial reason has matching
//     OAuth canonical error)
//
// Authority: docs/spec/05_FAPI_2_0_PROFILE.md §2 — every implemented RFC.

import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';

import { WellknownService } from '../../apps/api/src/modules/wellknown/wellknown.service';
import { encodeBase64Url } from '../../apps/api/src/common/crypto/ed25519.util';
import { evaluateRar } from '../../apps/api/src/modules/verify/rar/rar.evaluator';
import { oauthErrorFor } from '../../apps/api/src/modules/verify/oauth-error-mapping';
import type { DenialReason } from '../../apps/api/src/modules/verify/verify.dto';

// ──────────────────────────────────────────────────────────────────────
// Fixture: a minimal buyer integration setup
// ──────────────────────────────────────────────────────────────────────

const TRADING_HOURS_TS = new Date('2026-06-08T14:00:00Z'); // Mon 10:00 ET

function buildWellknown(): WellknownService {
  const pub = new Uint8Array(32);
  pub[0] = 1; // non-zero so the key looks plausible in the transcript
  const svc = new WellknownService({
    aegisSigningPublicKey: encodeBase64Url(pub),
    aegisSigningKeyRotatedAt: '2026-01-01T00:00:00.000Z',
    apiBaseUrl: 'https://api.aegis.klytics.io',
  } as never);
  svc.onModuleInit();
  return svc;
}

// ──────────────────────────────────────────────────────────────────────
// The buyer journey, step by step. Each `it()` is one step in the
// onboarding flow a real fintech engineer walks through.
// ──────────────────────────────────────────────────────────────────────

describe('Buyer journey 1 — Discovery (RFC 8414 + AEGIS configuration)', () => {
  const wk = buildWellknown();

  it('step 1: GET /.well-known/aegis-configuration produces a parseable discovery doc', () => {
    const cfg = wk.getAegisConfiguration();

    // RFC-essential fields a buyer's tooling expects:
    expect(cfg.issuer).toMatch(/^https?:\/\//);
    expect(cfg.jwks_uri).toMatch(/^https?:\/\/.+\/\.well-known\/jwks\.json$/);
    expect(cfg.spec_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Array.isArray(cfg.standards_implemented)).toBe(true);
    expect(Array.isArray(cfg.standards_aligned)).toBe(true);

    // Wedge claim assertions — every RFC the marketing site mentions
    // must be discoverable here.
    expect(cfg.standards_implemented).toEqual(
      expect.arrayContaining([
        'RFC-8032', 'RFC-7517', 'RFC-9116', 'RFC-9396',
        'RFC-8414', 'RFC-6749', 'RFC-9101',
      ]),
    );
    expect(cfg.fapi_profile).toBe('aegis-fapi-2.0-aligned-1.0');
    expect(cfg.authorization_details_types_supported).toEqual(
      expect.arrayContaining(['trading_order', 'payment_initiation', 'data_access', 'agent_action']),
    );
  });

  it('step 2: GET /.well-known/oauth-authorization-server returns RFC 8414 conformant subset', () => {
    const md = wk.getOAuthAuthorizationServerMetadata();

    // RFC 8414 §2 required fields
    expect(md.issuer).toBeDefined();
    expect(Array.isArray(md.response_types_supported)).toBe(true);

    // FAPI 2.0 extensions
    expect(md.request_object_signing_alg_values_supported).toEqual(['EdDSA']);

    // AEGIS-namespaced extensions clearly disambiguate
    expect(md.aegis_service_type).toBe('authorization-decision-and-audit-layer');
    expect(md.aegis_rar_evaluate_endpoint).toMatch(/\/v1\/verify\/rar\/evaluate$/);
  });

  it('step 3: discovery doc cross-consistency — issuer + endpoints share a base URL', () => {
    const cfg = wk.getAegisConfiguration();
    const md = wk.getOAuthAuthorizationServerMetadata();

    expect(md.issuer).toBe(cfg.issuer);
    expect(md.jwks_uri).toBe(cfg.jwks_uri);
    expect(md.aegis_fapi_profile).toBe(cfg.fapi_profile);
    expect(md.authorization_details_types_supported).toEqual(
      cfg.authorization_details_types_supported,
    );
  });

  it('step 4: GET /.well-known/jwks.json returns RFC 7517 + RFC 8037 Ed25519 JWKS', () => {
    const jwks = wk.getJwks();
    expect(jwks.keys).toHaveLength(1);
    const jwk = jwks.keys[0]!;
    expect(jwk.kty).toBe('OKP'); // RFC 8037 Ed25519-in-JOSE
    expect(jwk.crv).toBe('Ed25519');
    expect(jwk.alg).toBe('EdDSA');
    expect(jwk.use).toBe('sig');
    expect(jwk.x).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
  });

  it('step 5: GET /.well-known/security.txt returns RFC 9116 conformant text', () => {
    const txt = wk.getSecurityTxt();
    // RFC 9116 §2 required fields
    expect(txt).toMatch(/Contact: /);
    expect(txt).toMatch(/Expires: \d{4}-\d{2}-\d{2}/);
    expect(txt).toMatch(/Preferred-Languages: /);
  });
});

describe('Buyer journey 2 — RAR evaluation (RFC 9396)', () => {
  it('step 6: AI portfolio manager builds RAR claims for managed-account rebalance', async () => {
    // Buyer generates an Ed25519 keypair locally for the agent.
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    expect(pub.length).toBe(32);
    expect(priv.length).toBe(32);

    // Buyer crafts a RAR authorization_details following RFC 9396 §2.1.
    // The detail constrains the agent's authority for this verify call.
    const auth_details = [
      {
        type: 'trading_order' as const,
        actions: ['buy', 'sell'] as const,
        instruments: ['NYSE:*', 'NASDAQ:*'],
        limits: { per_order_usd: 50000, per_day_usd: 250000 },
        trading_hours_only: true,
      },
    ];

    // Buyer's broker forwards the agent's action to AEGIS for evaluation.
    const result = evaluateRar(auth_details, {
      type: 'trading_order',
      action: 'buy',
      instrument: 'NASDAQ:AAPL',
      amount_usd: 49750,
      at: TRADING_HOURS_TS,
    });

    expect(result).toEqual({ ok: true, matched_detail_type: 'trading_order' });
  });

  it('step 7: over-cap order is rejected with typed RAR deny reason', () => {
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

  it('step 8: off-hours order denied even with sufficient cap (defense-in-depth)', () => {
    const result = evaluateRar(
      [
        {
          type: 'trading_order',
          actions: ['buy'],
          trading_hours_only: true,
        },
      ],
      {
        type: 'trading_order',
        action: 'buy',
        at: new Date('2026-06-13T15:00:00Z'), // Saturday
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('outside_trading_hours');
  });

  it('step 9: payment-initiation RAR honors destination whitelist + currency filter', () => {
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

  it('step 10: PII access strictly denied without explicit pii_allowed=true', () => {
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

describe('Buyer journey 3 — Denial response (RFC 6749 §5.2 envelope)', () => {
  it('step 11: every AEGIS denial reason resolves to an OAuth canonical error + description', () => {
    // The buyer's existing OAuth review playbook knows these canonical
    // error values. Mapping every AEGIS-specific reason to one of them
    // means the buyer's playbook handles AEGIS denials without learning
    // AEGIS-specific reason codes.
    const reasons: ReadonlyArray<DenialReason> = [
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
    for (const reason of reasons) {
      const { error, error_description } = oauthErrorFor(reason);
      expect(typeof error).toBe('string');
      expect(error.length).toBeGreaterThan(0);
      expect(typeof error_description).toBe('string');
      expect(error_description.length).toBeGreaterThan(0);
    }
  });

  it('step 12: error descriptions are public-safe (no secrets, no internal jargon)', () => {
    const reasons: ReadonlyArray<DenialReason> = [
      'INVALID_SIGNATURE',
      'POLICY_REVOKED',
      'TRIAL_EXHAUSTED',
      'ANOMALY_FLAGGED',
    ];
    for (const reason of reasons) {
      const { error_description } = oauthErrorFor(reason);
      // No SQL, no internal class names, no stack traces.
      expect(error_description).not.toMatch(/sql|prisma|redis|errno|stack/i);
      // Sentence-shaped (capital + period).
      expect(error_description).toMatch(/^[A-Z].+[.]$/);
    }
  });
});

describe('Buyer journey 4 — Wedge demo (Persona-level integration scenarios)', () => {
  it('PERSONA A — Fintech Builder: AI agent makes its first Plaid-shaped call', () => {
    // Persona A's first integration: their LLM agent makes a Plaid-style
    // data_access call. The buyer's compliance officer wants per-action
    // scope. AEGIS evaluates the RAR claim, returns ALLOW + audit-ready.
    const result = evaluateRar(
      [
        {
          type: 'data_access',
          actions: ['read', 'list'],
          resources: ['plaid/accounts/*', 'plaid/transactions/*'],
          pii_allowed: false, // strict default
        },
      ],
      {
        type: 'data_access',
        action: 'read',
        resource: 'plaid/accounts/acct_abc',
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.matched_detail_type).toBe('data_access');
  });

  it('PERSONA B — Treasury Eng Lead: AI vendor-payment agent under SOC 2 controls', () => {
    // Persona B: 50-person fintech, agent paying vendors. SOC 2 CC7.2
    // requires per-action authorization evidence. RAR provides it; the
    // matched_detail_type goes into the audit row.
    const result = evaluateRar(
      [
        {
          type: 'payment_initiation',
          actions: ['transfer'],
          destinations: ['acct_vendor_aws', 'acct_vendor_stripe', 'acct_vendor_office'],
          currencies: ['USD'],
          limits: { per_transaction_usd: 25000, per_day_usd: 100000 },
        },
      ],
      {
        type: 'payment_initiation',
        action: 'transfer',
        destination: 'acct_vendor_aws',
        amount_usd: 5000,
        currency: 'USD',
        spent_today_usd: 12000,
      },
    );
    expect(result.ok).toBe(true);
  });

  it('PERSONA C — Capital Markets CISO: regulator-defensible posture under SR 11-7', () => {
    // Persona C: broker-dealer running AI order routing. Fed SR 11-7
    // model risk management requires bounded action scope. Trading hours
    // + per-order USD cap + instrument whitelist together compose the
    // "control" evidence.
    const result = evaluateRar(
      [
        {
          type: 'trading_order',
          actions: ['buy', 'sell'],
          instruments: ['NYSE:*', 'NASDAQ:*', 'AMEX:*'],
          limits: { per_order_usd: 100000, per_day_usd: 1000000, per_order_qty: 5000 },
          trading_hours_only: true,
        },
      ],
      {
        type: 'trading_order',
        action: 'buy',
        instrument: 'NASDAQ:MSFT',
        amount_usd: 45000,
        qty: 100,
        at: TRADING_HOURS_TS,
      },
    );
    expect(result.ok).toBe(true);
  });

  it('Negative path: each persona\'s "exceeded" scenario rejects with clear deny reason', () => {
    // Persona A — over-scoped resource
    const a = evaluateRar(
      [{ type: 'data_access', actions: ['read'], resources: ['plaid/accounts/*'] }],
      { type: 'data_access', action: 'read', resource: 'kyc/ssn_lookup' },
    );
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe('resource_not_whitelisted');

    // Persona B — daily cap exceeded
    const b = evaluateRar(
      [{ type: 'payment_initiation', actions: ['transfer'], limits: { per_day_usd: 100000 } }],
      {
        type: 'payment_initiation',
        action: 'transfer',
        amount_usd: 50000,
        spent_today_usd: 80000,
      },
    );
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe('limit_exceeded');

    // Persona C — off-hours
    const c = evaluateRar(
      [{ type: 'trading_order', actions: ['buy'], trading_hours_only: true }],
      {
        type: 'trading_order',
        action: 'buy',
        at: new Date('2026-06-08T01:00:00Z'), // 9 PM ET Sunday in NYC
      },
    );
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe('outside_trading_hours');
  });
});

describe('Buyer journey 5 — Integration health check', () => {
  it('every RFC the wedge claims is observable via the discovery doc', () => {
    // Buyer\'s integration smoke test: `curl /.well-known/aegis-configuration`
    // and confirm every RFC the buyer signed up for is there.
    const cfg = buildWellknown().getAegisConfiguration();
    const wedgeRfcs = [
      'RFC-8032', // EdDSA
      'RFC-7517', // JWKS
      'RFC-9116', // security.txt
      'RFC-9396', // RAR
      'RFC-8414', // OAuth AS Metadata
      'RFC-6749', // OAuth error envelope
      'RFC-9101', // JAR
    ];
    for (const rfc of wedgeRfcs) {
      expect(cfg.standards_implemented).toContain(rfc);
    }
  });

  it('discovery doc has zero standards_implemented entries without implementation evidence', () => {
    // Inverse of step above: if standards_implemented adds an RFC, every
    // entry must be backed by a binding test elsewhere. This spec lists
    // the binding tests we know about — if standards_implemented grows
    // beyond this list, the engineer must add a corresponding binding
    // test before promotion. Spec is the operational forcing function.
    const cfg = buildWellknown().getAegisConfiguration();
    const knownBindings: Record<string, string> = {
      'RFC-8032': 'audit-chain-parity.spec.ts',
      'RFC-7517': 'wellknown.service.spec.ts',
      'RFC-9116': 'wellknown.service.spec.ts',
      'RFC-9396': 'rar.evaluator.spec.ts + rar.controller.spec.ts',
      'RFC-8414': 'wellknown.service.spec.ts (getOAuthAuthorizationServerMetadata block)',
      'RFC-6749': 'oauth-error-mapping.spec.ts',
      'RFC-9101': 'jwt.util.jar.spec.ts',
    };
    for (const rfc of cfg.standards_implemented) {
      expect(
        knownBindings[rfc],
        `RFC ${rfc} is in standards_implemented but has no known binding test — update this spec`,
      ).toBeDefined();
    }
  });
});
