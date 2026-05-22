// Tests for AbortSignal threading through HttpClient + withRetry.
//
// What this spec guards:
//   1. Preflight: an already-aborted signal at request time fails fast
//      WITHOUT invoking fetch. Caller arrived with intent to abort —
//      SDK must not burn a request before honoring it.
//   2. Mid-request abort: a signal that fires while fetch is in-flight
//      propagates the signal's `reason` verbatim to the caller (matches
//      native fetch convention).
//   3. Timeout vs external abort disambiguation: an internal timeout
//      throws AegisNetworkError (preserves the existing customer
//      contract); an external signal throws the caller's reason.
//   4. Multi-signal combination: caller's `opts.signal` AND the
//      config-level `configSignal` are both honored — whichever
//      aborts first wins.
//   5. Listener cleanup: a long-lived caller signal (used across many
//      requests, never aborted) doesn't accumulate listeners. We
//      assert this by measuring `signal.eventListeners` after the
//      request completes.
//   6. withRetry signal-aware sleep: an abort during backoff sleep
//      throws the signal's reason immediately, terminating the retry
//      loop. The SDK does NOT finish the sleep or attempt one more
//      request after signal fires.

import { HttpClient, withRetry } from './http.js';
import {
  AegisNetworkError,
  AegisServiceUnavailableError,
} from './errors.js';

