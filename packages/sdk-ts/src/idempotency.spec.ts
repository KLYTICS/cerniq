// Tests for the SDK idempotency surface. Three layers:
//   1. `generateIdempotencyKey()` — wire shape + uniqueness.
//   2. `resolveIdempotencyKey()` — auto-attach policy semantics.
//   3. `parseReplayHeaders()` — response-side metadata parsing.
//
// The auto-attach policy table (`AUTO_IDEMPOTENT_METHODS`) is owned
// by the operator — see TODO block in `idempotency.ts`. These tests
// pin the pinned rows (intent.reconcile) and the structural shape
// (every value is a valid AutoAttachMode), without locking the
// operator's call-site decisions.

import { HttpClient } from './http';
import {
  AUTO_IDEMPOTENT_METHODS,
  FIRST_SEEN_HEADER,
  IDEMPOTENCY_HEADER,
  REPLAY_HEADER,
  generateIdempotencyKey,
  parseReplayHeaders,
  resolveIdempotencyKey,
  type WriteResponseInfo,
} from './idempotency';

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateIdempotencyKey', () => {
  it('produces a 36-char RFC-4122 v4 UUID', () => {
    const key = generateIdempotencyKey();
    expect(key).toHaveLength(36);
    expect(key).toMatch(UUID_V4_RE);
  });

  it('produces unique keys across 1000 calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) seen.add(generateIdempotencyKey());
    expect(seen.size).toBe(1000);
  });

  it('falls back to manual v4 when randomUUID is missing', () => {
    // Save + temporarily strip randomUUID so the manual path runs.
    // type-rationale: the lib type for Crypto.randomUUID is required;
    // cast to Record to delete/restore without fighting the template
    // literal return type.
    const cryptoAny = globalThis.crypto as unknown as Record<string, unknown>;
    const original = cryptoAny.randomUUID;
    delete cryptoAny.randomUUID;
    try {
      const key = generateIdempotencyKey();
      expect(key).toMatch(UUID_V4_RE);
    } finally {
      if (original !== undefined) cryptoAny.randomUUID = original;
    }
  });
});

describe('resolveIdempotencyKey', () => {
  it('returns undefined when no opts and policy is opt-in', () => {
    // intent.reconcile is pinned to 'opt-in' — see idempotency.ts.
    expect(resolveIdempotencyKey('intent.reconcile')).toBeUndefined();
  });

  it('returns the caller-supplied key verbatim when present', () => {
    expect(resolveIdempotencyKey('agents.register', { key: 'my-key-123' })).toBe(
      'my-key-123',
    );
  });

  it('mints a fresh v4 when { auto: true } is passed', () => {
    const key = resolveIdempotencyKey('agents.register', { auto: true });
    expect(key).toMatch(UUID_V4_RE);
  });

  it('mints a fresh v4 when policy is auto and no opts', () => {
    // We can't test this without overriding the table, so we install
    // a synthetic call site to exercise the 'auto' branch end-to-end.
    const SENTINEL = '__test.auto_attach__';
    AUTO_IDEMPOTENT_METHODS[SENTINEL] = 'auto';
    try {
      const key = resolveIdempotencyKey(SENTINEL);
      expect(key).toMatch(UUID_V4_RE);
    } finally {
      delete AUTO_IDEMPOTENT_METHODS[SENTINEL];
    }
  });

  it('returns undefined when policy is forbidden, even with explicit key', () => {
    const SENTINEL = '__test.forbidden__';
    AUTO_IDEMPOTENT_METHODS[SENTINEL] = 'forbidden';
    try {
      expect(resolveIdempotencyKey(SENTINEL, { key: 'caller-tried' })).toBeUndefined();
      expect(resolveIdempotencyKey(SENTINEL, { auto: true })).toBeUndefined();
    } finally {
      delete AUTO_IDEMPOTENT_METHODS[SENTINEL];
    }
  });

  it('returns undefined for an unknown call site with no opts', () => {
    expect(resolveIdempotencyKey('this.does.not.exist')).toBeUndefined();
  });
});

