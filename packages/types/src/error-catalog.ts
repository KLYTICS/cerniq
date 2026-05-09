// Public re-export + helpers around the generated error catalog.
//
// Consumers (SDK, dashboard) import from this module — never from the
// `.generated.ts` file directly. The generated file's shape may evolve;
// this thin façade is the stable surface.

import { GENERATED_ERROR_CATALOG } from './error-catalog.generated.js';
import type { Backoff, Category, ErrorCatalogEntry } from './error-catalog.generated.js';

export { GENERATED_ERROR_CATALOG } from './error-catalog.generated.js';
export type { Backoff, Category, ErrorCatalogEntry } from './error-catalog.generated.js';

/**
 * Look up a catalog entry by its stable lower-snake-case `code`.
 * Returns `undefined` for unknown codes (the SDK treats this as "fall
 * through to status-based behavior").
 */
export function getEntry(code: string): ErrorCatalogEntry | undefined {
  return GENERATED_ERROR_CATALOG[code];
}

/**
 * Look up a catalog entry by JS class name (constructor.name on the
 * server). Useful when the SDK is told "the API thrown error was X".
 */
export function getEntryByClassName(className: string): ErrorCatalogEntry | undefined {
  for (const entry of Object.values(GENERATED_ERROR_CATALOG)) {
    if (entry.className === className) return entry;
  }
  return undefined;
}

/**
 * Is this code marked retryable in the catalog? Defaults to `false`
 * when the code is missing — the safe default for unknown codes is "do
 * not retry" so we don't amplify failures during catalog drift.
 */
export function isRetryable(code: string | undefined): boolean {
  if (code === undefined) return false;
  return getEntry(code)?.retryable === true;
}

/** Convenience: backoff strategy for a code. `undefined` if not retryable. */
export function getBackoff(code: string | undefined): Backoff | undefined {
  if (code === undefined) return undefined;
  return getEntry(code)?.backoff;
}

/** Convenience: customer-safe message for a code. */
export function getCustomerMessage(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  return getEntry(code)?.customerMessage;
}

/** Coarse category for a code, for ops dashboards or routing. */
export function getCategory(code: string | undefined): Category | undefined {
  if (code === undefined) return undefined;
  return getEntry(code)?.category;
}
