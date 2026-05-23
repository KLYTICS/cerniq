import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import {
  DEMO_EMAIL_SUFFIX,
  PERSONAS,
  canonicalize,
  deterministicRng,
  mintApiKeyPlaintext,
  planAgentEvents,
  planBateForAgent,
  prevHash,
  runSeedDemo,
  signAuditChain,
  verifySignedChain,
  type DemoCipher,
  type DemoPrisma,
} from './seed-demo.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ──────────────────────────────────────────────────────────────────
// In-memory Prisma + cipher mocks.
// ──────────────────────────────────────────────────────────────────

interface Recorded {
  principals: Array<{ id: string; email: string; data: Record<string, unknown> }>;
  apiKeys: Array<{ id: string; principalId: string; data: Record<string, unknown> }>;
  agents: Array<{ id: string; principalId: string; data: Record<string, unknown> }>;
  policies: Array<{ id: string; agentId: string; data: Record<string, unknown> }>;
  webhooks: Array<{
    id: string;
    principalId: string;
    secret: string;
    data: Record<string, unknown>;
  }>;
  bateSignals: Array<{ id: string; data: Record<string, unknown> }>;
  auditEvents: Array<{ id: string; data: Record<string, unknown> }>;
  deletedSuffixes: string[];
}

function buildPrisma(): { prisma: DemoPrisma; rec: Recorded } {
  const rec: Recorded = {
    principals: [],
    apiKeys: [],
    agents: [],
    policies: [],
    webhooks: [],
    bateSignals: [],
    auditEvents: [],
    deletedSuffixes: [],
  };
  let n = 0;
  const id = (p: string): string => `${p}_${++n}`;

  const prisma: DemoPrisma = {
    principal: {
      async deleteMany(args) {
        rec.deletedSuffixes.push(args.where.email.endsWith);
        // Also clear in-memory state so a re-run starts clean.
        rec.principals = rec.principals.filter((p) => !p.email.endsWith(args.where.email.endsWith));
        return { count: 0 };
      },
      async create(args) {
        const pid = id('prc');
        const email = String(args.data.email);
        rec.principals.push({ id: pid, email, data: args.data });
        return { id: pid, email };
      },
    },
    apiKey: {
      async create(args) {
        const apid = id('apk');
        rec.apiKeys.push({ id: apid, principalId: String(args.data.principalId), data: args.data });
        return { id: apid, principalId: String(args.data.principalId) };
      },
    },
    agentIdentity: {
      async create(args) {
        const aid = id('agt');
        rec.agents.push({ id: aid, principalId: String(args.data.principalId), data: args.data });
        return { id: aid, principalId: String(args.data.principalId) };
      },
    },
    agentPolicy: {
      async create(args) {
        const polid = id('pol');
        rec.policies.push({ id: polid, agentId: String(args.data.agentId), data: args.data });
        return { id: polid, agentId: String(args.data.agentId) };
      },
    },
    webhookSubscription: {
      async create(args) {
        const wid = id('whk');
        rec.webhooks.push({
          id: wid,
          principalId: String(args.data.principalId),
          secret: String(args.data.secret),
          data: args.data,
        });
        return {
          id: wid,
          principalId: String(args.data.principalId),
          secret: String(args.data.secret),
        };
      },
    },
    bateSignal: {
      async create(args) {
        const bid = id('bate');
        rec.bateSignals.push({ id: bid, data: args.data });
        return { id: bid };
      },
    },
    auditEvent: {
      async create(args) {
        const eid = String(args.data.id);
        rec.auditEvents.push({ id: eid, data: args.data });
        return { id: eid };
      },
    },
    async $disconnect() {
      /* no-op */
    },
  };
  return { prisma, rec };
}

const PREFIX = 'v1:';
function buildCipher(): DemoCipher {
  return {
    isEncrypted: (v) => typeof v === 'string' && v.startsWith(PREFIX),
    encrypt: (pt) => `${PREFIX}iv:tag:${Buffer.from(pt, 'utf8').toString('base64url')}`,
  };
}

// ──────────────────────────────────────────────────────────────────
// Pure-helper tests.
// ──────────────────────────────────────────────────────────────────

