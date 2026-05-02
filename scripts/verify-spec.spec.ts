import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  compareEnums,
  compareKeys,
  parsePrismaEnums,
  resolveSchemaName,
  zodObjectKeys,
} from './verify-spec.js';

describe('verify-spec — schema-name resolver', () => {
  const components = {
    AgentRegistrationRequest: {
      type: 'object',
      properties: { publicKey: {}, runtime: {}, principalId: {} },
    },
  };

  it('resolves a $ref to its component name + node', () => {
    const node = { $ref: '#/components/schemas/AgentRegistrationRequest' };
    const r = resolveSchemaName(node, components);
    expect(r.name).toBe('AgentRegistrationRequest');
    expect(r.resolved?.properties).toBeDefined();
  });

  it('returns the inline node when no $ref is present', () => {
    const node = { type: 'object', properties: { x: {} } };
    const r = resolveSchemaName(node, components);
    expect(r.name).toBeNull();
    expect(r.resolved).toBe(node);
  });

  it('returns nulls when the ref target does not exist', () => {
    const node = { $ref: '#/components/schemas/NotARealSchema' };
    const r = resolveSchemaName(node, components);
    expect(r.name).toBe('NotARealSchema');
    expect(r.resolved).toBeNull();
  });
});

describe('verify-spec — Zod object key extraction', () => {
  it('returns top-level keys of a ZodObject', () => {
    const s = z.object({ a: z.string(), b: z.number().optional() });
    expect(zodObjectKeys(s)).toEqual(['a', 'b']);
  });

  it('unwraps optional/nullable wrappers', () => {
    const s = z.object({ a: z.string() }).optional();
    expect(zodObjectKeys(s)).toEqual(['a']);
  });

  it('returns null for non-object schemas', () => {
    expect(zodObjectKeys(z.string())).toBeNull();
  });

  it('returns null when given undefined', () => {
    expect(zodObjectKeys(undefined)).toBeNull();
  });
});

describe('verify-spec — compareKeys', () => {
  it('reports ok when Zod is a superset of spec (loose mode)', () => {
    expect(compareKeys(['a', 'b'], ['a', 'b', 'c'], false)).toEqual({
      status: 'ok',
      delta: '',
    });
  });

  it('reports drift when Zod is missing a spec key', () => {
    const r = compareKeys(['a', 'b'], ['a'], false);
    expect(r.status).toBe('drift');
    expect(r.delta).toContain('missingInZod=[b]');
  });

  it('strict mode flags extra Zod keys', () => {
    const r = compareKeys(['a'], ['a', 'b'], true);
    expect(r.status).toBe('drift');
    expect(r.delta).toContain('extraInZod=[b]');
  });

  it('returns missing when Zod is null', () => {
    expect(compareKeys(['a'], null, false).status).toBe('missing');
  });
});

describe('verify-spec — Prisma enum parser', () => {
  const sample = `
    enum AgentStatus {
      PENDING_VERIFICATION
      ACTIVE
      // a comment
      SUSPENDED
      REVOKED
    }

    enum PolicyStatus {
      ACTIVE
      EXPIRED
      REVOKED
    }
  `;

  it('extracts enum names + members, ignoring comments', () => {
    const m = parsePrismaEnums(sample);
    expect(m.get('AgentStatus')).toEqual([
      'PENDING_VERIFICATION',
      'ACTIVE',
      'SUSPENDED',
      'REVOKED',
    ]);
    expect(m.get('PolicyStatus')).toEqual(['ACTIVE', 'EXPIRED', 'REVOKED']);
  });
});

describe('verify-spec — compareEnums (case-insensitive)', () => {
  it('matches Prisma uppercase to Zod lowercase', () => {
    expect(compareEnums(['ACTIVE', 'EXPIRED'], ['active', 'expired']).status).toBe('ok');
  });

  it('flags missing members', () => {
    const r = compareEnums(['ACTIVE', 'EXPIRED', 'REVOKED'], ['active', 'expired']);
    expect(r.status).toBe('drift');
    expect(r.delta).toContain('REVOKED');
  });

  it('flags extras in Zod', () => {
    const r = compareEnums(['ACTIVE'], ['active', 'frozen']);
    expect(r.status).toBe('drift');
    expect(r.delta).toContain('FROZEN');
  });
});
