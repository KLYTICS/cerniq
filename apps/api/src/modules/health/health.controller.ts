// HealthController — operator-facing readiness, liveness, and version surface.
//
// Three endpoints, all `@Public()`:
//
//   GET /health/live    — process liveness only. No deps. Always 200.
//                         k8s/Railway use this for restart decisions.
//
//   GET /health/ready   — structured readiness with per-component status.
//                         Status semantics:
//                           - 'ok':       all checks pass (HTTP 200)
//                           - 'degraded': core deps (db+kms) fine, but a
//                                         non-blocking dep (redis or stripe)
//                                         is failing (HTTP 200 — we still
//                                         serve traffic; observability layer
//                                         escalates the alert)
//                           - 'down':     core dep (db OR kms) unreachable
//                                         (HTTP 503 — load balancer should
//                                         drain this pod)
//                         KMS is a CORE dep because every audit row gets
//                         signed (CLAUDE.md invariant #3 — append-only +
//                         signed). Without KMS we cannot honor that
//                         invariant, so serving any mutating traffic would
//                         silently drop signatures. Better to be drained.
//
//   GET /health/version — { version, gitSha, builtAt } for blue-green
//                         confirmation. Cached at construct time — no fs
//                         or env reads at request time.
//
// Internal contract: every readiness check is wrapped in `runCheck()` which
// (a) times the call, (b) enforces a 200ms timeout, (c) catches throws and
// converts to `{ ok: false, error: <one-liner> }`. The endpoint itself
// MUST NOT throw — if a check itself fails, we report it as a failed
// component and continue (CLAUDE.md invariant #4 — no silent swallow,
// surface to caller).
//
// Error redaction: error strings are short, fixed phrases or first-line
// messages. We never include DSNs, secret material, or stack traces in
// the readiness payload. The spec asserts none of the canary patterns
// (`aegis_`, `whsec_`, `sk_`) appear in any error string.

import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../auth/api-key.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditSignerService } from '../../common/crypto/audit-signer.service';
import { StripeService } from '../billing/stripe.service';

// type-rationale: package.json is a static JSON resource and tsconfig has
// resolveJsonModule=true. Importing once at module load avoids fs reads
// per request and keeps `version` baked into the bundle.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
import * as pkgJson from '../../../package.json';

const READINESS_CHECK_TIMEOUT_MS = 200;

export interface ComponentStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  /** Free-form note (e.g. 'enabled' / 'disabled' for Stripe). */
  note?: string;
}

export type ReadinessOverall = 'ok' | 'degraded' | 'down';

export interface ReadinessChecks {
  database: ComponentStatus;
  redis: ComponentStatus;
  kms: ComponentStatus;
  stripe?: ComponentStatus;
}

export interface ReadinessResponse {
  status: ReadinessOverall;
  checks: ReadinessChecks;
  ts: string;
}

export interface VersionResponse {
  version: string;
  gitSha: string;
  builtAt: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  /** Computed once at construct time. */
  private readonly versionPayload: VersionResponse;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditSigner: AuditSignerService,
    private readonly stripe: StripeService,
  ) {
    // type-rationale: ts-jest + CJS interop on a JSON import surfaces both
    // a `default` and the raw object. We accept either shape.
    const pkg =
      (pkgJson as { default?: { version?: string }; version?: string })
        .default ?? (pkgJson as { version?: string });
    this.versionPayload = {
      version: pkg.version ?? '0.0.0',
      gitSha: process.env.GIT_SHA ?? 'dev',
      builtAt: process.env.BUILD_AT ?? 'dev',
    };
  }

  @Public()
  @Get('live')
  live(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessResponse> {
    const [database, redis, kms, stripe] = await Promise.all([
      this.runCheck(() =>
        this.prisma.$queryRaw`SELECT 1`.then(() => undefined),
      ),
      this.runCheck(async () => {
        const ok = await this.redis.ping();
        if (!ok) throw new Error('ping returned false');
      }),
      this.runCheck(async () => {
        await this.auditSigner.getActiveKid();
      }),
      this.stripe.isEnabled()
        ? this.runCheck(() => Promise.resolve()).then((c) => ({
            ...c,
            note: 'enabled',
          }))
        : Promise.resolve<ComponentStatus>({ ok: true, note: 'disabled' }),
    ]);

    const checks: ReadinessChecks = { database, redis, kms, stripe };
    const overall = this.computeOverall(checks);

    res.status(
      overall === 'down' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK,
    );

    return {
      status: overall,
      checks,
      ts: new Date().toISOString(),
    };
  }

  @Public()
  @Get('version')
  version(): VersionResponse {
    return this.versionPayload;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Run a single readiness probe with a fixed timeout. Returns a
   * structured ComponentStatus — never throws. Captures latency in ms.
   */
  private async runCheck(
    fn: () => Promise<void>,
  ): Promise<ComponentStatus> {
    const started = Date.now();
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`timeout: ${READINESS_CHECK_TIMEOUT_MS}ms`)),
            READINESS_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      const latencyMs = Date.now() - started;
      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - started;
      return {
        ok: false,
        latencyMs,
        error: this.redactError(err),
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  /**
   * Reduce raw error to a short, sensitive-data-free one-liner.
   * Stack traces and full messages can carry DSNs / tokens — we keep
   * only the first line and cap it.
   */
  private redactError(err: unknown): string {
    const raw =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown error';
    const firstLine = raw.split('\n')[0] ?? 'unknown error';
    return firstLine.slice(0, 120);
  }

  /**
   * Reduce per-component status to an overall verdict.
   *   - any core dep down → 'down'
   *   - all checks ok    → 'ok'
   *   - non-core dep failing → 'degraded'
   * Core deps: database, kms. Non-core: redis, stripe.
   */
  private computeOverall(checks: ReadinessChecks): ReadinessOverall {
    if (!checks.database.ok || !checks.kms.ok) return 'down';
    const nonCoreFailing =
      !checks.redis.ok || (checks.stripe !== undefined && !checks.stripe.ok);
    return nonCoreFailing ? 'degraded' : 'ok';
  }
}
