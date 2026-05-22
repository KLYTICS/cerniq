// Tests for the generic paginate() async-iterable helper.
//
// What this spec guards:
//   1. Single-page (no nextCursor) — yields items, ends cleanly,
//      ONE network call only (no double-fetch of page 1).
//   2. Multi-page — yields all items across pages in order, threads
//      the cursor correctly, terminates on null nextCursor.
//   3. Empty stream — yields zero items, one fetch.
//   4. Safety cap — throws PaginationLimitExceededError when maxPages
//      exceeded without end-of-stream.
//   5. Error mid-iteration — fetchPage rejection propagates immediately;
//      no swallowing, no partial-page-then-throw.
//   6. Preflight abort — signal already aborted at start throws reason
//      with ZERO fetch calls.
//   7. Abort between pages — signal fires after page N consumed; next
//      fetch does NOT happen, iteration throws reason.
//   8. Cursor threading — initial query passed through; only cursor
//      added on subsequent calls.

import {
  DEFAULT_MAX_PAGES,
  PaginationLimitExceededError,
  paginate,
} from './pagination.js';

interface FakePage<T> {
  items: T[];
  nextCursor: string | null;
}

function buildFetcher<T>(
  pages: FakePage<T>[],
): { fetcher: (q: { cursor?: string }) => Promise<FakePage<T>>; calls: Array<{ cursor?: string }> } {
  const calls: Array<{ cursor?: string }> = [];
  let i = 0;
  const fetcher = async (q: { cursor?: string }): Promise<FakePage<T>> => {
    calls.push({ ...q });
    if (i >= pages.length) throw new Error(`fetcher called more than ${pages.length} times`);
    return pages[i++]!;
  };
  return { fetcher, calls };
}

const extractItems = <T>(p: FakePage<T>): T[] => p.items;
const extractCursor = <T>(p: FakePage<T>): string | null => p.nextCursor;