describe('mintApiKeyPlaintext', () => {
  it('produces cerniq_sk_-prefixed plaintext with stable prefix slice', () => {
    const k = mintApiKeyPlaintext();
    expect(k.plaintext.startsWith('cerniq_sk_')).toBe(true);
    expect(k.prefix).toBe(k.plaintext.slice(0, 12));
  });
});

describe('canonicalize', () => {
  it('sorts object keys recursively and produces stable byte output', () => {
    const a = canonicalize({ b: 1, a: { z: 2, y: [3, { q: 1, p: 0 }] } });
    const b = canonicalize({ a: { y: [3, { p: 0, q: 1 }], z: 2 }, b: 1 });
    expect(a).toBe(b);
  });
});

describe('prevHash', () => {
  it('returns the genesis hash when both args null', () => {
    const h1 = prevHash(null, null);
    const h2 = prevHash(null, null);
    expect(h1.equals(h2)).toBe(true);
    expect(h1.length).toBe(32);
  });
  it('throws when only one of the two is null', () => {
    expect(() => prevHash('evt', null)).toThrowError(/both/);
    expect(() => prevHash(null, 'sig')).toThrowError(/both/);
  });
});

describe('deterministicRng', () => {
  it('is reproducible given the same seed', () => {
    const a = deterministicRng(42);
    const b = deterministicRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });
});

// ──────────────────────────────────────────────────────────────────
// Plan + chain tests.
// ──────────────────────────────────────────────────────────────────

describe('planAgentEvents', () => {
  it('produces the requested count and timestamps inside the 14-day window', () => {
    const end = new Date('2026-05-05T00:00:00Z');
    const events = planAgentEvents({
      principalId: 'prc_1',
      agentId: 'agt_1',
      agentLabel: 'demo/agent',
      count: 25,
      endTime: end,
      rng: deterministicRng(1),
    });
    expect(events.length).toBe(25);
    const lo = end.getTime() - 14 * 24 * 60 * 60 * 1000;
    for (const e of events) {
      expect(e.timestamp.getTime()).toBeGreaterThanOrEqual(lo);
      expect(e.timestamp.getTime()).toBeLessThanOrEqual(end.getTime() + 60_000);
    }
  });

  it('mixes ALLOWED ~80% / DENIED ~20% with realistic denial reasons', () => {
    const events = planAgentEvents({
      principalId: 'prc_1',
      agentId: 'agt_1',
      agentLabel: 'demo/agent',
      count: 200,
      endTime: new Date('2026-05-05T00:00:00Z'),
      rng: deterministicRng(7),
    });
    const denied = events.filter((e) => e.decision === 'DENIED');
    expect(denied.length).toBeGreaterThanOrEqual(20); // > 10%
    expect(denied.length).toBeLessThanOrEqual(60); // < 30%
    for (const d of denied) {
      expect([
        'INVALID_SIGNATURE',
        'SCOPE_NOT_GRANTED',
        'SPEND_LIMIT_EXCEEDED',
        'TRUST_SCORE_TOO_LOW',
      ]).toContain(d.denialReason);
    }
  });
});

