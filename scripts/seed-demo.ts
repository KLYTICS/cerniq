#!/usr/bin/env -S node --import=tsx
/**
 * OKORO — `pnpm seed:demo` — believable, multi-principal demo dataset.
 *
 * A fresh OKORO install boots to an empty database. The dashboard is blank,
 * `/v1/verify` has nothing to verify. New devs can't see the product
 * end-to-end without first hand-crafting principals, agents, policies, and
 * audit events. This script fills that gap with a deterministic-but-realistic
 * dataset that exercises:
 *
 *   - multi-principal isolation (`maria@okoro-demo.test`, `roberto@okoro-demo.test`)
 *   - agent identities (Ed25519 keypairs minted client-side, public-only at rest)
 *   - active and revoked agents (so AGENT_REVOKED denial is demonstrable)
 *   - policy issuance with realistic scopes/spend caps
 *   - webhook subscriptions with v1: envelope-encrypted secrets
 *   - audit-chain integrity (the chain MUST verify on day 1)
 *   - BATE signal mix that drives non-default trust scores
 *
 * Style mirrors `scripts/audit-verify-chain.ts` (chain-link math is replicated
 * inline so we don't need a NestJS DI bootstrap) and
 * `scripts/encrypt-existing-webhook-secrets.ts` (dynamic-import of the canonical
 * `WebhookSecretCipher`, structural Prisma surface for testability).
 *
 * Idempotent: re-runs delete every row whose principal email ends in
 * `@okoro-demo.test` and recreate from scratch. Production rows are untouched.
 *
 * Flags:
 *   --reset-only   delete demo rows and exit (cleanup utility)
 *   --dry-run      log the plan but write nothing
 *   --quiet        suppress the human-readable summary block, keep JSON tail
 *
 * Exit codes:
 *   0  success
 *   1  unhandled failure
 *   2  CLI usage error
 *   3  config error (missing DATABASE_URL)
 *   4  audit-chain self-verify failed (operator-actionable bug)
 */

import { randomBytes, createHash } from 'node:crypto';
import { stderr, stdout, exit, argv, env } from 'node:process';

import bcrypt from 'bcryptjs';
import { Command, Option } from 'commander';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ──────────────────────────────────────────────────────────────────
// Constants — keep at the top so an operator can audit the dataset
// shape at a glance.
// ──────────────────────────────────────────────────────────────────

export const DEMO_EMAIL_SUFFIX = '@okoro-demo.test' as const;
const API_KEY_PREFIX = 'okoro_sk_' as const;
const BCRYPT_COST_FAST = 4;
const AUDIT_PAYLOAD_VERSION = 2 as const;

const DENIAL_REASONS = [
  'INVALID_SIGNATURE',
  'SCOPE_NOT_GRANTED',
  'SPEND_LIMIT_EXCEEDED',
  'TRUST_SCORE_TOO_LOW',
] as const;

// ──────────────────────────────────────────────────────────────────
// Persona definitions — drive the entire seed plan deterministically.
// ──────────────────────────────────────────────────────────────────

interface PersonaSpec {
  email: string;
  name: string;
  planTier: 'FREE' | 'DEVELOPER';
  apiKeyLabel: string;
  agents: ReadonlyArray<{
    label: string;
    status: 'ACTIVE' | 'REVOKED';
    revokedReason?: string;
  }>;
  webhookUrl: string;
  auditEventCount: number;
}

export const PERSONAS: ReadonlyArray<PersonaSpec> = [
  {
    email: `maria${DEMO_EMAIL_SUFFIX}`,
    name: "Maria's Coffee Shop",
    planTier: 'FREE',
    apiKeyLabel: 'maria-demo-key',
    agents: [
      { label: 'maria/checkout-bot', status: 'ACTIVE' },
      { label: 'maria/refund-agent', status: 'ACTIVE' },
      { label: 'maria/loyalty-agent', status: 'ACTIVE' },
    ],
    webhookUrl: 'https://hooks.okoro-demo.test/maria',
    auditEventCount: 10,
  },
  {
    email: `roberto${DEMO_EMAIL_SUFFIX}`,
    name: 'Roberto Logistics',
    planTier: 'DEVELOPER',
    apiKeyLabel: 'roberto-demo-key',
    agents: [
      { label: 'roberto/dispatch-bot', status: 'ACTIVE' },
      { label: 'roberto/route-planner', status: 'ACTIVE' },
      {
        label: 'roberto/legacy-billing',
        status: 'REVOKED',
        revokedReason: 'demo: rotated to dispatch-bot',
      },
    ],
    webhookUrl: 'https://hooks.okoro-demo.test/roberto',
    auditEventCount: 50,
  },
] as const;

