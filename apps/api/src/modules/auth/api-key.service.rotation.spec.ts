import * as bcrypt from 'bcryptjs';

import {
  AlreadyRotatedError,
  AuthorizationError,
  NotFoundError,
} from '../../common/errors/cerniq-error';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AppConfigService } from '../../config/config.service';
import type { AuditService } from '../audit/audit.service';

import { ApiKeyService } from './api-key.service';

/**
 * Rotation-only service tests. Kept separate from api-key.service.spec.ts
 * (issue + resolve) so the harnesses don't bloat. Coverage:
 *   - happy path (24 h default + custom overlap)
 *   - scope inheritance
 *   - atomicity (transaction throws → no partial state)
 *   - already-rotated (expiresAt in future)
 *   - cross-principal (guard bypass simulation)
 *   - revoked calling key
 *   - audit emission shape (NO plaintext in payload)
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
  expiresAt: Date | null;
}

function buildHarness(opts: { failTransaction?: boolean } = {}) {
  const rows = new Map<string, ApiKeyRow>();
  let createCounter = 0;

  const apiKeyOps = {
    findUnique: jest.fn(async ({ where }: { where: { id: string }; select?: unknown }) => {
      const row = rows.get(where.id);
      return row ?? null;
    }),
    findMany: jest.fn(async () => Array.from(rows.values())),
    create: jest.fn(
      async ({
        data,
      }: {
        data: Omit<ApiKeyRow, 'id' | 'revokedAt' | 'lastUsedAt' | 'expiresAt'>;
      }) => {
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
          expiresAt: null,
        };
        rows.set(id, row);
        return row;
      },
    ),
    update: jest.fn(
      async ({ where, data }: { where: { id: string }; data: Partial<ApiKeyRow> }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    ),
  };

  const txClient = { apiKey: apiKeyOps };

  const prisma = {
    apiKey: apiKeyOps,
    $transaction: jest.fn(async (cb: (tx: typeof txClient) => Promise<unknown>) => {
      if (opts.failTransaction) {
        // Snapshot rows so we can restore if a partial mutation occurred.
        const snapshot = new Map(Array.from(rows.entries()).map(([k, v]) => [k, { ...v }]));
        try {
          await cb(txClient);
        } finally {
          // Simulate Postgres rollback — restore snapshot regardless of cb.
          rows.clear();
          for (const [k, v] of snapshot) rows.set(k, v);
        }
        throw new Error('simulated tx failure');
      }
      return await cb(txClient);
    }),
  } as unknown as PrismaService;

  const config = { apiKeyBcryptCost: 4 } as unknown as AppConfigService;

  const audit = { append: jest.fn(async () => 'evt_test') } as unknown as AuditService;

  // Constructor: (prisma, config, redis?, audit?). Tests that don't exercise
  // the cache pass `undefined` in the redis slot — audit stays at index 4.
  return { svc: new ApiKeyService(prisma, config, undefined, audit), prisma, rows, audit };
}

async function seedKey(
  rows: Map<string, ApiKeyRow>,
  overrides: Partial<ApiKeyRow> = {},
): Promise<ApiKeyRow> {
  const plaintext = `cerniq_sk_${'a'.repeat(26)}`;
  const hash = await bcrypt.hash(plaintext, 4);
  const id = overrides.id ?? `ak_seed_${rows.size + 1}`;
  const row: ApiKeyRow = {
    id,
    keyHash: hash,
    keyPrefix: plaintext.slice(0, 12),
    principalId: 'p_alice',
    scope: 'FULL',
    label: null,
    revokedAt: null,
    lastUsedAt: null,
    expiresAt: null,
    ...overrides,
  };
  rows.set(id, row);
  return row;
}

describe('ApiKeyService.rotate — happy path', () => {
  it('mints new plaintext, marks old key expired in 24h by default', async () => {
    const { svc, rows } = buildHarness();
    const old = await seedKey(rows);
    const before = Date.now();

    const result = await svc.rotate(old.id, 'p_alice');

    expect(result.newKey.plaintext).toMatch(/^cerniq_sk_[A-Za-z0-9]+$/);
    expect(result.newKey.plaintext).toHaveLength('cerniq_sk_'.length + 26);
    expect(result.newKey.id).not.toBe(old.id);
    expect(result.newKey.expiresAt).toBeNull();

    const overlapMs = result.oldKey.expiresAt.getTime() - before;
    // 24h ± 2s tolerance for test wall-clock jitter.
    expect(overlapMs).toBeGreaterThan(24 * 60 * 60 * 1000 - 2_000);
    expect(overlapMs).toBeLessThan(24 * 60 * 60 * 1000 + 2_000);

    // Old row in the harness is now stamped with expiresAt.
    const oldRowAfter = rows.get(old.id)!;
    expect(oldRowAfter.expiresAt).not.toBeNull();
    expect(oldRowAfter.expiresAt!.getTime()).toEqual(result.oldKey.expiresAt.getTime());

    // New row has matching scope + principal.
    const newRow = rows.get(result.newKey.id)!;
    expect(newRow.principalId).toBe('p_alice');
    expect(newRow.scope).toBe('FULL');
    expect(newRow.expiresAt).toBeNull();
  });

  it('honours custom overlap window (e.g. 1h for breach response)', async () => {
    const { svc, rows } = buildHarness();
    const old = await seedKey(rows);
    const before = Date.now();

    const result = await svc.rotate(old.id, 'p_alice', 1);

    const overlapMs = result.oldKey.expiresAt.getTime() - before;
    expect(overlapMs).toBeGreaterThan(60 * 60 * 1000 - 2_000);
    expect(overlapMs).toBeLessThan(60 * 60 * 1000 + 2_000);
  });

  it('inherits scope from the calling key (VERIFY_ONLY stays VERIFY_ONLY)', async () => {
    const { svc, rows } = buildHarness();
    const old = await seedKey(rows, { scope: 'VERIFY_ONLY', keyPrefix: 'cerniq_vk_aa' });

    const result = await svc.rotate(old.id, 'p_alice');

    expect(result.newKey.plaintext.startsWith('cerniq_vk_')).toBe(true);
    const newRow = rows.get(result.newKey.id)!;
    expect(newRow.scope).toBe('VERIFY_ONLY');
  });

  it('persists a bcrypt hash for the new key — not the plaintext', async () => {
    const { svc, rows } = buildHarness();
    const old = await seedKey(rows);

    const result = await svc.rotate(old.id, 'p_alice');
    const newRow = rows.get(result.newKey.id)!;

    expect(newRow.keyHash).not.toEqual(result.newKey.plaintext);
    expect(newRow.keyHash.startsWith('$2')).toBe(true);
    await expect(bcrypt.compare(result.newKey.plaintext, newRow.keyHash)).resolves.toBe(true);
  });
});

describe('ApiKeyService.rotate — error paths', () => {
  it('throws NotFoundError for an unknown calling key id', async () => {
    const { svc } = buildHarness();
    await expect(svc.rotate('ak_does_not_exist', 'p_alice')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws AuthorizationError if the calling key belongs to another principal', async () => {
    const { svc, rows } = buildHarness();
    const other = await seedKey(rows, { principalId: 'p_attacker' });

    await expect(svc.rotate(other.id, 'p_alice')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throws NotFoundError for a revoked calling key', async () => {
    const { svc, rows } = buildHarness();
    const old = await seedKey(rows, { revokedAt: new Date() });

    await expect(svc.rotate(old.id, 'p_alice')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws AlreadyRotatedError if the calling key is already inside an overlap window', async () => {
    const { svc, rows } = buildHarness();
    const future = new Date(Date.now() + 60 * 60 * 1000); // +1h
    const old = await seedKey(rows, { expiresAt: future });

    await expect(svc.rotate(old.id, 'p_alice')).rejects.toBeInstanceOf(AlreadyRotatedError);
  });

  it('rejects overlapHours <= 0 (no silent default)', async () => {
    const { svc, rows } = buildHarness();
    const old = await seedKey(rows);

    await expect(svc.rotate(old.id, 'p_alice', 0)).rejects.toThrow(/overlapHours/);
    await expect(svc.rotate(old.id, 'p_alice', -1)).rejects.toThrow(/overlapHours/);
    await expect(svc.rotate(old.id, 'p_alice', Number.NaN)).rejects.toThrow(/overlapHours/);
  });
});

describe('ApiKeyService.rotate — atomicity', () => {
  it('on transaction failure, no partial state is left behind', async () => {
    const { svc, rows } = buildHarness({ failTransaction: true });
    const old = await seedKey(rows);

    await expect(svc.rotate(old.id, 'p_alice')).rejects.toThrow('simulated tx failure');

    // The old key MUST NOT have been stamped.
    expect(rows.get(old.id)!.expiresAt).toBeNull();
    // No new row created (rollback restored snapshot).
    expect(rows.size).toBe(1);
  });
});

describe('ApiKeyService.rotate — audit emission', () => {
  it('appends an api_key.rotated event with old + new key ids — NO plaintext', async () => {
    const { svc, rows, audit } = buildHarness();
    const old = await seedKey(rows);

    const result = await svc.rotate(old.id, 'p_alice');

    expect(audit.append as jest.Mock).toHaveBeenCalledTimes(1);
    const appendArgs = (audit.append as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;

    expect(appendArgs.action).toBe('api_key.rotated');
    expect(appendArgs.decision).toBe('APPROVED');
    expect(appendArgs.principalId).toBe('p_alice');
    expect(appendArgs.agentId).toBeNull();

    const snapshot = appendArgs.policySnapshot as Record<string, unknown>;
    expect(snapshot.oldKeyId).toBe(old.id);
    expect(snapshot.newKeyId).toBe(result.newKey.id);
    expect(snapshot.overlapHours).toBe(24);

    // CRITICAL: plaintext must NOT appear anywhere in the audit payload.
    const serialised = JSON.stringify(appendArgs);
    expect(serialised).not.toContain(result.newKey.plaintext);
    expect(serialised.toLowerCase()).not.toContain('plaintext');
    expect(serialised).not.toContain('cerniq_sk_');
    expect(serialised).not.toContain('cerniq_vk_');
  });

  it('audit append failure surfaces — does not silently swallow', async () => {
    const { svc, rows, audit } = buildHarness();
    (audit.append as jest.Mock).mockRejectedValueOnce(new Error('audit chain offline'));
    const old = await seedKey(rows);

    await expect(svc.rotate(old.id, 'p_alice')).rejects.toThrow('audit chain offline');
  });
});
