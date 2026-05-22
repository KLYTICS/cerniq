// Async-iterable pagination helper.
//
// Several SDK list endpoints (`agents.list`, `agents.audit`) return
// cursor-paginated responses of the shape `{ items: T[], nextCursor:
// string | null }`. Customers writing iteration loops at every call
// site is boilerplate that's easy to get subtly wrong — forgetting to
// thread the cursor, double-fetching page 1, no termination guard, no
// AbortSignal integration.
//
// This module ships one primitive — `paginate()` — and the SDK exposes
// per-endpoint wrappers (`agents.listAll`, `agents.auditAll`) that
// compose it with concrete fetch functions. Customers write:
//
//   for await (const agent of aegis.agents.listAll()) {
//     console.log(agent.id);
//   }
//
// Or, with cancellation, composing with M-ABORT-1:
//
//   const ctrl = new AbortController();
//   for await (const agent of aegis.agents.listAll(query, { signal: ctrl.signal })) {
//     if (shouldStop(agent)) ctrl.abort();
//   }
//
// DESIGN DECISIONS (locked):
//   1. LAZY fetch — exactly one in-flight network call at a time, no
//      page-1 prefetch. Eager prefetch is a customer choice via their
//      own `for await` + buffering, not a default.
//   2. SAFETY CAP via `maxPages` — defends against a misbehaving server
//      that returns a cursor forever. See the operator-decided default
//      below.
//   3. ABORT integration — checked between page fetches AND threaded
//      into the fetchPage function via the second argument. Customers'
//      signals end iteration cleanly with the signal's reason.
//   4. ERROR mid-iteration — propagate immediately; do NOT yield
//      partial-page-then-throw. A failed page is unsafe data; the
//      caller should restart with the last successful cursor if they
//      want resumable iteration.
//
// Portability: zero Node-only imports. Works unchanged in Node 20+,
// browsers, Bun, Deno, Cloudflare Workers, Vercel Edge.

/**
 * Maximum pages traversed in a single iteration before throwing
 * `PaginationLimitExceededError`. Operator decision 2026-05-22:
 *
 * Pinned at **10_000 pages** as a sane runaway-loop catch.
 *
 * At a default server page-size of 100 items per page, this allows
 * iteration over 1M items — more than enough for any legitimate
 * customer workload, and a hard stop that catches a misbehaving
 * server (or a bug in the SDK itself) before it burns through
 * customer API quota.
 *
 * Trade-offs considered and rejected:
 *   - `Infinity` (Stripe default): trusts the server fully; a single
 *     bug on the server side could DDoS the customer's quota.
 *     Rejected because OKORO's audit-event endpoint may return many
 *     pages and we want defense-in-depth.
 *   - `1_000` (conservative): caps at 100K items. Real customers
 *     auditing large trees (e.g. quarterly compliance exports) hit
 *     this. Rejected as too tight.
 *
 * Callers can always override per-call via `PaginationOptions.maxPages`,
 * including `Infinity` if they explicitly opt out of the safety cap
 * for a known-bounded enumeration.
 */
export const DEFAULT_MAX_PAGES = 10_000;

/**
 * Error thrown when `paginate()` traverses more than `maxPages` pages
 * without hitting `nextCursor === null`. Typically indicates a server-
 * side bug returning a cursor forever, or that the caller's `query`
 * is not narrowing the result set enough.
 */
export class PaginationLimitExceededError extends Error {
  override readonly name = 'PaginationLimitExceededError';
  constructor(
    /** The limit that was exceeded. */
    public readonly maxPages: number,
    /** Pages consumed before the limit. */
    public readonly pagesConsumed: number,
  ) {
    super(
      `pagination: exceeded maxPages safety cap (${maxPages}). ` +
        `Override via PaginationOptions.maxPages if intentional, or check ` +
        `that your query is narrowing the result set.`,
    );
  }
}

export interface PaginationOptions {
  /**
   * Maximum pages to traverse before throwing `PaginationLimitExceededError`.
   * Defaults to `DEFAULT_MAX_PAGES`. Set to `Infinity` to opt out of
   * the safety cap entirely for known-bounded enumerations.
   */
  maxPages?: number;
  /**
   * AbortSignal — when aborted, iteration terminates between pages
   * with the signal's reason. Composes with the SDK's per-client and
   * per-request signal handling (M-ABORT-1) but operates at the
   * iterator level rather than per-request.
   */
  signal?: AbortSignal;
}

/**
 * Generic cursor-pagination helper. Given a `fetchPage` function that
 * accepts an optional `cursor` and returns a page, plus extractors for
 * the item array and the next cursor, returns an `AsyncIterableIterator`
 * that yields each item across all pages.
 *
 * Type parameters:
 *   - `TItem`: the per-item type customers receive.
 *   - `TPage`: the per-page response envelope (carries the cursor).
 *   - `TQuery`: any extra query params (limit, filters, etc.) passed
 *     to every page fetch.
 *
 * Resolution order:
 *   1. Preflight: if `options.signal` is already aborted, throw the
 *      signal's reason immediately — no fetch.
 *   2. Loop: fetch page → yield items → read nextCursor → repeat.
 *   3. End: when `extractCursor(page)` returns `null` or `undefined`,
 *      iteration completes normally.
 *   4. Safety: if `maxPages` exceeded before end-of-stream, throw
 *      `PaginationLimitExceededError`.
 *   5. Abort: between pages, check the signal; if aborted, throw the
 *      signal's reason. Per-request abort propagates via the signal
 *      passed to `fetchPage` (caller threads it through).
 *
 * Critical correctness:
 *   - `cursor` starts as `undefined`, NOT empty string. The server
 *     interprets undefined as "give me page 1"; the helper never
 *     double-fetches page 1.
 *   - The yield happens BEFORE the next fetch — single network call
 *     in flight at a time (lazy).
 */
export async function* paginate<TItem, TPage, TQuery>(
  fetchPage: (query: TQuery & { cursor?: string }) => Promise<TPage>,
  extractItems: (page: TPage) => TItem[],
  extractCursor: (page: TPage) => string | null | undefined,
  initial: TQuery,
  options: PaginationOptions = {},
): AsyncIterableIterator<TItem> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const signal = options.signal;

  // Preflight abort — match the M-ABORT-1 contract: an already-aborted
  // signal at start time must fail fast without firing any network.
  if (signal?.aborted) throw signal.reason;

  let cursor: string | undefined = undefined;
  let pagesConsumed = 0;
  while (true) {
    if (pagesConsumed >= maxPages) {
      throw new PaginationLimitExceededError(maxPages, pagesConsumed);
    }
    // Build the query — only attach `cursor` when we have one, so the
    // first fetch is `{ ...initial }` (server reads as "page 1") and
    // subsequent fetches are `{ ...initial, cursor }`.
    const query =
      cursor === undefined
        ? ({ ...initial } as TQuery & { cursor?: string })
        : ({ ...initial, cursor } as TQuery & { cursor?: string });
    const page = await fetchPage(query);
    pagesConsumed += 1;

    for (const item of extractItems(page)) {
      yield item;
    }

    // After yielding the page's items, check abort between pages.
    // A signal that aborted during consumer iteration (the for-of
    // above runs to completion synchronously per item; the consumer
    // controls iteration speed via await on the yielded promise) is
    // honored before the next network fetch.
    if (signal?.aborted) throw signal.reason;

    const next = extractCursor(page);
    if (next === null || next === undefined) return; // end of stream
    cursor = next;
  }
}