// ──────────────────────────────────────────────────────────────────
// Pure helpers (no Prisma, no I/O) — covered by the spec.
// ──────────────────────────────────────────────────────────────────

function toB64Url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64url');
}

function sha256B64Url(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('base64url');
}

/**
 * Mint an `okoro_sk_<random>` API key. Same shape as
 * `apps/api/src/modules/auth/api-key.service.ts` so verify-time resolution
 * via `keyPrefix` works without a code change.
 */
export function mintApiKeyPlaintext(): { plaintext: string; prefix: string } {
  const random = randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 26);
  const plaintext = `${API_KEY_PREFIX}${random}`;
  return { plaintext, prefix: plaintext.slice(0, 12) };
}

/** Stable canonicalisation — must byte-match `audit-chain.util.ts`. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
  return out;
}

/**
 * sha256 chain link — genesis variant when both `prev` are null. Mirrors
 * `AuditChainUtil.prevHash` byte-for-byte so the chain validates against
 * the canonical verifier.
 */
export function prevHash(prevEventId: string | null, prevSignatureB64Url: string | null): Buffer {
  if (prevEventId === null && prevSignatureB64Url === null) {
    return createHash('sha256').update('OKORO-AUDIT-GENESIS-v1').digest();
  }
  if (prevEventId === null || prevSignatureB64Url === null) {
    throw new Error('prevEventId and prevSignatureB64Url must both be set or both be null');
  }
  const sigBytes = Buffer.from(prevSignatureB64Url, 'base64url');
  return createHash('sha256').update(sigBytes).update(prevEventId, 'utf8').digest();
}

// ──────────────────────────────────────────────────────────────────
// Audit event planning — pure, deterministic given inputs.
// ──────────────────────────────────────────────────────────────────

export interface PlannedAuditEvent {
  // Identity
  id: string;
  agentId: string;
  claimedAgentId: string;
  principalId: string;
  // Decision
  action: string;
  decision: 'APPROVED' | 'DENIED';
  denialReason: string | null;
  relyingParty: string;
  requestedAmount: string | null;
  currency: 'USD';
  // Trust snapshot at time of event
  trustScoreAtEvent: number;
  trustBandAtEvent: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  // Hash commitments (mirror v2 payload)
  actionHash: string;
  relyingPartyHash: string;
  requestedAmountHash: string | null;
  policySnapshotHash: string | null;
  // Chain
  payloadVersion: typeof AUDIT_PAYLOAD_VERSION;
  timestamp: Date;
  okoroSignature: string;
  prevEventId: string | null;
}

interface PlanAuditEventsArgs {
  principalId: string;
  agentId: string;
  agentLabel: string;
  count: number;
  /** End of the spread; events are spread across the prior 14 days. */
  endTime: Date;
  /** When set, all events use this band; otherwise VERIFIED is the default. */
  trustBand?: 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';
  /** Initial trust score; used as `trustScoreAtEvent`. */
  trustScore?: number;
  /** RNG that returns [0,1). Defaulted to a deterministic counter for reproducible tests. */
  rng: () => number;
}

/**
 * Build the in-memory plan for one agent's audit events. Decision mix is
 * 80% APPROVED / 20% DENIED with denial reasons evenly drawn from the
 * configured set. Timestamps are spread across 14 days back from `endTime`.
 *
 * NOTE: this returns the *plan* — the signature is filled in by
 * `signAuditChain()` once the chain order across all agents is finalised.
 */