describe('signAuditChain + verifySignedChain', () => {
  it('signs each event and the chain self-verifies under the public key', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const planned = planAgentEvents({
      principalId: 'prc_1',
      agentId: 'agt_1',
      agentLabel: 'demo/agent',
      count: 6,
      endTime: new Date('2026-05-05T00:00:00Z'),
      rng: deterministicRng(3),
    });
    const signed = await signAuditChain({
      events: planned,
      privateKey: priv,
      partitionBy: 'agentId',
    });
    const verify = await verifySignedChain(signed, pub, 'agentId');
    expect(verify).toEqual({ ok: true });
  });

  it('detects a chain break when one signature is mutated', async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const planned = planAgentEvents({
      principalId: 'prc_2',
      agentId: 'agt_2',
      agentLabel: 'demo/agent2',
      count: 5,
      endTime: new Date('2026-05-05T00:00:00Z'),
      rng: deterministicRng(11),
    });
    const signed = await signAuditChain({
      events: planned,
      privateKey: priv,
      partitionBy: 'agentId',
    });
    // Tamper with the third event's signature byte.
    const tampered = signed.map((s, i) =>
      i === 2
        ? {
            ...s,
            cerniqSignature: Buffer.from(s.cerniqSignature, 'base64url')
              .reverse()
              .toString('base64url'),
          }
        : s,
    );
    const verify = await verifySignedChain(tampered, pub, 'agentId');
    expect(verify.ok).toBe(false);
    if (!verify.ok) {
      expect(verify.firstBreakAt).toBe(2);
    }
  });

  it('audit-chain hash linkage holds — each non-genesis event carries the previous event id as prevEventId', async () => {
    const priv = ed.utils.randomPrivateKey();
    const planned = planAgentEvents({
      principalId: 'prc_3',
      agentId: 'agt_3',
      agentLabel: 'demo/agent3',
      count: 8,
      endTime: new Date('2026-05-05T00:00:00Z'),
      rng: deterministicRng(99),
    });
    const signed = await signAuditChain({
      events: planned,
      privateKey: priv,
      partitionBy: 'agentId',
    });
    expect(signed[0]!.prevEventId).toBeNull();
    for (let i = 1; i < signed.length; i++) {
      expect(signed[i]!.prevEventId).toBe(signed[i - 1]!.id);
    }
  });
});

