/**
 * @aegis/mcp-bridge — unit tests for wrapMcpHandler()
 *
 * Coverage:
 *  - Token extracted from `_aegis_headers` (header path)
 *  - Token extracted from `_aegis_token` params (arg path)
 *  - MISSING_TOKEN → BridgeDenialError(AGENT_NOT_FOUND)
 *  - AEGIS verify() returns valid=false → BridgeDenialError with reason
 *  - Trust band below minimum → BridgeDenialError(TRUST_SCORE_TOO_LOW)
 *  - Happy path → handler called, aegisVerify injected into context
 *  - Custom onDenial callback is invoked (not the default throw)
 *  - tools/call scopes to the named MCP tool, not the generic JSON-RPC method
 *  - bridge-only auth metadata is stripped before handler execution
 *  - PLAN_LIMIT_EXCEEDED propagates from verify()
 *  - FLAGGED minTrustBand accepts any band
 */

import type { Aegis, VerifyResult } from '@aegis/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { BridgeConfig} from './index.js';
import { BridgeDenialError, wrapMcpHandler } from './index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal mock Aegis client with a controllable verify() */
function makeAegis(result: VerifyResult): Aegis {
  return {
    verify: vi.fn().mockResolvedValue(result),
  } as unknown as Aegis;
}

/** Build a base BridgeConfig with mocked aegis */
function baseConfig(overrides?: Partial<BridgeConfig>): BridgeConfig {
  return {
    aegis: makeAegis(happyResult()),
    actionPrefix: 'mcp.test.',
    ...overrides,
  };
}

/** Minimal MCP request shape */
function makeReq(
  method: string,
  params?: Record<string, unknown>,
): { method: string; params: Record<string, unknown> } {
  return { method, params: params ?? {} };
}

/** Token-bearing request via header path */
function reqWithHeaderToken(method: string, token: string, params?: Record<string, unknown>) {
  return makeReq(method, {
    ...(params ?? {}),
    _aegis_headers: { 'x-aegis-token': token },
  });
}

/** Token-bearing request via arg path */
function reqWithArgToken(method: string, token: string, params?: Record<string, unknown>) {
  return makeReq(method, { ...(params ?? {}), _aegis_token: token });
}

function happyResult(overrides?: Partial<VerifyResult>): VerifyResult {
  return {
    valid: true,
    agentId: 'agt_test',
    principalId: 'pri_test',
    trustScore: 650,
    trustBand: 'VERIFIED',
    scopesGranted: ['mcp.test.*'],
    denialReason: null,
    verifiedAt: new Date().toISOString(),
    ttl: 30,
    ...overrides,
  };
}