describe('AUTO_IDEMPOTENT_METHODS — operator-decided values (2026-05-22)', () => {
  // These values were chosen by operator decision after the policy
  // table scaffold landed (M-IDEM-1). Each row is part of the SDK's
  // customer-observable contract — flipping a row changes whether
  // customers' calls get auto-protected retries.
  //
  // Changing a value below requires:
  //   1. Update the rationale block in idempotency.ts
  //   2. Add a SDK CHANGELOG entry
  //   3. Notify customers via release notes
  //
  // The test names below state the customer-visible behavior, not
  // the internal mode, so a maintainer reading test output understands
  // what each row buys.

  it('agents.register auto-mints a key (write that creates persistent identity)', () => {
    expect(AUTO_IDEMPOTENT_METHODS['agents.register']).toBe('auto');
  });
  it('agents.revoke does NOT auto-mint (DELETE is server-side idempotent)', () => {
    expect(AUTO_IDEMPOTENT_METHODS['agents.revoke']).toBe('opt-in');
  });
  it('agents.report auto-mints a key (fraud signal double-submit cost)', () => {
    expect(AUTO_IDEMPOTENT_METHODS['agents.report']).toBe('auto');
  });
  it('agents.challenge refuses any key — replay returns a stale nonce', () => {
    expect(AUTO_IDEMPOTENT_METHODS['agents.challenge']).toBe('forbidden');
  });
  it('agents.verifyHandshake does NOT auto-mint (server-side replay defense covers it)', () => {
    expect(AUTO_IDEMPOTENT_METHODS['agents.verifyHandshake']).toBe('opt-in');
  });
  it('policies.create auto-mints a key (write that creates signed policy JWT)', () => {
    expect(AUTO_IDEMPOTENT_METHODS['policies.create']).toBe('auto');
  });
  it('policies.revoke does NOT auto-mint (DELETE is server-side idempotent)', () => {
    expect(AUTO_IDEMPOTENT_METHODS['policies.revoke']).toBe('opt-in');
  });
  it('intent.reconcile stays opt-in — ADR-0017 caller mints the key', () => {
    expect(AUTO_IDEMPOTENT_METHODS['intent.reconcile']).toBe('opt-in');
  });

  it('agents.register attaches a key automatically when caller omits options', () => {
    // End-to-end check that the 'auto' mode does what its name says
    // for the customer's most common call site.
    const key = resolveIdempotencyKey('agents.register');
    expect(key).toMatch(UUID_V4_RE);
  });

  it('agents.challenge refuses a key even when caller explicitly requests one', () => {
    // The 'forbidden' security guarantee — the SDK protects the
    // handshake flow from a key that would silently break it.
    expect(resolveIdempotencyKey('agents.challenge', { key: 'caller-asked' })).toBeUndefined();
    expect(resolveIdempotencyKey('agents.challenge', { auto: true })).toBeUndefined();
  });
});

describe('AUTO_IDEMPOTENT_METHODS table shape', () => {
  it('pins intent.reconcile to opt-in', () => {
    expect(AUTO_IDEMPOTENT_METHODS['intent.reconcile']).toBe('opt-in');
  });

  it('every entry is a valid AutoAttachMode', () => {
    const valid = new Set(['auto', 'opt-in', 'forbidden']);
    for (const [callSite, mode] of Object.entries(AUTO_IDEMPOTENT_METHODS)) {
      expect(valid).toContain(mode);
      expect(callSite).toMatch(/^[a-z]+\.[a-zA-Z]+$/); // namespace.method
    }
  });

  it('covers the known SDK write surface', () => {
    // If a new SDK write method ships, this assertion forces an
    // explicit operator decision in the table.
    const required = [
      'agents.register',
      'agents.revoke',
      'agents.report',
      'agents.challenge',
      'agents.verifyHandshake',
      'policies.create',
      'policies.revoke',
      'intent.reconcile',
    ];
    for (const callSite of required) {
      expect(AUTO_IDEMPOTENT_METHODS[callSite]).toBeDefined();
    }
  });
});

describe('parseReplayHeaders', () => {
  it('returns { replayed: false } on empty record', () => {
    expect(parseReplayHeaders({})).toEqual({ replayed: false });
  });

  it('returns { replayed: false } when replay header is missing', () => {
    expect(parseReplayHeaders({ 'content-type': 'application/json' })).toEqual({
      replayed: false,
    });
  });

  it('returns full metadata when both replay headers are present', () => {
    expect(
      parseReplayHeaders({
        [REPLAY_HEADER]: 'true',
        [FIRST_SEEN_HEADER]: '2026-05-22T12:34:56Z',
      }),
    ).toEqual({ replayed: true, firstSeenAt: '2026-05-22T12:34:56Z' });
  });

  it('is case-insensitive on header lookup', () => {
    expect(
      parseReplayHeaders({
        'idempotent-replay': 'true',
        'IDEMPOTENT-FIRST-SEEN': '2026-05-22T00:00:00Z',
      }),
    ).toEqual({ replayed: true, firstSeenAt: '2026-05-22T00:00:00Z' });
  });

  it('works with a Web API Headers object', () => {
    const h = new Headers();
    h.set(REPLAY_HEADER, 'true');
    h.set(FIRST_SEEN_HEADER, '2026-05-22T00:00:00Z');
    expect(parseReplayHeaders(h)).toEqual({
      replayed: true,
      firstSeenAt: '2026-05-22T00:00:00Z',
    });
  });

  it('returns { replayed: true } without firstSeenAt when only replay header is set', () => {
    expect(parseReplayHeaders({ [REPLAY_HEADER]: 'true' })).toEqual({ replayed: true });
  });

  it('treats non-true replay header value as not replayed', () => {
    expect(parseReplayHeaders({ [REPLAY_HEADER]: 'false' })).toEqual({ replayed: false });
    expect(parseReplayHeaders({ [REPLAY_HEADER]: '' })).toEqual({ replayed: false });
  });
});