export function planAgentEvents(args: PlanAuditEventsArgs): Omit<PlannedAuditEvent, 'okoroSignature' | 'prevEventId'>[] {
  const span = 14 * 24 * 60 * 60 * 1000; // 14 days
  const out: Omit<PlannedAuditEvent, 'okoroSignature' | 'prevEventId'>[] = [];
  for (let i = 0; i < args.count; i++) {
    const r = args.rng();
    const isDenied = r < 0.2;
    const reasonIdx = Math.floor(args.rng() * DENIAL_REASONS.length);
    // Spread timestamps deterministically: each event sits at `i / count`
    // of the way through the 14-day window, with a small RNG jitter so the
    // chain order isn't trivially monotonic on the wall-clock.
    const baseOffset = (i / Math.max(1, args.count)) * span;
    const jitter = args.rng() * 60_000; // up to one minute
    const ts = new Date(args.endTime.getTime() - span + baseOffset + jitter);
    const action = isDenied ? 'stripe.charge' : i % 2 === 0 ? 'stripe.charge' : 'email.send';
    const requestedAmount = action === 'stripe.charge' ? ((i + 1) * 4.25).toFixed(2) : null;
    const relyingParty = `https://demo.${args.principalId}.example/checkout`;
    const denialReason = isDenied ? (DENIAL_REASONS[reasonIdx] ?? null) : null;

    out.push({
      id: `evt_${toB64Url(randomBytes(15)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 22)}`,
      agentId: args.agentId,
      claimedAgentId: args.agentLabel,
      principalId: args.principalId,
      action,
      decision: isDenied ? 'DENIED' : 'APPROVED',
      denialReason,
      relyingParty,
      requestedAmount,
      currency: 'USD',
      trustScoreAtEvent: args.trustScore ?? 500,
      trustBandAtEvent: args.trustBand ?? 'VERIFIED',
      actionHash: sha256B64Url(action),
      relyingPartyHash: sha256B64Url(relyingParty),
      requestedAmountHash: requestedAmount ? sha256B64Url(requestedAmount) : null,
      policySnapshotHash: null,
      payloadVersion: AUDIT_PAYLOAD_VERSION,
      timestamp: ts,
    });
  }
  // Order ascending by timestamp so the chain is built in time order. Tie-break
  // on id for determinism with equal timestamps.
  out.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id));
  return out;
}

interface SignAuditChainArgs {
  events: Omit<PlannedAuditEvent, 'okoroSignature' | 'prevEventId'>[];
  /**
   * OKORO audit-signing private key (32-byte Ed25519 seed). One key per
   * partition (agentId or principal) keeps the chain deterministic per
   * partition; the script uses one global key because the verifier only
   * cares about `prev` linkage within a partition, not across.
   */
  privateKey: Uint8Array;
  /**
   * Chain partitioning: per `audit.service.ts`, real events chain by
   * `agentId` when present, otherwise by `principalId`. We always have
   * a real agentId here, so we partition by agentId.
   */
  partitionBy: 'agentId';
}

function rebuildPayload(row: Omit<PlannedAuditEvent, 'okoroSignature' | 'prevEventId'>): Record<string, unknown> {
  // Mirrors AuditChainPayload v2 verbatim. CRITICAL: field set + names +
  // nullability MUST match the signer in audit-chain.util.ts. If that file
  // grows a field, mirror it here AND in audit-verify-chain.ts.
  return {
    agentId: row.claimedAgentId, // matches audit.service.ts: signed payload uses claimedAgentId-as-agentId when no FK
    claimedAgentId: row.claimedAgentId,
    principalId: row.principalId,
    decision: row.decision,
    denialReason: row.denialReason,
    policyId: null,
    trustScoreAtEvent: row.trustScoreAtEvent,
    trustBandAtEvent: row.trustBandAtEvent,
    currency: row.currency,
    timestamp: row.timestamp.toISOString(),
    actionHash: row.actionHash,
    relyingPartyHash: row.relyingPartyHash,
    requestedAmountHash: row.requestedAmountHash,
    policySnapshotHash: row.policySnapshotHash,
    v: AUDIT_PAYLOAD_VERSION,
  };
}

/**
 * Sign every event in chain order, partitioning by `agentId`. Returns the
 * fully-signed plan — each event carries its `prevEventId` and signature.
 */
export async function signAuditChain(args: SignAuditChainArgs): Promise<PlannedAuditEvent[]> {
  const enc = new TextEncoder();
  const partitions = new Map<string, { prevId: string | null; prevSig: string | null }>();
  const out: PlannedAuditEvent[] = [];

  for (const ev of args.events) {
    const partKey = args.partitionBy === 'agentId' ? ev.agentId : ev.principalId;
    const part = partitions.get(partKey) ?? { prevId: null, prevSig: null };
    const prev = prevHash(part.prevId, part.prevSig);
    const canonical = enc.encode(canonicalize(rebuildPayload(ev)));
    const message = Buffer.concat([prev, canonical]);
    const sig = await ed.signAsync(message, args.privateKey);
    const sigB64Url = toB64Url(sig);
    out.push({ ...ev, okoroSignature: sigB64Url, prevEventId: part.prevId });
    partitions.set(partKey, { prevId: ev.id, prevSig: sigB64Url });
  }
  return out;
}

/**
 * Self-verify the signed chain. Returns `{ ok: true }` on success or the
 * first break index for diagnostics. Used as a safety net before persisting.
 */