function buildClient(opts: {
  fetch: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): HttpClient {
  return new HttpClient({
    apiKey: 'aegis_sk_test',
    verifyKey: undefined,
    baseUrl: 'https://api.test.local',
    timeoutMs: opts.timeoutMs ?? 5_000,
    fetch: opts.fetch,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

const OK_BODY = (): Response =>
  new Response('{"ok":true}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Stub fetch that mimics native fetch's abort behavior:
 *   - If signal is already aborted at call time → reject(signal.reason)
 *   - If signal aborts during the request → reject(signal.reason)
 *   - Otherwise → never resolve (request hangs until timeout/abort)
 *
 * Real fetch rejects with the signal's REASON, not a hardcoded
 * AbortError. Earlier versions of this stub didn't match — those
 * versions made disambiguation tests fail because the stub threw a
 * different value than what the SDK propagates.
 */
function abortAwareNeverResolveFetch(): typeof fetch {
  return (_url, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (signal !== undefined) {
        signal.addEventListener(
          'abort',
          () => reject(signal.reason),
          { once: true },
        );
      }
    });
}

describe('HttpClient — preflight abort', () => {
  it('throws the signal reason immediately when opts.signal is already aborted', async () => {
    const ctrl = new AbortController();
    const reason = new DOMException('caller aborted preflight', 'AbortError');
    ctrl.abort(reason);
    const client = buildClient({ fetch: abortAwareNeverResolveFetch() });
    await expect(
      client.request('/agents', { method: 'GET', signal: ctrl.signal }),
    ).rejects.toBe(reason);
  });

  it('throws the signal reason when configSignal is already aborted', async () => {
    const ctrl = new AbortController();
    const reason = new DOMException('config aborted', 'AbortError');
    ctrl.abort(reason);
    const client = buildClient({
      fetch: abortAwareNeverResolveFetch(),
      signal: ctrl.signal,
    });
    await expect(client.request('/agents', { method: 'GET' })).rejects.toBe(reason);
  });
});

describe('HttpClient — mid-request abort', () => {
  it('propagates the signal reason when caller aborts during fetch', async () => {
    const ctrl = new AbortController();
    const reason = new DOMException('caller mid-request', 'AbortError');
    const client = buildClient({ fetch: abortAwareNeverResolveFetch() });
    const pending = client.request('/agents', { method: 'GET', signal: ctrl.signal });
    await Promise.resolve();
    ctrl.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe('HttpClient — timeout vs external abort disambiguation', () => {
  it('throws AegisNetworkError on internal timeout (preserves existing contract)', async () => {
    const client = buildClient({
      fetch: abortAwareNeverResolveFetch(),
      timeoutMs: 20,
    });
    await expect(
      client.request('/agents', { method: 'GET' }),
    ).rejects.toBeInstanceOf(AegisNetworkError);
  });

  it('throws caller reason on external abort (NOT AegisNetworkError)', async () => {
    const ctrl = new AbortController();
    const customReason = new Error('domain-specific abort');
    const client = buildClient({ fetch: abortAwareNeverResolveFetch() });
    const pending = client.request('/agents', { method: 'GET', signal: ctrl.signal });
    await Promise.resolve();
    ctrl.abort(customReason);
    await expect(pending).rejects.toBe(customReason);
  });
});

describe('HttpClient — multi-signal combination (any-wins)', () => {
  it('caller signal wins when it aborts first', async () => {
    const callerCtrl = new AbortController();
    const configCtrl = new AbortController();
    const client = buildClient({
      fetch: abortAwareNeverResolveFetch(),
      signal: configCtrl.signal,
    });
    const pending = client.request('/agents', { method: 'GET', signal: callerCtrl.signal });
    await Promise.resolve();
    const reason = new Error('caller-first');
    callerCtrl.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('config signal wins when it aborts first', async () => {
    const callerCtrl = new AbortController();
    const configCtrl = new AbortController();
    const client = buildClient({
      fetch: abortAwareNeverResolveFetch(),
      signal: configCtrl.signal,
    });
    const pending = client.request('/agents', { method: 'GET', signal: callerCtrl.signal });
    await Promise.resolve();
    const reason = new Error('config-first');
    configCtrl.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe('HttpClient — listener cleanup on success', () => {
  // The contract: a long-lived caller signal (shared across many
  // requests, never aborts) should not accumulate listeners. We
  // verify by counting via the events API on a custom AbortController.
  it('removes the abort listener from caller signal after successful request', async () => {
    const stubFetch: typeof fetch = async () => OK_BODY();
    const ctrl = new AbortController();
    const sig = ctrl.signal;
    // Spy on add/removeEventListener — the count balance should be zero.
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const realAdd = sig.addEventListener.bind(sig);
    const realRemove = sig.removeEventListener.bind(sig);
    sig.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (type === 'abort') added.push(listener);
      // @ts-expect-error — preserving the real impl signature
      return realAdd(type, listener, options);
    }) as typeof sig.addEventListener;
    sig.removeEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (type === 'abort') removed.push(listener);
      // @ts-expect-error — preserving the real impl signature
      return realRemove(type, listener, options);
    }) as typeof sig.removeEventListener;

    const client = buildClient({ fetch: stubFetch });
    await client.request('/agents', { method: 'GET', signal: sig });
    // Every listener we added on the caller signal must be removed.
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBe(added.length);
  });

  it('removes the abort listener even when the request throws', async () => {
    const stubFetch: typeof fetch = async () =>
      new Response('boom', { status: 500 });
    const ctrl = new AbortController();
    const sig = ctrl.signal;
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const realAdd = sig.addEventListener.bind(sig);
    const realRemove = sig.removeEventListener.bind(sig);
    sig.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (type === 'abort') added.push(listener);
      // @ts-expect-error
      return realAdd(type, listener, options);
    }) as typeof sig.addEventListener;
    sig.removeEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (type === 'abort') removed.push(listener);
      // @ts-expect-error
      return realRemove(type, listener, options);
    }) as typeof sig.removeEventListener;

    const client = buildClient({ fetch: stubFetch });
    await client
      .request('/agents', { method: 'GET', signal: sig })
      .catch(() => undefined);
    expect(removed.length).toBe(added.length);
  });
});

describe('withRetry — signal-aware sleep', () => {
  it('aborts immediately when signal is pre-aborted (preflight)', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      throw new AegisServiceUnavailableError('try later', 503, undefined);
    };
    const ctrl = new AbortController();
    const reason = new Error('preflight');
    ctrl.abort(reason);
    await expect(withRetry(fn, { signal: ctrl.signal })).rejects.toBe(reason);
    expect(calls).toBe(0); // fn never invoked
  });

  it('aborts mid-sleep with the signal reason (does not finish sleep or retry)', async () => {
    let attempts = 0;
    const fn = async (): Promise<string> => {
      attempts += 1;
      throw new AegisServiceUnavailableError('try later', 503, undefined);
    };
    const ctrl = new AbortController();
    const reason = new Error('mid-sleep abort');

    // Fire abort during the first backoff sleep.
    const pending = withRetry(fn, {
      maxAttempts: 5,
      signal: ctrl.signal,
      sleep: (ms: number, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason);
          });
        }),
    });

    // Let the first attempt fail and enter the sleep.
    await Promise.resolve();
    await Promise.resolve();
    ctrl.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(attempts).toBe(1); // first attempt only; no second attempt after abort
  });

  it('still retries normally when signal never fires', async () => {
    let attempts = 0;
    const fn = async (): Promise<string> => {
      attempts += 1;
      if (attempts < 3) {
        throw new AegisServiceUnavailableError('try later', 503, undefined);
      }
      return 'ok';
    };
    const ctrl = new AbortController();
    const result = await withRetry(fn, {
      maxAttempts: 5,
      signal: ctrl.signal,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 1))),
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });
});
