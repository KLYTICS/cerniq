/**
 * AuditService — unit tests
 *
 * CLAUDE.md invariant #3: the audit log is append-only and signed.
 * Every write goes through `append()`. No UPDATE/DELETE on AuditEvent ever.
 * Each event includes a signature over `{prev_sig || canonical(event)}`
 * forming a tamper-evident hash chain.
 *
 * Coverage:
 *   append()              — returns evt_ ID, calls $transaction, writes row,
 *                           chains to previous event's signature
 *   list()                — ownership-scoped, cursor pagination, NotFoundException
 *   exportStream()        — async generator, scoped, NotFoundException, limit
 *   exportTenantStream()  — async generator, scoped to principalId
 *   redact()              — nulls specified fields, appends meta-event,
 *                           throws for wrong principal / empty field list
 */

import { NotFoundException } from '@nestjs/common';

import type { AuditChainUtil } from '../../common/crypto/audit-chain.util';
import type { Ed25519Util } from '../../common/crypto/ed25519.util';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AppConfigService } from '../../config/config.service';

import { AuditService, type AppendAuditInput } from './audit.service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditEventRow {
  id: string;
  agentId: string | null;
  claimedAgentId: string | null;
  principalId: string;
  action: string | null;
  actionHash: string;
  decision: string;
  denialReason: string | null;
  relyingParty: string | null;
  relyingPartyHash: string | null;
  requestedAmount: { toString(): string } | null;
  requestedAmountHash: string | null;
  currency: string | null;
  policyId: string | null;
  policySnapshot: unknown;
  policySnapshotHash: string | null;
  trustScoreAtEvent: number;
  trustBandAtEvent: string;
  aegisSignature: string;
  payloadVersion: number;
  redactedAt: Date | null;
  redactionReason: string | null;
  timestamp: Date;
}

// ── Stub factories ────────────────────────────────────────────────────────────

function makeChain(): jest.Mocked<AuditChainUtil> {
  return {
    buildPayload: jest.fn().mockReturnValue({
      signed: {
        agentId: 'agt_1',
        claimedAgentId: null,
        principalId: 'prn_A',
        decision: 'APPROVED',
        denialReason: null,
        policyId: null,
        trustScoreAtEvent: 600,
        trustBandAtEvent: 'VERIFIED',
        currency: null,
        timestamp: new Date().toISOString(),
        actionHash: 'fake_action_hash_aaa',
        relyingPartyHash: null,
        requestedAmountHash: null,
        policySnapshotHash: null,
        v: 2,
      },
      rawHashes: {
        actionHash: 'fake_action_hash_aaa',
        relyingPartyHash: null,
        requestedAmountHash: null,
        policySnapshotHash: null,
      },
    }),
    sign: jest.fn().mockResolvedValue('fake_audit_sig_b64url'),
    signWithSigner: jest.fn().mockResolvedValue('fake_audit_sig_b64url'),
    hashLeaf: jest.fn().mockReturnValue('fake_leaf_hash'),
    canonicalize: jest.fn().mockReturnValue('{}'),
  } as unknown as jest.Mocked<AuditChainUtil>;
}

function makeEd25519(): jest.Mocked<Ed25519Util> {
  return {
    generateKeypair: jest.fn().mockResolvedValue({
      privateKey: new Uint8Array(32).fill(1),
      publicKey: new Uint8Array(32).fill(2),
    }),
    sign: jest.fn(),
    verify: jest.fn(),
  };
}

function makeConfig(): jest.Mocked<Pick<AppConfigService, 'auditEd25519PrivateB64' | 'auditEd25519PublicB64' | 'nodeEnv'>> {
  // No env keys → will use ephemeral key (fine for tests; not production)
  return {
    auditEd25519PrivateB64: undefined,
    auditEd25519PublicB64: undefined,
    nodeEnv: 'test',
  };
}

/**
 * Build a Prisma mock that shares an in-memory `events` array.
 * The `$transaction` mock calls the callback with a tx stub whose
 * `auditEvent.create` pushes into the same array as the outer queries.
 */