export async function verifySignedChain(
  events: PlannedAuditEvent[],
  publicKey: Uint8Array,
  partitionBy: 'agentId',
): Promise<{ ok: true } | { ok: false; firstBreakAt: number; reason: string }> {
  const enc = new TextEncoder();
  const partitions = new Map<string, { prevId: string | null; prevSig: string | null }>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const partKey = partitionBy === 'agentId' ? ev.agentId : ev.principalId;
    const part = partitions.get(partKey) ?? { prevId: null, prevSig: null };
    const prev = prevHash(part.prevId, part.prevSig);
    const canonical = enc.encode(canonicalize(rebuildPayload(ev)));
    const message = Buffer.concat([prev, canonical]);
    const sig = Buffer.from(ev.okoroSignature, 'base64url');
    let ok = false;
    try {
      ok = await ed.verifyAsync(sig, message, publicKey);
    } catch (err) {
      return { ok: false, firstBreakAt: i, reason: (err as Error).message };
    }
    if (!ok) return { ok: false, firstBreakAt: i, reason: 'signature failed' };
    partitions.set(partKey, { prevId: ev.id, prevSig: ev.okoroSignature });
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────
// Deterministic RNG helpers.
//
// CLAUDE.md says no Math.random in production code paths; this is a
// seed/test script so it's allowed, but using a counter-driven mulberry32
// makes the output reproducible across runs for the tests AND lets us
// pass a real RNG (`Math.random`) for actual seeding.
// ──────────────────────────────────────────────────────────────────

export function deterministicRng(seed: number): () => number {
  // mulberry32 — one-line, fast, well-distributed for our use.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ──────────────────────────────────────────────────────────────────
// Structural Prisma surface — the spec swaps in an in-memory mock.
//
// Keep narrow on purpose; growing this means real call-sites have to
// satisfy them. Mirrors the pattern in
// `encrypt-existing-webhook-secrets.ts`.
// ──────────────────────────────────────────────────────────────────

export interface DemoPrisma {
  principal: {
    deleteMany(args: { where: { email: { endsWith: string } } }): Promise<{ count: number }>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; email: string }>;
  };
  apiKey: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; principalId: string }>;
  };
  agentIdentity: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; principalId: string }>;
  };
  agentPolicy: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; agentId: string }>;
  };
  webhookSubscription: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ id: string; principalId: string; secret: string }>;
  };
  bateSignal: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  auditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
  $disconnect(): Promise<void>;
}

export interface DemoCipher {
  encrypt(plaintext: string): string;
  isEncrypted(value: string): boolean;
}

// ──────────────────────────────────────────────────────────────────
// BATE signals — drives non-default trust scores in the dashboard.
// ──────────────────────────────────────────────────────────────────

export interface PlannedBateSignal {
  agentId: string;
  signalType:
    | 'CLEAN_TRANSACTION'
    | 'FAILED_VERIFY_SPIKE'
    | 'PRINCIPAL_KYC_VERIFIED'
    | 'NORMAL_VELOCITY';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  source: string;
  occurredAt: Date;
  scoreDelta: number;
  payload: Record<string, unknown>;
}

interface PlanBateForAgentArgs {
  agentId: string;
  cleanCount: number;
  failedSpikeCount: number;
  /** Spread the signals across this many days back from `endTime`. */
  spreadDays: number;
  endTime: Date;
}

