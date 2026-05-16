// Production-realistic in-memory AEGIS harness. The shape mirrors what
// the live API exposes; the implementation uses real @noble/ed25519
// cryptography and the documented denial precedence from CLAUDE.md §6.
//
// Layers:
//   L1 — Identity   (agent keypair + revocation)
//   L2 — Policy     (action scopes, amount caps, RAR authorization_details)
//   L3 — BATE       (trust score 0-1000, band mapping, anomaly count)
//   L4 — Audit      (append-only hash-chained Ed25519-signed events)

import { AssertCtx } from './assert';
import { canonicalize, generateKeypair, sha256Hex, sign, verify, b64UrlEncode, b64UrlDecode, type Keypair } from './crypto';

// ── Types ────────────────────────────────────────────────────────────

export type DenialReason =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_REVOKED'
  | 'INVALID_SIGNATURE'
  | 'POLICY_REVOKED'
  | 'POLICY_EXPIRED'
  | 'SCOPE_NOT_GRANTED'
  | 'TRIAL_EXHAUSTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'TRUST_SCORE_TOO_LOW'
  | 'ANOMALY_FLAGGED'
  | 'PLAN_LIMIT_EXCEEDED'
  | 'RAR_CONSTRAINT_FAILED'
  | 'INTENT_RECONCILIATION_FAILED';

export type TrustBand = 'PLATINUM' | 'VERIFIED' | 'WATCH' | 'FLAGGED';

export interface AgentRecord {
  id: string;
  tenantId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  revoked: boolean;
  trustScore: number;
  anomalyCount: number;
}

export interface PolicyRecord {
  id: string;
  agentId: string;
  tenantId: string;
  actions: string[];
  amountMax?: number;
  authorizationDetails?: RarDetail[];
  revoked: boolean;
  expiresAt?: number;
}

export interface RarDetail {
  type: 'trading_order' | 'payment_initiation' | 'data_access' | 'agent_action';
  actions: string[];
  limits?: { per_order_usd?: number; per_day_usd?: number; trading_hours_utc?: [number, number] };
}

export interface IntentRecord {
  id: string;
  agentId: string;
  declared: { action: string; amount?: number; meta?: Record<string, unknown> };
  signedAt: number;
  signatureB64Url: string;
  actuals?: { amount?: number; meta?: Record<string, unknown> };
  reconciliation?: { ok: boolean; mismatch?: string };
}

export interface AuditEventRow {
  seq: number;
  tenantId: string;
  agentId: string;
  action: string;
  amount?: number;
  result: 'VALID' | 'DENIED';
  reason?: DenialReason;
  trustScore?: number;
  trustBandAtEvent?: TrustBand;
  timestamp: number;
  prevHash: string;
  signatureB64Url: string;
}

export interface VerifyContext {
  tenantId: string;
  action: string;
  amount?: number;
}

export interface VerifyResult {
  valid: boolean;
  reason?: DenialReason;
  trustScore?: number;
  trustBand?: TrustBand;
  auditSeq?: number;
}

export interface SignedActionToken {
  agentId: string;
  tenantId: string;
  action: string;
  amount?: number;
  expiresAt: number;
  signatureB64Url: string;
}

// ── Trust band mapping (BATE) ────────────────────────────────────────

export function trustBandFor(score: number): TrustBand {
  if (score >= 900) return 'PLATINUM';
  if (score >= 600) return 'VERIFIED';
  if (score >= 300) return 'WATCH';
  return 'FLAGGED';
}

// ── Audit chain — hash-chained, Ed25519-signed per row ──────────────

const GENESIS_PREV_HASH = '0'.repeat(64);

function buildSignedAuditMessage(row: Omit<AuditEventRow, 'signatureB64Url'>): Uint8Array {
  return new TextEncoder().encode(canonicalize({
    seq: row.seq,
    tenantId: row.tenantId,
    agentId: row.agentId,
    action: row.action,
    amount: row.amount,
    result: row.result,
    reason: row.reason,
    trustScore: row.trustScore,
    trustBandAtEvent: row.trustBandAtEvent,
    timestamp: row.timestamp,
    prevHash: row.prevHash,
  }));
}

// ── Harness state ────────────────────────────────────────────────────

interface HarnessState {
  agents: Map<string, AgentRecord>;
  policies: Map<string, PolicyRecord>;
  intents: Map<string, IntentRecord>;
  auditChain: AuditEventRow[];
  signingKeypair: Keypair;
  tenantPlanLimits: Map<string, number>; // tenantId → max verifies / window
  tenantVerifyCount: Map<string, number>;
  now: () => number;
  rng: () => number; // For deterministic IDs, seedable
  agentCounter: number;
  policyCounter: number;
}

// ── Public API: build a harness instance ─────────────────────────────