function makePrisma(initialEvents: AuditEventRow[] = [], agents: { id: string; principalId: string }[] = []) {
  const events: AuditEventRow[] = [...initialEvents];

  // The tx stub used inside $transaction callbacks
  const txStub = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    auditEvent: {
      findFirst: jest.fn(async ({ where }: { where: { agentId?: string | null; principalId?: string } & Record<string, unknown> }) => {
        return events.find((e) => {
          if (where.agentId !== undefined && e.agentId !== where.agentId) return false;
          if (where.principalId !== undefined && e.principalId !== where.principalId) return false;
          return true;
        }) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Partial<AuditEventRow> & { id: string } }) => {
        const row: AuditEventRow = {
          id: data.id,
          agentId: data.agentId ?? null,
          claimedAgentId: data.claimedAgentId ?? null,
          principalId: data.principalId ?? 'prn_?',
          action: data.action ?? null,
          actionHash: data.actionHash ?? '',
          decision: data.decision ?? 'APPROVED',
          denialReason: data.denialReason ?? null,
          relyingParty: data.relyingParty ?? null,
          relyingPartyHash: data.relyingPartyHash ?? null,
          requestedAmount: null,
          requestedAmountHash: data.requestedAmountHash ?? null,
          currency: data.currency ?? null,
          policyId: data.policyId ?? null,
          policySnapshot: data.policySnapshot ?? null,
          policySnapshotHash: data.policySnapshotHash ?? null,
          trustScoreAtEvent: data.trustScoreAtEvent ?? 0,
          trustBandAtEvent: data.trustBandAtEvent ?? 'VERIFIED',
          aegisSignature: data.aegisSignature ?? '',
          payloadVersion: data.payloadVersion ?? 2,
          redactedAt: null,
          redactionReason: null,
          timestamp: data.timestamp instanceof Date ? data.timestamp : new Date(),
        };
        events.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callbackOrArr: unknown, _opts?: unknown) => {
      if (typeof callbackOrArr === 'function') {
        return callbackOrArr(txStub);
      }
      return await Promise.all(callbackOrArr as Promise<unknown>[]);
    }),
    agentIdentity: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string; principalId?: string } }) => {
        return agents.find(
          (a) =>
            (!where.id || a.id === where.id) &&
            (!where.principalId || a.principalId === where.principalId),
        ) ?? null;
      }),
    },
    auditEvent: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string; principalId?: string } & Record<string, unknown> }) => {
        return events.find((e) => {
          if (where.id !== undefined && e.id !== where.id) return false;
          if (where.principalId !== undefined && e.principalId !== where.principalId) return false;
          return true;
        }) ?? null;
      }),
      findMany: jest.fn(async ({ where, take, orderBy, cursor, skip }: {
        where?: Partial<AuditEventRow> & Record<string, unknown>;
        take?: number;
        orderBy?: unknown;
        cursor?: { id: string };
        skip?: number;
      }) => {
        let filtered = events.filter((e) => {
          if (where?.agentId !== undefined && e.agentId !== where.agentId) return false;
          if (where?.principalId !== undefined && e.principalId !== where.principalId) return false;
          return true;
        });
        // Stable order: by timestamp asc or desc
        if (orderBy && (orderBy as Record<string, string>).timestamp === 'asc') {
          filtered = [...filtered].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        } else {
          filtered = [...filtered].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        }
        // Cursor pagination
        if (cursor) {
          const idx = filtered.findIndex((e) => e.id === cursor.id);
          if (idx !== -1) filtered = filtered.slice(idx + (skip ?? 1));
        }
        if (take !== undefined) filtered = filtered.slice(0, take);
        return filtered;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<AuditEventRow> }) => {
        const row = events.find((e) => e.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  };

  return { prisma, events, txStub };
}

// ── Service factory ───────────────────────────────────────────────────────────

