// Paired tests for `PolicyClient` — OD-024 (Option A) SDK extensions.
// CLAUDE.md Quality bar: policy-module changes require paired tests in
// the same change. This file covers the new overloaded `create` (2-arg
// canonical + single-bundle ergonomic form), the wrapped `list` return
// shape, and `revoke`'s required-but-typed-optional `agentId` invariant.

import type { HttpClient } from './http.js';
import { PolicyClient } from './policy.js';
import type { CreatePolicyBundle, CreatePolicyInput, PolicyListItem } from './types.js';

interface StubHttp {
  request: jest.Mock;
}

function makeHttp(returnValue?: unknown): StubHttp {
  return { request: jest.fn(async () => returnValue) };
}

function lastCall(http: StubHttp): { path: string; opts: { method: string; body?: unknown; query?: unknown } } {
  const calls = http.request.mock.calls;
  const [path, opts] = calls[calls.length - 1] as [string, { method: string; body?: unknown; query?: unknown }];
  return { path, opts };
}

describe('PolicyClient.create — 2-arg canonical form', () => {
  it('posts to /agents/:agentId/policies with the input body', async () => {
    const http = makeHttp({ policyId: 'p_x', signedToken: 't', expiresAt: '2030-01-01' });
    const client = new PolicyClient(http as unknown as HttpClient);
    const input: CreatePolicyInput = {
      label: 'demo',
      scopes: [],
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    };
    await client.create('a_123', input);
    const { path, opts } = lastCall(http);
    expect(path).toBe('/agents/a_123/policies');
    expect(opts).toEqual({
      method: 'POST',
      body: { label: 'demo', scopes: [], expiresAt: '2030-01-01T00:00:00.000Z' },
    });
  });

  it('coerces a string expiresAt unchanged', async () => {
    const http = makeHttp({});
    const client = new PolicyClient(http as unknown as HttpClient);
    await client.create('a_123', { scopes: [], expiresAt: '2030-06-01T00:00:00.000Z' });
    expect((lastCall(http).opts.body as { expiresAt: string }).expiresAt).toBe(
      '2030-06-01T00:00:00.000Z',
    );
  });
});

describe('PolicyClient.create — single-bundle form (OD-024)', () => {
  it('converts expiresInSeconds → absolute ISO expiresAt at call time', async () => {
    const http = makeHttp({});
    const client = new PolicyClient(http as unknown as HttpClient);
    const before = Date.now();
    await client.create({ agentId: 'a_123', scopes: [], expiresInSeconds: 3600 });
    const { path, opts } = lastCall(http);
    expect(path).toBe('/agents/a_123/policies');
    const expiresAt = Date.parse((opts.body as { expiresAt: string }).expiresAt);
    expect(expiresAt - before).toBeGreaterThanOrEqual(3600 * 1000 - 200);
    expect(expiresAt - before).toBeLessThanOrEqual(3600 * 1000 + 200);
  });

  it('accepts absolute expiresAt in the bundle form', async () => {
    const http = makeHttp({});
    const client = new PolicyClient(http as unknown as HttpClient);
    await client.create({
      agentId: 'a_123',
      scopes: [],
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect((lastCall(http).opts.body as { expiresAt: string }).expiresAt).toBe(
      '2030-01-01T00:00:00.000Z',
    );
  });

  it('expiresInSeconds wins over expiresAt when both are supplied', async () => {
    const http = makeHttp({});
    const client = new PolicyClient(http as unknown as HttpClient);
    await client.create({
      agentId: 'a_123',
      scopes: [],
      expiresInSeconds: 60,
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    expect((lastCall(http).opts.body as { expiresAt: string }).expiresAt).not.toBe(
      '2000-01-01T00:00:00.000Z',
    );
  });

  it('throws when neither expiresInSeconds nor expiresAt is supplied', async () => {
    const client = new PolicyClient(makeHttp() as unknown as HttpClient);
    await expect(
      client.create({ agentId: 'a_x', scopes: [] } as CreatePolicyBundle),
    ).rejects.toThrow(/expiresInSeconds.*expiresAt/);
  });
});

describe('PolicyClient.list', () => {
  it('returns the wrapped {policies: [...]} shape the CLI accesses', async () => {
    const items: PolicyListItem[] = [
      {
        policyId: 'p1',
        agentId: 'a1',
        scopes: [],
        status: 'ACTIVE',
        createdAt: '2026-05-24T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    ];
    const http = makeHttp(items);
    const client = new PolicyClient(http as unknown as HttpClient);
    const result = await client.list({ agentId: 'a1' });
    expect(result).toEqual({ policies: items });
    const { path, opts } = lastCall(http);
    expect(path).toBe('/agents/a1/policies');
    expect(opts.method).toBe('GET');
    expect(opts.query).toBeUndefined();
  });

  it('forwards optional status as a query parameter', async () => {
    const http = makeHttp([]);
    const client = new PolicyClient(http as unknown as HttpClient);
    await client.list({ agentId: 'a1', status: 'REVOKED' });
    expect(lastCall(http).opts.query).toEqual({ status: 'REVOKED' });
  });
});

describe('PolicyClient.revoke', () => {
  it('DELETEs /agents/:agentId/policies/:policyId with no body when no reason', async () => {
    const http = makeHttp(undefined);
    const client = new PolicyClient(http as unknown as HttpClient);
    await client.revoke('p_x', { agentId: 'a_x' });
    const { path, opts } = lastCall(http);
    expect(path).toBe('/agents/a_x/policies/p_x');
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
  });

  it('forwards reason in the DELETE body when provided', async () => {
    const http = makeHttp(undefined);
    const client = new PolicyClient(http as unknown as HttpClient);
    await client.revoke('p_x', { agentId: 'a_x', reason: 'compromised key' });
    expect(lastCall(http).opts.body).toEqual({ reason: 'compromised key' });
  });

  it('throws when agentId is missing (CLAUDE.md §4 — no silent failures)', async () => {
    const client = new PolicyClient(makeHttp() as unknown as HttpClient);
    await expect(client.revoke('p_x', {})).rejects.toThrow(/agentId is required/);
    await expect(client.revoke('p_x')).rejects.toThrow(/agentId is required/);
  });
});