export async function buildHarness(opts?: { now?: () => number; seed?: number }): Promise<{
  ctx: ScenarioContext;
  state: HarnessState;
}> {
  const signingKeypair = await generateKeypair();
  let counter = opts?.seed ?? 0;
  const state: HarnessState = {
    agents: new Map(),
    policies: new Map(),
    intents: new Map(),
    auditChain: [],
    signingKeypair,
    tenantPlanLimits: new Map(),
    tenantVerifyCount: new Map(),
    now: opts?.now ?? (() => Date.now()),
    rng: () => ++counter,
    agentCounter: 0,
    policyCounter: 0,
  };

  const ctx: ScenarioContext = {
    // L1 — Identity
    registerAgent: async (tenantId, regOpts) => {
      const kp = await generateKeypair();
      const agent: AgentRecord = {
        id: `agt_${state.rng().toString(36).padStart(6, '0')}`,
        tenantId,
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
        revoked: false,
        trustScore: regOpts?.initialTrust ?? 700,
        anomalyCount: 0,
      };
      state.agents.set(agent.id, agent);
      return agent;
    },
    revokeAgent: (agentId) => {
      const a = state.agents.get(agentId);
      if (a) a.revoked = true;
    },

    // L2 — Policy
    attachPolicy: (agentId, p) => {
      const agent = state.agents.get(agentId);
      if (!agent) throw new Error(`unknown agent: ${agentId}`);
      const policy: PolicyRecord = {
        id: `pol_${state.rng().toString(36).padStart(6, '0')}`,
        agentId,
        tenantId: agent.tenantId,
        actions: p.actions,
        amountMax: p.amountMax,
        authorizationDetails: p.authorizationDetails,
        revoked: false,
        expiresAt: p.expiresAt,
      };
      state.policies.set(policy.id, policy);
      return policy;
    },
    revokePolicy: (policyId) => {
      const p = state.policies.get(policyId);
      if (p) p.revoked = true;
    },

    // L3 — BATE
    flagAnomaly: (agentId, count) => {
      const a = state.agents.get(agentId);
      if (!a) return;
      a.anomalyCount += count ?? 1;
      // Each anomaly drops trust by 100, floored at 0. 100/anomaly lets
      // ANOMALY_FLAGGED fire without trust dropping below the 100 floor
      // when the agent starts at high trust (precedence chain ordering).
      a.trustScore = Math.max(0, a.trustScore - 100 * (count ?? 1));
    },
    boostTrust: (agentId, delta) => {
      const a = state.agents.get(agentId);
      if (!a) return;
      a.trustScore = Math.min(1000, a.trustScore + delta);
    },
    setPlanLimit: (tenantId, limit) => {
      state.tenantPlanLimits.set(tenantId, limit);
    },

    // Action signing (agent-side)
    signAction: async (agentId, action, amount) => {
      const agent = state.agents.get(agentId);
      if (!agent) throw new Error(`unknown agent: ${agentId}`);
      const payload = {
        agentId,
        tenantId: agent.tenantId,
        action,
        amount,
        expiresAt: state.now() + 60_000, // 60s validity
      };
      const message = new TextEncoder().encode(canonicalize(payload));
      const sigBytes = await sign(message, agent.privateKey);
      const token: SignedActionToken = { ...payload, signatureB64Url: b64UrlEncode(sigBytes) };
      // The wire format is base64url(canonical(token-with-sig)) — opaque to the relying party.
      return b64UrlEncode(new TextEncoder().encode(canonicalize(token)));
    },

    // Verify path (AEGIS-side) — follows CLAUDE.md §6 denial precedence
    verify: async (wireToken, vctx) => {
      // 1. Decode token
      let token: SignedActionToken;
      try {
        const tokenJson = new TextDecoder().decode(b64UrlDecode(wireToken));
        token = JSON.parse(tokenJson);
      } catch {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: 'unknown', action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'INVALID_SIGNATURE' });
      }

      // Plan limit (pre-algorithm billing gate)
      const limit = state.tenantPlanLimits.get(vctx.tenantId);
      const used = state.tenantVerifyCount.get(vctx.tenantId) ?? 0;
      if (limit !== undefined && used >= limit) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: token.agentId, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'PLAN_LIMIT_EXCEEDED' });
      }
      state.tenantVerifyCount.set(vctx.tenantId, used + 1);

      // Agent must exist + same tenant + not revoked
      const agent = state.agents.get(token.agentId);
      if (!agent || agent.tenantId !== vctx.tenantId) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: token.agentId, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'AGENT_NOT_FOUND' });
      }
      if (agent.revoked) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'AGENT_REVOKED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      // Verify signature
      const { signatureB64Url, ...payload } = token;
      const messageBytes = new TextEncoder().encode(canonicalize(payload));
      const ok = await verify(b64UrlDecode(signatureB64Url), messageBytes, agent.publicKey);
      if (!ok) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'INVALID_SIGNATURE', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      // Token expiry
      if (token.expiresAt < state.now()) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'POLICY_EXPIRED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      // Find matching policy
      const policies = Array.from(state.policies.values()).filter((p) => p.agentId === agent.id);
      if (policies.length === 0) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'SCOPE_NOT_GRANTED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      for (const p of policies) {
        if (p.revoked) {
          return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'POLICY_REVOKED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
        }
        if (p.expiresAt !== undefined && p.expiresAt < state.now()) {
          return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'POLICY_EXPIRED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
        }
      }

      // Scope check
      const matchingPolicy = policies.find((p) => p.actions.some((a) => a === vctx.action || a === '*'));
      if (!matchingPolicy) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'SCOPE_NOT_GRANTED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      // Amount cap
      if (matchingPolicy.amountMax !== undefined && vctx.amount !== undefined && vctx.amount > matchingPolicy.amountMax) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'SPEND_LIMIT_EXCEEDED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      // BATE gates
      if (agent.trustScore < 100) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'TRUST_SCORE_TOO_LOW', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }
      if (agent.anomalyCount >= 5) {
        return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'DENIED', reason: 'ANOMALY_FLAGGED', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
      }

      // Pass — append VALID audit row
      return await appendAuditAndReturn(state, { tenantId: vctx.tenantId, agentId: agent.id, action: vctx.action, amount: vctx.amount, result: 'VALID', trustScore: agent.trustScore, trustBandAtEvent: trustBandFor(agent.trustScore) });
    },

    // RAR evaluator — mirrors apps/api/src/modules/verify/rar/rar.evaluator.ts
    evaluateRAR: (authDetails, candidate) => {
      for (const detail of authDetails) {
        if (detail.type !== candidate.type) continue;
        if (!detail.actions.includes(candidate.action)) continue;

        // Per-order cap
        if (detail.limits?.per_order_usd !== undefined && candidate.amount_usd !== undefined) {
          if (candidate.amount_usd > detail.limits.per_order_usd) {
            return { ok: false, reason: 'RAR_PER_ORDER_EXCEEDED', matched_detail_type: detail.type };
          }
        }

        // Per-day cap (callers provide cumulative day total in candidate.day_total_usd)
        if (detail.limits?.per_day_usd !== undefined && candidate.day_total_usd !== undefined) {
          if (candidate.day_total_usd + (candidate.amount_usd ?? 0) > detail.limits.per_day_usd) {
            return { ok: false, reason: 'RAR_PER_DAY_EXCEEDED', matched_detail_type: detail.type };
          }
        }

        // Trading hours (UTC hour range)
        if (detail.limits?.trading_hours_utc !== undefined && candidate.utc_hour !== undefined) {
          const [start, end] = detail.limits.trading_hours_utc;
          if (candidate.utc_hour < start || candidate.utc_hour >= end) {
            return { ok: false, reason: 'RAR_OUTSIDE_TRADING_HOURS', matched_detail_type: detail.type };
          }
        }

        return { ok: true, matched_detail_type: detail.type, binding_version: 'aegis-rar-1.0' };
      }
      return { ok: false, reason: 'RAR_NO_MATCH' };
    },

    // Intent manifest — declare + reconcile
    declareIntent: async (agentId, intent) => {
      const agent = state.agents.get(agentId);
      if (!agent) throw new Error(`unknown agent: ${agentId}`);
      const id = `int_${state.rng().toString(36).padStart(6, '0')}`;
      const body = { id, agentId, declared: intent, signedAt: state.now() };
      const sigBytes = await sign(new TextEncoder().encode(canonicalize(body)), state.signingKeypair.privateKey);
      const record: IntentRecord = { ...body, signatureB64Url: b64UrlEncode(sigBytes) };
      state.intents.set(id, record);
      return record;
    },
    reconcileActuals: (intentId, actuals) => {
      const intent = state.intents.get(intentId);
      if (!intent) return { ok: false, mismatch: 'unknown_intent' };
      intent.actuals = actuals;
      // Mismatch policy: amounts must match within 1% tolerance
      const declared = intent.declared.amount ?? 0;
      const actual = actuals.amount ?? 0;
      if (declared === 0 && actual === 0) {
        intent.reconciliation = { ok: true };
        return intent.reconciliation;
      }
      const drift = Math.abs((actual - declared) / Math.max(declared, 1));
      if (drift > 0.01) {
        intent.reconciliation = { ok: false, mismatch: `amount_drift_${(drift * 100).toFixed(1)}pct` };
        return intent.reconciliation;
      }
      intent.reconciliation = { ok: true };
      return intent.reconciliation;
    },

    // MCP per-tool — action becomes `${prefix}${tool}` per peer 2b178d04's hardening
    verifyMcpTool: async (wireToken, tool) => {
      const prefix = 'mcp.fs.';
      return await ctx.verify(wireToken, { tenantId: 't_default', action: `${prefix}${tool}` });
    },

    // Audit chain
    exportAuditChain: () => state.auditChain.slice(),
    verifyAuditChainOffline: async () => {
      let prevHash = GENESIS_PREV_HASH;
      for (const row of state.auditChain) {
        if (row.prevHash !== prevHash) {
          return { valid: false, brokenAt: row.seq, reason: 'prev_hash_mismatch' };
        }
        const { signatureB64Url, ...body } = row;
        const message = buildSignedAuditMessage(body);
        const ok = await verify(b64UrlDecode(signatureB64Url), message, state.signingKeypair.publicKey);
        if (!ok) {
          return { valid: false, brokenAt: row.seq, reason: 'invalid_signature' };
        }
        prevHash = sha256Hex(message);
      }
      return { valid: true };
    },
    tamperWithRow: (seq, mutator) => {
      const idx = state.auditChain.findIndex((r) => r.seq === seq);
      if (idx < 0) throw new Error(`no row with seq ${seq}`);
      state.auditChain[idx] = mutator(state.auditChain[idx]);
    },
  };

  return { ctx, state };
}