function deniedResult(reason: VerifyResult['denialReason']): VerifyResult {
  return {
    valid: false,
    agentId: null,
    principalId: null,
    trustScore: 0,
    trustBand: null,
    scopesGranted: [],
    denialReason: reason,
    verifiedAt: new Date().toISOString(),
    ttl: 0,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('wrapMcpHandler', () => {
  // ── Token extraction ─────────────────────────────────────────────────────

  it('extracts token from _aegis_headers and calls verify', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis });
    const handler = vi.fn().mockResolvedValue({ result: 'ok' });

    const wrapped = wrapMcpHandler(config, handler);
    await wrapped(reqWithHeaderToken('tools/call', 'tok_header', { name: 'read_file' }));

    expect(aegis.verify).toHaveBeenCalledWith('tok_header', expect.objectContaining({ action: 'mcp.test.read_file' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('normalizes mixed-case transport headers before extracting the token', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis });
    const handler = vi.fn().mockResolvedValue({ result: 'ok' });

    const wrapped = wrapMcpHandler(config, handler);
    await wrapped(
      makeReq('tools/call', {
        name: 'read_file',
        _aegis_headers: { 'X-AEGIS-Token': 'tok_mixed_case' },
      }),
    );

    expect(aegis.verify).toHaveBeenCalledWith('tok_mixed_case', expect.objectContaining({ action: 'mcp.test.read_file' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('exposes ctx.headers with lowercase keys to the handler — contract lock', async () => {
    // Lock the BridgeContext.headers contract: keys are guaranteed
    // lowercased regardless of what the transport delivered. Without this
    // assertion a future contributor could "improve" extractHeaders to
    // preserve casing and silently break every consumer that does
    // `ctx.headers['x-...']`.
    let observed: Record<string, string> | undefined;
    const handler = vi.fn().mockImplementation(async (_req: unknown, ctx: { headers: Record<string, string> }) => {
      observed = ctx.headers;
      return { ok: true };
    });
    const wrapped = wrapMcpHandler(baseConfig(), handler);

    await wrapped(
      makeReq('tools/call', {
        name: 'read_file',
        _aegis_headers: {
          'X-AEGIS-Token': 'tok',
          'X-Request-Id': 'req-123',
          'User-Agent': 'mcp-client/1.0',
        },
      }),
    );

    expect(observed).toEqual({
      'x-aegis-token': 'tok',
      'x-request-id': 'req-123',
      'user-agent': 'mcp-client/1.0',
    });
    // Negative: original-case keys are gone, not duplicated.
    expect(observed!['X-Request-Id']).toBeUndefined();
  });

  it('drops non-string header values defensively', async () => {
    // Transports occasionally deliver numeric content-length or boolean
    // flags. We forward only string-valued headers so consumers don't
    // need to typeguard every lookup.
    let observed: Record<string, string> | undefined;
    const handler = vi.fn().mockImplementation(async (_req: unknown, ctx: { headers: Record<string, string> }) => {
      observed = ctx.headers;
      return { ok: true };
    });
    const wrapped = wrapMcpHandler(baseConfig(), handler);

    await wrapped(
      makeReq('tools/call', {
        name: 'read_file',
        _aegis_headers: {
          'X-AEGIS-Token': 'tok',
          'Content-Length': 42,
          'X-Trusted': true,
        },
      }),
    );

    expect(observed).toEqual({ 'x-aegis-token': 'tok' });
  });

  it('extracts token from _aegis_token param when header is absent', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis });
    const handler = vi.fn().mockResolvedValue({ result: 'ok' });

    const wrapped = wrapMcpHandler(config, handler);
    await wrapped(reqWithArgToken('resources/read', 'tok_arg'));

    expect(aegis.verify).toHaveBeenCalledWith('tok_arg', expect.anything());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── Missing token ────────────────────────────────────────────────────────

  it('throws BridgeDenialError(AGENT_NOT_FOUND) when no token present', async () => {
    const wrapped = wrapMcpHandler(baseConfig(), vi.fn());
    await expect(wrapped(makeReq('tools/call'))).rejects.toMatchObject({
      name: 'BridgeDenialError',
      reason: 'AGENT_NOT_FOUND',
    });
  });

  it('does NOT call verify() when token is absent', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis });
    const wrapped = wrapMcpHandler(config, vi.fn());
    await expect(wrapped(makeReq('tools/call'))).rejects.toThrow(BridgeDenialError);
    expect(aegis.verify).not.toHaveBeenCalled();
  });

  // ── Verify denial propagation ────────────────────────────────────────────

  it.each([
    'AGENT_NOT_FOUND',
    'AGENT_REVOKED',
    'INVALID_SIGNATURE',
    'POLICY_EXPIRED',
    'SCOPE_NOT_GRANTED',
    'SPEND_LIMIT_EXCEEDED',
    'ANOMALY_FLAGGED',
    'PLAN_LIMIT_EXCEEDED',
  ] as VerifyResult['denialReason'][])(
    'propagates denial reason %s from verify()',
    async (reason) => {
      const aegis = makeAegis(deniedResult(reason));
      const wrapped = wrapMcpHandler(baseConfig({ aegis }), vi.fn());
      await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toMatchObject({
        name: 'BridgeDenialError',
        reason,
      });
    },
  );

  // ── Trust band enforcement ───────────────────────────────────────────────

  it('denies WATCH-band agent when minTrustBand=VERIFIED', async () => {
    const result = happyResult({ trustBand: 'WATCH', trustScore: 300 });
    const aegis = makeAegis(result);
    const config = baseConfig({ aegis, minTrustBand: 'VERIFIED' });
    const wrapped = wrapMcpHandler(config, vi.fn());
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toMatchObject({
      reason: 'TRUST_SCORE_TOO_LOW',
    });
  });

  it('denies VERIFIED-band agent when minTrustBand=PLATINUM', async () => {
    const result = happyResult({ trustBand: 'VERIFIED', trustScore: 600 });
    const aegis = makeAegis(result);
    const config = baseConfig({ aegis, minTrustBand: 'PLATINUM' });
    const wrapped = wrapMcpHandler(config, vi.fn());
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toMatchObject({
      reason: 'TRUST_SCORE_TOO_LOW',
    });
  });

  it('accepts WATCH-band agent when minTrustBand=WATCH', async () => {
    const result = happyResult({ trustBand: 'WATCH', trustScore: 300 });
    const aegis = makeAegis(result);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ aegis, minTrustBand: 'WATCH' });
    const wrapped = wrapMcpHandler(config, handler);
    const res = await wrapped(reqWithHeaderToken('tools/call', 'tok'));
    expect(res).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepts PLATINUM-band agent when minTrustBand=VERIFIED (default)', async () => {
    const result = happyResult({ trustBand: 'PLATINUM', trustScore: 900 });
    const aegis = makeAegis(result);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapMcpHandler(baseConfig({ aegis }), handler);
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).resolves.toEqual({ ok: true });
  });

  it('accepts FLAGGED-band agent when minTrustBand=FLAGGED', async () => {
    const result = happyResult({ trustBand: 'FLAGGED', trustScore: 50 });
    const aegis = makeAegis(result);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ aegis, minTrustBand: 'FLAGGED' });
    const wrapped = wrapMcpHandler(config, handler);
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).resolves.toEqual({ ok: true });
  });

  // ── Happy path: context injection ────────────────────────────────────────

  it('injects aegisVerify into BridgeContextWithVerification', async () => {
    const verifyResult = happyResult();
    const aegis = makeAegis(verifyResult);
    let capturedCtx: unknown;
    const handler = vi.fn().mockImplementation(async (_req: unknown, ctx: unknown) => {
      capturedCtx = ctx;
      return { done: true };
    });

    const wrapped = wrapMcpHandler(baseConfig({ aegis }), handler);
    await wrapped(reqWithHeaderToken('tools/call', 'tok', { name: 'read_file' }));

    expect(capturedCtx).toMatchObject({
      method: 'tools/call',
      target: 'read_file',
      aegisVerify: verifyResult,
    });
  });

  it('returns the handler result unchanged', async () => {
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] });
    const wrapped = wrapMcpHandler(baseConfig(), handler);
    const res = await wrapped(reqWithHeaderToken('tools/call', 'tok'));
    expect(res).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  // ── Custom onDenial callback ──────────────────────────────────────────────

  it('calls onDenial instead of throwing when provided', async () => {
    const onDenial = vi.fn().mockImplementation(() => {
      throw new Error('custom denial');
    });
    const aegis = makeAegis(deniedResult('AGENT_REVOKED'));
    const config = baseConfig({ aegis, onDenial });
    const wrapped = wrapMcpHandler(config, vi.fn());

    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toThrow('custom denial');
    expect(onDenial).toHaveBeenCalledWith('AGENT_REVOKED', expect.objectContaining({ method: 'tools/call' }));
  });

  it('calls onDenial on missing-token denial', async () => {
    const onDenial = vi.fn().mockImplementation(() => {
      throw new Error('no token');
    });
    const config = baseConfig({ onDenial });
    const wrapped = wrapMcpHandler(config, vi.fn());

    await expect(wrapped(makeReq('tools/call'))).rejects.toThrow('no token');
    expect(onDenial).toHaveBeenCalledWith('AGENT_NOT_FOUND', expect.anything());
  });

  it('strips bridge-only auth metadata before invoking the handler', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapMcpHandler(baseConfig(), handler);

    await wrapped(
      makeReq('tools/call', {
        name: 'read_file',
        path: '/tmp/report.txt',
        _aegis_token: 'tok_arg',
        _aegis_headers: { 'x-aegis-token': 'tok_header' },
      }),
    );

    expect(handler).toHaveBeenCalledWith(
      {
        method: 'tools/call',
        params: { name: 'read_file', path: '/tmp/report.txt' },
      },
      expect.objectContaining({
        args: { name: 'read_file', path: '/tmp/report.txt' },
      }),
    );
  });

  // ── action scoping ───────────────────────────────────────────────────────

  it('constructs tools/call action as actionPrefix + target tool name', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis, actionPrefix: 'mcp.myserver.' });
    const wrapped = wrapMcpHandler(config, vi.fn().mockResolvedValue({}));

    await wrapped(reqWithHeaderToken('tools/call', 'tok', { name: 'charge_card' }));

    expect(aegis.verify).toHaveBeenCalledWith('tok', { action: 'mcp.myserver.charge_card' });
  });

  it('falls back to method name when the MCP request has no concrete target', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis, actionPrefix: 'mcp.myserver.' });
    const wrapped = wrapMcpHandler(config, vi.fn().mockResolvedValue({}));

    await wrapped(reqWithHeaderToken('tools/list', 'tok'));

    expect(aegis.verify).toHaveBeenCalledWith('tok', { action: 'mcp.myserver.tools/list' });
  });

  // Resource methods scope under the method name to keep resource URIs
  // namespaced separately from tool names (which use a flat prefix).
  // A resource URI of "read_file" must NOT match a tools/call policy.
  it.each([
    ['resources/read', 'file:///etc/hosts', 'mcp.myserver.resources/read.file:///etc/hosts'],
    ['resources/subscribe', 'config://app/logs', 'mcp.myserver.resources/subscribe.config://app/logs'],
    ['resources/unsubscribe', 'config://app/logs', 'mcp.myserver.resources/unsubscribe.config://app/logs'],
    ['prompts/get', 'summarize_diff', 'mcp.myserver.prompts/get.summarize_diff'],
  ])('scopes %s to its target via method.target namespace', async (method, target, expectedAction) => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis, actionPrefix: 'mcp.myserver.' });
    const wrapped = wrapMcpHandler(config, vi.fn().mockResolvedValue({}));

    const params = method.startsWith('resources/') ? { uri: target } : { name: target };
    await wrapped(reqWithHeaderToken(method, 'tok', params));

    expect(aegis.verify).toHaveBeenCalledWith('tok', { action: expectedAction });
  });

  // Defense: a resource URI that spells `charge_card` must not pass a
  // tools/call policy on `mcp.myserver.charge_card`. The method.target
  // namespace prevents this cross-method confusion.
  it('isolates a resource URI from collision with a tool name', async () => {
    const aegis = makeAegis(happyResult());
    const config = baseConfig({ aegis, actionPrefix: 'mcp.myserver.' });
    const wrapped = wrapMcpHandler(config, vi.fn().mockResolvedValue({}));

    await wrapped(reqWithHeaderToken('resources/read', 'tok', { uri: 'charge_card' }));

    // resources/read scoped under its method; cannot match an
    // mcp.myserver.charge_card tools/call policy.
    expect(aegis.verify).toHaveBeenCalledWith('tok', {
      action: 'mcp.myserver.resources/read.charge_card',
    });
  });

  it.each(['resources/list', 'prompts/list'])(
    'list method %s falls back to method name (no target discriminator)',
    async (method) => {
      const aegis = makeAegis(happyResult());
      const config = baseConfig({ aegis, actionPrefix: 'mcp.myserver.' });
      const wrapped = wrapMcpHandler(config, vi.fn().mockResolvedValue({}));

      await wrapped(reqWithHeaderToken(method, 'tok'));

      expect(aegis.verify).toHaveBeenCalledWith('tok', { action: `mcp.myserver.${method}` });
    },
  );

  // ── BridgeDenialError shape ──────────────────────────────────────────────

  it('BridgeDenialError carries the VerifyResult', async () => {
    const vr = deniedResult('POLICY_EXPIRED');
    const wrapped = wrapMcpHandler(baseConfig({ aegis: makeAegis(vr) }), vi.fn());
    try {
      await wrapped(reqWithHeaderToken('tools/call', 'tok'));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeDenialError);
      expect((e as BridgeDenialError).verifyResponse).toMatchObject({ valid: false, denialReason: 'POLICY_EXPIRED' });
    }
  });
});
