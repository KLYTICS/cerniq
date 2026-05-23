// CERNIQ — security hardening module.
//
// Wraps the cors / request-limits / helmet / trust-proxy primitives into
// a single import. Wired in main.ts via:
//
//   import { applySecurityMiddleware } from './common/security/security.module';
//   applySecurityMiddleware(app, config);
//
// Order matters — we apply middleware in this sequence:
//
//   1. trust proxy            (so req.ip is real before anything else reads it)
//   2. helmet headers         (set on every response, including errors)
//   3. body parser stack      (limits + depth-bomb guard)
//   4. CORS                   (after body parsing so preflights short-circuit)
//   5. (NestJS / framework guards run after our middleware)
//
// security.txt + JWKS rotation responses set their own headers in the
// respective controllers; helmet defaults still apply.

import type { INestApplication } from '@nestjs/common';

import { buildCorsDelegate } from './cors-allowlist';
import { buildHelmetConfig } from './helmet-config';
import { buildBodyParserStack, DEFAULT_REQUEST_LIMITS } from './request-limits';
import { resolveTrustProxy, type TrustProxyMode } from './trust-proxy';

export interface SecurityHardeningConfig {
  trustProxyMode: TrustProxyMode;
  managementCorsOrigins: string;
  enableHsts: boolean;
  securityContactEmail: string;
  /**
   * If true, throws when the operator left CORS at '*' in production.
   * Set false for explicit dev/test overrides.
   */
  failOnWildcardCorsInProd?: boolean;
  isProduction: boolean;
}

export function applySecurityMiddleware(
  app: INestApplication,
  config: SecurityHardeningConfig,
): void {
  // Cast required: INestApplication doesn't expose `set` on its typing,
  // but the underlying express app does.
  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
    use: (...args: unknown[]) => void;
  };

  // 1. Trust proxy
  expressApp.set('trust proxy', resolveTrustProxy(config.trustProxyMode));

  // 2. Helmet
  // (helmet is applied by the caller after this — kept separate so the
  // caller can register additional middlewares between if needed.)

  // 3. Body parser stack
  expressApp.use(buildBodyParserStack(DEFAULT_REQUEST_LIMITS));

  // 4. CORS
  app.enableCors(buildCorsDelegate({ managementOrigins: config.managementCorsOrigins }));

  // Validate prod posture.
  if (
    config.failOnWildcardCorsInProd !== false &&
    config.isProduction &&
    config.managementCorsOrigins.trim() === '*'
  ) {
    throw new Error(
      'CORS_ORIGINS=* is not permitted in production. Set CORS_ORIGINS to a comma-separated allow-list.',
    );
  }
}

export { buildCorsDelegate, buildHelmetConfig, buildBodyParserStack, resolveTrustProxy };