async function appendAuditAndReturn(
  state: HarnessState,
  evt: Omit<AuditEventRow, 'seq' | 'timestamp' | 'prevHash' | 'signatureB64Url'>,
): Promise<VerifyResult> {
  const seq = state.auditChain.length + 1;
  const last = state.auditChain[state.auditChain.length - 1];
  const prevHash = last ? sha256Hex(buildSignedAuditMessage(last)) : GENESIS_PREV_HASH;
  const body = { seq, timestamp: state.now(), prevHash, ...evt };
  const sigBytes = await sign(buildSignedAuditMessage(body), state.signingKeypair.privateKey);
  const row: AuditEventRow = { ...body, signatureB64Url: b64UrlEncode(sigBytes) };
  state.auditChain.push(row);
  return {
    valid: evt.result === 'VALID',
    reason: evt.reason,
    trustScore: evt.trustScore,
    trustBand: evt.trustBandAtEvent,
    auditSeq: seq,
  };
}

// ── Scenario contract ────────────────────────────────────────────────

export interface ScenarioContext {
  registerAgent(tenantId: string, opts?: { initialTrust?: number }): Promise<AgentRecord>;
  revokeAgent(agentId: string): void;
  attachPolicy(agentId: string, p: { actions: string[]; amountMax?: number; authorizationDetails?: RarDetail[]; expiresAt?: number }): PolicyRecord;
  revokePolicy(policyId: string): void;
  flagAnomaly(agentId: string, count?: number): void;
  boostTrust(agentId: string, delta: number): void;
  setPlanLimit(tenantId: string, limit: number): void;

