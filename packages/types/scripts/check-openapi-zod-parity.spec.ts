// Unit tests for the spec-sync parity script. We don't shell out — we
// import the pure functions and feed them small synthetic specs / Zod
// schemas. The integration check (real OpenAPI YAML against the real
// schemas) runs in CI by invoking the script directly.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  collectReferencedComponents,
  resolveProperties,
  zodObjectKeys,
  diffComponent,
  checkDenialEnumOrder,
  type OpenApiDoc,
} from './check-openapi-zod-parity.js';

const minimalSpec: OpenApiDoc = {
  paths: {
    '/v1/agents': {
      post: {
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/AgentRegistrationRequest' } },
          },
        },
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AgentRegistrationResponse' } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      AgentRegistrationRequest: {
        type: 'object',
        properties: {
          publicKey: { type: 'string' },
          runtime: { type: 'string' },
        },
      },
      AgentRegistrationResponse: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          trustScore: { type: 'number' },
        },
      },
      Compound: {
        allOf: [
          { $ref: '#/components/schemas/AgentRegistrationRequest' },
          { type: 'object', properties: { extra: { type: 'string' } } },
        ],
      },
    },
  },
};

describe('collectReferencedComponents', () => {
  it('finds every $ref reachable from path operations', () => {
    const refs = collectReferencedComponents(minimalSpec);
    expect(refs.has('AgentRegistrationRequest')).toBe(true);
    expect(refs.has('AgentRegistrationResponse')).toBe(true);
    expect(refs.get('AgentRegistrationRequest')!.has('POST /v1/agents')).toBe(true);
  });

  it('does not pull in unreferenced components', () => {
    const refs = collectReferencedComponents(minimalSpec);
    expect(refs.has('Compound')).toBe(false);
  });
});

describe('resolveProperties', () => {
  it('returns top-level keys of an object schema', () => {
    const props = resolveProperties(minimalSpec.components!.schemas!.AgentRegistrationRequest, minimalSpec.components!.schemas!);
    expect(props).toEqual(['publicKey', 'runtime']);
  });

  it('returns null for primitive shapes', () => {
    expect(resolveProperties({ type: 'string' }, {})).toBeNull();
  });

  it('merges allOf branches', () => {
    const props = resolveProperties(minimalSpec.components!.schemas!.Compound, minimalSpec.components!.schemas!);
    expect(props).toContain('publicKey');
    expect(props).toContain('runtime');
    expect(props).toContain('extra');
  });
});

describe('zodObjectKeys', () => {
  it('returns shape keys for a plain ZodObject', () => {
    const schema = z.object({ a: z.string(), b: z.number() });
    expect(zodObjectKeys(schema)).toEqual(['a', 'b']);
  });

  it('drills through .refine() to find the underlying object', () => {
    const schema = z
      .object({ valid: z.boolean(), denialReason: z.string().nullable() })
      .refine((v) => v.valid || v.denialReason !== null);
    expect(zodObjectKeys(schema)).toEqual(['valid', 'denialReason']);
  });

  it('returns null for non-object schemas', () => {
    expect(zodObjectKeys(z.string())).toBeNull();
    expect(zodObjectKeys(z.enum(['a', 'b']))).toBeNull();
  });
});

describe('diffComponent', () => {
  it('reports ok when zod covers every spec property', () => {
    const r = diffComponent('Foo', ['POST /x'], ['a', 'b'], ['a', 'b', 'principalId'], false);
    expect(r.status).toBe('ok');
    expect(r.missingInZod).toEqual([]);
  });

  it('reports drift when a spec property is missing from zod', () => {
    const r = diffComponent('Foo', ['POST /x'], ['a', 'b'], ['a'], false);
    expect(r.status).toBe('drift');
    expect(r.missingInZod).toEqual(['b']);
  });

  it('reports drift in --strict when zod has extras', () => {
    const r = diffComponent('Foo', ['POST /x'], ['a'], ['a', 'principalId'], true);
    expect(r.status).toBe('drift');
    expect(r.extraInZod).toEqual(['principalId']);
  });

  it('non-strict tolerates zod extras', () => {
    const r = diffComponent('Foo', ['POST /x'], ['a'], ['a', 'principalId'], false);
    expect(r.status).toBe('ok');
  });

  it('reports missing when the schema has no zod counterpart', () => {
    const r = diffComponent('Foo', ['POST /x'], ['a', 'b'], null, false);
    expect(r.status).toBe('missing');
    expect(r.missingInZod).toEqual(['a', 'b']);
  });
});

describe('checkDenialEnumOrder', () => {
  it('passes when the spec lists DENIAL_REASON_PRECEDENCE in canonical order', () => {
    // Canonical order from packages/types/src/constants.ts.
    // DENIAL_REASON_PRECEDENCE history:
    //   - 10 entries originally.
    //   - Bumped to 11 on 2026-05-05 per ADR-0014 (TRIAL_EXHAUSTED inserted
    //     between SCOPE_NOT_GRANTED and SPEND_LIMIT_EXCEEDED).
    //   - Bumped to 12 on 2026-05-15 per ADR-0016 (INTENT_MISMATCH appended
    //     after ANOMALY_FLAGGED — forward-compatible per Decision 3 option (a),
    //     no API minor bump). Phase 1 wire-up commit: 2078bd2.
    const spec: OpenApiDoc = {
      components: {
        schemas: {
          VerifyResponse: {
            type: 'object',
            properties: {
              denialReason: {
                enum: [
                  'PLAN_LIMIT_EXCEEDED',
                  'AGENT_NOT_FOUND',
                  'AGENT_REVOKED',
                  'INVALID_SIGNATURE',
                  'POLICY_REVOKED',
                  'POLICY_EXPIRED',
                  'SCOPE_NOT_GRANTED',
                  'TRIAL_EXHAUSTED',
                  'SPEND_LIMIT_EXCEEDED',
                  'TRUST_SCORE_TOO_LOW',
                  'ANOMALY_FLAGGED',
                  'INTENT_MISMATCH',
                ],
              },
            },
          },
        },
      },
    };
    expect(checkDenialEnumOrder(spec).status).toBe('ok');
  });

  it('catches the alphabetical ordering bug (POLICY_EXPIRED before POLICY_REVOKED)', () => {
    const spec: OpenApiDoc = {
      components: {
        schemas: {
          VerifyResponse: {
            type: 'object',
            properties: {
              denialReason: {
                enum: [
                  'AGENT_NOT_FOUND',
                  'AGENT_REVOKED',
                  'INVALID_SIGNATURE',
                  'POLICY_EXPIRED',
                  'POLICY_REVOKED',
                  'SCOPE_NOT_GRANTED',
                  'SPEND_LIMIT_EXCEEDED',
                  'TRUST_SCORE_TOO_LOW',
                  'ANOMALY_FLAGGED',
                ],
              },
            },
          },
        },
      },
    };
    const r = checkDenialEnumOrder(spec);
    expect(r.status).toBe('drift');
    expect(r.detail).toContain('POLICY_REVOKED');
  });

  it('reports missing when denialReason is not declared', () => {
    expect(checkDenialEnumOrder({}).status).toBe('missing');
  });
});