async function collect<T>(iter: AsyncIterableIterator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('paginate — single page', () => {
  it('yields items from one page and ends without a second fetch', async () => {
    const { fetcher, calls } = buildFetcher([
      { items: ['a', 'b', 'c'], nextCursor: null },
    ]);
    const items = await collect(paginate(fetcher, extractItems, extractCursor, {}));
    expect(items).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(1);
    // Critical: first call MUST NOT carry a cursor (server reads
    // undefined as "page 1").
    expect(calls[0]).not.toHaveProperty('cursor');
  });

  it('yields zero items on an empty page', async () => {
    const { fetcher, calls } = buildFetcher<string>([{ items: [], nextCursor: null }]);
    const items = await collect(paginate(fetcher, extractItems, extractCursor, {}));
    expect(items).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('treats nextCursor: undefined as end-of-stream', async () => {
    // Per the helper's contract — extractCursor returning null OR
    // undefined ends the loop. Defensive against API variants.
    const { fetcher } = buildFetcher<string>([
      { items: ['x'], nextCursor: undefined as unknown as null },
    ]);
    const items = await collect(paginate(fetcher, extractItems, extractCursor, {}));
    expect(items).toEqual(['x']);
  });
});

describe('paginate — multi-page', () => {
  it('threads cursor across pages and yields items in order', async () => {
    const { fetcher, calls } = buildFetcher([
      { items: ['1', '2'], nextCursor: 'cur_p2' },
      { items: ['3', '4'], nextCursor: 'cur_p3' },
      { items: ['5'], nextCursor: null },
    ]);
    const items = await collect(paginate(fetcher, extractItems, extractCursor, {}));
    expect(items).toEqual(['1', '2', '3', '4', '5']);
    expect(calls).toEqual([
      {},
      { cursor: 'cur_p2' },
      { cursor: 'cur_p3' },
    ]);
  });

  it('preserves initial query params on every call', async () => {
    const { fetcher, calls } = buildFetcher([
      { items: ['a'], nextCursor: 'p2' },
      { items: ['b'], nextCursor: null },
    ]);
    const items = await collect(
      paginate(fetcher, extractItems, extractCursor, { limit: 50, status: 'ACTIVE' }),
    );
    expect(items).toEqual(['a', 'b']);
    expect(calls[0]).toEqual({ limit: 50, status: 'ACTIVE' });
    expect(calls[1]).toEqual({ limit: 50, status: 'ACTIVE', cursor: 'p2' });
  });
});

describe('paginate — safety cap', () => {
  it('throws PaginationLimitExceededError when maxPages exceeded', async () => {
    // Server that returns a cursor forever — bug we want to catch.
    let i = 0;
    const fetcher = async (): Promise<FakePage<number>> => {
      i += 1;
      return { items: [i], nextCursor: `cur_${i}` };
    };
    const iter = paginate(fetcher, extractItems, extractCursor, {}, { maxPages: 3 });
    const collected: number[] = [];
    let caught: unknown;
    try {
      for await (const item of iter) collected.push(item);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PaginationLimitExceededError);
    expect((caught as PaginationLimitExceededError).maxPages).toBe(3);
    expect(collected).toEqual([1, 2, 3]); // 3 pages of items yielded before throw
  });

  it('honors Infinity to opt out of the safety cap', async () => {
    // We exercise this by setting maxPages = Infinity and verifying
    // the loop does not throw at a low pages-consumed count.
    let i = 0;
    const fetcher = async (): Promise<FakePage<number>> => {
      i += 1;
      return { items: [i], nextCursor: i < 100 ? `cur_${i}` : null };
    };
    const iter = paginate(
      fetcher,
      extractItems,
      extractCursor,
      {},
      { maxPages: Infinity },
    );
    const items = await collect(iter);
    expect(items.length).toBe(100);
  });

  it('default cap is DEFAULT_MAX_PAGES (10_000)', () => {
    expect(DEFAULT_MAX_PAGES).toBe(10_000);
  });
});

describe('paginate — error mid-iteration', () => {
  it('propagates fetchPage errors immediately (no swallow)', async () => {
    const boom = new Error('boom on page 2');
    const fetcher = async (q: { cursor?: string }): Promise<FakePage<string>> => {
      if (q.cursor === 'p2') throw boom;
      return { items: ['a'], nextCursor: 'p2' };
    };
    const iter = paginate(fetcher, extractItems, extractCursor, {});
    const collected: string[] = [];
    await expect(
      (async () => {
        for await (const item of iter) collected.push(item);
      })(),
    ).rejects.toBe(boom);
    // Items from successful pages ARE yielded before the throw.
    expect(collected).toEqual(['a']);
  });
});

describe('paginate — abort integration (composes with M-ABORT-1)', () => {
  it('throws signal reason on preflight (signal already aborted)', async () => {
    const { fetcher, calls } = buildFetcher([{ items: ['a'], nextCursor: null }]);
    const ctrl = new AbortController();
    const reason = new Error('preflight abort');
    ctrl.abort(reason);
    const iter = paginate(
      fetcher,
      extractItems,
      extractCursor,
      {},
      { signal: ctrl.signal },
    );
    await expect(collect(iter)).rejects.toBe(reason);
    expect(calls).toHaveLength(0); // no fetch at all
  });

  it('aborts between pages — signal fires after page 1 consumed', async () => {
    const ctrl = new AbortController();
    const reason = new Error('between-pages abort');
    const { fetcher } = buildFetcher([
      { items: ['a', 'b'], nextCursor: 'p2' },
      { items: ['c'], nextCursor: null }, // should NEVER be fetched
    ]);
    const iter = paginate(
      fetcher,
      extractItems,
      extractCursor,
      {},
      { signal: ctrl.signal },
    );
    const collected: string[] = [];
    let caught: unknown;
    try {
      for await (const item of iter) {
        collected.push(item);
        // Abort after consuming the last item of page 1.
        if (item === 'b') ctrl.abort(reason);
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(reason);
    expect(collected).toEqual(['a', 'b']); // page 1 fully consumed
  });

  it('does not fetch the next page after abort during yield', async () => {
    const ctrl = new AbortController();
    const reason = new Error('mid-iter abort');
    let p2Fetched = false;
    const fetcher = async (q: { cursor?: string }): Promise<FakePage<string>> => {
      if (q.cursor === 'p2') {
        p2Fetched = true;
        return { items: ['c'], nextCursor: null };
      }
      return { items: ['a', 'b'], nextCursor: 'p2' };
    };
    const iter = paginate(
      fetcher,
      extractItems,
      extractCursor,
      {},
      { signal: ctrl.signal },
    );
    try {
      for await (const item of iter) {
        if (item === 'a') ctrl.abort(reason);
      }
    } catch {
      // expected
    }
    expect(p2Fetched).toBe(false); // proves next-page fetch was skipped
  });
});

describe('paginate — type ergonomics', () => {
  // Spec-quality assertion: when paginate is parameterized correctly,
  // the iterator's item type IS narrowed to the extractor's return.
  // tsc will fail if this contract regresses; the runtime check below
  // is a belt-and-braces lock.
  it('yields items whose type matches extractItems return', async () => {
    interface UserRecord {
      id: string;
      name: string;
    }
    const fetcher = async (): Promise<FakePage<UserRecord>> => ({
      items: [{ id: 'u1', name: 'alice' }],
      nextCursor: null,
    });
    const items = await collect(paginate(fetcher, extractItems, extractCursor, {}));
    expect(items[0]?.id).toBe('u1');
    expect(items[0]?.name).toBe('alice');
  });
});