  signAction(agentId: string, action: string, amount?: number): Promise<string>;
  verify(token: string, ctx: VerifyContext): Promise<VerifyResult>;
  evaluateRAR(authDetails: RarDetail[], candidate: { type: RarDetail['type']; action: string; amount_usd?: number; day_total_usd?: number; utc_hour?: number }): { ok: boolean; reason?: string; matched_detail_type?: string; binding_version?: string };
  declareIntent(agentId: string, intent: { action: string; amount?: number; meta?: Record<string, unknown> }): Promise<IntentRecord>;
  reconcileActuals(intentId: string, actuals: { amount?: number; meta?: Record<string, unknown> }): { ok: boolean; mismatch?: string };
  verifyMcpTool(token: string, tool: string): Promise<VerifyResult>;

  exportAuditChain(): AuditEventRow[];
  verifyAuditChainOffline(): Promise<{ valid: boolean; brokenAt?: number; reason?: string }>;
  tamperWithRow(seq: number, mutator: (row: AuditEventRow) => AuditEventRow): void;
}

export interface Scenario {
  id: string;
  name: string;
  vertical: 'fintech' | 'treasury' | 'broker-dealer' | 'banking' | 'ai-platform' | 'saas' | 'cross-cutting';
  description: string;
  layers: ReadonlyArray<'L1' | 'L2' | 'L3' | 'L4' | 'intent' | 'mcp'>;
  run: (ctx: ScenarioContext, assert: AssertCtx) => Promise<void>;
}

export interface ScenarioResult {
  scenario: Scenario;
  pass: boolean;
  assertions: ReturnType<AssertCtx['log']['slice']>;
  durationMs: number;
  error?: string;
}
