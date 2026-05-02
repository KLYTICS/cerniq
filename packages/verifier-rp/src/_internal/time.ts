// Test-injectable clock. Production paths should always go through `now()`
// rather than `Date.now()` so tests can pin time without monkey-patching the
// global Date object.

export type Clock = () => number;

const defaultClock: Clock = () => Date.now();

let current: Clock = defaultClock;

/** Current epoch milliseconds via the active clock. */
export function now(): number {
  return current();
}

/** Current epoch seconds (matches JWT iat/exp units). */
export function nowSeconds(): number {
  return Math.floor(current() / 1000);
}

/**
 * Replace the active clock for tests. Always pair with `resetClock()` in
 * afterEach to avoid leaking state across files.
 */
export function setClock(clock: Clock): void {
  current = clock;
}

export function resetClock(): void {
  current = defaultClock;
}