export function planBateForAgent(args: PlanBateForAgentArgs): PlannedBateSignal[] {
  const out: PlannedBateSignal[] = [];
  const span = args.spreadDays * 24 * 60 * 60 * 1000;
  for (let i = 0; i < args.cleanCount; i++) {
    out.push({
      agentId: args.agentId,
      signalType: 'CLEAN_TRANSACTION',
      severity: 'LOW',
      source: 'okoro-demo-seed',
      occurredAt: new Date(args.endTime.getTime() - span + (i / Math.max(1, args.cleanCount)) * span),
      scoreDelta: +4,
      payload: { reason: 'demo:clean-tx', idx: i },
    });
  }
  for (let i = 0; i < args.failedSpikeCount; i++) {
    out.push({
      agentId: args.agentId,
      signalType: 'FAILED_VERIFY_SPIKE',
      severity: 'HIGH',
      source: 'okoro-demo-seed',
      occurredAt: new Date(args.endTime.getTime() - span / 2 + i * 60_000),
      scoreDelta: -25,
      payload: { reason: 'demo:failed-spike', idx: i },
    });
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Persistence orchestration — testable with a mock Prisma.
// ──────────────────────────────────────────────────────────────────

export interface SeededPrincipalRecord {
  email: string;
  principalId: string;
  apiKey: string;
  agents: Array<{
    id: string;
    label: string;
    publicKeyB64Url: string;
    privateKeyB64Url: string;
    status: 'ACTIVE' | 'REVOKED';
  }>;
  webhookSecret: string;
  webhookUrl: string;
}

export interface SeedDemoOutcome {
  ok: boolean;
  durationMs: number;
  dryRun: boolean;
  resetOnly: boolean;
  chainOk: boolean;
  totalAuditEvents: number;
  totalBateSignals: number;
  principals: Array<{
    email: string;
    principalId: string;
    plan: 'FREE' | 'DEVELOPER';
    apiKey?: string; // omitted on dryRun
    agentCount: number;
    revokedAgentCount: number;
    auditEventCount: number;
  }>;
}

export interface SeedDemoOptions {
  dryRun: boolean;
  resetOnly: boolean;
  /** Seed for the deterministic RNG path. Production runs should leave this undefined. */
  rngSeed?: number;
  /** Bcrypt cost for API key hashing. Defaults to 4 — plaintext is shown to the operator anyway, slow hashing buys nothing. */
  bcryptCost?: number;
  /** Inject the audit-signing key. When absent the script generates an ephemeral one and prints the public key. */
  auditPrivateKey?: Uint8Array;
}

export async function runSeedDemo(
  prisma: DemoPrisma,
  cipher: DemoCipher,
  opts: SeedDemoOptions,
): Promise<{ outcome: SeedDemoOutcome; principals: SeededPrincipalRecord[] }> {
  const startedAt = Date.now();
  const cost = opts.bcryptCost ?? BCRYPT_COST_FAST;

  // Step 1 — wipe demo rows. Cascade deletes through Principal handles
  // ApiKey, AgentIdentity (and its policies/audit/BATE FKs), WebhookSubscription,
  // PrincipalOnboarding. AuditEvent FK is `SetNull` (chain stays intact).
  if (!opts.dryRun) {
    await prisma.principal.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_SUFFIX } } });
  }

  if (opts.resetOnly) {
    return {
      outcome: {
        ok: true,
        durationMs: Date.now() - startedAt,
        dryRun: opts.dryRun,
        resetOnly: true,
        chainOk: true,
        totalAuditEvents: 0,
        totalBateSignals: 0,
        principals: [],
      },
      principals: [],
    };
  }

  // Step 2 — generate the audit-signing keypair (or use the injected one).
  const auditPriv = opts.auditPrivateKey ?? ed.utils.randomPrivateKey();
  const auditPub = await ed.getPublicKeyAsync(auditPriv);

  const records: SeededPrincipalRecord[] = [];
  let totalAuditEvents = 0;
  let totalBateSignals = 0;
  const allPlannedEvents: Omit<PlannedAuditEvent, 'okoroSignature' | 'prevEventId'>[] = [];

  // Step 3 — for each persona, create principal + apiKey + agents + policies + webhook.
  for (let pIdx = 0; pIdx < PERSONAS.length; pIdx++) {
    const persona = PERSONAS[pIdx]!;
    const principal = opts.dryRun
      ? { id: `prc_dry_${pIdx}`, email: persona.email }
      : await prisma.principal.create({
          data: {
            email: persona.email,
            name: persona.name,
            planTier: persona.planTier,
            emailVerified: true,
          },
        });

    // 3a. API key
    const minted = mintApiKeyPlaintext();
    const keyHash = await bcrypt.hash(minted.plaintext, cost);
    if (!opts.dryRun) {
      await prisma.apiKey.create({
        data: {
          keyHash,
          keyPrefix: minted.prefix,
          label: persona.apiKeyLabel,
          principalId: principal.id,
          scope: 'FULL',
        },
      });
    }

    // 3b. Agents — keypair per agent.
    const seededAgents: SeededPrincipalRecord['agents'] = [];
    for (let aIdx = 0; aIdx < persona.agents.length; aIdx++) {
      const spec = persona.agents[aIdx]!;
      const priv = ed.utils.randomPrivateKey();
      const pub = await ed.getPublicKeyAsync(priv);
      const pubB64 = toB64Url(pub);
      const privB64 = toB64Url(priv);
      const agent = opts.dryRun
        ? { id: `agt_dry_${pIdx}_${aIdx}`, principalId: principal.id }
        : await prisma.agentIdentity.create({
            data: {
              publicKey: pubB64,
              principalId: principal.id,
              label: spec.label,
              runtime: 'CUSTOM',
              status: spec.status,
              ...(spec.status === 'REVOKED'
                ? { revokedAt: new Date(), revokedReason: spec.revokedReason ?? null }
                : {}),
              trustScore: 500,
              trustBand: 'VERIFIED',
            },
          });

      // 3c. Per-agent policy. Token isn't used for verification at seed
      // time — `signedToken` is structurally a JWT with deterministic
      // shape so dashboards rendering it don't crash.
      const scopes = [
        {
          category: 'commerce',
          allowedActions: ['stripe.charge', 'email.send'],
          maxSpend: 5000,
          spendLimit: { currency: 'USD', maxPerTransaction: 5000 },
          extraScopes: ['read:orders'],
        },
      ];
      const tokenPayload = {
        sub: agent.id,
        scopes: scopes.map((s) => s.category),
        iat: Math.floor(startedAt / 1000),
        exp: Math.floor(startedAt / 1000) + 30 * 24 * 60 * 60,
        type: 'okoro_policy_demo',
      };
      const tokenHeader = { alg: 'EdDSA', typ: 'JWT' };
      const headerB64 = toB64Url(Buffer.from(JSON.stringify(tokenHeader)));
      const payloadB64 = toB64Url(Buffer.from(JSON.stringify(tokenPayload)));
      const signingInput = `${headerB64}.${payloadB64}`;
      const tokenSig = await ed.signAsync(new TextEncoder().encode(signingInput), priv);
      const signedToken = `${signingInput}.${toB64Url(tokenSig)}`;
      const tokenHash = createHash('sha256').update(signedToken).digest('hex');
      if (!opts.dryRun) {
        await prisma.agentPolicy.create({
          data: {
            agentId: agent.id,
            label: `${spec.label} default policy`,
            signedToken,
            tokenHash,
            status: 'ACTIVE',
            expiresAt: new Date(startedAt + 30 * 24 * 60 * 60 * 1000),
            scopes,
          },
        });
      }

      seededAgents.push({
        id: agent.id,
        label: spec.label,
        publicKeyB64Url: pubB64,
        privateKeyB64Url: privB64,
        status: spec.status,
      });
    }

    // 3d. Webhook subscription — secret is encrypted via the canonical cipher.
    const plaintextSecret = `whsec_${randomBytes(24).toString('base64url').slice(0, 32)}`;
    const ciphertext = cipher.encrypt(plaintextSecret);
    if (!opts.dryRun) {
      await prisma.webhookSubscription.create({
        data: {
          principalId: principal.id,
          url: persona.webhookUrl,
          secret: ciphertext,
          events: ['verify.allowed', 'verify.denied', 'agent.revoked', 'policy.expired'],
          active: true,
        },
      });
    }

    // 3e. Plan audit events for the first ACTIVE agent (chain partitioned by agentId).
    const firstActive = seededAgents.find((a) => a.status === 'ACTIVE')!;
    const rng = deterministicRng((opts.rngSeed ?? 0xa3615) + pIdx * 1000);
    const planned = planAgentEvents({
      principalId: principal.id,
      agentId: firstActive.id,
      agentLabel: firstActive.label,
      count: persona.auditEventCount,
      endTime: new Date(startedAt),
      rng,
    });
    allPlannedEvents.push(...planned);

    records.push({
      email: principal.email,
      principalId: principal.id,
      apiKey: minted.plaintext,
      agents: seededAgents,
      webhookSecret: plaintextSecret,
      webhookUrl: persona.webhookUrl,
    });
  }

  // Step 4 — sign the whole audit chain in one pass (partition by agentId,
  // events already in timestamp order per partition because plan ordering is stable).
  const signed = await signAuditChain({
    events: allPlannedEvents,
    privateKey: auditPriv,
    partitionBy: 'agentId',
  });

  // Step 5 — self-verify before we persist; refuse to seed a broken chain.
  const verify = await verifySignedChain(signed, auditPub, 'agentId');
  if (!verify.ok) {
    throw new Error(
      `audit chain self-verify failed at index ${verify.firstBreakAt}: ${verify.reason}`,
    );
  }

  // Step 6 — persist signed events.
  if (!opts.dryRun) {
    for (const ev of signed) {
      await prisma.auditEvent.create({
        data: {
          id: ev.id,
          agentId: ev.agentId,
          claimedAgentId: ev.claimedAgentId,
          principalId: ev.principalId,
          action: ev.action,
          decision: ev.decision,
          denialReason: ev.denialReason,
          relyingParty: ev.relyingParty,
          requestedAmount: ev.requestedAmount,
          currency: ev.currency,
          actionHash: ev.actionHash,
          relyingPartyHash: ev.relyingPartyHash,
          requestedAmountHash: ev.requestedAmountHash,
          policySnapshotHash: ev.policySnapshotHash,
          trustScoreAtEvent: ev.trustScoreAtEvent,
          trustBandAtEvent: ev.trustBandAtEvent,
          okoroSignature: ev.okoroSignature,
          payloadVersion: ev.payloadVersion,
          timestamp: ev.timestamp,
        },
      });
    }
  }
  totalAuditEvents = signed.length;

  // Step 7 — BATE signals for the two flagship agents.
  const bateForAgent = (
    label: string,
    agents: SeededPrincipalRecord['agents'],
  ): { agentId: string; clean: number; spike: number; days: number } | null => {
    const a = agents.find((x) => x.label === label);
    if (!a) return null;
    if (label === 'roberto/dispatch-bot') return { agentId: a.id, clean: 50, spike: 0, days: 10 };
    if (label === 'maria/refund-agent') return { agentId: a.id, clean: 5, spike: 2, days: 7 };
    return null;
  };
  for (const rec of records) {
    for (const target of ['roberto/dispatch-bot', 'maria/refund-agent']) {
      const cfg = bateForAgent(target, rec.agents);
      if (!cfg) continue;
      const signals = planBateForAgent({
        agentId: cfg.agentId,
        cleanCount: cfg.clean,
        failedSpikeCount: cfg.spike,
        spreadDays: cfg.days,
        endTime: new Date(startedAt),
      });
      if (!opts.dryRun) {
        for (const s of signals) {
          await prisma.bateSignal.create({
            data: {
              agentId: s.agentId,
              signalType: s.signalType,
              severity: s.severity,
              source: s.source,
              occurredAt: s.occurredAt,
              scoreDelta: s.scoreDelta,
              payload: s.payload,
              processed: true,
              processedAt: s.occurredAt,
              idempotencyKey: `demo-${s.signalType}-${s.agentId}-${s.occurredAt.getTime()}`,
            },
          });
        }
      }
      totalBateSignals += signals.length;
    }
  }

  return {
    outcome: {
      ok: true,
      durationMs: Date.now() - startedAt,
      dryRun: opts.dryRun,
      resetOnly: false,
      chainOk: true,
      totalAuditEvents,
      totalBateSignals,
      principals: records.map((r) => ({
        email: r.email,
        principalId: r.principalId,
        plan: PERSONAS.find((p) => p.email === r.email)!.planTier,
        ...(opts.dryRun ? {} : { apiKey: r.apiKey }),
        agentCount: r.agents.length,
        revokedAgentCount: r.agents.filter((a) => a.status === 'REVOKED').length,
        auditEventCount: PERSONAS.find((p) => p.email === r.email)!.auditEventCount,
      })),
    },
    principals: records,
  };
}

