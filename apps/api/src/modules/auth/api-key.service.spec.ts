import * as bcrypt from 'bcryptjs';

import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AppConfigService } from '../../config/config.service';

import { ApiKeyService } from './api-key.service';

/**
 * Security-critical surface (CLAUDE.md invariant #5 + auth boundary).
 *
 * Notes on actual service shape:
 *  - The service exposes `issue()` and `resolve()` (not `validate()`).
 *  - Revocation is NOT a method on this service today — it is performed
 *    via the principals/dashboard layer setting `revokedAt`. We test that
 *    `resolve()` correctly excludes any record with `revokedAt` set
 *    (the where-clause guarantees this) so a revoked key cannot
 *    authenticate. If a `revoke()` method is added later, extend this spec.
 */

interface ApiKeyRow {
  id: string;
  keyHash: string;
  keyPrefix: string;
  principalId: string;
  scope: 'FULL' | 'VERIFY_ONLY';
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  label: string | null;
}

function buildHarness() {
  const rows = new Map<string, ApiKeyRow>();
  let createCounter = 0;

  const prisma = {
    apiKey: {
      create: jest.fn(
        async ({ data }: { data: Omit<ApiKeyRow, 'id' | 'revokedAt' | 'lastUsedAt'> }) => {
          const id = `ak_${++createCounter}`;
          const row: ApiKeyRow = {
            id,
            keyHash: data.keyHash,
            keyPrefix: data.keyPrefix,
            principalId: data.principalId,
            scope: data.scope,
            label: data.label ?? null,
            revokedAt: null,
            lastUsedAt: null,
          };
          rows.set(id, row);
          return row;
        },
      ),
      findMany: jest.fn(
        async ({ where }: { where: { keyPrefix: string; revokedAt: null }; select?: unknown }) => {
          return Array.from(rows.values()).filter(
            (r) => r.keyPrefix === where.keyPrefix && r.revokedAt === null,
          );
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Pick<ApiKeyRow, 'lastUsedAt' | 'revokedAt'>>;
        }) => {
          const row = rows.get(where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      ),
    },
  } as unknown as PrismaService;

  const config = { apiKeyBcryptCost: 4 } as unknown as AppConfigService;

  return { svc: new ApiKeyService(prisma, config), prisma, config, rows };
}

describe('ApiKeyService.issue', () => {
  it('returns plaintext exactly once with `cerniq_sk_` prefix for FULL scope', async () => {
    const { svc } = buildHarness();
    const result = await svc.issue('p_1', 'CI key', 'FULL');

    expect(result.plaintextKey.startsWith('cerniq_sk_')).toBe(true);
    expect(result.plaintextKey.startsWith('cerniq_vk_')).toBe(false);
    expect(typeof result.apiKeyId).toBe('string');
    expect(result.apiKeyId.length).toBeGreaterThan(0);
  });

  it('uses `cerniq_vk_` prefix for VERIFY_ONLY scope', async () => {
    const { svc } = buildHarness();
    const result = await svc.issue('p_1', 'Verifier key', 'VERIFY_ONLY');

    expect(result.plaintextKey.startsWith('cerniq_vk_')).toBe(true);
    expect(result.plaintextKey.startsWith('cerniq_sk_')).toBe(false);
  });

  it('defaults to FULL scope when omitted', async () => {
    const { svc } = buildHarness();
    const result = await svc.issue('p_1', null);

    expect(result.plaintextKey.startsWith('cerniq_sk_')).toBe(true);
  });

  it('persists a bcrypt hash, never the plaintext', async () => {
    const { svc, rows } = buildHarness();
    const result = await svc.issue('p_1', null, 'FULL');

    const stored = Array.from(rows.values())[0];
    expect(stored).toBeDefined();
    expect(stored.keyHash).not.toEqual(result.plaintextKey);
    expect(stored.keyHash.startsWith('$2')).toBe(true); // bcryptjs prefix family
    await expect(bcrypt.compare(result.plaintextKey, stored.keyHash)).resolves.toBe(true);
  });

  it('returns keyPrefix equal to the first 12 plaintext characters', async () => {
    const { svc } = buildHarness();
    const result = await svc.issue('p_1', null, 'FULL');

    expect(result.keyPrefix).toEqual(result.plaintextKey.slice(0, 12));
    expect(result.keyPrefix).toHaveLength(12);
    expect(result.keyPrefix.startsWith('cerniq_sk_')).toBe(true);
  });

  it('honours the bcrypt cost from config', async () => {
    const { svc, rows } = buildHarness();
    await svc.issue('p_1', null, 'FULL');

    const stored = Array.from(rows.values())[0];
    // bcryptjs hashes encode cost as the second `$`-segment (e.g. `$2a$04$...`).
    const cost = Number.parseInt(stored.keyHash.split('$')[2] ?? '', 10);
    expect(cost).toBe(4);
  });

  it('produces unique plaintext for sequential issues', async () => {
    const { svc } = buildHarness();
    const a = await svc.issue('p_1', null, 'FULL');
    const b = await svc.issue('p_1', null, 'FULL');
    expect(a.plaintextKey).not.toEqual(b.plaintextKey);
  });
});

describe('ApiKeyService.resolve', () => {
  it('returns AuthenticatedKey for a valid key', async () => {
    const { svc } = buildHarness();
    const issued = await svc.issue('p_owner', null, 'FULL');
    const resolved = await svc.resolve(issued.plaintextKey);

    expect(resolved).not.toBeNull();
    expect(resolved!.principalId).toBe('p_owner');
    expect(resolved!.scope).toBe('FULL');
    expect(resolved!.apiKeyId).toBe(issued.apiKeyId);
  });

  it('returns null for an unknown plaintext with valid prefix', async () => {
    const { svc } = buildHarness();
    await svc.issue('p_owner', null, 'FULL');
    const fake = `cerniq_sk_${'x'.repeat(26)}`;
    const resolved = await svc.resolve(fake);
    expect(resolved).toBeNull();
  });

  it('returns null when the plaintext is malformed (no cerniq prefix)', async () => {
    const { svc } = buildHarness();
    expect(await svc.resolve('garbage')).toBeNull();
    expect(await svc.resolve('')).toBeNull();
    expect(await svc.resolve('Bearer abc')).toBeNull();
  });

  it('returns null for a revoked key (revokedAt set)', async () => {
    const { svc, rows } = buildHarness();
    const issued = await svc.issue('p_owner', null, 'FULL');

    // Simulate the dashboard / principals service marking it revoked.
    rows.get(issued.apiKeyId)!.revokedAt = new Date();

    const resolved = await svc.resolve(issued.plaintextKey);
    expect(resolved).toBeNull();
  });

  it('preserves scope through resolve() — VERIFY_ONLY does not become FULL', async () => {
    const { svc } = buildHarness();
    const issued = await svc.issue('p_owner', null, 'VERIFY_ONLY');
    const resolved = await svc.resolve(issued.plaintextKey);

    expect(resolved).not.toBeNull();
    expect(resolved!.scope).toBe('VERIFY_ONLY');
  });

  it('bumps lastUsedAt on a successful resolve (best-effort fire-and-forget)', async () => {
    const { svc, prisma, rows } = buildHarness();
    const issued = await svc.issue('p_owner', null, 'FULL');
    expect(rows.get(issued.apiKeyId)!.lastUsedAt).toBeNull();

    await svc.resolve(issued.plaintextKey);

    // Allow the fire-and-forget update to settle.
    await new Promise((r) => setImmediate(r));

    const updateMock = prisma.apiKey.update as unknown as jest.Mock;
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: issued.apiKeyId },
        data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      }),
    );
  });

  it('does not bump lastUsedAt for an unknown key', async () => {
    const { svc, prisma } = buildHarness();
    await svc.issue('p_owner', null, 'FULL');
    await svc.resolve(`cerniq_sk_${'z'.repeat(26)}`);

    await new Promise((r) => setImmediate(r));
    expect(prisma.apiKey.update as unknown as jest.Mock).not.toHaveBeenCalled();
  });
});
