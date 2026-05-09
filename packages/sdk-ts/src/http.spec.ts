// Tests for the catalog-driven retry wrapper. Uses the SDK's existing
// jest test runner (see jest.config.ts).

import {
  AegisAuthenticationError,
  AegisAuthorizationError,
  AegisConflictError,
  AegisInternalError,
  AegisNetworkError,
  AegisNotFoundError,
  AegisRateLimitedError,
  AegisServiceUnavailableError,
  AegisValidationError,
} from './errors.js';
import {
  HttpClient,
  nextDelayMs,
  parseRetryAfter,
  withRetry,
  type RetryOptions,
} from './http.js';

const NEVER_SLEEP: RetryOptions['sleep'] = async () => undefined;

describe('AegisError.catalogKey (F-06 minification safety)', () => {
  // tsup minifies the SDK on production builds. Without a static catalogKey
  // discriminator, `new.target.name` collapses to "a"/"b"/... and
  // `err.name` becomes useless to consumers. These assertions are the
  // build-pipeline guard.
  const cases: Array<[new (...args: never[]) => unknown, string]> = [
    [AegisAuthenticationError, 'AegisAuthenticationError'],
    [AegisAuthorizationError, 'AegisAuthorizationError'],
    [AegisNotFoundError, 'AegisNotFoundError'],
    [AegisValidationError, 'AegisValidationError'],
    [AegisConflictError, 'AegisConflictError'],
    [AegisRateLimitedError, 'AegisRateLimitedError'],
    [AegisInternalError, 'AegisInternalError'],
    [AegisServiceUnavailableError, 'AegisServiceUnavailableError'],
    [AegisNetworkError, 'AegisNetworkError'],
  ];

  test.each(cases)('%p declares catalogKey matching its un-minified name', (cls, expected) => {
    expect((cls as unknown as { catalogKey: string }).catalogKey).toBe(expected);
  });

  test('instance.name reflects catalogKey, not the (mangled) constructor.name', () => {
    const err = new AegisAuthenticationError('x', 401, 'r1', undefined);
    Object.defineProperty(err.constructor, 'name', { value: 'a' });
    // err.name was set from the static catalogKey at construction time.
    expect(err.name).toBe('AegisAuthenticationError');
    // And the static survives mangling on the constructor reference itself.
    expect((err.constructor as unknown as { catalogKey: string }).catalogKey).toBe('AegisAuthenticationError');
  });
});

describe('parseRetryAfter', () => {
  test('parses integer seconds', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('0')).toBe(0);
  });

  test('parses HTTP date as a non-negative second delta', () => {
    const future = new Date(Date.now() + 3_500).toUTCString();
    const result = parseRetryAfter(future);
    expect(result).toBeDefined();
    expect(result).toBeGreaterThanOrEqual(3);
    expect(result).toBeLessThanOrEqual(4);
  });

  test('past dates clamp to 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  test('returns undefined for null/empty/garbage', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('   ')).toBeUndefined();
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
  });
});

describe('nextDelayMs (catalog-driven backoff)', () => {
  const mkEntry = (backoff: 'none' | 'linear' | 'exponential' | 'on_retry_after_header' | undefined) => ({
    className: 'Whatever',
    code: 'whatever',
    httpStatus: 500,
    retryable: true,
    backoff,
    customerMessage: 'x',
    category: 'transient' as const,
  });

  test('none/undefined backoff returns null', () => {
    expect(nextDelayMs({ attempt: 1, entry: mkEntry('none'), retryAfterSeconds: undefined, isNetwork: false })).toBeNull();
    expect(nextDelayMs({ attempt: 1, entry: mkEntry(undefined), retryAfterSeconds: undefined, isNetwork: false })).toBeNull();
  });

  test('linear schedule is 100/200/400', () => {
    expect(nextDelayMs({ attempt: 1, entry: mkEntry('linear'), retryAfterSeconds: undefined, isNetwork: false })).toBe(100);
    expect(nextDelayMs({ attempt: 2, entry: mkEntry('linear'), retryAfterSeconds: undefined, isNetwork: false })).toBe(200);
    expect(nextDelayMs({ attempt: 3, entry: mkEntry('linear'), retryAfterSeconds: undefined, isNetwork: false })).toBe(400);
    expect(nextDelayMs({ attempt: 99, entry: mkEntry('linear'), retryAfterSeconds: undefined, isNetwork: false })).toBe(400);
  });

  test('exponential schedule is 100/400/1600 with ±10% jitter', () => {
    for (const attempt of [1, 2, 3]) {
      const target = [100, 400, 1600][attempt - 1] ?? 0;
      const delay = nextDelayMs({ attempt, entry: mkEntry('exponential'), retryAfterSeconds: undefined, isNetwork: false });
      expect(delay).not.toBeNull();
      expect(delay!).toBeGreaterThanOrEqual(Math.floor(target * 0.9));
      expect(delay!).toBeLessThanOrEqual(Math.ceil(target * 1.1));
    }
  });

  test('on_retry_after_header honors header in seconds and caps at 60s', () => {
    expect(nextDelayMs({ attempt: 1, entry: mkEntry('on_retry_after_header'), retryAfterSeconds: 5, isNetwork: false })).toBe(5_000);
    expect(nextDelayMs({ attempt: 1, entry: mkEntry('on_retry_after_header'), retryAfterSeconds: 999, isNetwork: false })).toBe(60_000);
    expect(nextDelayMs({ attempt: 1, entry: mkEntry('on_retry_after_header'), retryAfterSeconds: 0, isNetwork: false })).toBe(0);
  });

  test('on_retry_after_header without header falls back to linear schedule', () => {
    expect(nextDelayMs({ attempt: 1, entry: mkEntry('on_retry_after_header'), retryAfterSeconds: undefined, isNetwork: false })).toBe(100);
  });

  test('network errors take exponential schedule even without a catalog entry', () => {
    const delay = nextDelayMs({ attempt: 1, entry: undefined, retryAfterSeconds: undefined, isNetwork: true });
    expect(delay).not.toBeNull();
    expect(delay!).toBeGreaterThanOrEqual(90);
    expect(delay!).toBeLessThanOrEqual(110);
  });

  test('non-network with no catalog entry returns null', () => {
    expect(nextDelayMs({ attempt: 1, entry: undefined, retryAfterSeconds: undefined, isNetwork: false })).toBeNull();
  });
});

