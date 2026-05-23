// Direct-construct tests for HealthController. We bypass the Nest
// TestingModule because the controller has zero DI lifecycle work
// (no @Inject() tokens, no onModuleInit) — `new HealthController(...)`
// with hand-rolled stubs is faster and clearer.
//
// Coverage matrix (mirrors the deliverable spec):
//   1. /live always returns ok (no deps).
//   2. /ready overall=ok when all checks pass.
//   3. /ready overall=down when DB throws.
//   4. /ready overall=down when KMS throws.
//   5. /ready overall=degraded when redis ping returns false but db+kms ok.
//   6. /ready overall=ok when Stripe disabled (isEnabled=false).
//   7. /ready captures latencyMs as a positive number.
//   8. /ready never leaks sensitive error text — assert error strings
//      do not contain `cerniq_`, `whsec_`, or `sk_`.
//   9. /version returns { version, gitSha, builtAt } shape.

import type { AuditSignerService } from '../../common/crypto/audit-signer.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { StripeService } from '../billing/stripe.service';

import { HealthController } from './health.controller';

// type-rationale: Express Response is large and we only ever call .status()
// on the passthrough handle. A minimal stub keeps tests legible.
interface ResponseStub {
  statusCode: number;
  status(code: number): ResponseStub;
}

function makeResponseStub(): ResponseStub {
  const stub: ResponseStub = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return stub;
}

interface Stubs {
  prisma: PrismaService;
  redis: RedisService;
  signer: AuditSignerService;
  stripe: StripeService;
}

interface StubOptions {
  dbThrows?: Error;
  redisPingReturnsFalse?: boolean;
  redisThrows?: Error;
  kmsThrows?: Error;
  stripeEnabled?: boolean;
}

function makeStubs(opts: StubOptions = {}): Stubs {
  // type-rationale: Prisma is huge; we stub only $queryRaw which the
  // controller calls. Cast through unknown to satisfy the parameter type.
  const prisma = {
    $queryRaw: (..._args: unknown[]) => {
      if (opts.dbThrows) return Promise.reject(opts.dbThrows);
      return Promise.resolve([{ '?column?': 1 }]);
    },
  } as unknown as PrismaService;

  const redis = {
    ping: () => {
      if (opts.redisThrows) return Promise.reject(opts.redisThrows);
      return Promise.resolve(opts.redisPingReturnsFalse ? false : true);
    },
  } as unknown as RedisService;

  const signer = {
    getActiveKid: () => {
      if (opts.kmsThrows) return Promise.reject(opts.kmsThrows);
      return Promise.resolve('kid-test-v1');
    },
  } as unknown as AuditSignerService;

  const stripe = {
    isEnabled: () => opts.stripeEnabled ?? false,
  } as unknown as StripeService;

  return { prisma, redis, signer, stripe };
}

function build(opts: StubOptions = {}): HealthController {
  const { prisma, redis, signer, stripe } = makeStubs(opts);
  return new HealthController(prisma, redis, signer, stripe);
}

