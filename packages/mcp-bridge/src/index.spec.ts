/**
 * @cerniq/mcp-bridge — unit tests for wrapMcpHandler()
 *
 * Coverage:
 *  - Token extracted from `_cerniq_headers` (header path)
 *  - Token extracted from `_cerniq_token` params (arg path)
 *  - MISSING_TOKEN → BridgeDenialError(AGENT_NOT_FOUND)
 *  - CERNIQ verify() returns valid=false → BridgeDenialError with reason
 *  - Trust band below minimum → BridgeDenialError(TRUST_SCORE_TOO_LOW)
 *  - Happy path → handler called, cerniqVerify injected into context
 *  - Custom onDenial callback is invoked (not the default throw)
 *  - actionPrefix + method → action string forwarded to verify()
 *  - PLAN_LIMIT_EXCEEDED propagates from verify()
 *  - FLAGGED minTrustBand accepts any band
 */

import type { Cerniq, VerifyResult } from '@cerniq/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { BridgeConfig } from './index.js';
import { BridgeDenialError, wrapMcpHandler } from './index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal mock Cerniq client with a controllable verify() */
function makeCerniq(result: VerifyResult): Cerniq {
  return {
    verify: vi.fn().mockResolvedValue(result),
  } as unknown as Cerniq;
}

