// Runtime detection for @aegis/sdk — Round 25 Lane A.
//
// The SDK runs in five distinct JS runtimes today. Each has different
// crypto, storage, and HTTP capabilities. Internal SDK code can branch on
// the detected runtime to pick the right adapter; callers can introspect
// via `Aegis.runtime()` for instrumentation and bug reports.
//
// Detection is best-effort and ordered most-specific to most-general:
//
//   1. Cloudflare Workers     — `globalThis.WebSocketPair` (CF-specific)
//   2. Deno                   — `globalThis.Deno`
//   3. Bun                    — `globalThis.Bun`
//   4. Edge runtime (Vercel)  — `globalThis.EdgeRuntime` (deprecated marker)
//                                or `process.env.NEXT_RUNTIME === 'edge'`
//   5. Node.js                — `globalThis.process.versions.node`
//   6. Browser                — `globalThis.window && globalThis.document`
//   7. Unknown                — everything else
//
// We deliberately do NOT cache the detection — modules can be re-evaluated
// across runtimes during hot-reload or worker spawning.

export type AegisRuntime =
  | 'cloudflare-workers'
  | 'deno'
  | 'bun'
  | 'edge'
  | 'node'
  | 'browser'
  | 'unknown';

// type-rationale: globalThis carries runtime-specific properties that
// TypeScript's lib.dom doesn't model; we narrow with `in` operators and
// `typeof` checks so the detection survives strict typecheck.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _g = (): any => globalThis as any;

export function detectRuntime(): AegisRuntime {
  const g = _g();
  // Cloudflare Workers expose WebSocketPair as a global constructor. This
  // marker predates the `navigator.userAgent === 'Cloudflare-Workers'` API
  // and is the most reliable cross-version signal.
  if (typeof g.WebSocketPair === 'function') return 'cloudflare-workers';
  if (g.Deno && typeof g.Deno === 'object' && typeof g.Deno.version === 'object') return 'deno';
  if (g.Bun && typeof g.Bun === 'object') return 'bun';
  // Vercel/Next.js edge runtime — checks the env var first (set by Next at
  // build time for edge bundles) then the legacy `EdgeRuntime` global.
  if (
    (typeof g.process === 'object' &&
      g.process?.env &&
      g.process.env.NEXT_RUNTIME === 'edge') ||
    typeof g.EdgeRuntime !== 'undefined'
  ) {
    return 'edge';
  }
  if (
    typeof g.process === 'object' &&
    g.process?.versions &&
    typeof g.process.versions.node === 'string'
  ) {
    return 'node';
  }
  if (typeof g.window === 'object' && typeof g.document === 'object') return 'browser';
  return 'unknown';
}

/**
 * Capabilities the SDK uses to choose adapter behavior. Returned as a
 * snapshot so calling code can stash it without re-detecting.
 */
export interface RuntimeCapabilities {
  runtime: AegisRuntime;
  /** True iff `node:fs` is importable. Implies a persistent local FS. */
  hasFilesystem: boolean;
  /** True iff `localStorage` / `indexedDB` are usable. */
  hasBrowserStorage: boolean;
  /** True iff `crypto.subtle` is available (all modern runtimes). */
  hasWebCrypto: boolean;
  /** True iff `fetch` is a global (all modern runtimes since Node 18). */
  hasFetch: boolean;
}

export function capabilities(): RuntimeCapabilities {
  const g = _g();
  const runtime = detectRuntime();
  return {
    runtime,
    hasFilesystem: runtime === 'node' || runtime === 'bun' || runtime === 'deno',
    hasBrowserStorage:
      runtime === 'browser' && typeof g.localStorage === 'object' && g.localStorage !== null,
    hasWebCrypto: typeof g.crypto === 'object' && typeof g.crypto?.subtle === 'object',
    hasFetch: typeof g.fetch === 'function',
  };
}