// ──────────────────────────────────────────────────────────────────
// Cipher loader — same dynamic-import trick as
// `encrypt-existing-webhook-secrets.ts`. See that script for why we go
// dynamic (TS6059 vs `rootDir: "."`).
// ──────────────────────────────────────────────────────────────────

interface CipherCtor {
  new (config: { webhookSecretDekB64: string; nodeEnv: 'production' | 'development' | 'test' }): DemoCipher;
}

async function loadWebhookSecretCipher(): Promise<CipherCtor> {
  const specifier = '../apps/api/src/common/crypto/webhook-secret-cipher.js';
  // type-rationale: dynamic import returns unknown-shaped module metadata;
  // narrow to the exported class via a single structural cast at the boundary.
  const mod = (await import(specifier)) as { WebhookSecretCipher: CipherCtor };
  if (typeof mod.WebhookSecretCipher !== 'function') {
    throw new Error(
      `webhook-secret-cipher module did not export a class (got ${typeof mod.WebhookSecretCipher})`,
    );
  }
  return mod.WebhookSecretCipher;
}

// ──────────────────────────────────────────────────────────────────
// Operator output — the moment of "aha, it works".
// ──────────────────────────────────────────────────────────────────

function emitHumanSummary(records: SeededPrincipalRecord[], outcome: SeedDemoOutcome): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(' OKORO demo seed — STORE NOW — never shown again');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const rec of records) {
    lines.push('');
    lines.push(`Principal: ${rec.email}  (id=${rec.principalId})`);
    lines.push(`  API key (use as x-okoro-api-key):`);
    lines.push(`    ${rec.apiKey}`);
    lines.push(`  Webhook URL:    ${rec.webhookUrl}`);
    lines.push(`  Webhook secret (HMAC plaintext, encrypted at rest):`);
    lines.push(`    ${rec.webhookSecret}`);
    lines.push('  Agents:');
    for (const a of rec.agents) {
      lines.push(`    - ${a.label}  status=${a.status}  id=${a.id}`);
      lines.push(`        public:  ${a.publicKeyB64Url}`);
      lines.push(`        private: ${a.privateKeyB64Url}    <-- STORE NOW — never shown again`);
    }
  }
  const maria = records.find((r) => r.email.startsWith('maria@'));
  const mariaAgent = maria?.agents.find((a) => a.label === 'maria/checkout-bot');
  if (maria && mariaAgent) {
    lines.push('');
    lines.push('Try it — verify a request as maria/checkout-bot:');
    lines.push('');
    lines.push(`  curl -sS -X POST http://localhost:4000/v1/verify \\`);
    lines.push(`    -H "x-okoro-api-key: ${maria.apiKey}" \\`);
    lines.push(`    -H "content-type: application/json" \\`);
    lines.push(`    -d '{`);
    lines.push(`      "agentId": "${mariaAgent.label}",`);
    lines.push(`      "action": "stripe.charge",`);
    lines.push(`      "amount": 12.50,`);
    lines.push(`      "currency": "USD",`);
    lines.push(`      "relyingParty": "https://demo.example/checkout"`);
    lines.push(`    }'`);
    lines.push('');
    lines.push('Expected response shape:');
    lines.push('  { "decision": "APPROVED", "trustScore": 500, "trustBand": "VERIFIED",');
    lines.push('    "auditEventId": "evt_…", "policyId": "pol_…" }');
  }
  lines.push('');
  lines.push(`Audit events seeded: ${outcome.totalAuditEvents}  (chainOk=${outcome.chainOk})`);
  lines.push(`BATE signals seeded: ${outcome.totalBateSignals}`);
  lines.push('');
  stdout.write(lines.join('\n'));
  stdout.write('\n');
}