function makeService(opts: {
  initialEvents?: AuditEventRow[];
  agents?: { id: string; principalId: string }[];
} = {}) {
  const { prisma, events, txStub } = makePrisma(opts.initialEvents ?? [], opts.agents ?? []);
  const config = makeConfig();
  const chain = makeChain();
  const ed25519 = makeEd25519();

  const svc = new AuditService(
    prisma as unknown as PrismaService,
    config as unknown as AppConfigService,
    chain,
    ed25519,
    // No KMS signer — dev path
    undefined,
  );

  return { svc, prisma, events, txStub, chain, ed25519 };
}

// ── Shared input fixture ──────────────────────────────────────────────────────

const BASE_APPEND: AppendAuditInput = {
  agentId: 'agt_1',
  principalId: 'prn_A',
  action: 'commerce.purchase',
  decision: 'APPROVED',
  trustScoreAtEvent: 650,
  trustBandAtEvent: 'VERIFIED',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuditService', () => {
  // ── append() ───────────────────────────────────────────────────────────────

  describe('append()', () => {
    it('returns an eventId starting with evt_', async () => {
      const { svc } = makeService();
      const id = await svc.append(BASE_APPEND);
      expect(id).toMatch(/^evt_/);
    });

    it('calls prisma.$transaction once per append', async () => {
      const { svc, prisma } = makeService();
      await svc.append(BASE_APPEND);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('creates an AuditEvent row inside the transaction', async () => {
      const { svc, txStub } = makeService();
      await svc.append(BASE_APPEND);
      expect(txStub.auditEvent.create).toHaveBeenCalledTimes(1);
      const callArg = (txStub.auditEvent.create as jest.Mock).mock.calls[0][0] as { data: AuditEventRow };
      expect(callArg.data.id).toMatch(/^evt_/);
      expect(callArg.data.principalId).toBe('prn_A');
      expect(callArg.data.agentId).toBe('agt_1');
    });

    it('calls chain.sign (CLAUDE.md invariant #3 — events are signed)', async () => {
      const { svc, chain } = makeService();
      await svc.append(BASE_APPEND);
      expect(chain.sign).toHaveBeenCalledTimes(1);
    });

    it('writes the chain signature to the aegisSignature column', async () => {
      const { svc, events } = makeService();
      await svc.append(BASE_APPEND);
      expect(events[0].aegisSignature).toBe('fake_audit_sig_b64url');
    });

    it('passes prevEventId=null for the first event in a chain', async () => {
      const { svc, chain } = makeService();
      await svc.append(BASE_APPEND);
      expect(chain.sign).toHaveBeenCalledWith(
        expect.objectContaining({ prevEventId: null, prevSignatureB64Url: null }),
        expect.any(Uint8Array),
      );
    });

    it('acquires a Postgres advisory xact lock inside the transaction', async () => {
      const { svc, txStub } = makeService();
      await svc.append(BASE_APPEND);
      expect(txStub.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('initialises an ephemeral key when no env key is configured', async () => {
      const { svc, ed25519 } = makeService();
      await svc.append(BASE_APPEND);
      expect(ed25519.generateKeypair).toHaveBeenCalledTimes(1);
    });

    it('does NOT reinitialise the signing key on subsequent appends', async () => {
      const { svc, ed25519 } = makeService();
      await svc.append(BASE_APPEND);
      await svc.append({ ...BASE_APPEND, action: 'commerce.refund' });
      expect(ed25519.generateKeypair).toHaveBeenCalledTimes(1);
    });

    it('rethrows Prisma errors (fail closed — append-only guarantee)', async () => {
      const { prisma } = makePrisma();
      const config = makeConfig();
      const chain = makeChain();
      const ed = makeEd25519();

      // Make $transaction throw
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('DEADLOCK'));
      const svc = new AuditService(
        prisma as unknown as PrismaService,
        config as unknown as AppConfigService,
        chain,
        ed,
      );
      await expect(svc.append(BASE_APPEND)).rejects.toThrow('DEADLOCK');
    });

    it('publicKey() returns the public key after first append initialises it', async () => {
      const { svc } = makeService();
      await svc.append(BASE_APPEND);
      const pk = svc.publicKey();
      expect(pk.format).toBe('ed25519-base64url');
      expect(typeof pk.key).toBe('string');
      expect(pk.key.length).toBeGreaterThan(0);
    });

    it('two appends produce different eventIds', async () => {
      const { svc } = makeService();
      const id1 = await svc.append(BASE_APPEND);
      const id2 = await svc.append(BASE_APPEND);
      expect(id1).not.toBe(id2);
    });
  });

  // ── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    const AGENT = { id: 'agt_1', principalId: 'prn_A' };

    it('throws NotFoundException when agent does not belong to principal', async () => {
      const { svc } = makeService({ agents: [AGENT] });
      await expect(svc.list('prn_B', 'agt_1', {})).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when agentId does not exist', async () => {
      const { svc } = makeService({ agents: [] });
      await expect(svc.list('prn_A', 'agt_nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    it('returns empty list when agent has no events', async () => {
      const { svc } = makeService({ agents: [AGENT], initialEvents: [] });
      const result = await svc.list('prn_A', 'agt_1', {});
      expect(result.events).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.count).toBe(0);
    });

    it('returns mapped DTOs for existing events', async () => {
      const events: AuditEventRow[] = [
        {
          id: 'evt_alpha',
          agentId: 'agt_1',
          claimedAgentId: null,
          principalId: 'prn_A',
          action: 'commerce.purchase',
          actionHash: 'ahash',
          decision: 'APPROVED',
          denialReason: null,
          relyingParty: null,
          relyingPartyHash: null,
          requestedAmount: null,
          requestedAmountHash: null,
          currency: null,
          policyId: null,
          policySnapshot: null,
          policySnapshotHash: null,
          trustScoreAtEvent: 700,
          trustBandAtEvent: 'PLATINUM',
          aegisSignature: 'sig_x',
          payloadVersion: 2,
          redactedAt: null,
          redactionReason: null,
          timestamp: new Date('2025-01-01T00:00:00Z'),
        },
      ];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const result = await svc.list('prn_A', 'agt_1', {});
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventId).toBe('evt_alpha');
      expect(result.events[0].agentId).toBe('agt_1');
      expect(result.events[0].decision).toBe('APPROVED');
      expect(result.events[0].trustScoreAtEvent).toBe(700);
      expect(result.events[0].signature).toBe('sig_x');
    });

    it('respects the limit parameter', async () => {
      const events: AuditEventRow[] = Array.from({ length: 5 }, (_, i) => ({
        id: `evt_${i}`,
        agentId: 'agt_1',
        claimedAgentId: null,
        principalId: 'prn_A',
        action: 'commerce.purchase',
        actionHash: `hash_${i}`,
        decision: 'APPROVED',
        denialReason: null,
        relyingParty: null,
        relyingPartyHash: null,
        requestedAmount: null,
        requestedAmountHash: null,
        currency: null,
        policyId: null,
        policySnapshot: null,
        policySnapshotHash: null,
        trustScoreAtEvent: 600,
        trustBandAtEvent: 'VERIFIED',
        aegisSignature: 'sig',
        payloadVersion: 2,
        redactedAt: null,
        redactionReason: null,
        timestamp: new Date(Date.now() + i * 1000),
      }));
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const result = await svc.list('prn_A', 'agt_1', { limit: 3 });
      expect(result.events).toHaveLength(3);
      expect(result.nextCursor).not.toBeNull();
    });

    it('nextCursor is null when all events fit in one page', async () => {
      const events: AuditEventRow[] = [
        {
          id: 'evt_only',
          agentId: 'agt_1',
          claimedAgentId: null,
          principalId: 'prn_A',
          action: null,
          actionHash: 'h',
          decision: 'DENIED',
          denialReason: 'SCOPE_NOT_GRANTED',
          relyingParty: null,
          relyingPartyHash: null,
          requestedAmount: null,
          requestedAmountHash: null,
          currency: null,
          policyId: null,
          policySnapshot: null,
          policySnapshotHash: null,
          trustScoreAtEvent: 200,
          trustBandAtEvent: 'WATCH',
          aegisSignature: 'sig2',
          payloadVersion: 2,
          redactedAt: null,
          redactionReason: null,
          timestamp: new Date(),
        },
      ];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const result = await svc.list('prn_A', 'agt_1', { limit: 10 });
      expect(result.nextCursor).toBeNull();
    });
  });

  // ── exportStream() ─────────────────────────────────────────────────────────

  describe('exportStream()', () => {
    const AGENT = { id: 'agt_1', principalId: 'prn_A' };

    it('throws NotFoundException when agent does not belong to principal', async () => {
      const { svc } = makeService({ agents: [AGENT] });
      const gen = svc.exportStream('prn_B', 'agt_1', {});
      await expect(gen.next()).rejects.toThrow(NotFoundException);
    });

    it('yields zero items when agent has no events', async () => {
      const { svc } = makeService({ agents: [AGENT], initialEvents: [] });
      const items: unknown[] = [];
      for await (const row of svc.exportStream('prn_A', 'agt_1', {})) {
        items.push(row);
      }
      expect(items).toHaveLength(0);
    });

    it('yields all events in chronological order (asc)', async () => {
      const t0 = new Date('2025-01-01T10:00:00Z');
      const t1 = new Date('2025-01-01T11:00:00Z');
      const events: AuditEventRow[] = [
        { ...makeEventRow('evt_b', 'agt_1', 'prn_A', t1) },
        { ...makeEventRow('evt_a', 'agt_1', 'prn_A', t0) },
      ];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const yielded: string[] = [];
      for await (const row of svc.exportStream('prn_A', 'agt_1', {})) {
        yielded.push(row.eventId);
      }
      expect(yielded).toEqual(['evt_a', 'evt_b']); // chronological asc
    });

    it('yields each event with the aegisSignature field', async () => {
      const events = [{ ...makeEventRow('evt_x', 'agt_1', 'prn_A', new Date()) }];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const items: { aegisSignature: string; eventId: string }[] = [];
      for await (const row of svc.exportStream('prn_A', 'agt_1', {})) {
        items.push(row);
      }
      expect(items[0].aegisSignature).toBeDefined();
    });
  });

  // ── exportTenantStream() ───────────────────────────────────────────────────

  describe('exportTenantStream()', () => {
    it('yields only events for the requesting principalId', async () => {
      const events: AuditEventRow[] = [
        makeEventRow('evt_a1', 'agt_1', 'prn_A', new Date()),
        makeEventRow('evt_b1', 'agt_2', 'prn_B', new Date()),
      ];
      const { svc } = makeService({ agents: [], initialEvents: events });
      const yielded: string[] = [];
      for await (const row of svc.exportTenantStream('prn_A', {})) {
        yielded.push(row.eventId);
      }
      expect(yielded).toEqual(['evt_a1']);
    });

    it('yields zero items when principal has no events', async () => {
      const { svc } = makeService({ agents: [], initialEvents: [] });
      const items: unknown[] = [];
      for await (const row of svc.exportTenantStream('prn_A', {})) {
        items.push(row);
      }
      expect(items).toHaveLength(0);
    });

    it('respects limit on the stream', async () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        makeEventRow(`evt_${i}`, 'agt_1', 'prn_A', new Date(Date.now() + i * 1000)),
      );
      const { svc } = makeService({ agents: [], initialEvents: events });
      const items: unknown[] = [];
      for await (const row of svc.exportTenantStream('prn_A', { limit: 2 })) {
        items.push(row);
      }
      expect(items).toHaveLength(2);
    });
  });

  // ── redact() ───────────────────────────────────────────────────────────────

  describe('redact()', () => {
    const AGENT = { id: 'agt_1', principalId: 'prn_A' };

    it('throws NotFoundException when event does not belong to principalId', async () => {
      const events = [makeEventRow('evt_x', 'agt_1', 'prn_B', new Date())];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      // prn_A tries to redact prn_B's event
      await expect(svc.redact('evt_x', 'prn_A', ['action'], 'gdpr')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when eventId does not exist', async () => {
      const { svc } = makeService({ agents: [AGENT] });
      await expect(svc.redact('evt_nonexistent', 'prn_A', ['action'], 'gdpr')).rejects.toThrow(NotFoundException);
    });

    it('throws when no redactable fields are supplied', async () => {
      const events = [makeEventRow('evt_y', 'agt_1', 'prn_A', new Date())];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      // type-cast: pass empty array at runtime
      await expect(svc.redact('evt_y', 'prn_A', [] as never, 'gdpr')).rejects.toThrow(/field/i);
    });

    it('calls auditEvent.update to null the action field', async () => {
      const events = [makeEventRow('evt_z', 'agt_1', 'prn_A', new Date())];
      const { svc, prisma } = makeService({ agents: [AGENT], initialEvents: events });
      await svc.redact('evt_z', 'prn_A', ['action'], 'gdpr');
      expect(prisma.auditEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt_z' },
          data: expect.objectContaining({ action: null }),
        }),
      );
    });

    it('sets redactedAt on the updated row', async () => {
      const events = [makeEventRow('evt_z2', 'agt_1', 'prn_A', new Date())];
      const { svc, prisma } = makeService({ agents: [AGENT], initialEvents: events });
      await svc.redact('evt_z2', 'prn_A', ['action'], 'gdpr-erasure');
      const updateCall = (prisma.auditEvent.update as jest.Mock).mock.calls[0][0] as { data: AuditEventRow };
      expect(updateCall.data.redactedAt).toBeInstanceOf(Date);
    });

    it('returns { eventId, redactedFields, redactionAuditId }', async () => {
      const events = [makeEventRow('evt_r', 'agt_1', 'prn_A', new Date())];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const result = await svc.redact('evt_r', 'prn_A', ['action', 'relyingParty'], 'gdpr');
      expect(result.eventId).toBe('evt_r');
      expect(result.redactedFields).toContain('action');
      expect(result.redactedFields).toContain('relyingParty');
      expect(result.redactionAuditId).toMatch(/^evt_/);
    });

    it('appends a meta-event with action=audit.redact (chain self-references the redaction)', async () => {
      const events = [makeEventRow('evt_m', 'agt_1', 'prn_A', new Date())];
      const { svc, events: storedEvents } = makeService({ agents: [AGENT], initialEvents: events });
      await svc.redact('evt_m', 'prn_A', ['policySnapshot'], 'gdpr');
      // The meta-event is the second row (appended after the original)
      const meta = storedEvents.find((e) => e.action === 'audit.redact');
      expect(meta).toBeDefined();
      expect(meta!.principalId).toBe('prn_A');
    });

    it('returns a different ID for the redaction meta-event than the original event', async () => {
      const events = [makeEventRow('evt_orig', 'agt_1', 'prn_A', new Date())];
      const { svc } = makeService({ agents: [AGENT], initialEvents: events });
      const result = await svc.redact('evt_orig', 'prn_A', ['action'], 'gdpr');
      expect(result.redactionAuditId).not.toBe('evt_orig');
    });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEventRow(
  id: string,
  agentId: string,
  principalId: string,
  timestamp: Date,
  overrides: Partial<AuditEventRow> = {},
): AuditEventRow {
  return {
    id,
    agentId,
    claimedAgentId: null,
    principalId,
    action: 'commerce.purchase',
    actionHash: `hash_${id}`,
    decision: 'APPROVED',
    denialReason: null,
    relyingParty: null,
    relyingPartyHash: null,
    requestedAmount: null,
    requestedAmountHash: null,
    currency: null,
    policyId: null,
    policySnapshot: null,
    policySnapshotHash: null,
    trustScoreAtEvent: 650,
    trustBandAtEvent: 'VERIFIED',
    aegisSignature: `sig_${id}`,
    payloadVersion: 2,
    redactedAt: null,
    redactionReason: null,
    timestamp,
    ...overrides,
  };
}