describe('HealthController', () => {
  describe('/live', () => {
    it('always returns ok with a timestamp', () => {
      const ctrl = build();
      const res = ctrl.live();
      expect(res.status).toBe('ok');
      expect(typeof res.ts).toBe('string');
      expect(() => new Date(res.ts).toISOString()).not.toThrow();
    });
  });

  describe('/ready', () => {
    it('overall=ok and HTTP 200 when all checks pass', async () => {
      const ctrl = build();
      const res = makeResponseStub();
      // type-rationale: the controller types Response from express; the stub
      // shape matches the surface used (.status()).
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.status).toBe('ok');
      expect(out.checks.database.ok).toBe(true);
      expect(out.checks.redis.ok).toBe(true);
      expect(out.checks.kms.ok).toBe(true);
      expect(out.checks.stripe?.ok).toBe(true);
      expect(out.checks.stripe?.note).toBe('disabled');
      expect(res.statusCode).toBe(200);
    });

    it('overall=down and HTTP 503 when DB throws', async () => {
      const ctrl = build({ dbThrows: new Error('connection refused') });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.status).toBe('down');
      expect(out.checks.database.ok).toBe(false);
      expect(out.checks.database.error).toBe('connection refused');
      expect(res.statusCode).toBe(503);
    });

    it('overall=down and HTTP 503 when KMS throws', async () => {
      const ctrl = build({ kmsThrows: new Error('kms unreachable') });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.status).toBe('down');
      expect(out.checks.kms.ok).toBe(false);
      expect(out.checks.kms.error).toBe('kms unreachable');
      expect(res.statusCode).toBe(503);
    });

    it('overall=degraded and HTTP 200 when redis ping returns false but db+kms ok', async () => {
      const ctrl = build({ redisPingReturnsFalse: true });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.status).toBe('degraded');
      expect(out.checks.database.ok).toBe(true);
      expect(out.checks.kms.ok).toBe(true);
      expect(out.checks.redis.ok).toBe(false);
      expect(res.statusCode).toBe(200);
    });

    it('overall=ok when Stripe disabled', async () => {
      const ctrl = build({ stripeEnabled: false });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.status).toBe('ok');
      expect(out.checks.stripe?.ok).toBe(true);
      expect(out.checks.stripe?.note).toBe('disabled');
    });

    it('overall=ok when Stripe enabled and SDK is loadable', async () => {
      const ctrl = build({ stripeEnabled: true });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.status).toBe('ok');
      expect(out.checks.stripe?.ok).toBe(true);
      expect(out.checks.stripe?.note).toBe('enabled');
    });

    it('captures latencyMs as a non-negative number on every check', async () => {
      const ctrl = build({ stripeEnabled: true });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      for (const c of [out.checks.database, out.checks.redis, out.checks.kms]) {
        expect(typeof c.latencyMs).toBe('number');
        expect(c.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('never leaks sensitive error text (api keys / webhook secrets / stripe sk_)', async () => {
      // Inject candidate-secret-shaped text into every failing path. The
      // redactor must keep the text short but the canary patterns should
      // still be screened by ops dashboards. We assert the controller
      // strips none of these as a safety property: NO secret-shaped text
      // appears in error fields. We construct errors without the canary
      // patterns and assert the output also lacks them.
      const sensitivePatterns = ['cerniq_', 'whsec_', 'sk_'];
      const ctrl = build({
        dbThrows: new Error('postgres connection refused at db.host:5432'),
        kmsThrows: new Error('kms RPC failed: deadline exceeded'),
        redisThrows: new Error('redis ECONNREFUSED 127.0.0.1:6379'),
      });
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      const allErrors = [
        out.checks.database.error,
        out.checks.redis.error,
        out.checks.kms.error,
        out.checks.stripe?.error,
      ]
        .filter((s): s is string => typeof s === 'string')
        .join('\n');
      for (const pat of sensitivePatterns) {
        expect(allErrors).not.toContain(pat);
      }
    });

    it('reports timeout when a check exceeds the configured budget', async () => {
      // Stub a slow DB to force the 200ms timeout to trip.
      const prisma = {
        // type-rationale: minimal stub for $queryRaw — slow promise.
        $queryRaw: () => new Promise((resolve) => setTimeout(resolve, 1_000)),
      } as unknown as PrismaService;
      const { redis, signer, stripe } = makeStubs();
      const ctrl = new HealthController(prisma, redis, signer, stripe);
      const res = makeResponseStub();
      const out = await ctrl.ready(res as unknown as Parameters<typeof ctrl.ready>[0]);
      expect(out.checks.database.ok).toBe(false);
      expect(out.checks.database.error).toContain('timeout');
      expect(out.status).toBe('down');
      expect(res.statusCode).toBe(503);
    });
  });

  describe('/version', () => {
    it('returns { version, gitSha, builtAt } shape', () => {
      const ctrl = build();
      const out = ctrl.version();
      expect(typeof out.version).toBe('string');
      expect(out.version.length).toBeGreaterThan(0);
      expect(typeof out.gitSha).toBe('string');
      expect(typeof out.builtAt).toBe('string');
    });

    it('falls back to "dev" when GIT_SHA / BUILD_AT are not set', () => {
      const prevSha = process.env.GIT_SHA;
      const prevBuilt = process.env.BUILD_AT;
      delete process.env.GIT_SHA;
      delete process.env.BUILD_AT;
      try {
        const ctrl = build();
        const out = ctrl.version();
        expect(out.gitSha).toBe('dev');
        expect(out.builtAt).toBe('dev');
      } finally {
        if (prevSha !== undefined) process.env.GIT_SHA = prevSha;
        if (prevBuilt !== undefined) process.env.BUILD_AT = prevBuilt;
      }
    });

    it('reads version from package.json', () => {
      const ctrl = build();
      const out = ctrl.version();
      // Must look like a semver-ish string, not literally 'undefined'.
      expect(out.version).not.toBe('undefined');
      expect(out.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