describe('planBateForAgent', () => {
  it('produces clean + spike signals with correct severities and score deltas', () => {
    const sigs = planBateForAgent({
      agentId: 'agt_x',
      cleanCount: 3,
      failedSpikeCount: 2,
      spreadDays: 5,
      endTime: new Date('2026-05-05T00:00:00Z'),
    });
    expect(sigs.length).toBe(5);
    const clean = sigs.filter((s) => s.signalType === 'CLEAN_TRANSACTION');
    const spike = sigs.filter((s) => s.signalType === 'FAILED_VERIFY_SPIKE');
    expect(clean.length).toBe(3);
    expect(spike.length).toBe(2);
    expect(clean.every((s) => s.scoreDelta > 0)).toBe(true);
    expect(spike.every((s) => s.scoreDelta < 0)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// runSeedDemo end-to-end (mocked Prisma).
// ──────────────────────────────────────────────────────────────────

describe('runSeedDemo', () => {
  it('creates the full dataset with the documented counts on a fresh DB', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    const { outcome } = await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    expect(outcome.ok).toBe(true);
    expect(outcome.chainOk).toBe(true);
    expect(rec.principals.length).toBe(2);
    expect(rec.apiKeys.length).toBe(2);
    expect(rec.agents.length).toBe(6); // 3 + 3
    expect(rec.policies.length).toBe(6);
    expect(rec.webhooks.length).toBe(2);
    expect(rec.auditEvents.length).toBe(60); // 10 + 50
    expect(outcome.totalAuditEvents).toBe(60);
    // BATE: dispatch-bot 50 clean + refund-agent 5 clean + 2 spike = 57
    expect(rec.bateSignals.length).toBe(57);
    expect(outcome.totalBateSignals).toBe(57);
  });

  it('idempotent: re-runs delete @cerniq-demo.test rows before recreating', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    const firstPrincipals = rec.principals.map((p) => p.id);
    await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    expect(rec.deletedSuffixes).toEqual([DEMO_EMAIL_SUFFIX, DEMO_EMAIL_SUFFIX]);
    // After 2 runs we should still have exactly 2 principals (re-created), not 4.
    expect(rec.principals.length).toBe(2);
    // And the new principal IDs differ from the first run (sequence advanced).
    expect(rec.principals.map((p) => p.id)).not.toEqual(firstPrincipals);
  });

  it('cross-principal isolation: no API key is written under a different principalId', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    // Each api-key row must belong to one of the two principals AND match
    // the persona it was minted for. We confirm the (label, principalId)
    // mapping is the same one each persona declared.
    const personaByEmail = new Map(PERSONAS.map((p) => [p.email, p]));
    for (const apk of rec.apiKeys) {
      const owner = rec.principals.find((p) => p.id === apk.principalId);
      expect(owner).toBeTruthy();
      const persona = personaByEmail.get(owner!.email);
      expect(persona).toBeTruthy();
      expect(apk.data.label).toBe(persona!.apiKeyLabel);
    }
    // Each agent must also be owned by exactly one principal.
    for (const agt of rec.agents) {
      expect(rec.principals.some((p) => p.id === agt.principalId)).toBe(true);
    }
  });

  it('webhook secret is encrypted (v1: prefix), not stored as plaintext whsec_', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    expect(rec.webhooks.length).toBe(2);
    for (const w of rec.webhooks) {
      expect(w.secret.startsWith('v1:')).toBe(true);
      expect(w.secret.startsWith('whsec_')).toBe(false);
    }
  });

  it('one revoked agent total — Roberto has 1 REVOKED, Maria has 0', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    const { outcome } = await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    const roberto = outcome.principals.find((p) => p.email.startsWith('roberto@'));
    const maria = outcome.principals.find((p) => p.email.startsWith('maria@'));
    expect(roberto?.revokedAgentCount).toBe(1);
    expect(maria?.revokedAgentCount).toBe(0);
    // Sanity: confirm via persisted rows.
    const revoked = rec.agents.filter((a) => a.data.status === 'REVOKED');
    expect(revoked.length).toBe(1);
  });

  it('--reset-only deletes demo rows and writes nothing else', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    const { outcome } = await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: true });
    expect(outcome.resetOnly).toBe(true);
    expect(rec.deletedSuffixes).toEqual([DEMO_EMAIL_SUFFIX]);
    expect(rec.principals.length).toBe(0);
    expect(rec.apiKeys.length).toBe(0);
    expect(rec.agents.length).toBe(0);
    expect(rec.auditEvents.length).toBe(0);
    expect(rec.bateSignals.length).toBe(0);
  });

  it('--dry-run plans the dataset without writing or deleting any rows', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    const { outcome } = await runSeedDemo(prisma, cipher, { dryRun: true, resetOnly: false });
    expect(outcome.dryRun).toBe(true);
    expect(outcome.ok).toBe(true);
    expect(outcome.totalAuditEvents).toBe(60);
    expect(rec.deletedSuffixes).toEqual([]);
    expect(rec.principals.length).toBe(0);
    expect(rec.auditEvents.length).toBe(0);
    // outcome.principals[*].apiKey is omitted on dry-run (no write happened)
    for (const p of outcome.principals) {
      expect(p.apiKey).toBeUndefined();
    }
  });

  it('audit chain persisted to the DB carries a non-empty signature on every event', async () => {
    const { prisma, rec } = buildPrisma();
    const cipher = buildCipher();
    await runSeedDemo(prisma, cipher, { dryRun: false, resetOnly: false });
    expect(rec.auditEvents.length).toBe(60);
    for (const ev of rec.auditEvents) {
      expect(typeof ev.data.cerniqSignature).toBe('string');
      expect(String(ev.data.cerniqSignature).length).toBeGreaterThan(40);
      expect(ev.data.payloadVersion).toBe(2);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// PERSONAS sanity — quick guard against accidental config drift.
// ──────────────────────────────────────────────────────────────────

describe('PERSONAS', () => {
  it('uses the @cerniq-demo.test suffix for every persona email', () => {
    for (const p of PERSONAS) {
      expect(p.email.endsWith(DEMO_EMAIL_SUFFIX)).toBe(true);
    }
  });
  it('has Maria@FREE with 3 agents and Roberto@DEVELOPER with 3 agents (1 revoked)', () => {
    expect(PERSONAS).toHaveLength(2);
    const maria = PERSONAS.find((p) => p.email.startsWith('maria@'))!;
    const roberto = PERSONAS.find((p) => p.email.startsWith('roberto@'))!;
    expect(maria.planTier).toBe('FREE');
    expect(roberto.planTier).toBe('DEVELOPER');
    expect(maria.agents).toHaveLength(3);
    expect(roberto.agents).toHaveLength(3);
    expect(roberto.agents.filter((a) => a.status === 'REVOKED')).toHaveLength(1);
    expect(maria.agents.every((a) => a.status === 'ACTIVE')).toBe(true);
  });
});
