import { describe, it, expect } from 'vitest';
import { shadowMode, compareVerifyResponses, divergenceHeader } from '../src/shadow';
import type { VerifyResponse } from '@aegis/types';

const baseResponse: VerifyResponse = {
  valid: true,
  agentId: 'agt_1',
  principalId: 'p_1',
  trustScore: 700,
  trustBand: 'VERIFIED',
  scopesGranted: ['commerce'],
  denialReason: null,
  verifiedAt: '2026-05-02T00:00:00.000Z',
  ttl: 30,
};

describe('shadowMode', () => {
  it('live wins over shadow when both flags are set', () => {
    expect(shadowMode({ AEGIS_EDGE_VERIFY_ENABLED: 'true', AEGIS_EDGE_VERIFY_SHADOW_MODE: 'true' })).toBe('live');
  });
  it('returns shadow when only shadow flag is set', () => {
    expect(shadowMode({ AEGIS_EDGE_VERIFY_SHADOW_MODE: 'true' })).toBe('shadow');
  });
  it('returns off when neither is set', () => {
    expect(shadowMode({})).toBe('off');
  });
});

describe('compareVerifyResponses', () => {
  it('reports agree on identical decision tuples (ignoring timestamps)', () => {
    const r = compareVerifyResponses(baseResponse, { ...baseResponse, verifiedAt: '2099-01-01T00:00:00.000Z' });
    expect(r.divergent).toBe(false);
    expect(r.fields).toEqual([]);
  });

  it('reports divergence on denialReason mismatch', () => {
    const r = compareVerifyResponses(baseResponse, { ...baseResponse, valid: false, denialReason: 'AGENT_REVOKED' });
    expect(r.divergent).toBe(true);
    expect(r.fields).toEqual(expect.arrayContaining(['valid', 'denialReason']));
  });

  it('reports divergence on scopesGranted set diff', () => {
    const r = compareVerifyResponses(baseResponse, { ...baseResponse, scopesGranted: ['commerce', 'data'] });
    expect(r.fields).toContain('scopesGranted');
  });

  it('reports divergence on trustBand drift', () => {
    const r = compareVerifyResponses(baseResponse, { ...baseResponse, trustBand: 'PLATINUM' });
    expect(r.fields).toContain('trustBand');
  });
});

describe('divergenceHeader', () => {
  it('emits "agree" on no divergence', () => {
    expect(divergenceHeader({ divergent: false, fields: [] })).toBe('agree');
  });
  it('emits "diverge:<fields>" on divergence', () => {
    expect(divergenceHeader({ divergent: true, fields: ['valid', 'denialReason'] })).toBe('diverge:valid,denialReason');
  });
  it('emits "edge-forward:no-edge-decision" when edge forwarded', () => {
    expect(divergenceHeader({ edgeForwarded: true })).toBe('edge-forward:no-edge-decision');
  });
});