// ──────────────────────────────────────────────────────────────────
// CLI entry.
// ──────────────────────────────────────────────────────────────────

interface CliOpts {
  resetOnly: boolean;
  dryRun: boolean;
  quiet: boolean;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('seed-demo')
    .description('Idempotent demo seed for OKORO — multi-principal, multi-agent, valid audit chain.')
    .addOption(new Option('--reset-only', 'delete demo rows and exit').default(false))
    .addOption(new Option('--dry-run', 'log the plan but write nothing').default(false))
    .addOption(new Option('--quiet', 'suppress the human-readable summary').default(false));

  try {
    program.parse(argv);
  } catch (err) {
    stderr.write(`usage error: ${(err as Error).message}\n`);
    exit(2);
  }
  const opts = program.opts<CliOpts>();

  if (!env.DATABASE_URL && !opts.dryRun) {
    stderr.write('DATABASE_URL is required (or pass --dry-run to skip DB writes)\n');
    exit(3);
  }

  // Build cipher. In dev, an absent DEK is fine — the cipher mints an ephemeral
  // one. The plaintext is printed to stdout, so the pinning warning is benign here.
  let cipher: DemoCipher;
  try {
    const Ctor = await loadWebhookSecretCipher();
    cipher = new Ctor({
      webhookSecretDekB64:
        env.OKORO_WEBHOOK_SECRET_DEK_B64 ?? Buffer.from(randomBytes(32)).toString('base64'),
      nodeEnv: env.NODE_ENV === 'production' ? 'production' : 'development',
    });
  } catch (err) {
    stderr.write(`failed to load WebhookSecretCipher: ${(err as Error).message}\n`);
    exit(3);
  }

  // type-rationale: PrismaClient's generated types may not exist when this script
  // is type-checked in isolation; cast through unknown to our structural surface.
  const prismaMod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => DemoPrisma;
  };
  const prisma: DemoPrisma = new prismaMod.PrismaClient();

  try {
    const { outcome, principals } = await runSeedDemo(prisma, cipher, {
      dryRun: opts.dryRun,
      resetOnly: opts.resetOnly,
    });
    if (!opts.quiet && !opts.resetOnly) {
      emitHumanSummary(principals, outcome);
    }
    stdout.write(`${JSON.stringify(outcome)}\n`);
    exit(outcome.ok ? 0 : 1);
  } catch (err) {
    stderr.write(`seed-demo failed: ${(err as Error).message}\n`);
    exit(/self-verify failed/.test((err as Error).message) ? 4 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  argv[1] !== undefined &&
  (argv[1].endsWith('seed-demo.ts') || argv[1].endsWith('seed-demo.js'));
if (isMain) {
  main().catch((err) => {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    exit(1);
  });
}