describe('withRetry (public API)', () => {
  test('returns the result on first success without sleeping', async () => {
    const fn = jest.fn(async () => 'ok');
    const sleep = jest.fn(async () => undefined);
    const result = await withRetry(fn, { sleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test('does not retry non-retryable AegisErrors', async () => {
    const err = new AegisAuthorizationError('nope', 403, 'r1', undefined);
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, { sleep: NEVER_SLEEP })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries retryable errors up to maxAttempts then throws', async () => {
    const fn = jest.fn(async () => {
      throw new AegisInternalError('boom', 500, 'r1', undefined);
    });
    const sleep = jest.fn(async () => undefined);
    const onRetry = jest.fn();
    await expect(
      withRetry(fn, { maxAttempts: 3, sleep, onRetry }),
    ).rejects.toBeInstanceOf(AegisInternalError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  test('succeeds after retry when underlying fn recovers', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 2) throw new AegisInternalError('flap', 500, 'r1', undefined);
      return 42;
    };
    const result = await withRetry(fn, { sleep: NEVER_SLEEP });
    expect(result).toBe(42);
    expect(calls).toBe(2);
  });

  test('honors Retry-After for rate-limited errors', async () => {
    const sleeps: number[] = [];
    const sleep: RetryOptions['sleep'] = async (ms) => {
      sleeps.push(ms);
    };
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      if (calls < 2) throw new AegisRateLimitedError('slow', 429, 'r1', undefined);
      return 'done';
    };
    const result = await withRetry(fn, {
      sleep,
      getRetryAfter: () => 2,
    });
    expect(result).toBe('done');
    expect(sleeps).toEqual([2_000]);
  });

  test('non-AegisErrors are not retried', async () => {
    const err = new RangeError('not ours');
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, { sleep: NEVER_SLEEP })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries network errors with exponential schedule', async () => {
    let calls = 0;
    const fn = async (): Promise<number> => {
      calls += 1;
      if (calls < 3) throw new AegisNetworkError('net');
      return 7;
    };
    const sleep = jest.fn(async () => undefined);
    const result = await withRetry(fn, { sleep });
    expect(result).toBe(7);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test('skips retry when maxAttempts is 1', async () => {
    const err = new AegisInternalError('once', 500, 'r1', undefined);
    const fn = jest.fn(async () => {
      throw err;
    });
    await expect(withRetry(fn, { maxAttempts: 1, sleep: NEVER_SLEEP })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('HttpClient.requestWithRetry', () => {
  function mkClient(handlers: Array<() => Response>): HttpClient {
    let i = 0;
    const fetchFn: typeof globalThis.fetch = async () => {
      const handler = handlers[Math.min(i, handlers.length - 1)];
      i += 1;
      if (!handler) throw new Error('handler missing');
      return handler();
    };
    return new HttpClient({
      apiKey: 'sk_test',
      baseUrl: 'https://api.aegislabs.io',
      timeoutMs: 1_000,
      fetch: fetchFn,
    });
  }

  test('passes through on first success — no retries', async () => {
    const client = mkClient([
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ]);
    const result = await client.requestWithRetry<{ ok: boolean }>('/agents', { method: 'GET' }, { sleep: NEVER_SLEEP });
    expect(result.ok).toBe(true);
  });

  test('retries on 500 and surfaces final AegisInternalError', async () => {
    const client = mkClient([
      () =>
        new Response(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    ]);
    await expect(
      client.requestWithRetry('/agents', { method: 'GET' }, { maxAttempts: 2, sleep: NEVER_SLEEP }),
    ).rejects.toBeInstanceOf(AegisInternalError);
  });

  test('does not retry 400 ValidationError', async () => {
    let calls = 0;
    const client = mkClient([
      () => {
        calls += 1;
        return new Response(JSON.stringify({ message: 'bad input', code: 'invalid_request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      },
    ]);
    await expect(
      client.requestWithRetry('/agents', { method: 'GET' }, { maxAttempts: 5, sleep: NEVER_SLEEP }),
    ).rejects.toBeInstanceOf(AegisValidationError);
    expect(calls).toBe(1);
  });
});