/** Build a base BridgeConfig with mocked cerniq */
function baseConfig(overrides?: Partial<BridgeConfig>): BridgeConfig {
  return {
    cerniq: makeCerniq(happyResult()),
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
function reqWithHeaderToken(method: string, token: string) {
  return makeReq(method, {
    _cerniq_headers: { 'x-cerniq-token': token },
  });
}

/** Token-bearing request via arg path */
function reqWithArgToken(method: string, token: string) {
  return makeReq(method, { _cerniq_token: token });
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

  it('extracts token from _cerniq_headers and calls verify', async () => {
    const cerniq = makeCerniq(happyResult());
    const config = baseConfig({ cerniq });
    const handler = vi.fn().mockResolvedValue({ result: 'ok' });

    const wrapped = wrapMcpHandler(config, handler);
    await wrapped(reqWithHeaderToken('tools/call', 'tok_header'));

    expect(cerniq.verify).toHaveBeenCalledWith(
      'tok_header',
      expect.objectContaining({ action: 'mcp.test.tools/call' }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('extracts token from _cerniq_token param when header is absent', async () => {
    const cerniq = makeCerniq(happyResult());
    const config = baseConfig({ cerniq });
    const handler = vi.fn().mockResolvedValue({ result: 'ok' });

    const wrapped = wrapMcpHandler(config, handler);
    await wrapped(reqWithArgToken('resources/read', 'tok_arg'));

    expect(cerniq.verify).toHaveBeenCalledWith('tok_arg', expect.anything());
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
    const cerniq = makeCerniq(happyResult());
    const config = baseConfig({ cerniq });
    const wrapped = wrapMcpHandler(config, vi.fn());
    await expect(wrapped(makeReq('tools/call'))).rejects.toThrow(BridgeDenialError);
    expect(cerniq.verify).not.toHaveBeenCalled();
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
      const cerniq = makeCerniq(deniedResult(reason));
      const wrapped = wrapMcpHandler(baseConfig({ cerniq }), vi.fn());
      await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toMatchObject({
        name: 'BridgeDenialError',
        reason,
      });
    },
  );

  // ── Trust band enforcement ───────────────────────────────────────────────

  it('denies WATCH-band agent when minTrustBand=VERIFIED', async () => {
    const result = happyResult({ trustBand: 'WATCH', trustScore: 300 });
    const cerniq = makeCerniq(result);
    const config = baseConfig({ cerniq, minTrustBand: 'VERIFIED' });
    const wrapped = wrapMcpHandler(config, vi.fn());
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toMatchObject({
      reason: 'TRUST_SCORE_TOO_LOW',
    });
  });

  it('denies VERIFIED-band agent when minTrustBand=PLATINUM', async () => {
    const result = happyResult({ trustBand: 'VERIFIED', trustScore: 600 });
    const cerniq = makeCerniq(result);
    const config = baseConfig({ cerniq, minTrustBand: 'PLATINUM' });
    const wrapped = wrapMcpHandler(config, vi.fn());
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toMatchObject({
      reason: 'TRUST_SCORE_TOO_LOW',
    });
  });

  it('accepts WATCH-band agent when minTrustBand=WATCH', async () => {
    const result = happyResult({ trustBand: 'WATCH', trustScore: 300 });
    const cerniq = makeCerniq(result);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ cerniq, minTrustBand: 'WATCH' });
    const wrapped = wrapMcpHandler(config, handler);
    const res = await wrapped(reqWithHeaderToken('tools/call', 'tok'));
    expect(res).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepts PLATINUM-band agent when minTrustBand=VERIFIED (default)', async () => {
    const result = happyResult({ trustBand: 'PLATINUM', trustScore: 900 });
    const cerniq = makeCerniq(result);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrapped = wrapMcpHandler(baseConfig({ cerniq }), handler);
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).resolves.toEqual({ ok: true });
  });

  it('accepts FLAGGED-band agent when minTrustBand=FLAGGED', async () => {
    const result = happyResult({ trustBand: 'FLAGGED', trustScore: 50 });
    const cerniq = makeCerniq(result);
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ cerniq, minTrustBand: 'FLAGGED' });
    const wrapped = wrapMcpHandler(config, handler);
    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).resolves.toEqual({ ok: true });
  });

  // ── Happy path: context injection ────────────────────────────────────────

  it('injects cerniqVerify into BridgeContextWithVerification', async () => {
    const verifyResult = happyResult();
    const cerniq = makeCerniq(verifyResult);
    let capturedCtx: unknown;
    const handler = vi.fn().mockImplementation(async (_req: unknown, ctx: unknown) => {
      capturedCtx = ctx;
      return { done: true };
    });

    const wrapped = wrapMcpHandler(baseConfig({ cerniq }), handler);
    await wrapped(reqWithHeaderToken('tools/call', 'tok'));

    expect(capturedCtx).toMatchObject({
      method: 'tools/call',
      cerniqVerify: verifyResult,
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
    const cerniq = makeCerniq(deniedResult('AGENT_REVOKED'));
    const config = baseConfig({ cerniq, onDenial });
    const wrapped = wrapMcpHandler(config, vi.fn());

    await expect(wrapped(reqWithHeaderToken('tools/call', 'tok'))).rejects.toThrow('custom denial');
    expect(onDenial).toHaveBeenCalledWith(
      'AGENT_REVOKED',
      expect.objectContaining({ method: 'tools/call' }),
    );
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

  // ── actionPrefix + method ────────────────────────────────────────────────

  it('constructs action as actionPrefix + method', async () => {
    const cerniq = makeCerniq(happyResult());
    const config = baseConfig({ cerniq, actionPrefix: 'mcp.myserver.' });
    const wrapped = wrapMcpHandler(config, vi.fn().mockResolvedValue({}));

    await wrapped(reqWithHeaderToken('tools/list', 'tok'));

    expect(cerniq.verify).toHaveBeenCalledWith('tok', { action: 'mcp.myserver.tools/list' });
  });

  // ── BridgeDenialError shape ──────────────────────────────────────────────

  it('BridgeDenialError carries the VerifyResult', async () => {
    const vr = deniedResult('POLICY_EXPIRED');
    const wrapped = wrapMcpHandler(baseConfig({ cerniq: makeCerniq(vr) }), vi.fn());
    try {
      await wrapped(reqWithHeaderToken('tools/call', 'tok'));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeDenialError);
      expect((e as BridgeDenialError).verifyResponse).toMatchObject({
        valid: false,
        denialReason: 'POLICY_EXPIRED',
      });
    }
  });
});
