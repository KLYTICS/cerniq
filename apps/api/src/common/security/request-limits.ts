// AEGIS — request size + JSON depth limits.
//
// Default Express body parser accepts up to 100 KB JSON. For an identity
// gateway that's both too generous (a 100 KB JWT is a guaranteed CPU DoS)
// and inconsistent across endpoints (the verify hot path needs ~ 8 KB at
// most; an audit export download needs more).
//
// We set per-content-type and per-route limits explicitly. The verify hot
// path enforces the tightest limits because the underlying primitive
// (Ed25519 verify) cost is constant but the un-verified JWT-decode +
// JSON-parse step scales with payload size.
//
// Defense against:
//   - Payload-size DoS: capped at 16 KB on the verify path.
//   - Prototype pollution: `__proto__` keys filtered post-parse.
//   - JSON depth bombs: 10-deep ceiling enforced by a depth checker.
//   - Slowloris: per-request timeout (handled at the reverse proxy layer
//     in production; documented here for completeness).

// express is imported lazily inside buildBodyParserStack() so that the pure
// helpers in this module (stripPrototypeProperties, etc.) can be unit-tested
// in environments where express is only a transitive dep (not directly
// installed). The type-only import below keeps TypeScript happy without
// causing a runtime require at module load.
type ExpressModule = typeof import('express');

export interface RequestLimitsConfig {
  /** Default body size for management endpoints. */
  managementBodyBytes: number; // default 256 KB
  /** Body size for verify hot path. */
  verifyBodyBytes: number; // default 16 KB
  /** Body size for audit export download endpoint (NDJSON streamed in, smaller cap on POST bodies). */
  auditBodyBytes: number; // default 64 KB
  /** Max JSON object/array nesting depth. */
  maxJsonDepth: number; // default 10
}

export const DEFAULT_REQUEST_LIMITS: RequestLimitsConfig = {
  managementBodyBytes: 256 * 1024,
  verifyBodyBytes: 16 * 1024,
  auditBodyBytes: 64 * 1024,
  maxJsonDepth: 10,
};

/**
 * Express middleware factory that picks a per-route body size + parses
 * JSON safely. Mounted in main.ts BEFORE NestJS's own body parser via
 * `app.use(...)`.
 *
 * This intentionally uses `body-parser` directly rather than relying on
 * Nest's default to give us per-route control — Nest's `bodyParser: true`
 * applies one limit globally.
 */
export function buildBodyParserStack(
  config: RequestLimitsConfig = DEFAULT_REQUEST_LIMITS,
): import('express').RequestHandler {
  // Lazy require so that modules importing only the pure helpers (e.g.
  // stripPrototypeProperties) don't force express into the Jest module graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const express = require('express') as ExpressModule;
  const bodyParser = { json: express.json };

  const verifyParser = bodyParser.json({
    limit: config.verifyBodyBytes,
    verify: makeJsonSafetyVerifier(config.maxJsonDepth),
  });
  const auditParser = bodyParser.json({
    limit: config.auditBodyBytes,
    verify: makeJsonSafetyVerifier(config.maxJsonDepth),
  });
  const managementParser = bodyParser.json({
    limit: config.managementBodyBytes,
    verify: makeJsonSafetyVerifier(config.maxJsonDepth),
  });

  return (req: import('express').Request, res: Parameters<typeof verifyParser>[1], next: Parameters<typeof verifyParser>[2]) => {
    const url = req.url ?? '';
    if (url.startsWith('/v1/verify') || url.startsWith('/v1/agents/') && url.includes('/status')) {
      verifyParser(req, res, next); return;
    }
    if (url.startsWith('/v1/audit') || url.startsWith('/v1/agents/') && url.includes('/audit')) {
      auditParser(req, res, next); return;
    }
    managementParser(req, res, next);
  };
}

/**
 * `body-parser` `verify` callback — runs on the raw buffer before JSON
 * parsing. We enforce JSON depth here using a streaming brace counter
 * (no full parse) so depth-bomb payloads die before they hit `JSON.parse`.
 *
 * Rejects:
 *   - JSON nested deeper than `maxDepth` (depth-bomb DoS).
 *
 * Throws SyntaxError on rejection — body-parser converts to 400.
 */
function makeJsonSafetyVerifier(maxDepth: number) {
  return (_req: unknown, _res: unknown, buf: Buffer): void => {
    if (!buf || buf.length === 0) return;
    let depth = 0;
    let max = 0;
    let inString = false;
    let escape = false;
    for (const c of buf) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === 0x5c /* \ */) {
        if (inString) escape = true;
        continue;
      }
      if (c === 0x22 /* " */) {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
        depth++;
        if (depth > max) max = depth;
        if (max > maxDepth) {
          const e = new SyntaxError(
            `JSON nesting depth exceeded ${maxDepth} — possible depth-bomb`,
          );
          (e as SyntaxError & { status?: number }).status = 400;
          throw e;
        }
      } else if (c === 0x7d /* } */ || c === 0x5d /* ] */) {
        depth = Math.max(0, depth - 1);
      }
    }
  };
}

/**
 * Strip `__proto__` and `constructor.prototype` from a parsed JSON object
 * to prevent prototype pollution. Run on every parsed body via a global
 * NestJS interceptor.
 *
 * This is a belt+suspenders measure on top of `noPrototypeBuiltins` ESLint
 * rule and the fact that `JSON.parse` already produces null-prototype-free
 * objects in modern V8 — but defense in depth.
 */
export function stripPrototypeProperties<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  const banned = ['__proto__', 'constructor', 'prototype'];
  if (Array.isArray(obj)) {
    return obj.map((v: unknown) => stripPrototypeProperties(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (banned.includes(k)) continue;
    out[k] = stripPrototypeProperties(v);
  }
  return out as T;
}