describe('HttpClient onWriteResponse hook', () => {
  // Build a stub fetch that returns a successful JSON response with
  // operator-supplied response headers. Each test installs its own.
  function buildStubFetch(
    headers: Record<string, string>,
    status = 200,
  ): typeof fetch {
    return async () =>
      new Response(JSON.stringify({ ok: true }), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
  }

  function buildClient(
    stubFetch: typeof fetch,
    onWriteResponse: (info: WriteResponseInfo) => void,
  ): HttpClient {
    return new HttpClient({
      apiKey: 'aegis_sk_test',
      verifyKey: undefined,
      baseUrl: 'https://api.test.local',
      timeoutMs: 5000,
      fetch: stubFetch,
      onWriteResponse,
    });
  }

  it('fires the hook on a fresh write with replayed=false', async () => {
    const captured: WriteResponseInfo[] = [];
    const client = buildClient(buildStubFetch({}), (info) => captured.push(info));
    await client.request('/agents/register', {
      method: 'POST',
      body: { name: 'a' },
      idempotencyKey: 'k-1',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.replay).toEqual({ replayed: false });
    expect(captured[0]!.idempotencyKey).toBe('k-1');
    expect(captured[0]!.status).toBe(200);
    expect(captured[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('fires with replayed=true + firstSeenAt when API returns replay headers', async () => {
    const captured: WriteResponseInfo[] = [];
    const client = buildClient(
      buildStubFetch({
        [REPLAY_HEADER]: 'true',
        [FIRST_SEEN_HEADER]: '2026-05-22T10:00:00Z',
        'x-request-id': 'req-abc',
      }),
      (info) => captured.push(info),
    );
    await client.request('/agents/register', {
      method: 'POST',
      body: {},
      idempotencyKey: 'k-2',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.replay).toEqual({
      replayed: true,
      firstSeenAt: '2026-05-22T10:00:00Z',
    });
    expect(captured[0]!.requestId).toBe('req-abc');
  });

  it('does NOT fire the hook when the request has no idempotency key', async () => {
    const captured: WriteResponseInfo[] = [];
    const client = buildClient(buildStubFetch({}), (info) => captured.push(info));
    await client.request('/agents', { method: 'GET' });
    expect(captured).toHaveLength(0);
  });

  it('swallows hook errors — write succeeds even if subscriber throws', async () => {
    const client = buildClient(buildStubFetch({}), () => {
      throw new Error('subscriber blew up');
    });
    // Should resolve cleanly. If the hook error propagated, this would reject.
    const out = await client.request<{ ok: boolean }>('/agents/register', {
      method: 'POST',
      body: {},
      idempotencyKey: 'k-3',
    });
    expect(out).toEqual({ ok: true });
  });

  it('does not require onWriteResponse — omission is supported', async () => {
    const client = new HttpClient({
      apiKey: 'aegis_sk_test',
      verifyKey: undefined,
      baseUrl: 'https://api.test.local',
      timeoutMs: 5000,
      fetch: buildStubFetch({}),
    });
    await expect(
      client.request('/agents/register', {
        method: 'POST',
        body: {},
        idempotencyKey: 'k-4',
      }),
    ).resolves.toBeDefined();
  });
});

describe('header constants match the wire contract', () => {
  // These match `AEGIS_HEADER_IDEMPOTENCY` in `@aegis/types/src/constants.ts`
  // and the response headers set by `apps/api/src/common/idempotency/
  // idempotency.interceptor.ts:70-71`. Drift between SDK and API would
  // silently break every replay observability hook.
  it('IDEMPOTENCY_HEADER is Idempotency-Key', () => {
    expect(IDEMPOTENCY_HEADER).toBe('Idempotency-Key');
  });
  it('REPLAY_HEADER is Idempotent-Replay', () => {
    expect(REPLAY_HEADER).toBe('Idempotent-Replay');
  });
  it('FIRST_SEEN_HEADER is Idempotent-First-Seen', () => {
    expect(FIRST_SEEN_HEADER).toBe('Idempotent-First-Seen');
  });
});
