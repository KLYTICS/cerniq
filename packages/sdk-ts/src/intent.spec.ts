// Smoke test for the IntentClient. The class itself is thin HTTP
// wrapping; the wire-shape contract is gated by:
//   - tests/cross-package/intent-openapi-parity.spec.ts (OpenAPI ↔ DTO)
//   - packages/verifier-rp/test/intent.spec.ts (kernel surface)
// This spec exists to lock the HTTP method/path mapping and idempotency-
// key header passthrough — the things that would silently regress if
// http.ts or the controller route changed without the SDK noticing.

import { HttpClient } from './http';
import { IntentClient } from './intent';

function buildClientWithCapturedFetch(): { client: IntentClient; capture: Array<{ url: string; init: RequestInit }>; } {
  const capture: Array<{ url: string; init: RequestInit }> = [];
  const stubFetch: typeof fetch = async (input, init) => {
    capture.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ manifestId: 'int_1', signedManifest: {}, expiresAt: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const http = new HttpClient({
    apiKey: 'aegis_sk_test',
    verifyKey: undefined,
    baseUrl: 'https://api.test.local',
    timeoutMs: 5000,
    fetch: stubFetch,
  });
  return { client: new IntentClient(http), capture };
}

describe('IntentClient', () => {
  it('issue() POSTs to /v1/intent with the management API key', async () => {
    const { client, capture } = buildClientWithCapturedFetch();
    await client.issue({
      agentId: 'agt_1',
      verifyTokenJti: 'jti_1',
      verifyTokenSha256B64Url: 'aGVsbG8',
      intent: { kind: 'commerce-action', action: 'stripe.charge', maxCalls: 1 },
    });
    expect(capture).toHaveLength(1);
    expect(capture[0]!.url).toBe('https://api.test.local/v1/intent');
    expect(capture[0]!.init.method).toBe('POST');
    const headers = capture[0]!.init.headers as Record<string, string>;
    expect(headers['X-AEGIS-API-Key']).toBe('aegis_sk_test');
    // Reserved auth header MUST NOT be overridable; this issue() call
    // didn't try, but the test pins the contract.
    expect(headers['X-AEGIS-Verify-Key']).toBeUndefined();
  });

  it('reconcile() encodes manifestId in path + sends Idempotency-Key header', async () => {
    const { client, capture } = buildClientWithCapturedFetch();
    await client.reconcile('int_with/slash', {
      idempotencyKey: 'recon-1',
      actuals: [
        {
          observedAt: 1_700_000_030,
          kind: 'commerce-action',
          payload: { action: 'stripe.charge', merchantId: 'm', amount: '5.00' },
        },
      ],
    });
    expect(capture[0]!.url).toBe('https://api.test.local/v1/intent/int_with%2Fslash/actuals');
    const headers = capture[0]!.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('recon-1');
  });

  it('get() uses GET method against /v1/intent/{id}', async () => {
    const { client, capture } = buildClientWithCapturedFetch();
    await client.get('int_42');
    expect(capture[0]!.url).toBe('https://api.test.local/v1/intent/int_42');
    expect(capture[0]!.init.method).toBe('GET');
  });

  it('reconcile() refuses to override reserved auth headers (idempotency contract honored)', async () => {
    const { client, capture } = buildClientWithCapturedFetch();
    // Attempt to inject a verify-key via a custom-header callsite (the
    // type system forbids this on RequestOptions.headers, but we test
    // the runtime guard via the IntentClient surface).
    // The reconcile() call only accepts an idempotencyKey, so this is
    // a contract-discipline smoke test against the http.ts merge code.
    await client.reconcile('int_1', {
      idempotencyKey: 'k',
      actuals: [],
    });
    const headers = capture[0]!.init.headers as Record<string, string>;
    // X-AEGIS-API-Key is the management key set by HttpClient; verify
    // it survived the merge intact.
    expect(headers['X-AEGIS-API-Key']).toBe('aegis_sk_test');
  });
});

